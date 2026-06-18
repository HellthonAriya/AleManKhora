/**
 * AleManKhora — Game manager
 * --------------------------
 * Holds live game rooms in memory, runs matchmaking, handles invite rooms,
 * AI games, chess clocks, 4-player games and live spectating, and persists
 * results to the database.
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
const DEFAULT_COLORS = ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff'];
const TIME_LIMITS = [0, 30, 60, 120, 180, 300, 600]; // seconds per player
const TIME_INCREMENTS = [0, 2, 3, 5, 10];             // seconds added per move

// If the player to move makes no move for this long, the game expires:
// in 2-player the opponent wins; in 4-player the idle player is eliminated
// and play continues.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// How long a disconnected player has to reconnect before being eliminated.
const RECONNECT_GRACE_MS = 2 * 60 * 1000; // 2 minutes

function sanitizeConfig(cfg = {}) {
  const s = getSettings();
  let size = parseInt(cfg.size, 10);
  if (!VALID_SIZES.includes(size)) size = parseInt(s.default_board_size, 10) || 9;

  const players = parseInt(cfg.players, 10) === 4 ? 4 : 2;

  let walls = parseInt(cfg.walls, 10);
  const wallCap = players === 4 ? 12 : 20;
  if (!Number.isFinite(walls) || walls < 0 || walls > wallCap) {
    walls = players === 4
      ? Math.max(3, Math.round((size * size) / 16))
      : (parseInt(s.default_walls, 10) || 10);
  }

  const theme = THEMES.includes(cfg.theme) ? cfg.theme : (s.default_theme || 'emerald');

  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const colors = [];
  const incoming = Array.isArray(cfg.colors) ? cfg.colors
    : [cfg.p0Color, cfg.p1Color, cfg.p2Color, cfg.p3Color];
  for (let i = 0; i < players; i++) {
    colors.push(colorRe.test(incoming?.[i]) ? incoming[i] : DEFAULT_COLORS[i]);
  }

  const timeLimit = TIME_LIMITS.includes(parseInt(cfg.timeLimit, 10)) ? parseInt(cfg.timeLimit, 10) : 0;
  const timeIncrement = TIME_INCREMENTS.includes(parseInt(cfg.timeIncrement, 10)) ? parseInt(cfg.timeIncrement, 10) : 0;

  return {
    size, players, walls, theme, colors,
    p0Color: colors[0], p1Color: colors[1],
    timeLimit, timeIncrement,
    ranked: !!cfg.ranked && players === 2,
  };
}

class Room {
  constructor({ id, mode, config, code = null }) {
    this.id = id;
    this.mode = mode; // private|random|ai
    this.code = code;
    this.config = config;
    this.numPlayers = config.players;
    this.game = new QuoridorGame({ size: config.size, wallsEach: config.walls, players: config.players });
    this.players = new Array(this.numPlayers).fill(null);
    this.spectators = new Set();
    this.status = 'waiting'; // waiting|active|finished|aborted
    this.aiDifficulty = null;
    this.aiSeats = new Set();
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.idleTimer = null;
    this.rematchVotes = new Set();
    // chess clock
    const ms = (config.timeLimit || 0) * 1000;
    this.clock = {
      enabled: ms > 0,
      limitMs: ms,
      incMs: (config.timeIncrement || 0) * 1000,
      remaining: new Array(this.numPlayers).fill(ms),
      turnStart: 0,
      timer: null,
    };
  }

  seatOf(socketId) {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i] && this.players[i].socketId === socketId) return i;
    }
    return -1;
  }
  isFull() { return this.players.every((p) => p); }
  humanSeats() { return this.players.map((p, i) => (p && !p.isAI ? i : -1)).filter((i) => i >= 0); }

  publicView() {
    return {
      id: this.id,
      mode: this.mode,
      code: this.code,
      config: this.config,
      numPlayers: this.numPlayers,
      status: this.status,
      players: this.players.map((p) =>
        p ? { name: p.name, color: p.color, userId: p.userId, connected: p.connected, elo: p.elo, isAI: !!p.isAI } : null
      ),
      aiSeats: [...this.aiSeats],
      spectators: this.spectators.size,
      clock: this.clockView(),
      state: this.game.toState(),
    };
  }

  clockView() {
    return {
      enabled: this.clock.enabled,
      limitMs: this.clock.limitMs,
      incMs: this.clock.incMs,
      remaining: [...this.clock.remaining],
      turn: this.game.turn,
      running: this.status === 'active' && this.game.winner === null,
      serverNow: Date.now(),
      turnStart: this.clock.turnStart,
    };
  }
}

export class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.codes = new Map();
    this.queue = [];
  }

  /* ----------------------------- Room lifecycle --------------------------- */

  createRoom({ mode, config, code }) {
    const id = idGen();
    const room = new Room({ id, mode, config: sanitizeConfig(config), code });
    this.rooms.set(id, room);
    if (code) this.codes.set(code, id);
    Games.insert({ id, status: 'waiting', mode, config: room.config, created_at: room.createdAt });
    return room;
  }

  createPrivate(config) {
    return this.createRoom({ mode: 'private', config, code: codeGen() });
  }

  createAI(config, difficulty) {
    const room = this.createRoom({ mode: 'ai', config });
    room.aiDifficulty = difficulty || getSettings().ai_difficulty || 'normal';
    // All seats except 0 are AI.
    for (let s = 1; s < room.numPlayers; s++) {
      room.aiSeats.add(s);
      room.players[s] = {
        socketId: null, userId: null, guestId: null,
        name: room.numPlayers > 2 ? `هوش مصنوعی ${s}` : 'هوش مصنوعی',
        color: room.config.colors[s], connected: true, elo: '—', isAI: true,
      };
    }
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
      seat = room.players.findIndex((p) => !p);
    }
    if (seat < 0 || room.players[seat]) return -1;
    player.color = room.config.colors[seat];
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
      this.startClock(room);
      this.resetIdleTimer(room);
      this.broadcast(room, 'game:start', room.publicView());
      this.maybeRunAI(room);
      return true;
    }
    return false;
  }

  _persistStart(room) {
    const p = room.players;
    db.prepare(
      `UPDATE games SET status='active', p0_id=?, p1_id=?, p2_id=?, p3_id=?,
        p0_name=?, p1_name=?, p2_name=?, p3_name=? WHERE id=?`
    ).run(
      p[0]?.userId ?? null, p[1]?.userId ?? null, p[2]?.userId ?? null, p[3]?.userId ?? null,
      p[0]?.name ?? null, p[1]?.name ?? null, p[2]?.name ?? null, p[3]?.name ?? null,
      room.id
    );
  }

  /* ------------------------------- Clock ---------------------------------- */

  startClock(room) {
    if (!room.clock.enabled) return;
    room.clock.turnStart = Date.now();
    this.scheduleFlag(room);
    this.broadcast(room, 'game:clock', room.clockView());
  }

  scheduleFlag(room) {
    if (room.clock.timer) { clearTimeout(room.clock.timer); room.clock.timer = null; }
    if (!room.clock.enabled || room.status !== 'active' || room.game.winner !== null) return;
    const seat = room.game.turn;
    const remaining = room.clock.remaining[seat];
    room.clock.timer = setTimeout(() => this.onFlag(room, seat), Math.max(0, remaining));
  }

  /** Deduct elapsed time from the player who just acted; apply increment. */
  chargeClock(room, seat) {
    if (!room.clock.enabled) return;
    const now = Date.now();
    const elapsed = now - room.clock.turnStart;
    room.clock.remaining[seat] = Math.max(0, room.clock.remaining[seat] - elapsed) + room.clock.incMs;
    room.clock.turnStart = now;
  }

  onFlag(room, seat) {
    if (room.status !== 'active' || room.game.winner !== null) return;
    if (room.game.turn !== seat || room.game.eliminated[seat]) return;
    room.clock.remaining[seat] = 0;
    this.playerOut(room, seat, 'timeout');
  }

  /* ------------------------- Inactivity timeout --------------------------- */

  /** (Re)start the per-turn inactivity timer for the player who must move. */
  resetIdleTimer(room) {
    this.clearIdleTimer(room);
    if (room.status !== 'active' || room.game.winner !== null) return;
    const seat = room.game.turn;
    // AI seats move on their own; no idle expiry for them.
    if (room.aiSeats.has(seat)) return;
    room.idleTimer = setTimeout(() => this.onIdle(room, seat), IDLE_TIMEOUT_MS);
  }

  clearIdleTimer(room) {
    if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
  }

  onIdle(room, seat) {
    if (room.status !== 'active' || room.game.winner !== null) return;
    if (room.game.turn !== seat || room.game.eliminated[seat]) return;
    // Idle player forfeits this turn. In 2-player the engine ends the game
    // (opponent wins); in 4-player they are removed and play continues.
    this.playerOut(room, seat, 'idle');
  }

  /* ------------------------------ Gameplay -------------------------------- */

  applyAction(room, seat, action) {
    if (room.status !== 'active') throw new Error('بازی فعال نیست');
    const result = room.game.apply(seat, action);
    this.chargeClock(room, seat);
    room.lastActivity = Date.now();
    this.broadcast(room, 'game:update', {
      action: { seat, ...action },
      state: result.state,
      turn: result.state.turn,
    });
    if (result.winner !== null) {
      this.finishGame(room, result.winner);
    } else {
      this.scheduleFlag(room);
      this.resetIdleTimer(room);
      this.broadcast(room, 'game:clock', room.clockView());
      this.maybeRunAI(room);
    }
    return result;
  }

  /** Remove a player from a live game (resign / timeout / abandon). */
  playerOut(room, seat, reason = 'resign') {
    if (room.status !== 'active') return;
    const over = room.game.eliminate(seat);
    this.broadcast(room, 'player:eliminated', { seat, reason, state: room.game.toState() });
    if (over || room.game.winner !== null) {
      this.finishGame(room, room.game.winner);
    } else {
      this.scheduleFlag(room);
      this.resetIdleTimer(room);
      this.broadcast(room, 'game:clock', room.clockView());
      this.maybeRunAI(room);
    }
  }

  maybeRunAI(room) {
    if (room.aiSeats.size === 0 || room.status !== 'active') return;
    const seat = room.game.turn;
    if (!room.aiSeats.has(seat)) return;
    setTimeout(() => {
      if (room.status !== 'active' || room.game.turn !== seat) return;
      try {
        const action = chooseAction(room.game, seat, room.aiDifficulty);
        if (action) this.applyAction(room, seat, action);
      } catch { /* ignore AI errors */ }
    }, 550 + Math.random() * 500);
  }

  finishGame(room, winnerSeat) {
    if (room.status === 'finished') return;
    room.status = 'finished';
    if (room.clock.timer) { clearTimeout(room.clock.timer); room.clock.timer = null; }
    this.clearIdleTimer(room);

    const winnerPlayer = winnerSeat == null ? null : room.players[winnerSeat];
    let eloResult = null;
    if (room.numPlayers === 2 && room.config.ranked) {
      const loserPlayer = room.players[1 - winnerSeat];
      if (winnerPlayer?.userId && loserPlayer?.userId && !winnerPlayer.isAI && !loserPlayer.isAI) {
        eloResult = applyEloResult(winnerPlayer.userId, loserPlayer.userId);
      }
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
      clock: room.clockView(),
      state: room.game.toState(),
    });
  }

  resign(room, seat) {
    if (room.status !== 'active') return;
    this.playerOut(room, seat, 'resign');
  }

  /* ----------------------------- Matchmaking ------------------------------ */

  enqueue(socket, identity, config) {
    this.dequeue(socket.id);
    const cfg = sanitizeConfig(config);
    const compatible = (q) =>
      q.config.size === cfg.size && q.config.walls === cfg.walls &&
      q.config.players === cfg.players && q.config.ranked === cfg.ranked &&
      q.config.timeLimit === cfg.timeLimit && q.socketId !== socket.id;

    // Gather enough players (2 or 4) before creating a room.
    const waiting = this.queue.filter(compatible);
    if (waiting.length >= cfg.players - 1) {
      const group = waiting.slice(0, cfg.players - 1);
      const groupIds = new Set(group.map((g) => g.socketId));
      this.queue = this.queue.filter((q) => !groupIds.has(q.socketId));
      const room = this.createRoom({ mode: 'random', config: cfg });
      const allMembers = [...group.map((g) => ({ socketId: g.socketId, identity: g.identity })),
        { socketId: socket.id, identity }];
      let ok = true;
      allMembers.forEach((m, i) => {
        const sock = m.socketId === socket.id ? socket : this.io.sockets.sockets.get(m.socketId);
        if (!sock) { ok = false; return; }
        const seat = this.seatPlayer(room, sock, m.identity, i);
        sock.emit('match:found', { roomId: room.id, seat });
      });
      if (!ok) {
        // Some opponent vanished mid-match; requeue this socket.
        this.queue.push({ socketId: socket.id, identity, config: cfg });
        return { queued: true };
      }
      this.maybeStart(room);
      return { matched: true, roomId: room.id };
    }
    this.queue.push({ socketId: socket.id, identity, config: cfg });
    return { queued: true, position: this.queue.length, need: cfg.players };
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
      if (room.status === 'active') {
        // Pause the idle timer while the player is away — they can't move
        // when disconnected; resume it on reconnect.
        if (room.game.turn === seat && !room.game.eliminated[seat]) {
          this.clearIdleTimer(room);
        }
        setTimeout(() => {
          const r = this.rooms.get(roomId);
          if (!r || r.status !== 'active') return;
          if (!r.players[seat]?.connected && !r.game.eliminated[seat]) {
            // Eliminate the abandoning player; engine decides if game ends.
            const humansLeft = r.humanSeats().filter((s) => s !== seat && r.players[s]?.connected);
            if (humansLeft.length === 0 && r.aiSeats.size === 0) {
              r.status = 'aborted';
              if (r.clock.timer) clearTimeout(r.clock.timer);
              this.clearIdleTimer(r);
              Games.finish(r.id, { status: 'aborted', moveCount: r.game.moveCount });
            } else {
              this.playerOut(r, seat, 'abandon');
            }
          }
        }, RECONNECT_GRACE_MS);
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
    // Resume idle timer if it's their turn (was paused on disconnect).
    if (room.status === 'active' && room.game.winner === null &&
        room.game.turn === seat && !room.game.eliminated[seat]) {
      this.resetIdleTimer(room);
    }
  }

  spectatorJoin(room, socket) {
    room.spectators.add(socket.id);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seat = -1;
    this.broadcast(room, 'spectator:update', { count: room.spectators.size });
  }
  spectatorLeave(room, socketId) {
    if (room.spectators.delete(socketId)) {
      this.broadcast(room, 'spectator:update', { count: room.spectators.size });
    }
  }

  cleanupMaybe(room) {
    const anyConnected = room.players.some((p) => p && p.connected && !p.isAI);
    if (!anyConnected && room.spectators.size === 0 &&
        (room.status === 'finished' || room.status === 'aborted' || room.status === 'waiting')) {
      setTimeout(() => {
        const r = this.rooms.get(room.id);
        if (!r) return;
        const live = r.players.some((p) => p && p.connected && !p.isAI);
        if (!live && r.spectators.size === 0) {
          if (r.clock.timer) clearTimeout(r.clock.timer);
          this.clearIdleTimer(r);
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

  /** Summaries of active games for the lobby's "watch live" panel. */
  liveGames() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.status !== 'active') continue;
      out.push({
        id: r.id,
        mode: r.mode,
        numPlayers: r.numPlayers,
        size: r.config.size,
        moveCount: r.game.moveCount,
        spectators: r.spectators.size,
        clock: r.clock.enabled,
        players: r.players.map((p) => p ? { name: p.name, color: p.color, isAI: !!p.isAI } : null),
      });
    }
    return out.sort((a, b) => b.spectators - a.spectators).slice(0, 40);
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

export { sanitizeConfig, VALID_SIZES, THEMES, TIME_LIMITS, TIME_INCREMENTS, DEFAULT_COLORS };
