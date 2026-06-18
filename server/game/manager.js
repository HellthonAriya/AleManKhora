/**
 * AleManKhora — Game manager
 * --------------------------
 * Holds live game rooms in memory, runs matchmaking, handles invite rooms and
 * AI games, and persists results to the database.
 */
import { customAlphabet } from 'nanoid';
import { QuoridorGame } from './engine.js';
import { chooseAction } from './ai.js';
import { Games, applyEloResult } from '../models.js';
import db, { getSettings } from '../db.js';

const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const idGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const VALID_SIZES = [5, 7, 9, 11];
const THEMES = ['emerald', 'midnight', 'sunset', 'sakura', 'mono', 'ocean'];

function sanitizeConfig(cfg = {}) {
  const s = getSettings();
  let size = parseInt(cfg.size, 10);
  if (!VALID_SIZES.includes(size)) size = parseInt(s.default_board_size, 10) || 9;
  let walls = parseInt(cfg.walls, 10);
  if (!Number.isFinite(walls) || walls < 0 || walls > 20) {
    walls = parseInt(s.default_walls, 10) || 10;
  }
  let theme = THEMES.includes(cfg.theme) ? cfg.theme : (s.default_theme || 'emerald');
  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const p0Color = colorRe.test(cfg.p0Color) ? cfg.p0Color : '#36c6ff';
  const p1Color = colorRe.test(cfg.p1Color) ? cfg.p1Color : '#ff6b6b';
  const timeLimit = [0, 30, 60, 120, 300].includes(parseInt(cfg.timeLimit, 10))
    ? parseInt(cfg.timeLimit, 10) : 0;
  return { size, walls, theme, p0Color, p1Color, timeLimit, ranked: !!cfg.ranked };
}

class Room {
  constructor({ id, mode, config, code = null }) {
    this.id = id;
    this.mode = mode; // private|random|ai
    this.code = code;
    this.config = config;
    this.game = new QuoridorGame({ size: config.size, wallsEach: config.walls });
    this.players = [null, null]; // {socketId, userId, guestId, name, color, connected}
    this.spectators = new Set();
    this.status = 'waiting'; // waiting|active|finished|aborted
    this.aiDifficulty = null;
    this.aiSeat = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.rematchVotes = new Set();
  }

  seatOf(socketId) {
    if (this.players[0]?.socketId === socketId) return 0;
    if (this.players[1]?.socketId === socketId) return 1;
    return -1;
  }

  isFull() {
    return this.players[0] && this.players[1];
  }

  publicView() {
    return {
      id: this.id,
      mode: this.mode,
      code: this.code,
      config: this.config,
      status: this.status,
      players: this.players.map((p) =>
        p ? { name: p.name, color: p.color, userId: p.userId, connected: p.connected, elo: p.elo } : null
      ),
      aiSeat: this.aiSeat,
      state: this.game.toState(),
    };
  }
}

export class GameManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string,Room>} */
    this.rooms = new Map();
    /** @type {Map<string,string>} invite code -> roomId */
    this.codes = new Map();
    /** random matchmaking queue: {socketId, identity, config} */
    this.queue = [];
  }

  /* ----------------------------- Room lifecycle --------------------------- */

  createRoom({ mode, config, code }) {
    const id = idGen();
    const room = new Room({ id, mode, config: sanitizeConfig(config), code });
    this.rooms.set(id, room);
    if (code) this.codes.set(code, id);
    Games.insert({
      id, status: 'waiting', mode,
      config: room.config, created_at: room.createdAt,
    });
    return room;
  }

  createPrivate(config) {
    const code = codeGen();
    return this.createRoom({ mode: 'private', config, code });
  }

  createAI(config, difficulty) {
    const room = this.createRoom({ mode: 'ai', config });
    room.aiDifficulty = difficulty || getSettings().ai_difficulty || 'normal';
    room.aiSeat = 1;
    room.players[1] = {
      socketId: null, userId: null, guestId: null,
      name: 'هوش مصنوعی', color: room.config.p1Color, connected: true, elo: '—', isAI: true,
    };
    return room;
  }

  getRoom(id) { return this.rooms.get(id); }
  getRoomByCode(code) {
    const id = this.codes.get((code || '').toUpperCase());
    return id ? this.rooms.get(id) : null;
  }

  /* ------------------------------ Seating --------------------------------- */

  seatPlayer(room, socket, identity, seatHint = null) {
    const player = {
      socketId: socket.id,
      userId: identity.userId ?? null,
      guestId: identity.guestId ?? null,
      name: identity.name,
      color: null,
      connected: true,
      elo: identity.elo ?? null,
    };
    let seat = seatHint;
    if (seat === null || seat < 0 || room.players[seat]) {
      // pick first free seat
      seat = !room.players[0] ? 0 : (!room.players[1] ? 1 : -1);
    }
    if (seat < 0 || room.players[seat]) return -1;
    player.color = seat === 0 ? room.config.p0Color : room.config.p1Color;
    room.players[seat] = player;
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seat = seat;
    return seat;
  }

  maybeStart(room) {
    if (room.isFull() && room.status === 'waiting') {
      room.status = 'active';
      this._persistStart(room);
      this.broadcast(room, 'game:start', room.publicView());
      this.maybeRunAI(room);
      return true;
    }
    return false;
  }

  _persistStart(room) {
    const [p0, p1] = room.players;
    db.prepare(
      `UPDATE games SET status='active', p0_id=?, p1_id=?, p0_name=?, p1_name=? WHERE id=?`
    ).run(p0?.userId ?? null, p1?.userId ?? null, p0?.name ?? null, p1?.name ?? null, room.id);
  }

  /* ------------------------------ Gameplay -------------------------------- */

  applyAction(room, seat, action) {
    if (room.status !== 'active') throw new Error('بازی فعال نیست');
    const result = room.game.apply(seat, action);
    room.lastActivity = Date.now();
    this.broadcast(room, 'game:update', {
      action: { seat, ...action },
      state: result.state,
      turn: result.state.turn,
    });
    if (result.winner !== null) {
      this.finishGame(room, result.winner);
    } else {
      this.maybeRunAI(room);
    }
    return result;
  }

  maybeRunAI(room) {
    if (room.mode !== 'ai' || room.status !== 'active') return;
    if (room.game.turn !== room.aiSeat) return;
    setTimeout(() => {
      if (room.status !== 'active' || room.game.turn !== room.aiSeat) return;
      try {
        const action = chooseAction(room.game, room.aiSeat, room.aiDifficulty);
        if (action) this.applyAction(room, room.aiSeat, action);
      } catch (e) {
        // ignore AI errors
      }
    }, 550 + Math.random() * 500);
  }

  finishGame(room, winnerSeat) {
    room.status = 'finished';
    const winnerPlayer = winnerSeat === null ? null : room.players[winnerSeat];
    const loserPlayer = winnerSeat === null ? null : room.players[1 - winnerSeat];
    let eloResult = null;
    if (
      room.config.ranked &&
      winnerPlayer?.userId && loserPlayer?.userId &&
      !winnerPlayer.isAI && !loserPlayer.isAI
    ) {
      eloResult = applyEloResult(winnerPlayer.userId, loserPlayer.userId);
    }
    Games.finish(room.id, {
      winner: winnerSeat,
      winnerId: winnerPlayer?.userId ?? null,
      state: room.game.toState(),
      moveCount: room.game.moveCount,
    });
    this.broadcast(room, 'game:over', {
      winner: winnerSeat,
      winnerName: winnerPlayer?.name ?? null,
      elo: eloResult,
      state: room.game.toState(),
    });
  }

  resign(room, seat) {
    if (room.status !== 'active') return;
    this.finishGame(room, 1 - seat);
  }

  /* ----------------------------- Matchmaking ------------------------------ */

  enqueue(socket, identity, config) {
    this.dequeue(socket.id);
    const cfg = sanitizeConfig(config);
    // Try to find a compatible opponent (same size & walls & ranked flag).
    const idx = this.queue.findIndex((q) =>
      q.config.size === cfg.size &&
      q.config.walls === cfg.walls &&
      q.config.ranked === cfg.ranked &&
      q.socketId !== socket.id
    );
    if (idx >= 0) {
      const opp = this.queue.splice(idx, 1)[0];
      const room = this.createRoom({ mode: 'random', config: cfg });
      const oppSocket = this.io.sockets.sockets.get(opp.socketId);
      if (!oppSocket) {
        // opponent vanished, requeue self
        this.queue.push({ socketId: socket.id, identity, config: cfg });
        return { queued: true };
      }
      this.seatPlayer(room, oppSocket, opp.identity, 0);
      this.seatPlayer(room, socket, identity, 1);
      oppSocket.emit('match:found', { roomId: room.id, seat: 0 });
      socket.emit('match:found', { roomId: room.id, seat: 1 });
      this.maybeStart(room);
      return { matched: true, roomId: room.id };
    }
    this.queue.push({ socketId: socket.id, identity, config: cfg });
    return { queued: true, position: this.queue.length };
  }

  dequeue(socketId) {
    this.queue = this.queue.filter((q) => q.socketId !== socketId);
  }

  /* --------------------------- Disconnect handling ------------------------ */

  handleDisconnect(socket) {
    this.dequeue(socket.id);
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const seat = room.seatOf(socket.id);
    if (seat >= 0 && room.players[seat]) {
      room.players[seat].connected = false;
      this.broadcast(room, 'player:disconnect', { seat });
      // Give a grace period; if still active and not reconnected, abort.
      if (room.status === 'active') {
        setTimeout(() => {
          const r = this.rooms.get(roomId);
          if (!r) return;
          if (r.status === 'active' && !r.players[seat]?.connected) {
            // opponent wins by abandonment if there is a connected human opponent
            const other = r.players[1 - seat];
            if (other && other.connected && !other.isAI) {
              this.finishGame(r, 1 - seat);
            } else {
              r.status = 'aborted';
              Games.finish(r.id, { status: 'aborted', moveCount: r.game.moveCount });
            }
          }
        }, 30000);
      }
    }
    this.spectatorLeave(room, socket.id);
    this.cleanupMaybe(room);
  }

  reconnect(room, socket, seat) {
    room.players[seat].socketId = socket.id;
    room.players[seat].connected = true;
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seat = seat;
    this.broadcast(room, 'player:reconnect', { seat });
  }

  spectatorJoin(room, socket) {
    room.spectators.add(socket.id);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seat = -1;
  }
  spectatorLeave(room, socketId) {
    room.spectators.delete(socketId);
  }

  cleanupMaybe(room) {
    const anyConnected = room.players.some((p) => p && p.connected && !p.isAI);
    if (!anyConnected && room.spectators.size === 0 &&
        (room.status === 'finished' || room.status === 'aborted' || room.status === 'waiting')) {
      // schedule removal
      setTimeout(() => {
        const r = this.rooms.get(room.id);
        if (!r) return;
        const live = r.players.some((p) => p && p.connected && !p.isAI);
        if (!live && r.spectators.size === 0) {
          if (r.code) this.codes.delete(r.code);
          this.rooms.delete(r.id);
        }
      }, 60000);
    }
  }

  /* ------------------------------- Helpers -------------------------------- */

  broadcast(room, event, payload) {
    this.io.to(room.id).emit(event, payload);
  }

  liveStats() {
    let activeGames = 0;
    for (const r of this.rooms.values()) if (r.status === 'active') activeGames++;
    return {
      rooms: this.rooms.size,
      activeGames,
      queue: this.queue.length,
      online: this.io.engine.clientsCount,
    };
  }
}

export { sanitizeConfig, VALID_SIZES, THEMES };
