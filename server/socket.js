/**
 * AleManKhora — Socket.IO real-time layer
 */
import { verifyToken, COOKIE } from './auth.js';
import { Users } from './models.js';

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

export function registerSocket(io, manager) {
  io.on('connection', (socket) => {
    socket.data.identity = identityFromSocket(socket);

    const emitErr = (msg) => socket.emit('game:error', { error: msg });

    /* --------------------------- Create games ---------------------------- */
    socket.on('room:createPrivate', (config, cb) => {
      try {
        const room = manager.createPrivate(config || {});
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        cb?.({ ok: true, roomId: room.id, code: room.code, seat, view: room.publicView() });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('room:createAI', ({ config, difficulty } = {}, cb) => {
      try {
        const room = manager.createAI(config || {}, difficulty);
        const seat = manager.seatPlayer(room, socket, socket.data.identity, 0);
        manager.maybeStart(room);
        cb?.({ ok: true, roomId: room.id, seat, view: room.publicView() });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    /* ------------------------------ Join --------------------------------- */
    socket.on('room:join', ({ roomId, code } = {}, cb) => {
      try {
        let room = roomId ? manager.getRoom(roomId) : manager.getRoomByCode(code);
        if (!room) return cb?.({ ok: false, error: 'بازی یافت نشد' });

        // Reconnect if this identity already holds a seat.
        const id = socket.data.identity;
        for (let s = 0; s < room.players.length; s++) {
          const p = room.players[s];
          if (p && !p.isAI && !p.connected &&
              ((id.userId && p.userId === id.userId) || (id.guestId && p.guestId === id.guestId))) {
            manager.reconnect(room, socket, s);
            return cb?.({ ok: true, roomId: room.id, seat: s, view: room.publicView(), reconnected: true });
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
        cb?.({ ok: true, roomId: room.id, seat, view: room.publicView() });
        manager.broadcast(room, 'room:update', room.publicView());
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
        // Reset the engine and clocks, keeping seats, colors and AI.
        room.game = new (room.game.constructor)({
          size: room.config.size, wallsEach: room.config.walls, players: room.numPlayers,
        });
        room.clock.remaining = new Array(room.numPlayers).fill(room.clock.limitMs);
        room.status = 'active';
        room.rematchVotes.clear();
        manager.startClock(room);
        manager.broadcast(room, 'game:start', room.publicView());
        manager.maybeRunAI(room);
      }
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
