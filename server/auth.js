/**
 * AleManKhora — Authentication (JWT cookies + guest sessions)
 */
import jwt from 'jsonwebtoken';
import { Users } from './models.js';

const JWT_SECRET = process.env.JWT_SECRET || 'alemankhora-dev-secret-change-me';
const COOKIE = 'amk_token';
const MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function setAuthCookie(res, payload) {
  const token = signToken(payload);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE,
  });
  return token;
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

/**
 * Express middleware: attaches req.auth = { id, username, isGuest, isAdmin }
 * for registered users, or guest payloads. Never throws.
 */
export function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE];
  req.auth = null;
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();

  if (payload.guest) {
    req.auth = {
      id: null,
      guestId: payload.guestId,
      username: payload.username,
      isGuest: true,
      isAdmin: false,
    };
    return next();
  }

  const user = Users.byId(payload.id);
  if (!user || user.isBanned) return next();
  Users.touch(user.id);
  req.auth = {
    id: user.id,
    username: user.username,
    isGuest: false,
    isAdmin: user.isAdmin,
    user,
  };
  next();
}

export function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'احراز هویت لازم است' });
  next();
}

export function requireUser(req, res, next) {
  if (!req.auth || req.auth.isGuest) {
    return res.status(401).json({ error: 'برای این عملیات باید وارد حساب شوید' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth || !req.auth.isAdmin) {
    return res.status(403).json({ error: 'دسترسی مدیریت لازم است' });
  }
  next();
}

export { JWT_SECRET, COOKIE };
