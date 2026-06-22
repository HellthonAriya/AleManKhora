/**
 * AleManKhora — Data models & helpers (users, games, stats, ELO)
 */
import bcrypt from 'bcryptjs';
import db from './db.js';

/* ------------------------------- Users ----------------------------------- */

const publicUserCols = `id, username, email, is_admin, is_banned, elo,
  games_played, wins, losses, draws, avatar_color, prefs, created_at, last_seen`;

function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isAdmin: !!row.is_admin,
    isBanned: !!row.is_banned,
    elo: row.elo,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    avatarColor: row.avatar_color,
    prefs: safeParse(row.prefs, {}),
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export const Users = {
  byId(id) {
    return shapeUser(db.prepare(`SELECT ${publicUserCols} FROM users WHERE id = ?`).get(id));
  },
  byUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  },
  byEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  },
  async create({ username, email, password, isAdmin = false }) {
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO users(username, email, password_hash, is_admin, created_at, last_seen)
       VALUES(?,?,?,?,?,?)`
    ).run(username, email || null, hash, isAdmin ? 1 : 0, now, now);
    return Users.byId(info.lastInsertRowid);
  },
  async verify(usernameOrEmail, password) {
    const row =
      Users.byUsername(usernameOrEmail) || Users.byEmail(usernameOrEmail);
    if (!row || !row.password_hash) return null;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return null;
    return shapeUser(row);
  },
  touch(id) {
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id);
  },
  updatePrefs(id, prefs) {
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), id);
    return Users.byId(id);
  },
  setAvatarColor(id, color) {
    db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(color, id);
  },
  list({ q = '', limit = 50, offset = 0 } = {}) {
    const like = `%${q}%`;
    return db.prepare(
      `SELECT ${publicUserCols} FROM users
       WHERE username LIKE ? OR IFNULL(email,'') LIKE ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(like, like, limit, offset).map(shapeUser);
  },
  count() {
    return db.prepare('SELECT COUNT(*) n FROM users').get().n;
  },
  setBanned(id, banned) {
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(banned ? 1 : 0, id);
  },
  setAdmin(id, admin) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, id);
  },
  remove(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
  async setPassword(id, password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  },
  leaderboard(limit = 100) {
    return db.prepare(
      `SELECT ${publicUserCols} FROM users
       WHERE is_banned = 0 AND games_played > 0
       ORDER BY elo DESC, wins DESC LIMIT ?`
    ).all(limit).map(shapeUser);
  },
};

/* --------------------------------- ELO ------------------------------------ */

export function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Apply an ELO update for a finished ranked game.
 * @param {number} winnerId
 * @param {number} loserId
 * @returns {{winner:object, loser:object}|null}
 */
export function applyEloResult(winnerId, loserId) {
  if (!winnerId || !loserId) return null;
  const w = db.prepare('SELECT * FROM users WHERE id = ?').get(winnerId);
  const l = db.prepare('SELECT * FROM users WHERE id = ?').get(loserId);
  if (!w || !l) return null;
  const K = 32;
  const ew = expectedScore(w.elo, l.elo);
  const el = expectedScore(l.elo, w.elo);
  const newW = Math.round(w.elo + K * (1 - ew));
  const newL = Math.round(l.elo + K * (0 - el));
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE users SET elo = ?, games_played = games_played + 1, wins = wins + 1 WHERE id = ?'
    ).run(newW, winnerId);
    db.prepare(
      'UPDATE users SET elo = ?, games_played = games_played + 1, losses = losses + 1 WHERE id = ?'
    ).run(Math.max(100, newL), loserId);
  });
  tx();
  return {
    winner: { id: winnerId, before: w.elo, after: newW },
    loser: { id: loserId, before: l.elo, after: Math.max(100, newL) },
  };
}

/**
 * Apply an ELO update for a drawn ranked game (each scores 0.5).
 * Counts as a game played and a draw for both, with no win/loss.
 */
export function applyEloDraw(aId, bId) {
  if (!aId || !bId) return null;
  const a = db.prepare('SELECT * FROM users WHERE id = ?').get(aId);
  const b = db.prepare('SELECT * FROM users WHERE id = ?').get(bId);
  if (!a || !b) return null;
  const K = 32;
  const ea = expectedScore(a.elo, b.elo);
  const eb = expectedScore(b.elo, a.elo);
  const newA = Math.max(100, Math.round(a.elo + K * (0.5 - ea)));
  const newB = Math.max(100, Math.round(b.elo + K * (0.5 - eb)));
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET elo = ?, games_played = games_played + 1, draws = draws + 1 WHERE id = ?').run(newA, aId);
    db.prepare('UPDATE users SET elo = ?, games_played = games_played + 1, draws = draws + 1 WHERE id = ?').run(newB, bId);
  });
  tx();
  return {
    winner: { id: aId, before: a.elo, after: newA },
    loser: { id: bId, before: b.elo, after: newB },
    draw: true,
  };
}

/* -------------------------------- Games ----------------------------------- */

export const Games = {
  insert(game) {
    db.prepare(
      `INSERT INTO games(id, status, mode, p0_id, p1_id, p0_name, p1_name, config, state, move_count, created_at, game_type)
       VALUES(@id, @status, @mode, @p0_id, @p1_id, @p0_name, @p1_name, @config, @state, @move_count, @created_at, @game_type)`
    ).run({
      id: game.id,
      status: game.status,
      mode: game.mode,
      p0_id: game.p0_id ?? null,
      p1_id: game.p1_id ?? null,
      p0_name: game.p0_name ?? null,
      p1_name: game.p1_name ?? null,
      config: JSON.stringify(game.config ?? {}),
      state: game.state ? JSON.stringify(game.state) : null,
      move_count: game.move_count ?? 0,
      created_at: game.created_at ?? Date.now(),
      game_type: game.config?.gameType ?? 'quoridor',
    });
  },
  finish(id, { winner, winnerId, state, moveCount, status = 'finished' }) {
    db.prepare(
      `UPDATE games SET status=?, winner=?, winner_id=?, state=?, move_count=?, finished_at=? WHERE id=?`
    ).run(status, winner ?? null, winnerId ?? null,
      state ? JSON.stringify(state) : null, moveCount ?? 0, Date.now(), id);
  },
  recentForUser(userId, limit = 20) {
    return db.prepare(
      `SELECT * FROM games
       WHERE (p0_id = ? OR p1_id = ? OR p2_id = ? OR p3_id = ?) AND status = 'finished'
       ORDER BY finished_at DESC LIMIT ?`
    ).all(userId, userId, userId, userId, limit);
  },
  list({ status, limit = 50, offset = 0 } = {}) {
    if (status) {
      return db.prepare('SELECT * FROM games WHERE status=? ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(status, limit, offset);
    }
    return db.prepare('SELECT * FROM games ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
  },
  stats() {
    const total = db.prepare('SELECT COUNT(*) n FROM games').get().n;
    const finished = db.prepare("SELECT COUNT(*) n FROM games WHERE status='finished'").get().n;
    const active = db.prepare("SELECT COUNT(*) n FROM games WHERE status='active'").get().n;
    return { total, finished, active };
  },
};

/* ----------------------------- Per-game stats ----------------------------- */

export const GameStats = {
  /** Record one finished game for a user in a given game type. */
  record({ userId, gameType, result }) {
    if (!userId || !gameType) return;
    const col = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
    db.prepare(
      `INSERT INTO game_stats(user_id, game_type, played, ${col})
       VALUES(?, ?, 1, 1)
       ON CONFLICT(user_id, game_type) DO UPDATE SET
         played = played + 1, ${col} = ${col} + 1`
    ).run(userId, gameType);
  },

  /** Ensure a stats row exists and return its current rating. */
  _rating(userId, gameType) {
    const row = db.prepare('SELECT rating FROM game_stats WHERE user_id=? AND game_type=?').get(userId, gameType);
    return row ? row.rating : 1000;
  },

  /** Apply a per-game ELO update between two rated users (2-player result). */
  applyRating(winnerId, loserId, gameType, draw = false) {
    if (!winnerId || !loserId || !gameType) return null;
    const rw = GameStats._rating(winnerId, gameType);
    const rl = GameStats._rating(loserId, gameType);
    const K = 24;
    const ew = expectedScore(rw, rl);
    const el = expectedScore(rl, rw);
    const sw = draw ? 0.5 : 1;
    const sl = draw ? 0.5 : 0;
    const newW = Math.max(100, Math.round(rw + K * (sw - ew)));
    const newL = Math.max(100, Math.round(rl + K * (sl - el)));
    db.prepare('UPDATE game_stats SET rating=? WHERE user_id=? AND game_type=?').run(newW, winnerId, gameType);
    db.prepare('UPDATE game_stats SET rating=? WHERE user_id=? AND game_type=?').run(newL, loserId, gameType);
    return { winner: { id: winnerId, before: rw, after: newW }, loser: { id: loserId, before: rl, after: newL } };
  },

  forUser(userId) {
    return db.prepare(
      'SELECT game_type, played, wins, losses, draws, rating FROM game_stats WHERE user_id=? ORDER BY played DESC'
    ).all(userId);
  },

  /**
   * Head-to-head record between two users across all finished games where both
   * occupied a seat. Returns wins/losses/draws from `userId`'s perspective.
   */
  /** Update and return a user's overall win streak after one finished game. */
  bumpStreak(userId, won) {
    if (!userId) return 0;
    const row = db.prepare('SELECT win_streak FROM users WHERE id=?').get(userId);
    const next = won ? (row?.win_streak || 0) + 1 : 0;
    db.prepare('UPDATE users SET win_streak=? WHERE id=?').run(next, userId);
    return next;
  },

  headToHead(userId, opponentId) {
    if (!userId || !opponentId) return { wins: 0, losses: 0, draws: 0, total: 0 };
    const rows = db.prepare(
      `SELECT winner_id FROM games
        WHERE status='finished'
          AND (p0_id=@me OR p1_id=@me OR p2_id=@me OR p3_id=@me)
          AND (p0_id=@opp OR p1_id=@opp OR p2_id=@opp OR p3_id=@opp)`
    ).all({ me: userId, opp: opponentId });
    let wins = 0, losses = 0, draws = 0;
    for (const r of rows) {
      if (r.winner_id == null) draws++;
      else if (r.winner_id === userId) wins++;
      else if (r.winner_id === opponentId) losses++;
      else draws++; // a third party won (4-player) — neutral for this pair
    }
    return { wins, losses, draws, total: rows.length };
  },
};

/* ----------------------------- Achievements ------------------------------- */

export const Achievements = {
  earnedCodes(userId) {
    if (!userId) return [];
    return db.prepare('SELECT code FROM achievements WHERE user_id=?').all(userId).map((r) => r.code);
  },
  earned(userId) {
    if (!userId) return [];
    return db.prepare('SELECT code, earned_at FROM achievements WHERE user_id=? ORDER BY earned_at DESC').all(userId);
  },
  /** Insert if absent; returns true when newly granted. */
  grant(userId, code) {
    if (!userId) return false;
    const info = db.prepare(
      'INSERT OR IGNORE INTO achievements(user_id, code, earned_at) VALUES(?,?,?)'
    ).run(userId, code, Date.now());
    return info.changes > 0;
  },
};
