/* =========================================================================
   اَلِ من خورا — Dots-and-Boxes (نقطه‌خط) renderer.
   Click the line nearest the pointer to draw it; completed boxes fill with
   their owner's colour. Emits { type:'edge', o:'h'|'v', r, c } via onAction.
   Interface matches the other renderers (setConfig/setMySeat/setState/
   setInteractive/destroy/_resize).
   ========================================================================= */

import { gridTheme } from './boardthemes.js';

export class DotsRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.config = { colors: ['#36c6ff', '#ff6b6b'] };
    this.mySeat = -1;
    this.interactive = false;
    this.hover = null;          // {o,r,c}
    this.anim = null;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }
  destroy() { window.removeEventListener('resize', this._onResize); if (this._raf) cancelAnimationFrame(this._raf); }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; if (!v) this.hover = null; this.draw(); }
  setState(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;
    if (animate && prev && prev.boxes && state.boxes) {
      const cells = new Set();
      for (let i = 0; i < state.boxes.length; i++) if (state.boxes[i] != null && prev.boxes[i] == null) cells.add(i);
      if (cells.size) this.anim = { since: performance.now(), dur: 300, cells };
    }
    this.hover = null;
    this._loop();
  }
  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#36c6ff', '#ff6b6b'][s] || '#ccc'; }

  /* ------------------------------ Geometry ------------------------------- */
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 200);
    this.canvas.width = size * this._dpr; this.canvas.height = size * this._dpr;
    this.css = size; this.draw();
  }
  _geo() {
    const st = this.state;
    const R = st?.rows || 5, C = st?.cols || 5;
    const S = this.css, m = S * 0.08;
    const cell = (S - 2 * m) / Math.max(R, C);
    const ox = (S - C * cell) / 2, oy = (S - R * cell) / 2;
    return { R, C, S, m, cell, ox, oy };
  }
  _dot(i, j) { const { ox, oy, cell } = this._geo(); return { x: ox + j * cell, y: oy + i * cell }; }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _pos(e) { const rect = this.canvas.getBoundingClientRect(); return { mx: e.clientX - rect.left, my: e.clientY - rect.top }; }

  /** Nearest UNDRAWN edge to the pointer, or null if none within reach. */
  _nearestEdge(mx, my) {
    const st = this.state; if (!st) return null;
    const { R, C, cell, ox, oy } = this._geo();
    let best = null, bestD = cell * 0.45;
    const consider = (o, r, c, ax, ay, bx, by) => {
      const d = segDist(mx, my, ax, ay, bx, by);
      if (d < bestD) { bestD = d; best = { o, r, c }; }
    };
    for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) {
      if (st.hEdges[r * C + c]) continue;
      consider('h', r, c, ox + c * cell, oy + r * cell, ox + (c + 1) * cell, oy + r * cell);
    }
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) {
      if (st.vEdges[r * (C + 1) + c]) continue;
      consider('v', r, c, ox + c * cell, oy + r * cell, ox + c * cell, oy + (r + 1) * cell);
    }
    return best;
  }
  _onHover(e) {
    if (!this.interactive) { if (this.hover) { this.hover = null; this.draw(); } return; }
    const { mx, my } = this._pos(e);
    const ne = this._nearestEdge(mx, my);
    if ((ne?.o) !== (this.hover?.o) || (ne?.r) !== (this.hover?.r) || (ne?.c) !== (this.hover?.c)) { this.hover = ne; this.draw(); }
  }
  _onClick(e) {
    if (!this.interactive) return;
    const { mx, my } = this._pos(e);
    const ne = this._nearestEdge(mx, my);
    if (ne) this.onAction?.({ type: 'edge', o: ne.o, r: ne.r, c: ne.c });
  }

  /* ------------------------------ Render --------------------------------- */
  _loop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const tick = () => {
      let active = false;
      if (this.anim && performance.now() - this.anim.since < this.anim.dur) active = true; else this.anim = null;
      this.draw();
      this._raf = active ? requestAnimationFrame(tick) : null;
    };
    tick();
  }
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const st = this.state;
    const { R, C, S, cell, ox, oy } = this._geo();
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const look = gridTheme('dots', this.config?.boardTheme);
    this._roundRect(0, 0, S, S, 16); ctx.fillStyle = look.bg; ctx.fill();
    if (!st) { ctx.restore(); return; }

    // Filled boxes
    const prog = this.anim ? Math.min(1, (performance.now() - this.anim.since) / this.anim.dur) : 1;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const owner = st.boxes[r * C + c];
      if (owner == null) continue;
      const a = (this.anim && this.anim.cells.has(r * C + c)) ? prog : 1;
      ctx.fillStyle = hexA(this._seatColor(owner), 0.22 * a + 0.06);
      ctx.fillRect(ox + c * cell + 2, oy + r * cell + 2, cell - 4, cell - 4);
      ctx.fillStyle = hexA(this._seatColor(owner), 0.9);
      ctx.font = `${cell * 0.34}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(owner === 0 ? '◆' : '●', ox + c * cell + cell / 2, oy + r * cell + cell / 2);
    }

    // Drawn edges
    const drawEdge = (ax, ay, bx, by, on, isLast) => {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineWidth = on ? Math.max(3, cell * 0.09) : 2; ctx.lineCap = 'round';
      ctx.strokeStyle = on ? (isLast ? '#ffd36b' : 'rgba(220,228,240,.92)') : 'rgba(255,255,255,.07)';
      ctx.stroke();
    };
    const last = st.last;
    for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) {
      const on = !!st.hEdges[r * C + c];
      drawEdge(ox + c * cell, oy + r * cell, ox + (c + 1) * cell, oy + r * cell, on, last && last.o === 'h' && last.r === r && last.c === c);
    }
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) {
      const on = !!st.vEdges[r * (C + 1) + c];
      drawEdge(ox + c * cell, oy + r * cell, ox + c * cell, oy + (r + 1) * cell, on, last && last.o === 'v' && last.r === r && last.c === c);
    }

    // Hover preview
    if (this.hover && this.interactive) {
      const hv = this.hover;
      const turnColor = this._seatColor(this.state.turn);
      if (hv.o === 'h') drawHoverLine(ctx, ox + hv.c * cell, oy + hv.r * cell, ox + (hv.c + 1) * cell, oy + hv.r * cell, turnColor, cell);
      else drawHoverLine(ctx, ox + hv.c * cell, oy + hv.r * cell, ox + hv.c * cell, oy + (hv.r + 1) * cell, turnColor, cell);
    }

    // Dots
    ctx.fillStyle = '#e7ecf5';
    for (let i = 0; i <= R; i++) for (let j = 0; j <= C; j++) {
      const { x, y } = this._dot(i, j);
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, cell * 0.06), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

function drawHoverLine(ctx, ax, ay, bx, by, color, cell) {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.lineWidth = Math.max(3, cell * 0.09); ctx.lineCap = 'round';
  ctx.strokeStyle = hexA(color, 0.6); ctx.stroke();
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function hexA(hex, a) {
  const m = (hex || '#888888').replace('#', '');
  if (m.length < 6) return `rgba(136,136,136,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
