/* =========================================================================
   اَلِ من خورا — Shared grid renderer for the placement games:
   دوز (tic-tac-toe), گوموکو (gomoku) and اوتلو (othello).

   One renderer, three looks. The board state carries `gameType`, so a single
   draw loop dispatches per game. Pieces are placed on cell centres of an
   n×n grid; clicking a cell emits { type:'place', r, c } via onAction.

   Interface (matches BoardRenderer / ChessBoardRenderer so game.js can treat
   every renderer the same): constructor(canvas, { onAction }), setConfig,
   setMySeat, setState, setInteractive, destroy, _resize.
   ========================================================================= */

import { gridTheme } from './boardthemes.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class GridRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.config = { colors: ['#36c6ff', '#ff6b6b'] };
    this.mySeat = -1;
    this.interactive = false;
    this.hover = null;          // {r,c}
    this.anim = null;           // {since, cells:Set} flip/appear animation
    this._raf = null;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  /* ------------------------------ Public API ----------------------------- */
  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this.draw(); }
  setInteractive(v) {
    this.interactive = v;
    this.canvas.style.cursor = v ? 'pointer' : 'default';
    if (!v) this.hover = null;
    this.draw();
  }

  setState(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;
    // Animate cells that changed owner since the previous state (appear / flip).
    if (animate && prev && prev.board && state.board && prev.board.length === state.board.length) {
      const changed = [];
      for (let i = 0; i < state.board.length; i++) {
        if (state.board[i] !== prev.board[i] && state.board[i] != null) changed.push(i);
      }
      if (changed.length) this.anim = { since: performance.now(), dur: 240, cells: new Set(changed) };
    }
    this.hover = null;
    this._loop();
  }

  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#36c6ff', '#ff6b6b'][s] || '#ccc'; }

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
    const n = this.state?.n || 8;
    const S = this.css;
    const margin = S * (this.state?.gameType === 'tictactoe' ? 0.06 : 0.035);
    const cell = (S - 2 * margin) / n;
    return { n, S, margin, cell };
  }
  _cellXY(r, c) {
    const { margin, cell } = this._metrics();
    return { x: margin + c * cell, y: margin + r * cell };
  }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const { n, margin, cell } = this._metrics();
    const c = Math.floor((e.clientX - rect.left - margin) / cell);
    const r = Math.floor((e.clientY - rect.top - margin) / cell);
    if (r < 0 || c < 0 || r >= n || c >= n) return null;
    return { r, c };
  }
  _isLegal(r, c) {
    const st = this.state;
    if (!st) return false;
    if (st.gameType === 'othello') return (st.legal || []).some((m) => m.r === r && m.c === c);
    return st.board[r * st.n + c] == null; // tic-tac-toe / gomoku: any empty cell
  }
  _onHover(e) {
    if (!this.interactive) { if (this.hover) { this.hover = null; this.draw(); } return; }
    const hit = this._hit(e);
    const next = hit && this._isLegal(hit.r, hit.c) ? hit : null;
    if ((next?.r) !== (this.hover?.r) || (next?.c) !== (this.hover?.c)) { this.hover = next; this.draw(); }
  }
  _onClick(e) {
    if (!this.interactive) return;
    const hit = this._hit(e);
    if (!hit || !this._isLegal(hit.r, hit.c)) return;
    this.onAction?.({ type: 'place', r: hit.r, c: hit.c });
  }

  /* ------------------------------ Render loop ---------------------------- */
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
    const ctx = this.ctx;
    if (!ctx) return;
    const st = this.state;
    const { n, S, margin, cell } = this._metrics();
    const look = gridTheme(st?.gameType, this.config?.boardTheme);
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    if (!st) { ctx.restore(); return; }

    // Frame + board
    this._roundRect(0, 0, S, S, 16); ctx.fillStyle = look.frame || '#0c0f15'; ctx.fill();
    this._roundRect(margin * 0.5, margin * 0.5, S - margin, S - margin, 12);
    ctx.fillStyle = look.bg; ctx.fill();

    if (st.gameType === 'othello') this._drawOthelloGrid(ctx, n, margin, cell, look);
    else if (st.gameType === 'gomoku') this._drawLineGrid(ctx, n, margin, cell, look, true);
    else this._drawTicTacToeGrid(ctx, n, margin, cell, look);

    // Legal-move hints (othello, my turn)
    if (st.gameType === 'othello' && this.interactive && Array.isArray(st.legal)) {
      for (const m of st.legal) {
        const { x, y } = this._cellXY(m.r, m.c);
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill();
      }
    }

    // Hover highlight
    if (this.hover && this.interactive) {
      const { x, y } = this._cellXY(this.hover.r, this.hover.c);
      if (st.gameType === 'othello') {
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = this._seatColor(this.mySeat >= 0 ? this.mySeat : st.turn) + '66'; ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
      }
    }

    // Pieces
    const animProg = this.anim ? easeOut((performance.now() - this.anim.since) / this.anim.dur) : 1;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = st.board[r * n + c];
      if (v == null) continue;
      const i = r * n + c;
      const scale = (this.anim && this.anim.cells.has(i)) ? animProg : 1;
      const { x, y } = this._cellXY(r, c);
      const cx = x + cell / 2, cy = y + cell / 2;
      if (st.gameType === 'tictactoe') this._drawMark(ctx, v, cx, cy, cell, scale);
      else this._drawDisc(ctx, v, cx, cy, cell * (st.gameType === 'gomoku' ? 0.46 : 0.42), scale);
    }

    // Winning line / cells
    if (st.gameType === 'tictactoe' && st.line) this._strokeWinLine(ctx, st.line, n, cell, margin);
    if (st.gameType === 'gomoku' && st.winLine) {
      for (const cellPos of st.winLine) {
        const { x, y } = this._cellXY(cellPos.r, cellPos.c);
        ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(2, cell * 0.06); ctx.stroke();
      }
    }
    // Last-move marker (gomoku / othello)
    if (st.last && (st.gameType === 'gomoku' || st.gameType === 'othello')) {
      const { x, y } = this._cellXY(st.last.r, st.last.c);
      ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,80,80,.95)'; ctx.fill();
    }

    ctx.restore();
  }

  _drawTicTacToeGrid(ctx, n, margin, cell, look) {
    ctx.strokeStyle = look.grid; ctx.lineWidth = look.line; ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(margin + i * cell, margin + cell * 0.18); ctx.lineTo(margin + i * cell, margin + n * cell - cell * 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin + cell * 0.18, margin + i * cell); ctx.lineTo(margin + n * cell - cell * 0.18, margin + i * cell); ctx.stroke();
    }
  }
  _drawOthelloGrid(ctx, n, margin, cell, look) {
    ctx.strokeStyle = look.grid; ctx.lineWidth = look.line;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(margin + i * cell, margin); ctx.lineTo(margin + i * cell, margin + n * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin, margin + i * cell); ctx.lineTo(margin + n * cell, margin + i * cell); ctx.stroke();
    }
  }
  _drawLineGrid(ctx, n, margin, cell, look, stars) {
    // Go-style: lines through cell centres.
    const a = margin + cell / 2, b = margin + (n - 1) * cell + cell / 2;
    ctx.strokeStyle = look.grid; ctx.lineWidth = look.line;
    for (let i = 0; i < n; i++) {
      const p = margin + i * cell + cell / 2;
      ctx.beginPath(); ctx.moveTo(p, a); ctx.lineTo(p, b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a, p); ctx.lineTo(b, p); ctx.stroke();
    }
    if (stars && look.star && n >= 13) {
      const pts = [3, Math.floor(n / 2), n - 4];
      ctx.fillStyle = look.star;
      for (const pr of pts) for (const pc of pts) {
        const x = margin + pc * cell + cell / 2, y = margin + pr * cell + cell / 2;
        ctx.beginPath(); ctx.arc(x, y, Math.max(2, cell * 0.08), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _drawDisc(ctx, seat, cx, cy, radius, scale) {
    const color = this._seatColor(seat);
    const dark = this._lum(color) < 0.5;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = Math.max(1.5, radius * 0.12);
    ctx.strokeStyle = dark ? 'rgba(250,250,253,.85)' : 'rgba(16,16,20,.8)';
    ctx.stroke();
    // subtle highlight
    ctx.beginPath(); ctx.arc(cx - radius * 0.28, cy - radius * 0.3, radius * 0.32 * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
    ctx.restore();
  }
  _drawMark(ctx, seat, cx, cy, cell, scale) {
    const color = this._seatColor(seat);
    const r = cell * 0.28 * scale;
    ctx.save();
    ctx.lineWidth = Math.max(3, cell * 0.1); ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    if (seat === 0) { // X
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke();
    } else { // O
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  _strokeWinLine(ctx, line, n, cell, margin) {
    const a = line[0], b = line[line.length - 1];
    const ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(4, cell * 0.08); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(margin + ac * cell + cell / 2, margin + ar * cell + cell / 2);
    ctx.lineTo(margin + bc * cell + cell / 2, margin + br * cell + cell / 2);
    ctx.stroke();
    ctx.restore();
  }

  _lum(hex) {
    const m = (hex || '#888888').replace('#', '');
    if (m.length < 6) return 0.5;
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
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
}
