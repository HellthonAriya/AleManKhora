/* اِل من خورا — Reusable UI components */
import { h, PLAYER_COLORS, THEMES, store } from './core.js';
import { BoardRenderer } from './board.js';
import { QuoridorGame } from './engine.js';

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
