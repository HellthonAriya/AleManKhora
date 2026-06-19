/* اَلِ من خورا — Reusable UI components */
import { h, PLAYER_COLORS, THEMES, store } from './core.js';
import { BoardRenderer } from './board.js';
import { QuoridorGame } from './engine.js';
import { ChessBoardRenderer, BOARD_THEMES } from './chessboard.js';
import { ChessGame, randomChessSetup } from './chess.js';
import { GridRenderer } from './gridboard.js';
import { DotsRenderer } from './dotsboard.js';
import { BackgammonRenderer } from './backgammonboard.js';
import { HokmRenderer } from './hokmboard.js';
import { TicTacToeGame } from './tictactoe.js';
import { GomokuGame } from './gomoku.js';
import { OthelloGame } from './othello.js';
import { DotsGame } from './dots.js';
import { BackgammonGame } from './backgammon.js';
import { HokmGame } from './hokm.js';

const CHESS_SWATCHES = ['#f3f1ea', '#2b2b30', '#e7503a', '#3d7fe0', '#e8b730', '#3bb15f', '#9b8cff', '#36c6ff'];
const SIMPLE_SWATCHES = ['#1b1d22', '#f1ece0', '#efe9dc', '#36c6ff', '#ff6b6b', '#ffd36b', '#3bb15f', '#9b8cff', '#e7503a'];
const SIMPLE_TYPES = ['tictactoe', 'gomoku', 'othello', 'dots', 'backgammon'];

/** Pick the right customizer for a game type. Returns { element, getConfig }. */
export function makeCustomizer(gameType, opts = {}) {
  if (gameType === 'chess' || gameType === 'chess4' || gameType === 'chesszade') return ChessCustomizer({ gameType, ...opts });
  if (gameType === 'hokm') return HokmCustomizer(opts);
  if (SIMPLE_TYPES.includes(gameType)) return SimpleCustomizer({ gameType, ...opts });
  return GameCustomizer(opts);
}

const HOKM_COLORS = ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'];

/**
 * Hokm customizer: number of players (4 teams / 3 / 2), per-seat colours, time
 * control, and a live preview dealt from the viewer's seat. Returns
 * { element, getConfig }.
 */
export function HokmCustomizer() {
  const cfg = { gameType: 'hokm', variant: '4', colors: [...HOKM_COLORS], timeLimit: 0, timeIncrement: 0 };

  const previewCanvas = h('canvas', { style: 'width:100%;aspect-ratio:1;border-radius:14px' });
  let renderer = null;
  function refreshPreview() {
    if (!renderer) renderer = new HokmRenderer(previewCanvas);
    const g = new HokmGame({ variant: cfg.variant });
    renderer.setConfig({ colors: [...cfg.colors] });
    renderer.setMySeat(0);
    renderer.setState(g.toStateFor(0));
  }

  const players = () => Number(cfg.variant);

  const variantSeg = seg([
    { label: '۴ نفره (تیمی)', value: '4', active: true },
    { label: '۳ نفره', value: '3', active: false },
    { label: '۲ نفره', value: '2', active: false },
  ], (v) => { cfg.variant = v; rebuildColors(); refreshPreview(); });

  const colorsMount = h('div', {});
  function colorPick(idx) {
    const wrap = h('div', { class: 'swatches' });
    SIMPLE_SWATCHES.forEach((col) => {
      wrap.append(h('div', {
        class: 'swatch' + (col === cfg.colors[idx] ? ' active' : ''),
        style: `background:${col}`,
        onclick: () => { cfg.colors[idx] = col; [...wrap.children].forEach((c, i) => c.classList.toggle('active', SIMPLE_SWATCHES[i] === col)); pickInput.value = col; refreshPreview(); },
      }));
    });
    const pickInput = h('input', { type: 'color', value: cfg.colors[idx],
      oninput: (e) => { cfg.colors[idx] = e.target.value; [...wrap.children].forEach((c) => c.classList.remove('active')); refreshPreview(); } });
    wrap.append(h('div', { class: 'color-pick' }, pickInput));
    return wrap;
  }
  function rebuildColors() {
    colorsMount.innerHTML = '';
    const teams = cfg.variant === '4';
    for (let i = 0; i < players(); i++) {
      const label = i === 0 ? 'رنگ تو'
        : teams && i === 2 ? 'رنگ هم‌تیمی'
        : `رنگ بازیکن ${['۱', '۲', '۳', '۴'][i]}`;
      colorsMount.append(optGroup(label, colorPick(i)));
    }
  }
  rebuildColors();

  const timeSeg = seg(TIME_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeLimit })),
    (v) => { cfg.timeLimit = v; incMount.style.display = v ? '' : 'none'; });
  const incMount = h('div', { style: 'display:none' },
    optGroup('پاداش زمانی هر حرکت', seg(INC_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeIncrement })),
      (v) => { cfg.timeIncrement = v; })));

  const leftCol = h('div', { style: 'flex:1.2' },
    optGroup('تعداد بازیکنان', variantSeg),
    optGroup('کنترل زمان (تایمر)', timeSeg),
    incMount,
    colorsMount,
  );

  const element = h('div', { class: 'row', style: 'align-items:flex-start' },
    leftCol,
    h('div', { style: 'flex:1' },
      h('label', { class: 'opt-group', style: 'display:block;color:var(--text-dim);font-size:.82rem;font-weight:700;margin-bottom:9px' }, 'پیش‌نمایش زنده'),
      previewCanvas),
  );

  requestAnimationFrame(refreshPreview);
  return {
    element,
    getConfig: () => ({ gameType: 'hokm', variant: cfg.variant, colors: cfg.colors.slice(0, players()), timeLimit: cfg.timeLimit, timeIncrement: cfg.timeIncrement }),
  };
}

const TIME_OPTIONS = [
  { label: 'بدون زمان', value: 0 },
  { label: '۱ دقیقه', value: 60 },
  { label: '۳ دقیقه', value: 180 },
  { label: '۵ دقیقه', value: 300 },
  { label: '۱۰ دقیقه', value: 600 },
];
const INC_OPTIONS = [
  { label: 'بدون', value: 0 },
  { label: '+۲s', value: 2 },
  { label: '+۳s', value: 3 },
  { label: '+۵s', value: 5 },
];

/**
 * Game customizer: player count, board size, walls, theme, player colors,
 * chess clock and ranked flag — with a live preview board.
 * Returns { element, getConfig }.
 */
export function GameCustomizer({ showRanked = true, allowPlayers = true } = {}) {
  const cfg = {
    players: 2,
    size: store.config?.defaultBoardSize || 9,
    walls: store.config?.defaultWalls || 10,
    theme: store.config?.defaultTheme || 'emerald',
    colors: [...PLAYER_COLORS.slice(0, 4)],
    timeLimit: 0,
    timeIncrement: 0,
    ranked: !!store.isLoggedIn,
  };

  const previewCanvas = h('canvas', { style: 'width:100%;aspect-ratio:1;border-radius:14px' });
  let renderer = null;
  function refreshPreview() {
    if (!renderer) renderer = new BoardRenderer(previewCanvas);
    const g = new QuoridorGame({ size: cfg.size, wallsEach: cfg.walls, players: cfg.players });
    try { g.apply(0, { type: 'wall', r: Math.floor(cfg.size / 2), c: 1, o: 'h' }); g.turn = 0; } catch {}
    renderer.setConfig({ theme: cfg.theme, colors: [...cfg.colors] });
    renderer.setState(g.toState(), { animate: false });
  }
  function defWalls(size, players) {
    return players === 4 ? Math.max(3, Math.round((size * size) / 16)) : Math.max(4, Math.round((size * size) / 8));
  }

  /* --- players --- */
  const playersSeg = seg([
    { label: '۲ نفره', value: 2, active: true },
    { label: '۴ نفره', value: 4, active: false },
  ], (v) => {
    cfg.players = v;
    cfg.walls = defWalls(cfg.size, v);
    rebuildWalls();
    rebuildColors();
    refreshPreview();
  });

  /* --- size --- */
  const sizeSeg = seg([5, 7, 9, 11].map((s) => ({
    label: `${s}×${s}`, value: s, active: s === cfg.size,
  })), (v) => { cfg.size = v; cfg.walls = defWalls(v, cfg.players); rebuildWalls(); refreshPreview(); });

  /* --- walls --- */
  const wallsMount = h('div', {});
  function rebuildWalls() {
    const def = defWalls(cfg.size, cfg.players);
    const max = def + 6;
    const opts = [];
    for (let n = 3; n <= max; n++) opts.push({ label: String(n), value: n, active: n === cfg.walls });
    wallsMount.innerHTML = '';
    wallsMount.append(seg(opts, (v) => { cfg.walls = v; refreshPreview(); }));
  }
  rebuildWalls();

  /* --- theme --- */
  const themeRow = h('div', { class: 'theme-row' });
  THEMES.forEach((t) => {
    themeRow.append(h('div', {
      class: 'theme-chip' + (t.id === cfg.theme ? ' active' : ''), title: t.name,
      style: `background:linear-gradient(135deg,${t.from},${t.to})`,
      onclick: () => {
        cfg.theme = t.id;
        [...themeRow.children].forEach((c, i) => c.classList.toggle('active', THEMES[i].id === cfg.theme));
        refreshPreview();
      },
    }));
  });

  /* --- per-player colors --- */
  const colorsMount = h('div', {});
  function colorPick(idx) {
    const wrap = h('div', { class: 'swatches' });
    PLAYER_COLORS.forEach((col) => {
      wrap.append(h('div', {
        class: 'swatch' + (col === cfg.colors[idx] ? ' active' : ''),
        style: `background:${col}`,
        onclick: () => { cfg.colors[idx] = col; [...wrap.children].forEach((c, i) => c.classList.toggle('active', PLAYER_COLORS[i] === col)); pickInput.value = col; refreshPreview(); },
      }));
    });
    const pickInput = h('input', { type: 'color', value: cfg.colors[idx],
      oninput: (e) => { cfg.colors[idx] = e.target.value; [...wrap.children].forEach((c) => c.classList.remove('active')); refreshPreview(); } });
    wrap.append(h('div', { class: 'color-pick' }, pickInput));
    return wrap;
  }
  function rebuildColors() {
    colorsMount.innerHTML = '';
    for (let i = 0; i < cfg.players; i++) {
      colorsMount.append(optGroup(`رنگ بازیکن ${faPlayer(i + 1)}`, colorPick(i)));
    }
  }
  rebuildColors();

  /* --- time control --- */
  const timeSeg = seg(TIME_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeLimit })),
    (v) => { cfg.timeLimit = v; incMount.style.display = v ? '' : 'none'; });
  const incMount = h('div', { style: 'display:none' },
    optGroup('پاداش زمانی هر حرکت', seg(INC_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeIncrement })),
      (v) => { cfg.timeIncrement = v; })));

  const rankedToggle = showRanked && store.isLoggedIn ? h('label', { class: 'opt-group', style: 'display:flex;align-items:center;gap:10px;cursor:pointer' },
    h('input', { type: 'checkbox', checked: cfg.ranked,
      onchange: (e) => { cfg.ranked = e.target.checked; } }),
    h('span', {}, 'بازی رتبه‌دار — فقط حالت ۲ نفره روی ELO اثر دارد'),
  ) : null;

  const leftCol = h('div', { style: 'flex:1.2' },
    allowPlayers ? optGroup('تعداد بازیکنان', playersSeg) : null,
    optGroup('اندازهٔ صفحه', sizeSeg),
    optGroup('تعداد دیوار هر بازیکن', wallsMount),
    optGroup('کنترل زمان (تایمر شطرنجی)', timeSeg),
    incMount,
    optGroup('تم صفحه', themeRow),
    colorsMount,
    rankedToggle,
  );

  const element = h('div', { class: 'row', style: 'align-items:flex-start' },
    leftCol,
    h('div', { style: 'flex:1' },
      h('label', { class: 'opt-group', style: 'display:block;color:var(--text-dim);font-size:.82rem;font-weight:700;margin-bottom:9px' }, 'پیش‌نمایش زنده'),
      previewCanvas,
    ),
  );

  requestAnimationFrame(refreshPreview);
  return {
    element,
    getConfig: () => ({
      ...cfg,
      colors: [...cfg.colors.slice(0, cfg.players)],
      p0Color: cfg.colors[0], p1Color: cfg.colors[1],
    }),
  };
}

/**
 * Chess customizer: board theme, piece colors, time control, ranked flag and
 * (for 4-player) free-for-all vs 2-vs-2 teams — with a live preview board.
 */
export function ChessCustomizer({ gameType = 'chess', showRanked = true } = {}) {
  const is4 = gameType === 'chess4';
  const isZade = gameType === 'chesszade';
  const cfg = {
    gameType,
    players: is4 ? 4 : 2,
    teams: false,
    boardTheme: 'classic',
    colors: is4 ? ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'] : ['#f3f1ea', '#2b2b30'],
    timeLimit: 0,
    timeIncrement: 0,
    ranked: !is4 && !isZade && !!store.isLoggedIn,
    randomPawns: false,
    mirror: true,
  };

  const previewCanvas = h('canvas', { style: 'width:100%;aspect-ratio:1;border-radius:14px' });
  let renderer = null;
  function refreshPreview() {
    if (!renderer) renderer = new ChessBoardRenderer(previewCanvas);
    const variant = is4 ? (cfg.teams ? '4team' : '4') : '2';
    const g = isZade
      ? new ChessGame({ variant: '2', setup: randomChessSetup({ randomPawns: cfg.randomPawns, mirror: cfg.mirror }) })
      : new ChessGame({ variant });
    renderer.setConfig({ boardTheme: cfg.boardTheme, colors: [...cfg.colors] });
    renderer.setMySeat(0);
    renderer.setState(g.toState(), { animate: false });
  }

  /* --- 4-player mode (FFA / teams) --- */
  const modeSeg = is4 ? seg([
    { label: 'هرکس برای خودش', value: false, active: true },
    { label: 'تیمی ۲ در ۲', value: true, active: false },
  ], (v) => { cfg.teams = v; refreshPreview(); }) : null;

  /* --- شطرنج زاده‌ای options --- */
  const zadeBox = isZade ? h('div', {},
    optGroup('چیدمان', seg([
      { label: 'فقط مهره‌های عقب تصادفی', value: false, active: true },
      { label: 'سربازها هم تصادفی', value: true, active: false },
    ], (v) => { cfg.randomPawns = v; refreshPreview(); })),
    optGroup('تقارن', seg([
      { label: 'آینه‌ای (هر دو طرف یکسان)', value: true, active: true },
      { label: 'نامتقارن (هر طرف جدا)', value: false, active: false },
    ], (v) => { cfg.mirror = v; refreshPreview(); })),
    h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:4px', onclick: refreshPreview }, '🎲 یک چیدمان دیگر'),
  ) : null;

  /* --- board theme --- */
  const themeRow = h('div', { class: 'theme-row' });
  Object.keys(BOARD_THEMES).forEach((id) => {
    const t = BOARD_THEMES[id];
    themeRow.append(h('div', {
      class: 'theme-chip' + (id === cfg.boardTheme ? ' active' : ''), title: id,
      style: `background:linear-gradient(135deg,${t.light} 0 50%,${t.dark} 50% 100%)`,
      onclick: () => {
        cfg.boardTheme = id;
        [...themeRow.children].forEach((c, i) => c.classList.toggle('active', Object.keys(BOARD_THEMES)[i] === cfg.boardTheme));
        refreshPreview();
      },
    }));
  });

  /* --- piece colors --- */
  const colorsMount = h('div', {});
  function colorPick(idx) {
    const wrap = h('div', { class: 'swatches' });
    CHESS_SWATCHES.forEach((col) => {
      wrap.append(h('div', {
        class: 'swatch' + (col === cfg.colors[idx] ? ' active' : ''),
        style: `background:${col}`,
        onclick: () => { cfg.colors[idx] = col; [...wrap.children].forEach((c, i) => c.classList.toggle('active', CHESS_SWATCHES[i] === col)); pickInput.value = col; refreshPreview(); },
      }));
    });
    const pickInput = h('input', { type: 'color', value: cfg.colors[idx],
      oninput: (e) => { cfg.colors[idx] = e.target.value; [...wrap.children].forEach((c) => c.classList.remove('active')); refreshPreview(); } });
    wrap.append(h('div', { class: 'color-pick' }, pickInput));
    return wrap;
  }
  const seatNames4 = ['قرمز (پایین)', 'آبی (چپ)', 'زرد (بالا)', 'سبز (راست)'];
  function rebuildColors() {
    colorsMount.innerHTML = '';
    for (let i = 0; i < cfg.players; i++) {
      const label = is4 ? `رنگ ${seatNames4[i]}` : (i === 0 ? 'رنگ مهره‌های تو (سفید)' : 'رنگ مهره‌های حریف (سیاه)');
      colorsMount.append(optGroup(label, colorPick(i)));
    }
  }
  rebuildColors();

  /* --- time control --- */
  const timeSeg = seg(TIME_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeLimit })),
    (v) => { cfg.timeLimit = v; incMount.style.display = v ? '' : 'none'; });
  const incMount = h('div', { style: 'display:none' },
    optGroup('پاداش زمانی هر حرکت', seg(INC_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeIncrement })),
      (v) => { cfg.timeIncrement = v; })));

  const rankedToggle = showRanked && !is4 && store.isLoggedIn ? h('label', { class: 'opt-group', style: 'display:flex;align-items:center;gap:10px;cursor:pointer' },
    h('input', { type: 'checkbox', checked: cfg.ranked, onchange: (e) => { cfg.ranked = e.target.checked; } }),
    h('span', {}, 'بازی رتبه‌دار — روی امتیاز ELO اثر دارد')) : null;

  const leftCol = h('div', { style: 'flex:1.2' },
    is4 ? optGroup('حالت بازی', modeSeg) : null,
    zadeBox,
    optGroup('تم تخته', themeRow),
    optGroup('کنترل زمان (تایمر شطرنجی)', timeSeg),
    incMount,
    colorsMount,
    rankedToggle,
  );

  const element = h('div', { class: 'row', style: 'align-items:flex-start' },
    leftCol,
    h('div', { style: 'flex:1' },
      h('label', { class: 'opt-group', style: 'display:block;color:var(--text-dim);font-size:.82rem;font-weight:700;margin-bottom:9px' }, 'پیش‌نمایش زنده'),
      previewCanvas),
  );

  requestAnimationFrame(refreshPreview);
  return {
    element,
    getConfig: () => ({ ...cfg, colors: [...cfg.colors.slice(0, cfg.players)] }),
  };
}

const SIMPLE_DEFAULT_COLORS = {
  tictactoe: ['#36c6ff', '#ff6b6b'],
  gomoku: ['#1b1d22', '#f1ece0'],
  othello: ['#1b1d22', '#f1ece0'],
  dots: ['#36c6ff', '#ff6b6b'],
  backgammon: ['#efe9dc', '#21242b'],
};
const SIMPLE_NAMES = {
  tictactoe: 'دوز', gomoku: 'گوموکو', othello: 'اوتلو', dots: 'نقطه‌خط', backgammon: 'تخته‌نرد',
};

/**
 * Lightweight customizer for the simple 2-player board games: two piece
 * colours, time control, an optional board-size choice (gomoku / dots) and a
 * live preview. Returns { element, getConfig }.
 */
export function SimpleCustomizer({ gameType = 'tictactoe' } = {}) {
  const cfg = {
    gameType,
    colors: [...(SIMPLE_DEFAULT_COLORS[gameType] || ['#36c6ff', '#ff6b6b'])],
    size: gameType === 'gomoku' ? 15 : gameType === 'dots' ? 5 : 0,
    timeLimit: 0,
    timeIncrement: 0,
  };

  const previewCanvas = h('canvas', { style: 'width:100%;aspect-ratio:1;border-radius:14px' });
  let renderer = null;
  function buildEngine() {
    if (gameType === 'gomoku') return new GomokuGame({ size: cfg.size });
    if (gameType === 'othello') return new OthelloGame();
    if (gameType === 'tictactoe') return new TicTacToeGame();
    if (gameType === 'dots') return new DotsGame({ rows: cfg.size, cols: cfg.size });
    return new BackgammonGame();
  }
  function buildRenderer() {
    if (gameType === 'dots') return new DotsRenderer(previewCanvas);
    if (gameType === 'backgammon') return new BackgammonRenderer(previewCanvas);
    return new GridRenderer(previewCanvas);
  }
  function seed(g) {
    const n = gameType === 'gomoku' ? 5 : gameType === 'othello' ? 6 : gameType === 'dots' ? 7 : gameType === 'tictactoe' ? 3 : 0;
    for (let i = 0; i < n; i++) {
      const moves = g.legalMoves(g.turn);
      if (!moves.length || g.isOver()) break;
      try { g.apply(g.turn, moves[Math.floor(Math.random() * moves.length)]); } catch { break; }
    }
  }
  function refreshPreview() {
    if (!renderer) renderer = buildRenderer();
    const g = buildEngine();
    seed(g);
    renderer.setConfig({ colors: [...cfg.colors] });
    renderer.setMySeat(0);
    renderer.setState(g.toState(), { animate: false });
  }

  /* --- board size (gomoku / dots) --- */
  const sizeMount = h('div', {});
  if (gameType === 'gomoku' || gameType === 'dots') {
    const opts = gameType === 'gomoku'
      ? [{ label: '۱۳×۱۳', value: 13 }, { label: '۱۵×۱۵', value: 15 }, { label: '۱۹×۱۹', value: 19 }]
      : [{ label: '۴×۴', value: 4 }, { label: '۵×۵', value: 5 }, { label: '۶×۶', value: 6 }, { label: '۷×۷', value: 7 }];
    sizeMount.append(optGroup('اندازهٔ تخته',
      seg(opts.map((o) => ({ ...o, active: o.value === cfg.size })), (v) => { cfg.size = v; refreshPreview(); })));
  }

  /* --- piece colours --- */
  const colorsMount = h('div', {});
  function colorPick(idx) {
    const wrap = h('div', { class: 'swatches' });
    SIMPLE_SWATCHES.forEach((col) => {
      wrap.append(h('div', {
        class: 'swatch' + (col === cfg.colors[idx] ? ' active' : ''),
        style: `background:${col}`,
        onclick: () => { cfg.colors[idx] = col; [...wrap.children].forEach((c, i) => c.classList.toggle('active', SIMPLE_SWATCHES[i] === col)); pickInput.value = col; refreshPreview(); },
      }));
    });
    const pickInput = h('input', { type: 'color', value: cfg.colors[idx],
      oninput: (e) => { cfg.colors[idx] = e.target.value; [...wrap.children].forEach((c) => c.classList.remove('active')); refreshPreview(); } });
    wrap.append(h('div', { class: 'color-pick' }, pickInput));
    return wrap;
  }
  const labelFor = (i) => {
    if (gameType === 'tictactoe') return i === 0 ? 'رنگ ✕ (تو)' : 'رنگ ◯ (حریف)';
    if (gameType === 'gomoku') return i === 0 ? 'رنگ مهره‌های تو' : 'رنگ مهره‌های حریف';
    if (gameType === 'othello') return i === 0 ? 'رنگ مهره‌های تو' : 'رنگ مهره‌های حریف';
    if (gameType === 'backgammon') return i === 0 ? 'رنگ مهره‌های تو' : 'رنگ مهره‌های حریف';
    return i === 0 ? 'رنگ تو' : 'رنگ حریف';
  };
  colorsMount.append(optGroup(labelFor(0), colorPick(0)), optGroup(labelFor(1), colorPick(1)));

  /* --- time control --- */
  const timeSeg = seg(TIME_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeLimit })),
    (v) => { cfg.timeLimit = v; incMount.style.display = v ? '' : 'none'; });
  const incMount = h('div', { style: 'display:none' },
    optGroup('پاداش زمانی هر حرکت', seg(INC_OPTIONS.map((o) => ({ ...o, active: o.value === cfg.timeIncrement })),
      (v) => { cfg.timeIncrement = v; })));

  const leftCol = h('div', { style: 'flex:1.2' },
    sizeMount,
    optGroup('کنترل زمان (تایمر)', timeSeg),
    incMount,
    colorsMount,
  );

  const element = h('div', { class: 'row', style: 'align-items:flex-start' },
    leftCol,
    h('div', { style: 'flex:1' },
      h('label', { class: 'opt-group', style: 'display:block;color:var(--text-dim);font-size:.82rem;font-weight:700;margin-bottom:9px' }, 'پیش‌نمایش زنده'),
      previewCanvas),
  );

  requestAnimationFrame(refreshPreview);
  return {
    element,
    getConfig: () => {
      const out = { gameType, colors: [...cfg.colors], timeLimit: cfg.timeLimit, timeIncrement: cfg.timeIncrement };
      if (gameType === 'gomoku') out.size = cfg.size;
      if (gameType === 'dots') { out.rows = cfg.size; out.cols = cfg.size; }
      return out;
    },
  };
}

function faPlayer(n) { return ['۱', '۲', '۳', '۴'][n - 1] || String(n); }
function optGroup(label, control) {
  return h('div', { class: 'opt-group' }, h('label', {}, label), control);
}
function seg(options, onPick) {
  const wrap = h('div', { class: 'seg' });
  options.forEach((o) => {
    const btn = h('button', { class: o.active ? 'active' : '' }, o.label);
    btn.addEventListener('click', () => {
      [...wrap.children].forEach((b) => b.classList.toggle('active', b === btn));
      onPick(o.value);
    });
    wrap.append(btn);
  });
  return wrap;
}
