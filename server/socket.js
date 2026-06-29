/**
 * AleManKhora — Socket.IO real-time layer
 */
import { verifyToken, COOKIE } from './auth.js';
import { Users, Friends } from './models.js';
import { presence } from './presence.js';

function parseCookies(str = '') {
  const out = {};
  str.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

/** Resolve the identity of a connecting socket from its auth cookie. */
function identityFromSocket(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie || '');
  const token = cookies[COOKIE];
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return { userId: null, guestId: 'anon_' + socket.id.slice(0, 6), name: 'ناشناس', elo: null, isGuest: true };
  }
  if (payload.guest) {
    return { userId: null, guestId: payload.guestId, name: payload.username, elo: null, isGuest: true };
  }
  const user = Users.byId(payload.id);
  if (!user || user.isBanned) {
    return { userId: null, guestId: 'anon_' + socket.id.slice(0, 6), name: 'ناشناس', elo: null, isGuest: true };
  }
  return { userId: user.id, guestId: null, name: user.username, elo: user.elo, isGuest: false };
}

// Whitelisted in-game reaction emojis (validated server-side).
const REACTION_SET = new Set(['👍', '😂', '🔥', '😮', '😢', '👏', '❤️', '🤔', '🎉', '🧠']);

export function registerSocket(io, manager) {
  io.on('connection', (socket) => {
    socket.data.identity = identityFromSocket(socket);
    if (socket.data.identity.userId) presence.add(socket.data.identity.userId, socket.id);

    const emitErr = (msg) => socket.emit('game:error', { error: msg });

    /* ----------------------- Friends: direct invite --------------------- */
    socket.on('friend:invite', ({ toUserId, roomId } = {}, cb) => {
      const me = socket.data.identity;
      if (!me.userId) return cb?.({ ok: false, error: 'برای دعوت باید وارد حساب شوی' });
      const room = manager.getRoom(roomId || socket.data.roomId);
      if (!room) return cb?.({ ok: false, error: 'اتاقی برای دعوت پیدا نشد' });
      const target = parseInt(toUserId, 10);
      if (!Friends.areFriends(me.userId, target)) return cb?.({ ok: false, error: 'با این کاربر دوست نیستی' });
      const sids = presence.socketsOf(target);
      if (!sids.length) return cb?.({ ok: false, error: 'دوستت آنلاین نیست' });
      for (const sid of sids) {
        io.to(sid).emit('friend:invited', {
          fromName: me.name, roomId: room.id, code: room.code, gameType: room.gameType,
        });
      }
      cb?.({ ok: true });
    });

    /* --------------------------- Create games ---------------------------- */
    socket.on('room:createPrivate', (config, cb) => {
      try {
        const room = manager.createPrivate(config || {});
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        // Optionally pre-fill seats with bots chosen at creation time.
        const bots = parseInt(config?.bots, 10) || 0;
        if (bots > 0) manager.fillBots(room, bots, config?.botDifficulty, config?.botPersonality);
        manager.maybeStart(room); // starts immediately if bots filled every seat
        cb?.({ ok: true, roomId: room.id, code: room.code, seat, view: room.publicView(seat) });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    /* ------------------------------ Series ------------------------------- */
    socket.on('room:createSeries', (opts, cb) => {
      try {
        const room = manager.createSeries(opts || {});
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        const bots = parseInt(opts?.bots, 10) || 0;
        if (bots > 0) manager.fillBots(room, bots, opts?.botDifficulty, opts?.botPersonality);
        manager.maybeStart(room);
        cb?.({ ok: true, roomId: room.id, code: room.code, seat, view: room.publicView(seat) });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    // Vote to advance an intermission series to its next game. Every connected
    // human must be ready (mirrors the rematch flow).
    socket.on('series:next', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room?.series || room.series.done || !room.series.intermission) return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      if (seat < 0) return cb?.({ ok: false });
      room.series.readyVotes.add(seat);
      manager.broadcast(room, 'series:ready', { votes: [...room.series.readyVotes] });
      const humans = room.humanSeats().filter((s) => room.players[s]?.connected);
      if (room.series.readyVotes.size >= humans.length) manager.advanceSeries(room);
      cb?.({ ok: true });
    });

    /* ----------------------------- Tournament ---------------------------- */
    socket.on('room:createTournament', (opts, cb) => {
      try {
        const room = manager.createTournament(opts || {});
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        manager.maybeStart(room); // human + first bot opponent → starts immediately
        cb?.({ ok: true, roomId: room.id, seat, view: room.publicView(seat) });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('tournament:next', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room?.tournament || room.tournament.done || !room.tournament.intermission) return cb?.({ ok: false });
      if (room.seatOf(socket.id) !== 0) return cb?.({ ok: false });
      manager.advanceTournament(room);
      cb?.({ ok: true });
    });

    /* ----------------------- Bots in private rooms ----------------------- */
    // Only the host (seat 0) of a non-matchmaking room may add/remove bots,
    // and only while the room is still waiting to start.
    socket.on('room:addBot', ({ seat, difficulty, personality } = {}, cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false, error: 'بازی یافت نشد' });
      if (room.mode === 'random' || room.seatOf(socket.id) !== 0 || room.status !== 'waiting') {
        return cb?.({ ok: false, error: 'مجاز نیست' });
      }
      if (!manager.addBot(room, seat, difficulty, personality)) return cb?.({ ok: false, error: 'صندلی در دسترس نیست' });
      manager.emitPerSeat(room, 'room:update', (vs) => room.publicView(vs));
      manager.maybeStart(room);
      cb?.({ ok: true });
    });
    socket.on('room:removeBot', ({ seat } = {}, cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false });
      if (room.seatOf(socket.id) !== 0 || room.status !== 'waiting') return cb?.({ ok: false });
      if (!manager.removeBot(room, seat)) return cb?.({ ok: false });
      manager.emitPerSeat(room, 'room:update', (vs) => room.publicView(vs));
      cb?.({ ok: true });
    });

    // Host locks the lineup and starts the game.
    socket.on('room:start', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false, error: 'بازی یافت نشد' });
      if (room.seatOf(socket.id) !== 0 || room.status !== 'waiting') return cb?.({ ok: false, error: 'مجاز نیست' });
      if (!room.isFull()) return cb?.({ ok: false, error: 'هنوز همهٔ صندلی‌ها پر نشده‌اند' });
      manager.hostStart(room);
      cb?.({ ok: true });
    });

    socket.on('room:createAI', ({ config, difficulty } = {}, cb) => {
      try {
        const room = manager.createAI(config || {}, difficulty);
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        manager.maybeStart(room);
        cb?.({ ok: true, roomId: room.id, seat, view: room.publicView(seat) });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    /* ------------------------------ Join --------------------------------- */
    socket.on('room:join', ({ roomId, code } = {}, cb) => {
      try {
        let room = roomId ? manager.getRoom(roomId) : manager.getRoomByCode(code);
        if (!room) return cb?.({ ok: false, error: 'بازی یافت نشد' });

        const id = socket.data.identity;

        // Already seated in this room (e.g. the creator navigating into the
        // game view, or any double room:join from the same socket). Don't
        // re-seat — just return the existing seat.
        const mySeat = room.seatOf(socket.id);
        if (mySeat >= 0) {
          return cb?.({ ok: true, roomId: room.id, seat: mySeat, view: room.publicView(mySeat) });
        }
        // Already watching this room.
        if (room.spectators.has(socket.id)) {
          return cb?.({ ok: true, roomId: room.id, seat: -1, view: room.publicView(), spectator: true });
        }

        // Reconnect if this identity already holds a seat.
        for (let s = 0; s < room.players.length; s++) {
          const p = room.players[s];
          if (p && !p.isAI && !p.connected &&
              ((id.userId && p.userId === id.userId) || (id.guestId && p.guestId === id.guestId))) {
            manager.reconnect(room, socket, s);
            return cb?.({ ok: true, roomId: room.id, seat: s, view: room.publicView(s), reconnected: true });
          }
        }

        // A game that is already running or finished, or has no free seat,
        // can only be watched.
        if (room.status !== 'waiting' || room.isFull()) {
          manager.spectatorJoin(room, socket);
          return cb?.({ ok: true, roomId: room.id, seat: -1, view: room.publicView(), spectator: true });
        }
        const seat = manager.seatPlayer(room, socket, id);
        if (seat < 0) return cb?.({ ok: false, error: 'صندلی خالی نیست' });
        cb?.({ ok: true, roomId: room.id, seat, view: room.publicView(seat) });
        manager.emitPerSeat(room, 'room:update', (vs) => room.publicView(vs));
        manager.maybeStart(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    /* --------------------------- Matchmaking ----------------------------- */
    socket.on('match:queue', (config, cb) => {
      const result = manager.enqueue(socket, socket.data.identity, config || {});
      cb?.(result);
    });
    socket.on('match:cancel', (cb) => {
      manager.dequeue(socket.id);
      cb?.({ ok: true });
    });

    /* ----------------------------- Actions ------------------------------- */
    socket.on('game:action', ({ action } = {}, cb) => {
      const roomId = socket.data.roomId;
      const room = roomId && manager.getRoom(roomId);
      if (!room) return cb?.({ ok: false, error: 'بازی یافت نشد' });
      const seat = room.seatOf(socket.id);
      if (seat < 0) return cb?.({ ok: false, error: 'شما بازیکن این بازی نیستید' });
      try {
        manager.applyAction(room, seat, action);
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
        emitErr(e.message);
      }
    });

    socket.on('game:resign', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      if (seat < 0) return cb?.({ ok: false });
      manager.resign(room, seat);
      cb?.({ ok: true });
    });

    // Advance a paused Pasur match to the next round after the scoring reveal.
    socket.on('pasur:nextRound', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.gameType !== 'pasur' || room.game?.phase !== 'round-end') return cb?.({ ok: false });
      if (room.seatOf(socket.id) < 0) return cb?.({ ok: false });
      manager.advancePasurRound(room);
      cb?.({ ok: true });
    });

    socket.on('hokm:nextHand', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.gameType !== 'hokm' || room.game?.phase !== 'hand-end') return cb?.({ ok: false });
      if (room.seatOf(socket.id) < 0) return cb?.({ ok: false });
      manager.advanceHokmHand(room);
      cb?.({ ok: true });
    });

    socket.on('backgammon:nextGame', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.gameType !== 'backgammon' || room.game?.phase !== 'game-end') return cb?.({ ok: false });
      if (room.seatOf(socket.id) < 0) return cb?.({ ok: false });
      manager.advanceBackgammonGame(room);
      cb?.({ ok: true });
    });

    /* ------------------------------ Rematch ------------------------------ */
    socket.on('game:rematch', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.status !== 'finished') return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      if (seat < 0) return cb?.({ ok: false });
      room.rematchVotes.add(seat);
      manager.broadcast(room, 'game:rematchVote', { votes: [...room.rematchVotes] });
      const needed = room.humanSeats().length; // every human must agree
      if (room.rematchVotes.size >= needed) {
        manager.rematchReset(room); // rebuilds the right engine for this game type
      }
      cb?.({ ok: true });
    });

    /* --------------------------- Draw offers (2P) ------------------------ */
    socket.on('game:drawOffer', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.status !== 'active' || room.numPlayers !== 2) return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      if (seat < 0) return cb?.({ ok: false });
      // No spamming: only one outstanding offer at a time.
      if (room.drawOfferBy != null) return cb?.({ ok: false, error: 'یک پیشنهاد مساوی در جریان است' });
      room.drawOfferBy = seat;
      const other = 1 - seat;
      const target = room.players[other];
      if (target?.socketId) {
        io.to(target.socketId).emit('game:drawOffer', { from: seat, name: socket.data.identity.name });
      }
      cb?.({ ok: true });
    });
    socket.on('game:drawCancel', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      // Only the player who made the offer can withdraw it.
      if (seat < 0 || room.drawOfferBy !== seat) return cb?.({ ok: false });
      room.drawOfferBy = null;
      const other = room.players[1 - seat];
      if (other?.socketId) io.to(other.socketId).emit('game:drawCancelled');
      cb?.({ ok: true });
    });
    socket.on('game:drawRespond', ({ accept } = {}, cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || room.status !== 'active') return cb?.({ ok: false });
      const seat = room.seatOf(socket.id);
      if (seat < 0 || room.drawOfferBy == null || room.drawOfferBy === seat) return cb?.({ ok: false });
      const offerer = room.drawOfferBy;
      room.drawOfferBy = null;
      if (accept) {
        manager.acceptDraw(room);
      } else if (room.players[offerer]?.socketId) {
        io.to(room.players[offerer].socketId).emit('game:drawDeclined');
      }
      cb?.({ ok: true });
    });

    /* ----------------------------- Reactions ----------------------------- */
    socket.on('game:reaction', ({ emoji } = {}) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || !REACTION_SET.has(emoji)) return;
      // Light rate-limit: at most one reaction every 350ms per socket.
      const now = Date.now();
      if (now - (socket.data.lastReaction || 0) < 350) return;
      socket.data.lastReaction = now;
      manager.broadcast(room, 'game:reaction', {
        emoji, seat: room.seatOf(socket.id), name: socket.data.identity.name,
      });
    });

    /* ------------------------- Spectator predictions --------------------- */
    socket.on('predict:set', ({ seat } = {}, cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return cb?.({ ok: false });
      if (!manager.setPrediction(room, socket, seat)) return cb?.({ ok: false });
      cb?.({ ok: true });
    });

    /* ------------------------------- Chat -------------------------------- */
    socket.on('chat:message', ({ text } = {}) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room || !text) return;
      const clean = String(text).slice(0, 240);
      manager.broadcast(room, 'chat:message', {
        from: socket.data.identity.name,
        seat: room.seatOf(socket.id),
        text: clean,
        at: Date.now(),
      });
    });

    /* ----------------------------- Presence ------------------------------ */
    socket.on('lobby:stats', (cb) => cb?.(manager.liveStats()));
    socket.on('lobby:games', (cb) => cb?.({ games: manager.liveGames() }));

    /* --------------------------- Leave a room ---------------------------- */
    socket.on('room:leave', (cb) => {
      const room = manager.getRoom(socket.data.roomId);
      if (room) {
        manager.spectatorLeave(room, socket.id);
        if (room.voiceMembers?.has(socket.id)) {
          room.voiceMembers.delete(socket.id);
          for (const sid of room.voiceMembers) io.to(sid).emit('voice:left', { socketId: socket.id });
        }
        socket.leave(room.id);
      }
      socket.data.roomId = null;
      socket.data.seat = -1;
      cb?.({ ok: true });
    });

    /* ========================= Voice chat signaling ========================= */

    socket.on('voice:join', () => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room) return;
      if (!room.voiceMembers) room.voiceMembers = new Set();

      const identity = socket.data.identity;
      const seatIdx = room.seatOf(socket.id);

      // Tell the new member about every existing voice participant.
      for (const sid of room.voiceMembers) {
        const s = io.sockets.sockets.get(sid);
        if (!s) continue;
        socket.emit('voice:joined', {
          socketId: sid,
          name: s.data.identity?.name || '?',
          seat: room.seatOf(sid),
          existingMember: true, // they will wait for our offer
        });
      }

      // Tell existing members about the new participant (they initiate offers).
      for (const sid of room.voiceMembers) {
        io.to(sid).emit('voice:joined', {
          socketId: socket.id,
          name: identity.name,
          seat: seatIdx,
        });
      }

      room.voiceMembers.add(socket.id);
    });

    socket.on('voice:leave', () => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room?.voiceMembers) return;
      room.voiceMembers.delete(socket.id);
      for (const sid of room.voiceMembers) {
        io.to(sid).emit('voice:left', { socketId: socket.id });
      }
    });

    socket.on('voice:signal', ({ to, data }) => {
      if (!to || !data) return;
      io.to(to).emit('voice:signal', { from: socket.id, data });
    });

    socket.on('voice:spectator-request', () => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room?.voiceMembers) return;
      if (!room.voiceRequests) room.voiceRequests = new Map();
      const identity = socket.data.identity;
      room.voiceRequests.set(socket.id, { name: identity.name, votes: new Set() });
      // Notify players who are currently in voice.
      for (const sid of room.voiceMembers) {
        if (room.seatOf(sid) >= 0) {
          io.to(sid).emit('voice:spectator-request', { socketId: socket.id, name: identity.name });
        }
      }
    });

    socket.on('voice:spectator-vote', ({ requesterId, accept }) => {
      const room = manager.getRoom(socket.data.roomId);
      if (!room?.voiceRequests) return;
      const req = room.voiceRequests.get(requesterId);
      if (!req) return;

      if (!accept) {
        room.voiceRequests.delete(requesterId);
        io.to(requesterId).emit('voice:spectator-denied');
        return;
      }

      req.votes.add(socket.id);
      const playerVoiceCount = [...(room.voiceMembers || [])].filter((sid) => room.seatOf(sid) >= 0).length;
      if (req.votes.size >= Math.max(1, playerVoiceCount)) {
        room.voiceRequests.delete(requesterId);
        io.to(requesterId).emit('voice:spectator-granted');
        // Introduce them to existing voice members when they actually emit voice:join.
      }
    });

    /* ================================================================= */

    socket.on('disconnect', () => {
      if (socket.data.identity?.userId) presence.remove(socket.data.identity.userId, socket.id);
      // Clean up voice membership on disconnect
      const room = manager.getRoom(socket.data.roomId);
      if (room?.voiceMembers?.has(socket.id)) {
        room.voiceMembers.delete(socket.id);
        for (const sid of room.voiceMembers) {
          io.to(sid).emit('voice:left', { socketId: socket.id });
        }
      }
      manager.handleDisconnect(socket);
    });
  });
}
