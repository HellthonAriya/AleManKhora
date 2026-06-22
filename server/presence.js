/**
 * AleManKhora — Online presence
 * =============================
 * Tracks which logged-in users currently have at least one live socket, and
 * the socket ids per user (so we can push direct invites). Shared by the
 * socket layer (writes) and the REST API (reads).
 */

const online = new Map(); // userId -> Set<socketId>

export const presence = {
  add(userId, socketId) {
    if (!userId) return;
    let set = online.get(userId);
    if (!set) { set = new Set(); online.set(userId, set); }
    set.add(socketId);
  },
  remove(userId, socketId) {
    if (!userId) return;
    const set = online.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) online.delete(userId);
  },
  isOnline(userId) { return online.has(userId); },
  onlineIds() { return [...online.keys()]; },
  socketsOf(userId) { const s = online.get(userId); return s ? [...s] : []; },
  count() { return online.size; },
};
