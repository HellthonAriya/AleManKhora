/* =========================================================================
   اَلِ من خورا — Canvas board renderer
   Draws the Quoridor board, pawns and walls with animation, legal-move
   highlights and a live wall-placement preview. Server stays authoritative;
   the client engine is used only for instant visual feedback.
   ========================================================================= */
import { QuoridorGame } from './engine.js';

const PALETTES = {
  emerald:  { board: '#0e3b32', cell: '#0f4a3e', cellAlt: '#0c4135', line: 'rgba(255,255,255,.06)', glow: '#13c08a' },
  midnight: { board: '#1a2142', cell: '#222a52', cellAlt: '#1d2548', line: 'rgba(255,255,255,.07)', glow: '#6d8bff' },
  sunset:   { board: '#3a1d23', cell: '#4a2329', cellAlt: '#411f25', line: 'rgba(255,255,255,.07)', glow: '#ff8a4c' },
  sakura:   { board: '#3a1f30', cell: '#4a2840', cellAlt: '#412338', line: 'rgba(255,255,255,.08)', glow: '#ff7eb6' },
  ocean:    { board: '#10333d', cell: '#123e4a', cellAlt: '#0f3742', line: 'rgba(255,255,255,.07)', glow: '#2bc4d6' },
  mono:     { board: '#20242c', cell: '#2a2f38', cellAlt: '#262b33', line: 'rgba(255,255,255,.08)', glow: '#c7d2e3' },
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class BoardRenderer {
  constructor(canvas, { onMove, onWall } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onMove = onMove;
    this.onWall = onWall;

    this.state = null;
    this.engine = null;
    this.config = { colors: ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff'], theme: 'emerald' };
    this.mySeat = -1;
    this.mode = 'move';
    this.interactive = false;

    this.hover = null;          // {kind:'cell'|'wall', ...}
    this.legal = [];            // legal move cells for my pawn
    this.anim = null;           // pawn move animation
    this.lastPawns = null;
    this.wallPops = [];         // {r,c,o,t0}

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  /* ------------------------------ Public API ----------------------------- */
  setConfig(config) {
    this.config = { ...this.config, ...config };
    // Accept either a `colors` array or legacy p0/p1 color fields.
    if (!Array.isArray(this.config.colors)) {
      this.config.colors = [config.p0Color || '#36c6ff', config.p1Color || '#ff6b6b', '#ffd36b', '#9b8cff'];
    }
    this.draw();
  }
  _seatColor(s) {
    return (this.config.colors && this.config.colors[s]) ||
      ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff'][s] || '#36c6ff';
  }
  setMySeat(seat) { this.mySeat = seat; this._recomputeLegal(); this.draw(); }
  setMode(mode) { this.mode = mode; this.hover = null; this._recomputeLegal(); this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; this._recomputeLegal(); this.draw(); }

  setState(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;
    this.engine = QuoridorGame.fromState(state);
    // Detect a pawn move to animate.
    if (animate && prev && prev.pawns) {
      for (let s = 0; s < state.pawns.length; s++) {
        const a = prev.pawns[s], b = state.pawns[s];
        if (a && b && (a.r !== b.r || a.c !== b.c)) {
          this.anim = { seat: s, from: { ...a }, to: { ...b }, t0: performance.now(), dur: 260 };
        }
      }
      // Detect a newly placed wall to pop.
      if (state.walls.length > prev.walls.length) {
        const prevKeys = new Set(prev.walls.map((w) => `${w.o}${w.r}${w.c}`));
        for (const w of state.walls) {
          if (!prevKeys.has(`${w.o}${w.r}${w.c}`)) this.wallPops.push({ ...w, t0: performance.now() });
        }
      }
    }
    this._recomputeLegal();
    this._loop();
  }

  _recomputeLegal() {
    this.legal = [];
    if (!this.engine || this.mySeat < 0) return;
    if (this.state.turn === this.mySeat && this.state.winner === null && this.interactive) {
      this.legal = this.engine.legalMoves(this.mySeat);
    }
  }

  /** Called by the wall drag UI to preview a wall at CSS-pixel canvas coords. */
  previewDraggedWall(cssMx, cssMy, o) {
    if (!this.state) { this.hover = null; this.draw(); return; }
    const w = this._nearestWallOriented(cssMx, cssMy, o);
    if (w) {
      const valid = this.engine && this.mySeat >= 0 &&
        this.engine.canPlaceWall(this.mySeat, w.r, w.c, w.o);
      this.hover = { ...w, valid };
    } else {
      this.hover = null;
    }
    this.draw();
  }

  /** Returns the wall at CSS-pixel canvas coords with the given orientation, or null if invalid. */
  getWallAtPos(cssMx, cssMy, o) {
    if (!this.state || !this.engine) return null;
    const w = this._nearestWallOriented(cssMx, cssMy, o);
    if (!w) return null;
    if (!this.engine.canPlaceWall(this.mySeat, w.r, w.c, w.o)) return null;
    return w;
  }

  clearWallPreview() { this.hover = null; this.draw(); }

  /* ------------------------------ Geometry ------------------------------- */
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 200);
    this.canvas.width = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.css = size;
    this.draw();
  }

  _metrics() {
    const N = this.state?.size || 9;
    const S = this.css;
    const margin = S * 0.035;
    const gapRatio = 0.16; // gap as fraction of cell
    // S = 2*margin + N*cell + (N-1)*gap, gap = cell*gapRatio
    const cell = (S - 2 * margin) / (N + (N - 1) * gapRatio);
    const gap = cell * gapRatio;
    return { N, S, margin, cell, gap };
  }
  _cellXY(r, c) {
    const { margin, cell, gap } = this._metrics();
    return { x: margin + c * (cell + gap), y: margin + r * (cell + gap) };
  }
  _cellCenter(r, c) {
    const { cell } = this._metrics();
    const { x, y } = this._cellXY(r, c);
    return { x: x + cell / 2, y: y + cell / 2 };
  }
  _wallRect(r, c, o) {
    const { margin, cell, gap } = this._metrics();
    if (o === 'h') {
      return {
        x: margin + c * (cell + gap),
        y: margin + (r + 1) * cell + r * gap,
        w: 2 * cell + gap,
        h: gap,
      };
    }
    return {
      x: margin + (c + 1) * cell + c * gap,
      y: margin + r * (cell + gap),
      w: gap,
      h: 2 * cell + gap,
    };
  }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() {
    this.canvas.addEventListener('mousemove', (e) => this._onMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    this.canvas.addEventListener('click', (e) => this._onClick(e));
    // touch: tap to act — prevent scroll/selection on the board
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches[0]) { this._onMove(e.touches[0]); }
    }, { passive: false });
  }
  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }
  _myTurn() {
    return this.interactive && this.state && this.state.winner === null &&
      this.state.turn === this.mySeat;
  }

  _hitCell(mx, my) {
    const { N, cell } = this._metrics();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const { x, y } = this._cellXY(r, c);
      if (mx >= x && mx <= x + cell && my >= y && my <= y + cell) return { r, c };
    }
    return null;
  }

  _nearestWallOriented(mx, my, o) {
    const { N, margin, cell, gap } = this._metrics();
    const step = cell + gap;
    if (o === 'h') {
      let rowIdx = 0, bestD = Infinity;
      for (let r = 0; r <= N - 2; r++) {
        const yc = margin + (r + 1) * cell + r * gap + gap / 2;
        const d = Math.abs(my - yc); if (d < bestD) { bestD = d; rowIdx = r; }
      }
      let c = Math.round((mx - margin - cell - gap / 2) / step);
      c = Math.max(0, Math.min(N - 2, c));
      return { kind: 'wall', o: 'h', r: rowIdx, c };
    }
    let colIdx = 0, bestD = Infinity;
    for (let c = 0; c <= N - 2; c++) {
      const xc = margin + (c + 1) * cell + c * gap + gap / 2;
      const d = Math.abs(mx - xc); if (d < bestD) { bestD = d; colIdx = c; }
    }
    let r = Math.round((my - margin - cell - gap / 2) / step);
    r = Math.max(0, Math.min(N - 2, r));
    return { kind: 'wall', o: 'v', r, c: colIdx };
  }

  _nearestWall(mx, my) {
    const { N, margin, cell, gap } = this._metrics();
    // groove center positions
    let bestRowGap = Infinity, rowIdx = 0;
    for (let r = 0; r <= N - 2; r++) {
      const yc = margin + (r + 1) * cell + r * gap + gap / 2;
      const d = Math.abs(my - yc);
      if (d < bestRowGap) { bestRowGap = d; rowIdx = r; }
    }
    let bestColGap = Infinity, colIdx = 0;
    for (let c = 0; c <= N - 2; c++) {
      const xc = margin + (c + 1) * cell + c * gap + gap / 2;
      const d = Math.abs(mx - xc);
      if (d < bestColGap) { bestColGap = d; colIdx = c; }
    }
    const step = cell + gap;
    if (bestRowGap <= bestColGap) {
      // horizontal wall on row groove rowIdx, anchored column from mx
      let c = Math.round((mx - margin - cell - gap / 2) / step);
      c = Math.max(0, Math.min(N - 2, c));
      return { kind: 'wall', o: 'h', r: rowIdx, c };
    }
    let r = Math.round((my - margin - cell - gap / 2) / step);
    r = Math.max(0, Math.min(N - 2, r));
    return { kind: 'wall', o: 'v', r, c: colIdx };
  }

  _onMove(e) {
    if (!this.interactive || !this.state) { this.hover = null; return; }
    const { mx, my } = this._pos(e);
    if (this.mode === 'move') {
      const cell = this._hitCell(mx, my);
      this.hover = cell ? { kind: 'cell', ...cell } : null;
    } else {
      const w = this._nearestWall(mx, my);
      if (w) {
        const valid = this.engine && this.mySeat >= 0 &&
          this.engine.canPlaceWall(this.mySeat, w.r, w.c, w.o);
        this.hover = { ...w, valid };
      } else this.hover = null;
    }
    this.draw();
  }

  _onClick(e) {
    if (!this._myTurn()) return;
    const { mx, my } = this._pos(e);
    // Legal move cells always take priority over wall placement
    const cell = this._hitCell(mx, my);
    if (cell && this.legal.some((d) => d.r === cell.r && d.c === cell.c)) {
      this.onMove?.(cell.r, cell.c);
      return;
    }
    // Wall placement only in wall mode (active during drag)
    if (this.mode === 'wall') {
      const w = this._nearestWall(mx, my);
      if (w && this.engine.canPlaceWall(this.mySeat, w.r, w.c, w.o)) {
        this.onWall?.(w.r, w.c, w.o);
      }
    }
  }

  /* ------------------------------ Rendering ------------------------------ */
  _loop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const tick = () => {
      const active = this._isAnimating();
      this.draw();
      if (active) this._raf = requestAnimationFrame(tick);
      else this._raf = null;
    };
    tick();
  }
  _isAnimating() {
    const now = performance.now();
    if (this.anim && now - this.anim.t0 < this.anim.dur) return true;
    if (this.anim && now - this.anim.t0 >= this.anim.dur) this.anim = null;
    this.wallPops = this.wallPops.filter((w) => now - w.t0 < 320);
    return this.wallPops.length > 0;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { N, S, cell, gap, margin } = this._metrics();
    const pal = PALETTES[this.config.theme] || PALETTES.emerald;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // Board base
    this._roundRect(0, 0, S, S, 18);
    const bg = ctx.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, pal.board);
    bg.addColorStop(1, this._shade(pal.board, -14));
    ctx.fillStyle = bg;
    ctx.fill();

    if (!this.state) { ctx.restore(); return; }

    // Goal edge glows
    this._drawGoalEdges(pal);

    // Cells
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const { x, y } = this._cellXY(r, c);
      this._roundRect(x, y, cell, cell, Math.max(4, cell * 0.16));
      ctx.fillStyle = (r + c) % 2 === 0 ? pal.cell : pal.cellAlt;
      ctx.fill();
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Legal move targets — always show when it's my turn
    if (this.legal.length && this._myTurn()) {
      for (const d of this.legal) {
        const { x, y } = this._cellCenter(d.r, d.c);
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = this._withAlpha(pal.glow, 0.55);
        ctx.fill();
      }
    }

    // Hover cell highlight
    if (this.hover?.kind === 'cell' && this.legal.some((d) => d.r === this.hover.r && d.c === this.hover.c)) {
      const { x, y } = this._cellXY(this.hover.r, this.hover.c);
      this._roundRect(x, y, cell, cell, cell * 0.16);
      ctx.fillStyle = this._withAlpha(pal.glow, 0.22);
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = pal.glow; ctx.stroke();
    }

    // Placed walls
    for (const w of this.state.walls) this._drawWall(w, 1, false);

    // Wall preview
    if (this.hover?.kind === 'wall') {
      this._drawWall(this.hover, this.hover.valid ? 0.7 : 0.4, true, this.hover.valid);
    }

    // Pawns
    this._drawPawns();

    ctx.restore();
  }

  _drawGoalEdges(pal) {
    const ctx = this.ctx;
    const { S, margin } = this._metrics();
    const n = this.state.numPlayers || this.state.pawns.length;
    const t = margin * 1.5;
    const band = (x, y, w, hgt, color, dir) => {
      let g;
      if (dir === 'top') g = ctx.createLinearGradient(0, y, 0, y + hgt);
      else if (dir === 'bottom') g = ctx.createLinearGradient(0, y + hgt, 0, y);
      else if (dir === 'left') g = ctx.createLinearGradient(x, 0, x + w, 0);
      else g = ctx.createLinearGradient(x + w, 0, x, 0);
      g.addColorStop(0, this._withAlpha(color, 0.5));
      g.addColorStop(1, this._withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, hgt);
    };
    // p0 goal = top, p1 = bottom, p2 = right, p3 = left
    band(0, 0, S, t, this._seatColor(0), 'top');
    band(0, S - t, S, t, this._seatColor(1), 'bottom');
    if (n >= 4) {
      band(S - t, 0, t, S, this._seatColor(2), 'right');
      band(0, 0, t, S, this._seatColor(3), 'left');
    }
  }

  _drawWall(w, alpha, preview, valid = true) {
    const ctx = this.ctx;
    const rect = this._wallRect(w.r, w.c, w.o);
    let scale = 1;
    const pop = this.wallPops.find((p) => p.r === w.r && p.c === w.c && p.o === w.o);
    if (pop && !preview) {
      const t = Math.min(1, (performance.now() - pop.t0) / 320);
      scale = 0.6 + 0.4 * easeOut(t);
    }
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    const col = preview ? (valid ? '#ffffff' : '#ff5d6c') : '#f4e7c1';
    const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    grad.addColorStop(0, col);
    grad.addColorStop(1, this._shade(col, -25));
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    this._roundRect(rect.x, rect.y, rect.w, rect.h, rect.h > rect.w ? rect.w / 2.4 : rect.h / 2.4);
    ctx.fill();
    ctx.restore();
  }

  _drawPawns() {
    const ctx = this.ctx;
    const { cell } = this._metrics();
    const radius = cell * 0.33;
    const now = performance.now();
    for (let s = 0; s < this.state.pawns.length; s++) {
      const p = this.state.pawns[s];
      if (!p) continue; // eliminated
      let cx, cy;
      if (this.anim && this.anim.seat === s) {
        const t = Math.min(1, (now - this.anim.t0) / this.anim.dur);
        const e = easeOut(t);
        const a = this._cellCenter(this.anim.from.r, this.anim.from.c);
        const b = this._cellCenter(this.anim.to.r, this.anim.to.c);
        cx = a.x + (b.x - a.x) * e;
        cy = a.y + (b.y - a.y) * e;
      } else {
        const ctr = this._cellCenter(p.r, p.c);
        cx = ctr.x; cy = ctr.y;
      }
      const color = this._seatColor(s);
      // turn glow ring
      if (this.state.winner === null && this.state.turn === s) {
        ctx.beginPath();
        const pulse = 1 + Math.sin(now / 320) * 0.06;
        ctx.arc(cx, cy, radius * 1.32 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = this._withAlpha(color, 0.5);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      // shadow
      ctx.beginPath();
      ctx.ellipse(cx, cy + radius * 0.85, radius * 0.8, radius * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fill();
      // body
      const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.4, radius * 0.2, cx, cy, radius);
      grad.addColorStop(0, this._shade(color, 35));
      grad.addColorStop(1, this._shade(color, -18));
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.shadowColor = this._withAlpha(color, 0.6);
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
      // highlight
      ctx.beginPath();
      ctx.arc(cx - radius * 0.28, cy - radius * 0.32, radius * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fill();
    }
  }

  /* ------------------------------ Drawing utils -------------------------- */
  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  _hexToRgb(hex) {
    const m = hex.replace('#', '');
    return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
  }
  _withAlpha(hex, a) { const { r, g, b } = this._hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  _shade(hex, pct) {
    const { r, g, b } = this._hexToRgb(hex);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
}
