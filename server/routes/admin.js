/**
 * AleManKhora — Admin API routes (require admin auth)
 */
import express from 'express';
import { Users, Games } from '../models.js';
import { getSettings, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';

export default function adminRouter(manager) {
  const router = express.Router();
  router.use(requireAdmin);

  /* ------------------------------ Dashboard ------------------------------- */
  router.get('/stats', (req, res) => {
    res.json({
      users: Users.count(),
      games: Games.stats(),
      live: manager.liveStats(),
    });
  });

  /* -------------------------------- Users --------------------------------- */
  router.get('/users', (req, res) => {
    const q = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json({ users: Users.list({ q, limit, offset }), total: Users.count() });
  });

  router.post('/users/:id/ban', (req, res) => {
    Users.setBanned(parseInt(req.params.id, 10), !!req.body?.banned);
    res.json({ user: Users.byId(parseInt(req.params.id, 10)) });
  });

  router.post('/users/:id/admin', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.auth.id && !req.body?.admin) {
      return res.status(400).json({ error: 'نمی‌توانید دسترسی مدیریت خود را حذف کنید' });
    }
    Users.setAdmin(id, !!req.body?.admin);
    res.json({ user: Users.byId(id) });
  });

  router.post('/users/:id/password', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد' });
    }
    await Users.setPassword(id, password);
    res.json({ ok: true });
  });

  router.delete('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.auth.id) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خود را حذف کنید' });
    }
    Users.remove(id);
    res.json({ ok: true });
  });

  /* -------------------------------- Games --------------------------------- */
  router.get('/games', (req, res) => {
    const status = req.query.status || undefined;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json({ games: Games.list({ status, limit, offset }) });
  });

  /* ------------------------------ Settings -------------------------------- */
  router.get('/settings', (req, res) => {
    res.json({ settings: getSettings() });
  });

  const ALLOWED_SETTINGS = new Set([
    'site_name', 'allow_registration', 'allow_guest', 'default_board_size',
    'default_walls', 'default_theme', 'ai_difficulty', 'announcement', 'min_username_len',
  ]);

  router.patch('/settings', (req, res) => {
    const updates = req.body || {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED_SETTINGS.has(k)) setSetting(k, v);
    }
    res.json({ settings: getSettings() });
  });

  return router;
}
