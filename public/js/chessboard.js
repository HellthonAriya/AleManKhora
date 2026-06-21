/* =========================================================================
   اَلِ من خورا — Chess board renderer (2-player + 4-player cross board)
   Canvas-drawn squares and pieces with orientation per seat, legal-move
   highlights, last-move / check highlighting, smooth piece slides and an
   in-board promotion chooser. The server stays authoritative; the embedded
   engine is used only for instant visual feedback (legal targets).
   ========================================================================= */
import { ChessGame } from './chess.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PROMO_ORDER = ['q', 'r', 'b', 'n'];

const BOARD_THEMES = {
  classic:  { light: '#f0d9b5', dark: '#b58863', frame: '#3a2a1c' },
  green:    { light: '#eeeed2', dark: '#769656', frame: '#243016' },
  blue:     { light: '#dee3e6', dark: '#7c9bb0', frame: '#223240' },
  wood:     { light: '#d9b48f', dark: '#8b5a2b', frame: '#2e1c0e' },
  gray:     { light: '#e2e2e6', dark: '#8b8b93', frame: '#2a2a30' },
  midnight: { light: '#5d6b8a', dark: '#2c3650', frame: '#161d2e' },
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class ChessBoardRenderer {
  constructor(canvas, { onMove } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onMove = onMove;

    this.state = null;
    this.engine = null;
    this.config = { boardTheme: 'classic', colors: ['#f3f1ea', '#2b2b30'] };
    this.mySeat = -1;
    this.interactive = false;

    this.sel = null;        // {r,c} selected piece
    this.targets = [];      // legal targets for selected piece [{r,c,capture,promo}]
    this.hover = null;      // {sr,sc} screen-grid hover
    this.promo = null;      // {from,to,options:[{t,rect}]}
    this.anim = null;       // {seat, t, from, to, t0, dur}

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  destroy() { window.removeEventListener('resize', this._onResize); if (this._raf) cancelAnimationFrame(this._raf); }

  /* ------------------------------ Public API ----------------------------- */
  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this._clearSel(); this.draw(); }
  setInteractive(v) {
    this.interactive = v;
    this.canvas.style.cursor = v ? 'pointer' : 'default';
    if (!v) this._clearSel();
    this.draw();
  }

  setState(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;
    this.engine = ChessGame.fromState(state);
    this._clearSel();
    this.promo = null;
    if (animate && prev && state.lastMove &&
        (!prev.lastMove ||
         prev.lastMove.to.r !== state.lastMove.to.r || prev.lastMove.to.c !== state.lastMove.to.c ||
         prev.lastMove.from.r !== state.lastMove.from.r || prev.lastMove.from.c !== state.lastMove.from.c)) {
      const to = state.lastMove.to;
      const piece = state.board[to.r * state.cols + to.c];
      if (piece) this.anim = { seat: piece.seat, from: { ...state.lastMove.from }, to: { ...to }, t0: performance.now(), dur: 240 };
    }
    this._loop();
  }

  /* --------------------------- Orientation ------------------------------- */
  _rot() {
    if (this.mySeat < 0) return 0;
    const N = this.state?.numPlayers || 2;
    return N === 2 ? (this.mySeat === 1 ? 2 : 0) : [0, 3, 2, 1][this.mySeat];
  }
  _toScreen(r, c) {
    const N = this.state.rows;
    switch (this._rot()) {
      case 1: return { sr: c, sc: N - 1 - r };
      case 2: return { sr: N - 1 - r, sc: N - 1 - c };
      case 3: return { sr: N - 1 - c, sc: r };
      default: return { sr: r, sc: c };
    }
  }
  _toBoard(sr, sc) {
    const N = this.state.rows;
    switch (this._rot()) {
      case 1: return { r: N - 1 - sc, c: sr };
      case 2: return { r: N - 1 - sr, c: N - 1 - sc };
      case 3: return { r: sc, c: N - 1 - sr };
      default: return { r: sr, c: sc };
    }
  }

  /* ------------------------------ Geometry ------------------------------- */
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 200);
    this.canvas.width = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.css = size;
    this.draw();
  }
  /** Tiny file/rank labels in the corners of the edge squares (8×8 only). */
  _drawCoords(ctx, theme, N, cell) {
    const fs = Math.max(8, cell * 0.2);
    ctx.save();
    ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    const pad = cell * 0.06;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const { sr, sc } = this._toScreen(r, c);
      if (sr !== N - 1 && sc !== 0) continue; // only bottom row & left column
      const { x, y } = this._cellXY(sr, sc);
      const isLight = (r + c) % 2 === 0;
      ctx.fillStyle = isLight ? theme.dark : theme.light;
      ctx.globalAlpha = 0.9;
      if (sc === 0) { // rank number, top-left
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(String(8 - r), x + pad, y + pad);
      }
      if (sr === N - 1) { // file letter, bottom-right
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(String.fromCharCode(97 + c), x + cell - pad, y + cell - pad);
      }
    }
    ctx.restore();
  }

  _metrics() {
    const N = this.state?.rows || 8;
    const S = this.css;
    const margin = S * 0.03;
    const cell = (S - 2 * margin) / N;
    return { N, S, margin, cell };
  }
  _cellXY(sr, sc) {
    const { margin, cell } = this._metrics();
    return { x: margin + sc * cell, y: margin + sr * cell };
  }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() {
    // Pointer events unify mouse + touch and fire exactly once per tap (no 300ms
    // "ghost click"), which is what makes tap-to-move reliable on phones. The
    // canvas has `touch-action: none`, so taps aren't stolen by scrolling.
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }
  _hitSquare(mx, my) {
    const { N, margin, cell } = this._metrics();
    const sc = Math.floor((mx - margin) / cell);
    const sr = Math.floor((my - margin) / cell);
    if (sr < 0 || sc < 0 || sr >= N || sc >= N) return null;
    const { r, c } = this._toBoard(sr, sc);
    if (this.engine && this.engine.blocked(r, c)) return null;
    return { r, c };
  }
  _myTurn() {
    return this.interactive && this.state && !this.state.gameOver &&
      this.state.turn === this.mySeat && !this.state.eliminated?.[this.mySeat];
  }

  _onHover(e) {
    if (!this.interactive || !this.state) { this.hover = null; return; }
    const { mx, my } = this._pos(e);
    const sq = this._hitSquare(mx, my);
    this.hover = sq ? this._toScreen(sq.r, sq.c) : null;
    this.draw();
  }

  _onClick(e) {
    if (!this.state) return;
    const { mx, my } = this._pos(e);

    // Promotion chooser intercepts the next click.
    if (this.promo) {
      for (const opt of this.promo.options) {
        if (mx >= opt.rect.x && mx <= opt.rect.x + opt.rect.w &&
            my >= opt.rect.y && my <= opt.rect.y + opt.rect.h) {
          const { from, to } = this.promo;
          this.promo = null;
          this.onMove?.(from, to, opt.t);
          this.draw();
          return;
        }
      }
      this.promo = null; this.draw(); return;
    }

    if (!this._myTurn()) return;
    const sq = this._hitSquare(mx, my);
    if (!sq) { this._clearSel(); this.draw(); return; }

    // Clicking a legal target of the selected piece → move (or promote).
    if (this.sel) {
      const t = this.targets.find((d) => d.r === sq.r && d.c === sq.c);
      if (t) {
        if (t.promo) this._openPromo(this.sel, sq);
        else this.onMove?.(this.sel, { r: sq.r, c: sq.c });
        this._clearSel();
        this.draw();
        return;
      }
    }
    // Otherwise (re)select one of my pieces.
    const piece = this.state.board[sq.r * this.state.cols + sq.c];
    if (piece && piece.seat === this.mySeat) {
      this.sel = { r: sq.r, c: sq.c };
      const moves = this.engine.legalMoves(this.mySeat).filter((m) => m.from.r === sq.r && m.from.c === sq.c);
      const seen = new Map();
      for (const m of moves) {
        const k = m.to.r + ',' + m.to.c;
        const cap = !!this.state.board[m.to.r * this.state.cols + m.to.c] || !!m.ep;
        if (!seen.has(k)) seen.set(k, { r: m.to.r, c: m.to.c, capture: cap, promo: !!m.promo });
        else if (m.promo) seen.get(k).promo = true;
      }
      this.targets = [...seen.values()];
    } else {
      this._clearSel();
    }
    this.draw();
  }

  _openPromo(from, to) {
    this.promo = { from, to, options: [] };
    this.draw(); // _drawPromo fills option rects
  }
  _clearSel() { this.sel = null; this.targets = []; }

  /* ------------------------------ Rendering ------------------------------ */
  _loop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const tick = () => {
      const now = performance.now();
      let active = false;
      if (this.anim) {
        if (now - this.anim.t0 < this.anim.dur) active = true; else this.anim = null;
      }
      this.draw();
      this._raf = active ? requestAnimationFrame(tick) : null;
    };
    tick();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { N, S, margin, cell } = this._metrics();
    const theme = BOARD_THEMES[this.config.boardTheme] || BOARD_THEMES.classic;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // Frame
    this._roundRect(0, 0, S, S, 16);
    ctx.fillStyle = theme.frame;
    ctx.fill();

    if (!this.state) { ctx.restore(); return; }
    const cols = this.state.cols;

    // Squares (skip blocked cells on the cross board)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.engine.blocked(r, c)) continue;
      const { sr, sc } = this._toScreen(r, c);
      const { x, y } = this._cellXY(sr, sc);
      ctx.fillStyle = (r + c) % 2 === 0 ? theme.light : theme.dark;
      ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
    }

    // Board coordinates (files a–h, ranks 1–8) — only on the standard 8×8 board.
    // Drawn lichess-style inside the edge squares: small, tucked in the corner,
    // coloured to contrast with the square underneath.
    if (N === 8 && cols === 8) this._drawCoords(ctx, theme, N, cell);

    // Last-move highlight
    if (this.state.lastMove) {
      for (const sq of [this.state.lastMove.from, this.state.lastMove.to]) {
        const { sr, sc } = this._toScreen(sq.r, sq.c);
        const { x, y } = this._cellXY(sr, sc);
        ctx.fillStyle = 'rgba(255,214,107,.38)';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    // Check highlight on kings in check
    if (Array.isArray(this.state.inCheck)) {
      for (let s = 0; s < this.state.inCheck.length; s++) {
        if (!this.state.inCheck[s]) continue;
        const k = this.state.kings?.[s];
        if (!k) continue;
        const { sr, sc } = this._toScreen(k.r, k.c);
        const { x, y } = this._cellXY(sr, sc);
        const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, cell * 0.1, x + cell / 2, y + cell / 2, cell * 0.7);
        g.addColorStop(0, 'rgba(255,70,70,.85)');
        g.addColorStop(1, 'rgba(255,70,70,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, cell, cell);
      }
    }

    // Selection highlight
    if (this.sel) {
      const { sr, sc } = this._toScreen(this.sel.r, this.sel.c);
      const { x, y } = this._cellXY(sr, sc);
      ctx.fillStyle = 'rgba(80,200,255,.35)';
      ctx.fillRect(x, y, cell, cell);
    }
    // Hover highlight
    if (this.hover && this._myTurn()) {
      const { x, y } = this._cellXY(this.hover.sr, this.hover.sc);
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }

    // Pieces
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const p = this.state.board[r * cols + c];
      if (!p) continue;
      if (this.anim && this.anim.to.r === r && this.anim.to.c === c) continue; // drawn animated below
      const { sr, sc } = this._toScreen(r, c);
      const { x, y } = this._cellXY(sr, sc);
      this._drawPiece(p, x + cell / 2, y + cell / 2, cell);
    }
    // Animated piece (sliding)
    if (this.anim) {
      const t = easeOut(Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur));
      const a = this._toScreen(this.anim.from.r, this.anim.from.c);
      const b = this._toScreen(this.anim.to.r, this.anim.to.c);
      const pa = this._cellXY(a.sr, a.sc), pb = this._cellXY(b.sr, b.sc);
      const cx = pa.x + (pb.x - pa.x) * t + cell / 2;
      const cy = pa.y + (pb.y - pa.y) * t + cell / 2;
      const p = this.state.board[this.anim.to.r * cols + this.anim.to.c];
      if (p) this._drawPiece(p, cx, cy, cell);
    }

    // Legal target markers
    if (this.sel && this._myTurn()) {
      for (const d of this.targets) {
        const { sr, sc } = this._toScreen(d.r, d.c);
        const { x, y } = this._cellXY(sr, sc);
        ctx.save();
        if (d.capture) {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.45, 0, Math.PI * 2);
          ctx.lineWidth = cell * 0.08;
          ctx.strokeStyle = 'rgba(40,220,140,.85)';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.16, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(40,220,140,.7)';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    if (this.promo) this._drawPromo(cell);

    ctx.restore();
  }

  _seatColor(seat) {
    return (this.config.colors && this.config.colors[seat]) || ['#f3f1ea', '#2b2b30', '#e8b730', '#3bb15f'][seat] || '#ccc';
  }
  _luminance(hex) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  _drawPiece(p, cx, cy, cell) {
    const ctx = this.ctx;
    const color = this._seatColor(p.seat);
    // Each piece is ONE solid colour. A bold, fixed contrasting border (light
    // border for dark pieces, dark border for light pieces) makes that single
    // colour read clearly on any board square — no shadow blends, no mixed
    // tones. The glyph is stroked first (the border becomes a halo) then filled.
    const dark = this._luminance(color) < 0.5;
    const border = dark ? 'rgba(250,250,253,.96)' : 'rgba(16,16,20,.96)';
    const size = cell * 0.84;
    ctx.save();
    ctx.font = `${size}px "Segoe UI Symbol","Apple Symbols","Noto Sans Symbols2","DejaVu Sans",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const glyph = GLYPH[p.t] || '?';
    const oy = cy + cell * 0.02;
    // Bold contrasting halo/border.
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.strokeStyle = border;
    ctx.strokeText(glyph, cx, oy);
    // Solid single-colour body.
    ctx.fillStyle = color;
    ctx.fillText(glyph, cx, oy);
    ctx.restore();
  }

  _drawPromo(cell) {
    const ctx = this.ctx;
    const { margin } = this._metrics();
    const seat = this.mySeat;
    const color = this._seatColor(seat);
    const w = cell, h = cell;
    // Anchor the menu at the promotion target, stacking downward (clamped).
    const tgt = this._toScreen(this.promo.to.r, this.promo.to.c);
    let { x, y } = this._cellXY(tgt.sr, tgt.sc);
    const maxY = this.css - margin - 4 * h;
    if (y > maxY) y = Math.max(margin, maxY);
    this.promo.options = [];
    ctx.save();
    PROMO_ORDER.forEach((t, i) => {
      const rect = { x, y: y + i * h, w, h };
      this.promo.options.push({ t, rect });
      ctx.fillStyle = i % 2 === 0 ? 'rgba(20,24,34,.97)' : 'rgba(30,36,50,.97)';
      this._roundRect(rect.x, rect.y, rect.w, rect.h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1.5; ctx.stroke();
      this._drawPiece({ t, seat }, rect.x + w / 2, rect.y + h / 2, cell);
    });
    ctx.restore();
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

export { BOARD_THEMES };
