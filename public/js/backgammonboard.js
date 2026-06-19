/* =========================================================================
   اَلِ من خورا — Backgammon (تخته‌نرد) renderer.
   Fixed orientation (seat 0 home = bottom-right). Tap one of your checkers
   (or the bar) to pick it up, then tap a highlighted destination point or the
   bear-off tray. Emits { type:'move', from, to } via onAction, where from is a
   point index 0..23 or 'bar', and to is 0..23 or 'off'.
   ========================================================================= */
import { BackgammonGame } from './backgammon.js';

const FELT = '#16321f', FRAME = '#5a3a1c', POINT_A = '#caa45a', POINT_B = '#7d4a25', BAR = '#3a2614';

export class BackgammonRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.config = { colors: ['#efe9dc', '#21242b'] };
    this.mySeat = -1;
    this.interactive = false;
    this.sel = null;       // selected from (index or 'bar')
    this.targets = [];     // legal to-values for the selection

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }
  destroy() { window.removeEventListener('resize', this._onResize); }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this._clearSel(); this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; if (!v) this._clearSel(); this.draw(); }
  setState(state) { this.state = state; this._clearSel(); this.draw(); }
  _clearSel() { this.sel = null; this.targets = []; }
  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#efe9dc', '#21242b'][s] || '#ccc'; }

  /* ------------------------------ Geometry ------------------------------- */
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 220);
    this.canvas.width = size * this._dpr; this.canvas.height = size * this._dpr;
    this.css = size; this.draw();
  }
  _geo() {
    const S = this.css, m = S * 0.03;
    const offW = S * 0.10, barW = S * 0.06;
    const colW = (S - 2 * m - barW - offW) / 12;
    const fieldH = S - 2 * m;
    const leftX = m, rightX = m + 6 * colW + barW;
    const barX = m + 6 * colW;
    const offX = S - m - offW;
    const ckR = Math.min(colW * 0.46, fieldH / 12 * 0.5);
    return { S, m, offW, barW, colW, fieldH, leftX, rightX, barX, offX, ckR, topY: m, botY: S - m };
  }
  /** Canonical screen slot for a point index: column centre-x, baseline-y, isTop. */
  _slot(index) {
    const g = this._geo();
    const top = index >= 12;
    let posInRow, col, half;
    if (top) { posInRow = index - 12; }      // 12..23 → 0..11 left→right
    else { posInRow = 11 - index; }          // bottom: 11..0 → 0..11 left→right
    half = posInRow < 6 ? 0 : 1;
    col = posInRow % 6;
    const baseX = half === 0 ? g.leftX : g.rightX;
    const x = baseX + col * g.colW + g.colW / 2;
    const y = top ? g.topY : g.botY;
    return { x, y, top };
  }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() { this.canvas.addEventListener('pointerup', (e) => this._onClick(e)); }
  _pos(e) { const rect = this.canvas.getBoundingClientRect(); return { mx: e.clientX - rect.left, my: e.clientY - rect.top }; }
  _engine() { try { return BackgammonGame.fromState(this.state); } catch { return null; } }

  _hitRegion(mx, my) {
    const g = this._geo();
    if (mx >= g.offX) return { kind: 'off' };
    if (mx >= g.barX && mx < g.barX + g.barW) return { kind: 'bar' };
    // which column?
    let half, col;
    if (mx >= g.leftX && mx < g.leftX + 6 * g.colW) { half = 0; col = Math.floor((mx - g.leftX) / g.colW); }
    else if (mx >= g.rightX && mx < g.rightX + 6 * g.colW) { half = 1; col = Math.floor((mx - g.rightX) / g.colW); }
    else return null;
    if (col < 0 || col > 5) return null;
    const top = my < g.S / 2;
    const posInRow = half === 0 ? col : 6 + col;
    const index = top ? 12 + posInRow : 11 - posInRow;
    return { kind: 'point', index };
  }
  _onClick(e) {
    if (!this.interactive || !this.state) return;
    const { mx, my } = this._pos(e);
    const hit = this._hitRegion(mx, my);
    if (!hit) { this._clearSel(); this.draw(); return; }

    if (this.sel != null) {
      // Resolve a destination.
      const want = hit.kind === 'off' ? 'off' : hit.kind === 'point' ? hit.index : null;
      if (want != null && this.targets.some((t) => t === want)) {
        const from = this.sel; this._clearSel();
        this.onAction?.({ type: 'move', from, to: want });
        return;
      }
    }
    // Otherwise (re)select a source.
    const eng = this._engine();
    if (!eng) { this._clearSel(); this.draw(); return; }
    const moves = eng.legalMoves(this.mySeat);
    let from = null;
    if (hit.kind === 'bar' && this.state.bar[this.mySeat] > 0) from = 'bar';
    else if (hit.kind === 'point') from = hit.index;
    const tos = moves.filter((mv) => mv.from === from).map((mv) => mv.to);
    if (from != null && tos.length) { this.sel = from; this.targets = tos; }
    else this._clearSel();
    this.draw();
  }

  /* ------------------------------ Render --------------------------------- */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const g = this._geo();
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, g.S, g.S);
    // Frame + felt
    this._roundRect(0, 0, g.S, g.S, 14); ctx.fillStyle = FRAME; ctx.fill();
    ctx.fillStyle = FELT; ctx.fillRect(g.m, g.m, g.S - 2 * g.m, g.fieldH);
    // Bar + off tray
    ctx.fillStyle = BAR; ctx.fillRect(g.barX, g.m, g.barW, g.fieldH);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(g.offX, g.m, g.offW, g.fieldH);
    if (!this.state) { ctx.restore(); return; }
    const st = this.state;

    // Points (triangles)
    const triH = g.fieldH * 0.42;
    for (let i = 0; i < 24; i++) {
      const s = this._slot(i);
      const half = (i >= 12 ? (i - 12) : (11 - i)) < 6 ? 0 : 1;
      const colParity = ((i >= 12 ? (i - 12) : (11 - i)) % 6 + half) % 2;
      ctx.fillStyle = colParity === 0 ? POINT_A : POINT_B;
      ctx.beginPath();
      if (s.top) { ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, s.y + triH); }
      else { ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, s.y - triH); }
      ctx.closePath(); ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    }

    // Target highlights
    for (const t of this.targets) {
      if (t === 'off') { ctx.fillStyle = 'rgba(60,220,140,.30)'; ctx.fillRect(g.offX, g.m, g.offW, g.fieldH); }
      else { const s = this._slot(t); this._highlightPoint(ctx, s, g, triH); }
    }
    // Selected source highlight
    if (this.sel != null && this.sel !== 'bar') { const s = this._slot(this.sel); this._highlightPoint(ctx, s, g, triH, 'rgba(80,200,255,.35)'); }

    // Checkers on points
    for (let i = 0; i < 24; i++) {
      const p = st.points[i];
      if (!p || !p.count) continue;
      this._stack(ctx, this._slot(i), p.seat, p.count, g);
    }
    // Bar checkers (seat 0 lower half of bar, seat 1 upper half)
    const barCx = g.barX + g.barW / 2;
    if (st.bar[0]) this._stackAt(ctx, barCx, g.botY, false, 0, st.bar[0], g);
    if (st.bar[1]) this._stackAt(ctx, barCx, g.topY, true, 1, st.bar[1], g);
    if (this.sel === 'bar') { ctx.strokeStyle = 'rgba(80,200,255,.8)'; ctx.lineWidth = 3; ctx.strokeRect(g.barX + 2, g.m + 2, g.barW - 4, g.fieldH - 4); }

    // Off tray counts
    this._offCount(ctx, g, 0, st.off[0]);
    this._offCount(ctx, g, 1, st.off[1]);

    // Dice
    this._dice(ctx, g, st);

    ctx.restore();
  }

  _highlightPoint(ctx, s, g, triH, color = 'rgba(60,220,140,.35)') {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (s.top) { ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, s.y + triH); }
    else { ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, s.y - triH); }
    ctx.closePath(); ctx.fill();
  }
  _stack(ctx, slot, seat, count, g) { this._stackAt(ctx, slot.x, slot.y, slot.top, seat, count, g); }
  _stackAt(ctx, x, baseY, top, seat, count, g) {
    const r = g.ckR;
    const shown = Math.min(count, 5);
    for (let k = 0; k < shown; k++) {
      const cy = top ? baseY + r + k * 2 * r : baseY - r - k * 2 * r;
      this._checker(ctx, x, cy, r, seat);
    }
    if (count > 5) {
      const cy = top ? baseY + r + 4 * 2 * r : baseY - r - 4 * 2 * r;
      ctx.fillStyle = this._lum(this._seatColor(seat)) < 0.5 ? '#fff' : '#111';
      ctx.font = `bold ${r * 0.9}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(count), x, cy);
    }
  }
  _checker(ctx, cx, cy, r, seat) {
    const color = this._seatColor(seat);
    const dark = this._lum(color) < 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = Math.max(1.4, r * 0.16); ctx.strokeStyle = dark ? 'rgba(250,250,253,.6)' : 'rgba(20,20,24,.55)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.15)'; ctx.lineWidth = 1; ctx.stroke();
  }
  _offCount(ctx, g, seat, count) {
    if (!count) return;
    const y = seat === 0 ? g.botY - g.ckR : g.topY + g.ckR;
    ctx.fillStyle = this._seatColor(seat);
    ctx.font = `bold ${g.ckR * 1.0}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`✓${count}`, g.offX + g.offW / 2, y);
  }
  _dice(ctx, g, st) {
    const dice = st.rolled || [];
    if (!dice.length) return;
    const used = countUsed(st);
    const sz = g.colW * 0.7, gap = sz * 0.4;
    const totalW = dice.length * sz + (dice.length - 1) * gap;
    const cx0 = (st.turn === 0 ? g.rightX + 3 * g.colW : g.leftX + 3 * g.colW) - totalW / 2;
    const cy = g.S / 2 - sz / 2;
    dice.forEach((d, i) => {
      const x = cx0 + i * (sz + gap);
      const spent = i < used;
      ctx.globalAlpha = spent ? 0.32 : 1;
      this._roundRect(x, cy, sz, sz, sz * 0.18);
      ctx.fillStyle = '#f3f0e8'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
      this._pips(ctx, x, cy, sz, d);
      ctx.globalAlpha = 1;
    });
  }
  _pips(ctx, x, y, sz, d) {
    ctx.fillStyle = '#1a1a1f';
    const o = sz * 0.26, mid = sz / 2, r = sz * 0.08;
    const P = { tl: [o, o], tr: [sz - o, o], ml: [o, mid], mr: [sz - o, mid], bl: [o, sz - o], br: [sz - o, sz - o], c: [mid, mid] };
    const map = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
    for (const key of (map[d] || [])) {
      const [px, py] = P[key];
      ctx.beginPath(); ctx.arc(x + px, y + py, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  _lum(hex) {
    const m = (hex || '#888888').replace('#', ''); if (m.length < 6) return 0.5;
    const r = parseInt(m.slice(0, 2), 16), gg = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
  }
  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

/** How many of the originally-rolled dice have been consumed this turn. */
function countUsed(st) {
  const rolled = st.rolled || [], remaining = st.dice || [];
  return Math.max(0, rolled.length - remaining.length);
}
