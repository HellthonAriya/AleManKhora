/**
 * AleManKhora — REST API routes
 */
import express from 'express';
import { customAlphabet } from 'nanoid';
import { Users, Games } from '../models.js';
import { getSettings } from '../db.js';
import {
  setAuthCookie, clearAuthCookie, requireAuth, requireUser,
} from '../auth.js';

const guestIdGen = customAlphabet('0123456789', 6);
const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_؀-ۿ]{3,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ------------------------------- Public ----------------------------------- */

router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    siteName: s.site_name,
    allowRegistration: s.allow_registration === 'true',
    allowGuest: s.allow_guest === 'true',
    defaultBoardSize: parseInt(s.default_board_size, 10),
    defaultWalls: parseInt(s.default_walls, 10),
    defaultTheme: s.default_theme,
    announcement: s.announcement || '',
  });
});

router.get('/me', (req, res) => {
  if (!req.auth) return res.json({ auth: null });
  if (req.auth.isGuest) {
    return res.json({
      auth: { isGuest: true, username: req.auth.username, guestId: req.auth.guestId },
    });
  }
  res.json({ auth: { isGuest: false, ...Users.byId(req.auth.id) } });
});

/* ------------------------------- Auth ------------------------------------- */

router.post('/auth/register', async (req, res) => {
  const s = getSettings();
  if (s.allow_registration !== 'true') {
    return res.status(403).json({ error: 'ثبت‌نام در حال حاضر غیرفعال است' });
  }
  const { username, email, password } = req.body || {};
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: 'نام کاربری نامعتبر است (۳ تا ۲۰ کاراکتر)' });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'ایمیل نامعتبر است' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد' });
  }
  if (Users.byUsername(username)) {
    return res.status(409).json({ error: 'این نام کاربری قبلاً استفاده شده است' });
  }
  if (email && Users.byEmail(email)) {
    return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });
  }
  const isFirst = Users.count() === 0; // first registered user becomes admin
  const user = await Users.create({ username, email, password, isAdmin: isFirst });
  setAuthCookie(res, { id: user.id, username: user.username });
  res.json({ user, firstAdmin: isFirst });
});

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await Users.verify(username, password);
  if (!user) return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  if (user.isBanned) return res.status(403).json({ error: 'حساب شما مسدود شده است' });
  setAuthCookie(res, { id: user.id, username: user.username });
  res.json({ user });
});

router.post('/auth/guest', (req, res) => {
  const s = getSettings();
  if (s.allow_guest !== 'true') {
    return res.status(403).json({ error: 'بازی مهمان غیرفعال است' });
  }
  let name = (req.body?.username || '').trim();
  if (!name || !USERNAME_RE.test(name)) name = 'مهمان' + guestIdGen();
  const guestId = 'g_' + guestIdGen() + guestIdGen();
  setAuthCookie(res, { guest: true, guestId, username: name });
  res.json({ guest: { username: name, guestId, isGuest: true } });
});

router.post('/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* ------------------------------ Profile ----------------------------------- */

router.get('/profile/:username', (req, res) => {
  const row = Users.byUsername(req.params.username);
  if (!row) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const user = Users.byId(row.id);
  const recent = Games.recentForUser(row.id, 15).map((g) => ({
    id: g.id, mode: g.mode, winnerId: g.winner_id,
    p0_name: g.p0_name, p1_name: g.p1_name,
    moveCount: g.move_count, finishedAt: g.finished_at,
    result: g.winner_id === row.id ? 'win' : (g.winner_id ? 'loss' : 'draw'),
  }));
  res.json({ user, recent });
});

router.patch('/profile', requireUser, (req, res) => {
  const { avatarColor, prefs } = req.body || {};
  if (avatarColor && /^#[0-9a-fA-F]{6}$/.test(avatarColor)) {
    Users.setAvatarColor(req.auth.id, avatarColor);
  }
  if (prefs && typeof prefs === 'object') {
    Users.updatePrefs(req.auth.id, prefs);
  }
  res.json({ user: Users.byId(req.auth.id) });
});

router.post('/profile/password', requireUser, async (req, res) => {
  const { current, next } = req.body || {};
  const row = Users.byUsername(req.auth.username);
  const ok = await Users.verify(row.username, current);
  if (!ok) return res.status(401).json({ error: 'رمز فعلی اشتباه است' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'رمز جدید کوتاه است' });
  await Users.setPassword(req.auth.id, next);
  res.json({ ok: true });
});

/* ---------------------------- Leaderboard --------------------------------- */

router.get('/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  res.json({ leaderboard: Users.leaderboard(limit) });
});

export default router;
