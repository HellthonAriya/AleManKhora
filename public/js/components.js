/* اِل من خورا — Reusable UI components */
import { h, PLAYER_COLORS, THEMES, store } from './core.js';
import { BoardRenderer } from './board.js';
import { QuoridorGame } from './engine.js';

/**
 * Game customizer: board size, walls per player, theme, player colors, ranked,
 * with a live preview board. Returns { element, getConfig }.
 */
export function GameCustomizer({ showRanked = true } = {}) {
  const cfg = {
    size: store.config?.defaultBoardSize || 9,
    walls: store.config?.defaultWalls || 10,
    theme: store.config?.defaultTheme || 'emerald',
    p0Color: '#36c6ff',
    p1Color: '#ff6b6b',
    ranked: !!store.isLoggedIn,
  };

  const previewCanvas = h('canvas', { style: 'width:100%;aspect-ratio:1;border-radius:14px' });
  let renderer = null;
  function refreshPreview() {
    if (!renderer) renderer = new BoardRenderer(previewCanvas);
    const g = new QuoridorGame({ size: cfg.size, wallsEach: cfg.walls });
    // drop a couple of sample walls for flavor
    try { g.apply(0, { type: 'wall', r: Math.floor(cfg.size / 2), c: 1, o: 'h' }); g.turn = 0; } catch {}
    renderer.setConfig({ theme: cfg.theme, p0Color: cfg.p0Color, p1Color: cfg.p1Color });
    renderer.setState(g.toState(), { animate: false });
  }

  /* --- size --- */
  const sizeSeg = seg([5, 7, 9, 11].map((s) => ({
    label: `${s}×${s}`, value: s, active: s === cfg.size,
  })), (v) => { cfg.size = v; cfg.walls = Math.min(cfg.walls, defWalls(v)); rebuildWalls(); refreshPreview(); });

  /* --- walls --- */
  const wallsMount = h('div', {});
  function defWalls(size) { return Math.max(4, Math.round((size * size) / 8)); }
  function rebuildWalls() {
    const max = defWalls(cfg.size) + 6;
    const opts = [];
    for (let n = 4; n <= max; n += 2) opts.push({ label: String(n), value: n, active: n === cfg.walls });
    wallsMount.innerHTML = '';
    wallsMount.append(seg(opts, (v) => { cfg.walls = v; refreshPreview(); }));
  }
  rebuildWalls();

  /* --- theme --- */
  const themeRow = h('div', { class: 'theme-row' });
  THEMES.forEach((t) => {
    const chip = h('div', {
      class: 'theme-chip' + (t.id === cfg.theme ? ' active' : ''),
      title: t.name,
      style: `background:linear-gradient(135deg,${t.from},${t.to})`,
      onclick: () => {
        cfg.theme = t.id;
        [...themeRow.children].forEach((c, i) => c.classList.toggle('active', THEMES[i].id === cfg.theme));
        refreshPreview();
      },
    });
    themeRow.append(chip);
  });

  /* --- colors --- */
  const colorPick = (key) => {
    const wrap = h('div', { class: 'swatches' });
    PLAYER_COLORS.forEach((col) => {
      wrap.append(h('div', {
        class: 'swatch' + (col === cfg[key] ? ' active' : ''),
        style: `background:${col}`,
        onclick: () => { cfg[key] = col; [...wrap.children].forEach((c, i) => c.classList.toggle('active', PLAYER_COLORS[i] === col)); pickInput.value = col; refreshPreview(); },
      }));
    });
    const pickInput = h('input', { type: 'color', value: cfg[key],
      oninput: (e) => { cfg[key] = e.target.value; [...wrap.children].forEach((c) => c.classList.remove('active')); refreshPreview(); } });
    wrap.append(h('div', { class: 'color-pick' }, pickInput));
    return wrap;
  };

  const rankedToggle = showRanked && store.isLoggedIn ? h('label', { class: 'opt-group', style: 'display:flex;align-items:center;gap:10px;cursor:pointer' },
    h('input', { type: 'checkbox', checked: cfg.ranked, onchange: (e) => { cfg.ranked = e.target.checked; } }),
    h('span', {}, 'بازی رتبه‌دار (روی امتیاز ELO اثر می‌گذارد)'),
  ) : null;

  const element = h('div', { class: 'row', style: 'align-items:flex-start' },
    h('div', { style: 'flex:1.2' },
      optGroup('اندازهٔ صفحه', sizeSeg),
      optGroup('تعداد دیوار هر بازیکن', wallsMount),
      optGroup('تم صفحه', themeRow),
      optGroup('رنگ بازیکن ۱', colorPick('p0Color')),
      optGroup('رنگ بازیکن ۲', colorPick('p1Color')),
      rankedToggle,
    ),
    h('div', { style: 'flex:1' },
      h('label', { class: 'opt-group', style: 'display:block;color:var(--text-dim);font-size:.82rem;font-weight:700;margin-bottom:9px' }, 'پیش‌نمایش زنده'),
      previewCanvas,
    ),
  );

  requestAnimationFrame(refreshPreview);
  return { element, getConfig: () => ({ ...cfg }) };
}

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
