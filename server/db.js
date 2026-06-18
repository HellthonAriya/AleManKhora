/**
 * AleManKhora — Database layer (SQLite via better-sqlite3)
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'alemankhora.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  elo           INTEGER NOT NULL DEFAULT 1000,
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  avatar_color  TEXT NOT NULL DEFAULT '#36c6ff',
  prefs         TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER
);

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'waiting', -- waiting|active|finished|aborted
  mode          TEXT NOT NULL DEFAULT 'private', -- private|random|ai
  p0_id         INTEGER,
  p1_id         INTEGER,
  p0_name       TEXT,
  p1_name       TEXT,
  config        TEXT NOT NULL DEFAULT '{}',
  state         TEXT,
  winner        INTEGER,
  winner_id     INTEGER,
  move_count    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
`);

/* --------------------------- Schema migrations ---------------------------- */
// Add player 2 & 3 columns for 4-player games (idempotent).
const gameCols = db.prepare("PRAGMA table_info(games)").all().map((c) => c.name);
const addCol = (name, type = 'TEXT') => {
  if (!gameCols.includes(name)) db.exec(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
};
addCol('p2_id', 'INTEGER');
addCol('p3_id', 'INTEGER');
addCol('p2_name', 'TEXT');
addCol('p3_name', 'TEXT');

/* --------------------------- Default settings ----------------------------- */
const DEFAULT_SETTINGS = {
  site_name: 'اِل من خورا',
  allow_registration: 'true',
  allow_guest: 'true',
  default_board_size: '9',
  default_walls: '10',
  default_theme: 'emerald',
  ai_difficulty: 'normal',
  announcement: '',
  min_username_len: '3',
};

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!getSetting.get(k)) setSettingStmt.run(k, v);
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

export default db;
