/**
 * AleManKhora — Game manager
 * --------------------------
 * Holds live game rooms in memory, runs matchmaking, handles invite rooms,
 * AI games, chess clocks, 4-player games and live spectating, and persists
 * results to the database.
 */
import { customAlphabet } from 'nanoid';
import { QuoridorGame } from './engine.js';
import { ChessGame, randomChessSetup } from './chess.js';
import { TicTacToeGame } from './tictactoe.js';
import { GomokuGame } from './gomoku.js';
import { OthelloGame } from './othello.js';
import { DotsGame } from './dots.js';
import { BackgammonGame } from './backgammon.js';
import { HokmGame } from './hokm.js';
import { PasurGame } from './pasur.js';
import { chooseAction } from './ai.js';
import { chooseChessAction } from './chessAI.js';
import { chooseTicTacToeAction } from './tictactoeAI.js';
import { chooseGomokuAction } from './gomokuAI.js';
import { chooseOthelloAction } from './othelloAI.js';
import { chooseDotsAction } from './dotsAI.js';
import { chooseBackgammonAction } from './backgammonAI.js';
import { chooseHokmAction } from './hokmAI.js';
import { choosePasurAction } from './pasurAI.js';
import { Games, GameStats, Achievements, Users, applyEloResult, applyEloDraw } from '../models.js';
import { evaluateAchievements, ACHIEVEMENT_MAP } from '../../public/js/achievements.js';
import db, { getSettings } from '../db.js';

const GAME_TYPES = ['quoridor', 'chess', 'chess4', 'chesszade', 'tictactoe', 'gomoku', 'othello', 'dots', 'backgammon', 'hokm', 'pasur'];
// The simple 2-player board games that share one lightweight customizer/config.
const SIMPLE_TYPES = ['tictactoe', 'gomoku', 'othello', 'dots', 'backgammon'];

/** Build the right rules engine for a (sanitized) game configuration. */
function buildEngine(gameType, config) {
  switch (gameType) {
    case 'chess': return new ChessGame({ variant: '2' });
    case 'chess4': return new ChessGame({ variant: config.teams ? '4team' : '4' });
    case 'chesszade': return new ChessGame({ variant: '2', setup: randomChessSetup({ randomPawns: config.randomPawns, mirror: config.mirror }) });
    case 'tictactoe': return new TicTacToeGame();
    case 'gomoku': return new GomokuGame({ size: config.size || 15 });
    case 'othello': return new OthelloGame();
    case 'dots': return new DotsGame({ rows: config.rows || 5, cols: config.cols || 5 });
    case 'backgammon': return new BackgammonGame();
    case 'hokm': return new HokmGame({ variant: config.variant });
    case 'pasur': return new PasurGame();
    default: return new QuoridorGame({ size: config.size, wallsEach: config.walls, players: config.players });
  }
}

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
const RECONNECT_GRACE_MS = 3 * 60 * 1000; // 3 minutes

const CHESS_BOARD_THEMES = ['classic', 'green', 'blue', 'wood', 'gray', 'midnight'];
const CHESS_COLORS_2 = ['#f3f1ea', '#2b2b30'];
const CHESS_COLORS_4 = ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'];

// Default piece colours for the simple 2-player board games.
const SIMPLE_DEFAULT_COLORS = {
  tictactoe: ['#36c6ff', '#ff6b6b'],
  gomoku: ['#1b1d22', '#f1ece0'],
  othello: ['#1b1d22', '#f1ece0'],
  dots: ['#36c6ff', '#ff6b6b'],
  backgammon: ['#efe9dc', '#21242b'],
};
const GOMOKU_SIZES = [13, 15, 19];
const DOTS_SIZES = [4, 5, 6, 7];

function sanitizeSimpleConfig(cfg, gameType) {
  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const defaults = SIMPLE_DEFAULT_COLORS[gameType] || ['#36c6ff', '#ff6b6b'];
  const incoming = Array.isArray(cfg.colors) ? cfg.colors : [cfg.p0Color, cfg.p1Color];
  const colors = [0, 1].map((i) => (colorRe.test(incoming?.[i]) ? incoming[i] : defaults[i]));

  const timeLimit = TIME_LIMITS.includes(parseInt(cfg.timeLimit, 10)) ? parseInt(cfg.timeLimit, 10) : 0;
  const timeIncrement = TIME_INCREMENTS.includes(parseInt(cfg.timeIncrement, 10)) ? parseInt(cfg.timeIncrement, 10) : 0;

  const out = {
    gameType, players: 2, colors,
    p0Color: colors[0], p1Color: colors[1],
    timeLimit, timeIncrement, ranked: false,
  };
  if (gameType === 'gomoku') {
    out.size = GOMOKU_SIZES.includes(parseInt(cfg.size, 10)) ? parseInt(cfg.size, 10) : 15;
  }
  if (gameType === 'dots') {
    const n = DOTS_SIZES.includes(parseInt(cfg.rows, 10)) ? parseInt(cfg.rows, 10) : 5;
    out.rows = n; out.cols = n;
  }
  return out;
}

function sanitizeChessConfig(cfg, gameType) {
  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const players = gameType === 'chess4' ? 4 : 2;
  const defaults = players === 4 ? CHESS_COLORS_4 : CHESS_COLORS_2;
  const incoming = Array.isArray(cfg.colors) ? cfg.colors : [];
  const colors = [];
  for (let i = 0; i < players; i++) colors.push(colorRe.test(incoming[i]) ? incoming[i] : defaults[i]);

  const boardTheme = CHESS_BOARD_THEMES.includes(cfg.boardTheme) ? cfg.boardTheme : 'classic';
  const timeLimit = TIME_LIMITS.includes(parseInt(cfg.timeLimit, 10)) ? parseInt(cfg.timeLimit, 10) : 0;
  const timeIncrement = TIME_INCREMENTS.includes(parseInt(cfg.timeIncrement, 10)) ? parseInt(cfg.timeIncrement, 10) : 0;
  const teams = gameType === 'chess4' ? !!cfg.teams : false;

  return {
    gameType, players, colors, boardTheme, teams,
    p0Color: colors[0], p1Color: colors[1],
    timeLimit, timeIncrement,
    ranked: gameType === 'chess' ? !!cfg.ranked : false,
    // شطرنج زاده‌ای options (ignored by other chess types)
    randomPawns: gameType === 'chesszade' ? !!cfg.randomPawns : false,
    mirror: gameType === 'chesszade' ? (cfg.mirror !== false) : false,
  };
}

const HOKM_DEFAULT_COLORS = ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'];
function sanitizeHokmConfig(cfg) {
  const variant = ['2', '3', '4'].includes(String(cfg.variant)) ? String(cfg.variant) : '4';
  const players = Number(variant);
  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const incoming = Array.isArray(cfg.colors) ? cfg.colors : [];
  const colors = [];
  for (let i = 0; i < players; i++) colors.push(colorRe.test(incoming[i]) ? incoming[i] : HOKM_DEFAULT_COLORS[i]);
  const timeLimit = TIME_LIMITS.includes(parseInt(cfg.timeLimit, 10)) ? parseInt(cfg.timeLimit, 10) : 0;
  const timeIncrement = TIME_INCREMENTS.includes(parseInt(cfg.timeIncrement, 10)) ? parseInt(cfg.timeIncrement, 10) : 0;
  return {
    gameType: 'hokm', variant, players, teams: variant === '4', colors,
    p0Color: colors[0], p1Color: colors[1],
    timeLimit, timeIncrement, ranked: false,
  };
}

const PASUR_DEFAULT_COLORS = ['#e7503a', '#3d7fe0'];
function sanitizePasurConfig(cfg) {
  const colorRe = /^#[0-9a-fA-F]{6}$/;
  const incoming = Array.isArray(cfg.colors) ? cfg.colors : [cfg.p0Color, cfg.p1Color];
  const colors = [0, 1].map((i) => (colorRe.test(incoming?.[i]) ? incoming[i] : PASUR_DEFAULT_COLORS[i]));
  const timeLimit = TIME_LIMITS.includes(parseInt(cfg.timeLimit, 10)) ? parseInt(cfg.timeLimit, 10) : 0;
  const timeIncrement = TIME_INCREMENTS.includes(parseInt(cfg.timeIncrement, 10)) ? parseInt(cfg.timeIncrement, 10) : 0;
  return {
    gameType: 'pasur', players: 2, teams: false, colors,
    p0Color: colors[0], p1Color: colors[1],
    timeLimit, timeIncrement, ranked: false,
  };
}

function sanitizeConfig(cfg = {}) {
  const gameType = GAME_TYPES.includes(cfg.gameType) ? cfg.gameType : 'quoridor';
  if (gameType === 'chess' || gameType === 'chess4' || gameType === 'chesszade') return sanitizeChessConfig(cfg, gameType);
  if (gameType === 'hokm') return sanitizeHokmConfig(cfg);
  if (gameType === 'pasur') return sanitizePasurConfig(cfg);
  if (SIMPLE_TYPES.includes(gameType)) return sanitizeSimpleConfig(cfg, gameType);

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
    gameType: 'quoridor',
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
    this.gameType = config.gameType || 'quoridor';
    this.numPlayers = config.players;
    this.game = buildEngine(this.gameType, config);
    this.players = new Array(this.numPlayers).fill(null);
    this.spectators = new Set();
    this.status = 'waiting'; // waiting|active|finished|aborted
    this.aiDifficulty = null;
    this.aiSeats = new Set();
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.idleTimer = null;
    this.rematchVotes = new Set();
    this.predictions = new Map(); // spectator socketId -> { seat, userId }
    this.series = null; // set for multi-game "league" rooms
    this.tournament = null; // set for knockout rooms
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

  /** Game state as seen by `viewerSeat` (hidden-info games redact other hands). */
  stateFor(viewerSeat = -1) {
    return (this.game.hidden && typeof this.game.toStateFor === 'function')
      ? this.game.toStateFor(viewerSeat)
      : this.game.toState();
  }

  publicView(viewerSeat = -1) {
    return {
      id: this.id,
      mode: this.mode,
      gameType: this.gameType,
      code: this.code,
      config: this.config,
      numPlayers: this.numPlayers,
      status: this.status,
      players: this.players.map((p) =>
        p ? { name: p.name, color: p.color, userId: p.userId, connected: p.connected, elo: p.elo, isAI: !!p.isAI, personality: p.personality || null } : null
      ),
      aiSeats: [...this.aiSeats],
      spectators: this.spectators.size,
      clock: this.clockView(),
      state: this.stateFor(viewerSeat),
      series: this.seriesView(),
      tournament: this.tournamentView(),
    };
  }

  tournamentView() {
    const t = this.tournament;
    if (!t) return null;
    return {
      size: t.size, round: t.round, totalRounds: t.totalRounds,
      path: t.path.map((p) => ({ ...p })), done: !!t.done, champion: t.champion,
      intermission: !!t.intermission,
    };
  }

  /** Public summary of the series (playlist, progress, scoreboard). */
  seriesView() {
    if (!this.series) return null;
    return {
      index: this.series.index,
      total: this.series.configs.length,
      scores: [...this.series.scores],
      games: this.series.configs.map((c) => c.gameType),
      done: !!this.series.done,
      intermission: !!this.series.intermission,
    };
  }

  clockView() {
    return {
      enabled: this.clock.enabled,
      limitMs: this.clock.limitMs,
      incMs: this.clock.incMs,
      remaining: [...this.clock.remaining],
      turn: this.game.turn,
      running: this.status === 'active' && !this.game.isOver(),
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
      this.addBot(room, s, room.aiDifficulty);
    }
    return room;
  }

  /** Build a bot player object for a given seat. */
  _makeBot(room, seat, difficulty, personality) {
    const PERSONAS = { balanced: '', aggressive: ' ⚔️', defensive: ' 🛡️' };
    const persona = ['balanced', 'aggressive', 'defensive'].includes(personality) ? personality : 'balanced';
    return {
      socketId: null, userId: null, guestId: null,
      name: (room.numPlayers > 2 ? `هوش مصنوعی ${seat}` : 'هوش مصنوعی') + (PERSONAS[persona] || ''),
      color: room.config.colors[seat], connected: true, elo: '—', isAI: true,
      aiDifficulty: ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal',
      personality: persona,
    };
  }

  /** Seat a bot at a specific empty seat (host-managed mixed rooms). Seat 0 is
   *  reserved for the host, so bots only fill seats >= 1. Returns true on success. */
  addBot(room, seat, difficulty, personality) {
    if (room.status !== 'waiting') return false;
    seat = parseInt(seat, 10);
    if (!Number.isInteger(seat) || seat < 1 || seat >= room.numPlayers) return false;
    if (room.players[seat]) return false; // occupied
    room.players[seat] = this._makeBot(room, seat, difficulty, personality);
    room.aiSeats.add(seat);
    return true;
  }

  /** Remove a bot previously seated at `seat`. Returns true on success. */
  removeBot(room, seat) {
    if (room.status !== 'waiting') return false;
    seat = parseInt(seat, 10);
    const p = room.players[seat];
    if (!p || !p.isAI) return false;
    room.players[seat] = null;
    room.aiSeats.delete(seat);
    return true;
  }

  /** Fill the highest `count` empty seats with bots (used at room creation). */
  fillBots(room, count, difficulty, personality) {
    let added = 0;
    for (let s = room.numPlayers - 1; s >= 1 && added < count; s--) {
      if (!room.players[s] && this.addBot(room, s, difficulty, personality)) added++;
    }
    return added;
  }

  /* ------------------------------- Series --------------------------------- */

  // Which games are available for an N-player series.
  static SERIES_GAMES = {
    2: ['quoridor', 'chess', 'chesszade', 'hokm', 'pasur', 'backgammon', 'othello', 'gomoku', 'dots', 'tictactoe'],
    3: ['hokm'],
    4: ['quoridor', 'chess4', 'hokm'],
  };

  /** Build a sanitized config for one game in an N-player series. */
  _seriesConfig(gameType, players, { timeLimit = 0 } = {}) {
    const base = { gameType, timeLimit, timeIncrement: 0 };
    if (gameType === 'quoridor') base.players = players;
    if (gameType === 'hokm') base.variant = String(players);
    return sanitizeConfig(base);
  }

  /**
   * Create a "league" room: a fixed roster plays a playlist of games back to
   * back, accumulating points. All games share the same player count.
   */
  createSeries({ playlist, players, timeLimit }) {
    const n = [2, 3, 4].includes(parseInt(players, 10)) ? parseInt(players, 10) : 2;
    const allowed = GameManager.SERIES_GAMES[n];
    const games = (Array.isArray(playlist) ? playlist : [])
      .filter((g) => allowed.includes(g)).slice(0, 12);
    if (games.length < 2) throw new Error('برای یک سری حداقل دو بازی انتخاب کن');
    const configs = games.map((g) => this._seriesConfig(g, n, { timeLimit }));
    const room = this.createRoom({ mode: 'series', config: configs[0], code: codeGen() });
    room.series = {
      configs, index: 0,
      scores: new Array(room.numPlayers).fill(0),
      readyVotes: new Set(),
    };
    return room;
  }

  /** Award series points for a finished game (team-aware). */
  _scoreSeriesGame(room, { winnerSeat, isDraw }) {
    const sc = room.series.scores;
    const teams = !!room.config.teams;
    const wt = room.game.winningTeam ?? null;
    if (isDraw || winnerSeat == null) {
      if (room.numPlayers === 2) { sc[0] += 0.5; sc[1] += 0.5; }
    } else if (teams && wt != null) {
      for (let i = 0; i < room.numPlayers; i++) if (i % 2 === wt) sc[i] += 1;
    } else {
      sc[winnerSeat] += 1;
    }
  }

  /** Advance an intermission series to its next game (all humans ready). */
  advanceSeries(room) {
    if (!room.series || room.series.done) return;
    room.series.index++;
    room.series.intermission = false;
    room.series.readyVotes = new Set();
    const cfg = room.series.configs[room.series.index];
    room.config = cfg;
    room.gameType = cfg.gameType;
    room.game = buildEngine(cfg.gameType, cfg);
    room.rematchVotes.clear();
    room.predictions.clear();
    for (let s = 0; s < room.numPlayers; s++) {
      if (room.players[s]) room.players[s].color = cfg.colors[s];
    }
    room.clock.limitMs = (cfg.timeLimit || 0) * 1000;
    room.clock.incMs = (cfg.timeIncrement || 0) * 1000;
    room.clock.enabled = room.clock.limitMs > 0;
    room.clock.remaining = new Array(room.numPlayers).fill(room.clock.limitMs);
    room.status = 'active';
    this.startClock(room);
    this.resetIdleTimer(room);
    this.emitPerSeat(room, 'game:start', (s) => room.publicView(s));
    this.maybeRunAI(room);
  }

  /* ----------------------------- Tournament ------------------------------- */

  // 2-player games that can host a knockout.
  static TOURNAMENT_GAMES = ['quoridor', 'chess', 'chesszade', 'hokm', 'pasur', 'backgammon', 'othello', 'gomoku', 'dots', 'tictactoe'];

  _bump(diff) { return diff === 'easy' ? 'normal' : diff === 'normal' ? 'hard' : 'hard'; }
  _roundDifficulty(t, round) {
    if (round >= t.totalRounds - 1) return 'hard';        // final
    if (round >= t.totalRounds - 2) return this._bump(t.baseDifficulty); // semi
    return t.baseDifficulty;
  }

  /** Build the bot opponent for the human's match in the given round. */
  _setTournamentOpponent(room) {
    const t = room.tournament;
    const diff = this._roundDifficulty(t, t.round);
    const roundName = t.totalRounds - t.round === 1 ? 'فینال'
      : t.totalRounds - t.round === 2 ? 'نیمه‌نهایی'
      : t.totalRounds - t.round === 3 ? 'یک‌چهارم' : `دور ${t.round + 1}`;
    const name = `حریفِ ${roundName}`;
    room.players[1] = this._makeBot(room, 1, diff, 'balanced');
    room.players[1].name = name;
    room.aiSeats = new Set([1]);
    return name;
  }

  /**
   * Create a single-elimination knockout: the human climbs a bracket of
   * `size` (4 or 8) by beating one opponent per round, difficulty ramping up.
   */
  createTournament({ gameType, size, difficulty }) {
    if (!GameManager.TOURNAMENT_GAMES.includes(gameType)) throw new Error('این بازی برای تورنمنت پشتیبانی نمی‌شود');
    const n = [4, 8].includes(parseInt(size, 10)) ? parseInt(size, 10) : 4;
    const cfg = this._seriesConfig(gameType, 2, {});
    const room = this.createRoom({ mode: 'tournament', config: cfg, code: codeGen() });
    room.tournament = {
      gameType, size: n, baseDifficulty: ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal',
      round: 0, totalRounds: Math.round(Math.log2(n)),
      path: [], done: false, champion: null, intermission: false, readyVotes: new Set(),
    };
    const opp = this._setTournamentOpponent(room);
    room.tournament.path.push({ opponent: opp, result: null, field: n });
    return room;
  }

  _scoreTournament(room, { winnerSeat, isDraw }) {
    const t = room.tournament;
    const cur = t.path[t.path.length - 1];
    if (isDraw || winnerSeat == null) { cur.result = 'draw'; return; } // replay same round
    if (winnerSeat === 0) {
      cur.result = 'win';
      if (t.round >= t.totalRounds - 1) { t.done = true; t.champion = 0; }
    } else {
      cur.result = 'loss'; t.done = true; t.champion = 1;
    }
  }

  /** Advance the knockout: replay on a draw, otherwise climb to the next round. */
  advanceTournament(room) {
    const t = room.tournament;
    if (!t || t.done) return;
    t.intermission = false; t.readyVotes = new Set();
    const last = t.path[t.path.length - 1];
    if (last.result === 'win') {
      t.round++;
      const opp = this._setTournamentOpponent(room);
      t.path.push({ opponent: opp, result: null, field: Math.max(2, t.size >> t.round) });
    } else {
      // draw → replay the same round with a fresh opponent of equal strength
      this._setTournamentOpponent(room);
      last.result = null;
    }
    room.game = buildEngine(room.gameType, room.config);
    room.rematchVotes.clear();
    room.clock.remaining = new Array(room.numPlayers).fill(room.clock.limitMs);
    room.status = 'active';
    this.startClock(room);
    this.resetIdleTimer(room);
    this.emitPerSeat(room, 'game:start', (s) => room.publicView(s));
    this.maybeRunAI(room);
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
      this.emitPerSeat(room, 'game:start', (s) => room.publicView(s));
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
    room.clock.paused = false;
    room.clock.turnStart = Date.now();
    this.scheduleFlag(room);
    this.broadcast(room, 'game:clock', room.clockView());
  }

  scheduleFlag(room) {
    if (room.clock.timer) { clearTimeout(room.clock.timer); room.clock.timer = null; }
    if (!room.clock.enabled || room.status !== 'active' || room.game.isOver()) return;
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
    if (room.status !== 'active' || room.game.isOver()) return;
    if (room.game.turn !== seat || room.game.eliminated[seat]) return;
    room.clock.remaining[seat] = 0;
    this.playerOut(room, seat, 'timeout');
  }

  /* ------------------------- Inactivity timeout --------------------------- */

  /** (Re)start the per-turn inactivity timer for the player who must move. */
  resetIdleTimer(room) {
    this.clearIdleTimer(room);
    if (room.status !== 'active' || room.game.isOver()) return;
    const seat = room.game.turn;
    // AI seats move on their own; no idle expiry for them.
    if (room.aiSeats.has(seat)) return;
    room.idleTimer = setTimeout(() => this.onIdle(room, seat), IDLE_TIMEOUT_MS);
  }

  clearIdleTimer(room) {
    if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
  }

  onIdle(room, seat) {
    if (room.status !== 'active' || room.game.isOver()) return;
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
    this.emitPerSeat(room, 'game:update', (s) => ({
      action: { seat, ...action },
      state: room.stateFor(s),
      turn: result.state.turn,
    }));
    if (room.game.isOver()) {
      this.finishGame(room, room.game.winner);
    } else {
      this.scheduleFlag(room);
      this.resetIdleTimer(room);
      this.broadcast(room, 'game:clock', room.clockView());
      if (!this.maybeEndBotGame(room)) this.maybeRunAI(room);
    }
    return result;
  }

  /** Dispatch to the right AI for this room's game type. Each bot may carry its
   *  own difficulty (mixed rooms); fall back to the room-wide difficulty. */
  pickAIAction(room, seat) {
    const diff = room.players[seat]?.aiDifficulty || room.aiDifficulty || 'normal';
    const persona = room.players[seat]?.personality || 'balanced';
    return this._chooseAI(room.game, room.gameType, seat, diff, persona);
  }

  /** Game-type-agnostic AI dispatch (also used to simulate bot-vs-bot matches). */
  _chooseAI(game, gameType, seat, diff = 'normal', persona = 'balanced') {
    switch (gameType) {
      case 'chess': case 'chess4': case 'chesszade': return chooseChessAction(game, seat, diff, persona);
      case 'tictactoe': return chooseTicTacToeAction(game, seat, diff, persona);
      case 'gomoku': return chooseGomokuAction(game, seat, diff, persona);
      case 'othello': return chooseOthelloAction(game, seat, diff, persona);
      case 'dots': return chooseDotsAction(game, seat, diff, persona);
      case 'backgammon': return chooseBackgammonAction(game, seat, diff, persona);
      case 'hokm': return chooseHokmAction(game, seat, diff, persona);
      case 'pasur': return choosePasurAction(game, seat, diff, persona);
      default: return chooseAction(game, seat, diff, persona);
    }
  }

  /**
   * When every still-active player is an AI (all humans are out), bots can
   * shuffle forever without forcing mate. End the game and declare the
   * strongest remaining side as the winner so a result is always announced.
   * Returns true if it ended the game.
   */
  maybeEndBotGame(room) {
    if (room.status !== 'active' || room.game.isOver()) return false;
    if (room.aiSeats.size === 0) return false;
    const active = room.game.activePlayers();
    if (!active.length) return false;
    const humansLeft = active.filter((s) => !room.aiSeats.has(s));
    if (humansLeft.length > 0) return false; // a human is still playing — let it run

    // Only bots remain. Crown the leader (team-aware via material) so the
    // result reflects who was actually ahead.
    let winner = active[0];
    if (typeof room.game.materialBalance === 'function') {
      let bestMat = -Infinity;
      for (const s of active) {
        const m = room.game.materialBalance(s);
        if (m > bestMat) { bestMat = m; winner = s; }
      }
    }
    room.game.forceWinner?.(winner, 'bots-only');
    this.finishGame(room, winner);
    return true;
  }

  /** Evaluate & grant any newly-earned achievements for one human player and
   *  push a toast to their socket. Best-effort; never throws into game flow. */
  _awardAchievements(player, { gameType, result, gameSweep }) {
    const won = result === 'win';
    const winStreak = GameStats.bumpStreak(player.userId, won);
    const stats = GameStats.forUser(player.userId);
    let totalPlayed = 0, totalWins = 0, distinctGamesWon = 0;
    const gameWins = {};
    for (const r of stats) {
      totalPlayed += r.played; totalWins += r.wins;
      gameWins[r.game_type] = r.wins;
      if (r.wins >= 1) distinctGamesWon++;
    }
    const ctx = {
      totalPlayed, totalWins, gameWins, distinctGamesWon, winStreak,
      gameType, won, draw: result === 'draw', hokmSweep: won && gameSweep,
    };
    const already = new Set(Achievements.earnedCodes(player.userId));
    const fresh = [];
    for (const code of evaluateAchievements(ctx)) {
      if (already.has(code)) continue;
      if (Achievements.grant(player.userId, code)) {
        const def = ACHIEVEMENT_MAP[code];
        fresh.push({ code, icon: def?.icon || '🏆', name: def?.name || code, desc: def?.desc || '' });
      }
    }
    if (fresh.length && player.socketId) {
      this.io.to(player.socketId).emit('achievement:earned', { achievements: fresh });
    }
  }

  /** Remove a player from a live game (resign / timeout / abandon). */
  playerOut(room, seat, reason = 'resign') {
    if (room.status !== 'active') return;
    const over = room.game.eliminate(seat);
    this.emitPerSeat(room, 'player:eliminated', (s) => ({ seat, reason, state: room.stateFor(s) }));
    if (over || room.game.isOver()) {
      this.finishGame(room, room.game.winner);
    } else {
      this.scheduleFlag(room);
      this.resetIdleTimer(room);
      this.broadcast(room, 'game:clock', room.clockView());
      if (!this.maybeEndBotGame(room)) this.maybeRunAI(room);
    }
  }

  maybeRunAI(room) {
    if (room.aiSeats.size === 0 || room.status !== 'active') return;
    const seat = room.game.turn;
    if (!room.aiSeats.has(seat)) return;
    setTimeout(() => {
      if (room.status !== 'active' || room.game.turn !== seat) return;
      try {
        const action = this.pickAIAction(room, seat);
        if (action) this.applyAction(room, seat, action);
      } catch { /* ignore AI errors */ }
    }, this.aiThinkDelay(room));
  }

  /** How long the AI should "think" before acting — paced so client-side
   *  animations (especially Hokm's card flights and trick-hold) finish first
   *  and moves don't fire rapid-fire on top of each other. */
  aiThinkDelay(room) {
    const g = room.game;
    if (g.gameType === 'hokm' && g.phase === 'play') {
      // Leader about to start a brand-new trick.
      if (g.trick.length === 0) {
        // After at least one completed trick, wait for the client to finish
        // displaying the previous trick (~2.4s hold) before dealing the next.
        if (g.trickNumber > 0) return 2700;
        return 1500; // first lead right after the trump burst settles
      }
      return 950 + Math.random() * 350; // mid-trick: relaxed, one card at a time
    }
    if (g.gameType === 'pasur') return 850 + Math.random() * 450; // unhurried card play
    return 550 + Math.random() * 500;
  }

  finishGame(room, winnerSeat) {
    if (room.status === 'finished') return;
    room.status = 'finished';
    if (room.clock.timer) { clearTimeout(room.clock.timer); room.clock.timer = null; }
    this.clearIdleTimer(room);

    const isDraw = winnerSeat == null && room.game.draw === true;
    const winnerPlayer = winnerSeat == null ? null : room.players[winnerSeat];
    const endReason = room.game.endReason || null;

    let eloResult = null;
    if (room.numPlayers === 2 && room.config.ranked) {
      const p0 = room.players[0], p1 = room.players[1];
      const bothRated = p0?.userId && p1?.userId && !p0.isAI && !p1.isAI;
      if (bothRated && isDraw) {
        eloResult = applyEloDraw(p0.userId, p1.userId);
      } else if (bothRated && winnerPlayer) {
        const loserPlayer = room.players[1 - winnerSeat];
        eloResult = applyEloResult(winnerPlayer.userId, loserPlayer.userId);
      }
    }
    Games.finish(room.id, {
      winner: winnerSeat,
      winnerId: winnerPlayer?.userId ?? null,
      state: room.game.toState(),
      moveCount: room.game.moveCount,
    });

    // Per-game stats & per-game ELO (best-effort; never blocks the result).
    let gameElo = null;
    try { gameElo = this.recordGameStats(room, { winnerSeat, isDraw }); } catch { /* ignore */ }
    try { this.resolvePredictions(room, winnerSeat); } catch { /* ignore */ }

    // Series bookkeeping: award points and decide whether the league continues.
    if (room.series && !room.series.done) {
      this._scoreSeriesGame(room, { winnerSeat, isDraw });
      if (room.series.index >= room.series.configs.length - 1) room.series.done = true;
      else { room.series.intermission = true; room.series.readyVotes = new Set(); }
    }

    // Knockout bookkeeping: record the round and (if alive) queue the next.
    if (room.tournament && !room.tournament.done) {
      this._scoreTournament(room, { winnerSeat, isDraw });
      if (!room.tournament.done) { room.tournament.intermission = true; room.tournament.readyVotes = new Set(); }
      if (room.tournament.done && room.tournament.champion === 0) {
        const human = room.players[0];
        if (human?.userId && Achievements.grant(human.userId, 'tournament_champ') && human.socketId) {
          this.io.to(human.socketId).emit('achievement:earned', {
            achievements: [{ code: 'tournament_champ', icon: '🏆', name: 'قهرمان تورنمنت', desc: 'یک تورنمنت حذفی را بردی.' }],
          });
        }
      }
    }

    this.broadcast(room, 'game:over', {
      winner: winnerSeat,
      winnerName: winnerPlayer?.name ?? null,
      winningTeam: room.game.winningTeam ?? null,
      draw: isDraw,
      reason: endReason,
      elo: eloResult,
      gameElo,
      series: room.seriesView(),
      tournament: room.tournamentView(),
      clock: room.clockView(),
      state: room.game.toState(),
    });
  }

  /**
   * Update per-game played/win/loss/draw tallies for every human seat, and a
   * per-game ELO rating for 2-player games between two rated humans. Bots and
   * guests (no userId) are skipped. Returns the per-game ELO delta if any.
   */
  recordGameStats(room, { winnerSeat, isDraw }) {
    const gameType = room.gameType;
    const winningTeam = room.game.winningTeam ?? null;
    const teams = !!room.config.teams;

    const resultFor = (seat) => {
      if (isDraw) return 'draw';
      if (winnerSeat == null) return 'draw';
      if (teams && winningTeam != null) return seat % 2 === winningTeam ? 'win' : 'loss';
      return seat === winnerSeat ? 'win' : 'loss';
    };

    // Did the winning side sweep every trick (Hokm کوت)?
    let gameSweep = false;
    if (gameType === 'hokm') {
      const st = room.game;
      if (teams && Array.isArray(st.teamTricks) && winningTeam != null) {
        gameSweep = st.teamTricks[1 - winningTeam] === 0;
      } else if (winnerSeat != null && Array.isArray(st.tricksWon)) {
        gameSweep = st.tricksWon.every((t, i) => (i === winnerSeat ? true : t === 0));
      }
    }

    for (let s = 0; s < room.players.length; s++) {
      const p = room.players[s];
      if (!p || p.isAI || !p.userId) continue;
      const result = resultFor(s);
      GameStats.record({ userId: p.userId, gameType, result });
      try { this._awardAchievements(p, { gameType, result, gameSweep }); } catch { /* ignore */ }
    }

    // Per-game rating only makes sense in a head-to-head 2-player game.
    if (room.numPlayers !== 2) return null;
    const p0 = room.players[0], p1 = room.players[1];
    const bothRated = p0?.userId && p1?.userId && !p0.isAI && !p1.isAI;
    if (!bothRated) return null;
    if (isDraw || winnerSeat == null) return GameStats.applyRating(p0.userId, p1.userId, gameType, true);
    const winnerP = room.players[winnerSeat], loserP = room.players[1 - winnerSeat];
    return GameStats.applyRating(winnerP.userId, loserP.userId, gameType, false);
  }

  /** Reset a finished room for a rematch (engine + clocks), keeping seats. */
  rematchReset(room) {
    room.game = buildEngine(room.gameType, room.config);
    room.clock.remaining = new Array(room.numPlayers).fill(room.clock.limitMs);
    room.status = 'active';
    room.rematchVotes.clear();
    room.predictions.clear();
    this.startClock(room);
    this.resetIdleTimer(room);
    this.emitPerSeat(room, 'game:start', (s) => room.publicView(s));
    this.maybeRunAI(room);
  }

  /** Record a spectator's winner prediction for the current game. */
  setPrediction(room, socket, seat) {
    if (room.status !== 'active') return false;
    if (room.seatOf(socket.id) >= 0) return false; // players can't predict
    seat = parseInt(seat, 10);
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.numPlayers) return false;
    room.predictions.set(socket.id, { seat, userId: socket.data.identity?.userId ?? null });
    return true;
  }

  /** Resolve all spectator predictions once a game ends. */
  resolvePredictions(room, winnerSeat) {
    if (!room.predictions.size) return;
    const teams = !!room.config.teams;
    const winningTeam = room.game.winningTeam ?? null;
    for (const [sid, pred] of room.predictions) {
      const correct = winnerSeat != null && (
        pred.seat === winnerSeat || (teams && winningTeam != null && pred.seat % 2 === winningTeam));
      if (pred.userId) Users.recordPrediction(pred.userId, correct);
      this.io.to(sid).emit('predict:result', { correct, winner: winnerSeat });
    }
    room.predictions.clear();
  }

  /** Offer / accept a draw (2-player only). */
  acceptDraw(room) {
    if (room.status !== 'active' || room.numPlayers !== 2) return;
    room.game.agreeDraw?.();
    this.finishGame(room, null);
  }

  resign(room, seat) {
    if (room.status !== 'active') return;
    this.playerOut(room, seat, 'resign');
  }

  /* ----------------------------- Matchmaking ------------------------------ */

  enqueue(socket, identity, config) {
    this.dequeue(socket.id);
    const cfg = sanitizeConfig(config);
    // Note: `ranked` is intentionally NOT part of compatibility. A logged-in
    // user (ranked:true) and a guest (ranked:false) must still be able to match;
    // ELO is only ever applied when BOTH players are rated (see finishGame).
    const compatible = (q) =>
      q.config.gameType === cfg.gameType && q.config.players === cfg.players &&
      q.config.size === cfg.size && q.config.walls === cfg.walls &&
      !!q.config.teams === !!cfg.teams &&
      q.config.timeLimit === cfg.timeLimit && q.socketId !== socket.id;

    // Gather enough players (2 or 4) before creating a room.
    const waiting = this.queue.filter(compatible);
    if (waiting.length >= cfg.players - 1) {
      const group = waiting.slice(0, cfg.players - 1);
      const groupIds = new Set(group.map((g) => g.socketId));
      this.queue = this.queue.filter((q) => !groupIds.has(q.socketId));
      // A matched 2-player game on a rankable type is ranked; ELO is still only
      // applied when both seats turn out to be rated accounts (see finishGame).
      const rankableType = cfg.gameType === 'quoridor' || cfg.gameType === 'chess';
      const roomCfg = { ...cfg, ranked: cfg.players === 2 && rankableType };
      const room = this.createRoom({ mode: 'random', config: roomCfg });
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
        // Pause the idle timer AND the chess clock while the player is away —
        // it's unfair to flag or time-out someone who can't move. Both resume
        // on reconnect.
        if (room.game.turn === seat && !room.game.eliminated[seat]) {
          this.clearIdleTimer(room);
          if (room.clock.timer) { clearTimeout(room.clock.timer); room.clock.timer = null; }
          room.clock.paused = true;
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
    // Resume idle timer + clock if it's their turn (both paused on disconnect).
    if (room.status === 'active' && !room.game.isOver() &&
        room.game.turn === seat && !room.game.eliminated[seat]) {
      this.resetIdleTimer(room);
      if (room.clock.paused) {
        room.clock.paused = false;
        room.clock.turnStart = Date.now(); // don't charge the away time
        this.scheduleFlag(room);
        this.broadcast(room, 'game:clock', room.clockView());
      }
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

  /**
   * Emit a state-bearing event. For hidden-information games (Hokm) each player
   * receives a payload built for their own seat (so they only see their own
   * cards) and spectators get the fully-redacted (-1) view. For everything else
   * this is a single room-wide broadcast.
   * @param {(viewerSeat:number)=>object} build
   */
  emitPerSeat(room, event, build) {
    if (!room.game.hidden) { this.broadcast(room, event, build(-1)); return; }
    for (let s = 0; s < room.players.length; s++) {
      const p = room.players[s];
      if (p && p.socketId) this.io.to(p.socketId).emit(event, build(s));
    }
    for (const sid of room.spectators) this.io.to(sid).emit(event, build(-1));
  }

  /** Summaries of active games for the lobby's "watch live" panel. */
  liveGames() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.status !== 'active') continue;
      out.push({
        id: r.id,
        mode: r.mode,
        gameType: r.gameType,
        teams: !!r.config.teams,
        numPlayers: r.numPlayers,
        size: r.config.size || null,
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
