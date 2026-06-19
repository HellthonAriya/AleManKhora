/* =========================================================================
   اَلِ من خورا — Hokm (حکم) card-table renderer.
   The viewer always sits at the bottom; opponents sit around the table with
   face-down stacks. Shows the current trick, the trump (حکم) suit, and — when
   it's the viewer's turn to choose trump — four suit buttons. Tapping a legal
   hand card plays it. Emits { type:'play', card } or { type:'trump', suit }.
   Interface matches the other renderers (setConfig/setMySeat/setState/
   setInteractive/destroy/_resize).
   ========================================================================= */
import { HokmGame } from './hokm.js';

const SUIT = ['♠', '♥', '♦', '♣'];
const SUIT_RED = [false, true, true, false];
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel = (r) => RANK[r] || String(r);
const FELT = '#0c5132', FELT_EDGE = '#063b22';

export class HokmRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.engine = null;
    this.config = { colors: ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'] };
    this.mySeat = -1;
    this.interactive = false;
    this.hand = [];           // {card, x, y, w, h, legal}
    this.trumpBtns = [];      // {suit, x, y, w, h}
    this.hover = -1;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }
  destroy() { window.removeEventListener('resize', this._onResize); }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; this.draw(); }
  setState(state) {
    this.state = state;
    try { this.engine = HokmGame.fromState(state); } catch { this.engine = null; }
    this.hover = -1;
    this.draw();
  }
  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'][s] || '#ccc'; }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width = size * this._dpr; this.canvas.height = size * this._dpr;
    this.css = size; this.draw();
  }

  /** Legal cards for me right now (by value), or null if not my play turn. */
  _legalCards() {
    const st = this.state;
    if (!this.interactive || !st || st.phase !== 'play' || !this.engine) return null;
    try {
      return new Set(this.engine.legalMoves(this.mySeat).map((m) => `${m.card.s},${m.card.r}`));
    } catch { return null; }
  }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; }
  _handIndexAt(mx, my) {
    for (let i = this.hand.length - 1; i >= 0; i--) {
      const c = this.hand[i];
      if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return i;
    }
    return -1;
  }
  _onHover(e) {
    if (!this.interactive) return;
    const { mx, my } = this._pos(e);
    const i = this._handIndexAt(mx, my);
    if (i !== this.hover) { this.hover = i; this.draw(); }
  }
  _onClick(e) {
    if (!this.interactive || !this.state) return;
    const { mx, my } = this._pos(e);
    // Trump chooser
    if (this.state.phase === 'choose-trump') {
      for (const b of this.trumpBtns) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          this.onAction?.({ type: 'trump', suit: b.suit });
          return;
        }
      }
      return;
    }
    // Play a card
    const i = this._handIndexAt(mx, my);
    if (i >= 0 && this.hand[i].legal) this.onAction?.({ type: 'play', card: this.hand[i].card });
  }

  /* --------------------------- Relative seating -------------------------- */
  /** Where each seat sits on screen, relative to me at the bottom. */
  _placement() {
    const st = this.state, n = st.numPlayers;
    const me = this.mySeat >= 0 ? this.mySeat : 0;
    // relative index 0 = bottom (me), then around the table
    const order = n === 4 ? ['bottom', 'left', 'top', 'right']
      : n === 3 ? ['bottom', 'topleft', 'topright']
      : ['bottom', 'top'];
    const pos = {};
    for (let s = 0; s < n; s++) {
      const rel = (s - me + n) % n;
      pos[s] = order[rel];
    }
    return pos;
  }

  /* ------------------------------ Render --------------------------------- */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const S = this.css;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    // Table
    this._roundRect(0, 0, S, S, 16); ctx.fillStyle = FELT_EDGE; ctx.fill();
    this._roundRect(S * 0.04, S * 0.04, S * 0.92, S * 0.92, 999); ctx.fillStyle = FELT; ctx.fill();
    this.hand = []; this.trumpBtns = [];
    if (!this.state) { ctx.restore(); return; }
    const st = this.state;

    // Trump badge
    if (st.trump != null) this._trumpBadge(ctx, S, st.trump);
    // Hakem marker text
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${S * 0.032}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(st.teams ? 'حالت تیمی ۲ در ۲' : 'انفرادی', S * 0.06, S * 0.93);

    const place = this._placement();
    const cw = S * 0.115, ch = cw * 1.4;

    // Opponent stacks (face-down) + their played trick cards
    for (let s = 0; s < st.numPlayers; s++) {
      if (s === this.mySeat) continue;
      this._drawOpponent(ctx, S, place[s], st.handCounts[s], s, st);
    }

    // Current trick in the centre
    for (const t of (st.trick || [])) {
      const where = place[t.seat];
      this._drawTrickCard(ctx, S, where, t.card, cw, ch);
    }

    // My hand
    this._drawMyHand(ctx, S, st, cw, ch);

    // Trump chooser overlay
    if (st.phase === 'choose-trump') this._drawTrumpChooser(ctx, S, st);

    ctx.restore();
  }

  _trumpBadge(ctx, S, suit) {
    const x = S * 0.06, y = S * 0.055, w = S * 0.16, h = S * 0.075;
    this._roundRect(x, y, w, h, 8); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `${h * 0.5}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('حکم:', x + w * 0.12, y + h / 2);
    ctx.fillStyle = SUIT_RED[suit] ? '#ff5b6b' : '#fff';
    ctx.font = `${h * 0.62}px serif`; ctx.fillText(SUIT[suit], x + w * 0.62, y + h / 2);
  }

  _seatLabel(seat, st) {
    if (st.teams) return seat % 2 === (this.mySeat % 2) ? 'هم‌تیمی' : 'حریف';
    return `بازیکن ${['۱', '۲', '۳', '۴'][seat]}`;
  }

  _drawOpponent(ctx, S, where, count, seat, st) {
    const cw = S * 0.06, ch = cw * 1.4, gap = cw * 0.34;
    const active = st.turn === seat && !st.winner;
    let cx, cy, horizontal = true;
    if (where === 'top') { cx = S / 2; cy = S * 0.10; }
    else if (where === 'topleft') { cx = S * 0.28; cy = S * 0.10; }
    else if (where === 'topright') { cx = S * 0.72; cy = S * 0.10; }
    else if (where === 'left') { cx = S * 0.10; cy = S / 2; horizontal = false; }
    else { cx = S * 0.90; cy = S / 2; horizontal = false; } // right
    const shown = Math.min(count, 8);
    const span = (shown - 1) * gap;
    for (let i = 0; i < shown; i++) {
      const off = -span / 2 + i * gap;
      const x = (horizontal ? cx + off : cx) - cw / 2;
      const y = (horizontal ? cy : cy + off) - ch / 2;
      this._cardBack(ctx, x, y, cw, ch, this._seatColor(seat));
    }
    // label + count + active glow
    ctx.fillStyle = active ? '#ffe08a' : 'rgba(255,255,255,.75)';
    ctx.font = `${S * 0.03}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ly = where === 'left' || where === 'right' ? cy + ch * 0.75 : cy + ch * 0.75;
    ctx.fillText(`${this._seatLabel(seat, st)} · ${count}` + (active ? ' ●' : ''), cx, ly);
  }

  _drawTrickCard(ctx, S, where, card, cw, ch) {
    const c = S / 2, off = S * 0.16;
    let x = c, y = c;
    if (where === 'bottom') { y = c + off; }
    else if (where === 'top') { y = c - off; }
    else if (where === 'topleft') { x = c - off; y = c - off * 0.6; }
    else if (where === 'topright') { x = c + off; y = c - off * 0.6; }
    else if (where === 'left') { x = c - off; }
    else { x = c + off; }
    this._cardFace(ctx, x - cw / 2, y - ch / 2, cw, ch, card, true);
  }

  _drawMyHand(ctx, S, st, cw, ch) {
    const cards = (st.hands && st.hands[this.mySeat]) ? st.hands[this.mySeat] : null;
    if (!cards || !cards.length) return;
    const sorted = [...cards].sort((a, b) => (a.s - b.s) || (b.r - a.r));
    const legal = this._legalCards();
    const maxW = S * 0.9;
    const spacing = Math.min(cw * 0.92, (maxW - cw) / Math.max(1, sorted.length - 1));
    const totalW = cw + (sorted.length - 1) * spacing;
    const startX = (S - totalW) / 2;
    const baseY = S - ch - S * 0.075;
    sorted.forEach((card, i) => {
      const isLegal = !legal || legal.has(`${card.s},${card.r}`);
      const lifted = (this.hover === i && isLegal) ? S * 0.03 : 0;
      const x = startX + i * spacing;
      const y = baseY - lifted;
      this.hand.push({ card, x, y, w: cw, h: ch, legal: !!(legal && legal.has(`${card.s},${card.r}`)) });
      this._cardFace(ctx, x, y, cw, ch, card, true);
      if (legal && !isLegal) { ctx.fillStyle = 'rgba(10,20,14,.5)'; this._roundRect(x, y, cw, ch, 6); ctx.fill(); }
      else if (legal && isLegal) { ctx.strokeStyle = 'rgba(120,240,170,.9)'; ctx.lineWidth = 2; this._roundRect(x, y, cw, ch, 6); ctx.stroke(); }
    });
  }

  _drawTrumpChooser(ctx, S, st) {
    const choosing = st.hakem === this.mySeat && this.interactive;
    const w = S * 0.6, h = S * 0.2, x = (S - w) / 2, y = (S - h) / 2;
    this._roundRect(x, y, w, h, 14); ctx.fillStyle = 'rgba(8,16,12,.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `${S * 0.038}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(choosing ? 'حکم را انتخاب کن:' : 'حاکم در حال انتخاب حکم…', S / 2, y + h * 0.1);
    if (!choosing) return;
    const bw = w * 0.2, bh = h * 0.5, gy = y + h * 0.42;
    for (let s = 0; s < 4; s++) {
      const bx = x + w * 0.06 + s * (bw + w * 0.026);
      this._roundRect(bx, gy, bw, bh, 8); ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fill();
      ctx.fillStyle = SUIT_RED[s] ? '#d63b48' : '#1a1a1f';
      ctx.font = `${bh * 0.7}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[s], bx + bw / 2, gy + bh / 2);
      this.trumpBtns.push({ suit: s, x: bx, y: gy, w: bw, h: bh });
    }
  }

  /* ------------------------------ Card art ------------------------------- */
  _cardFace(ctx, x, y, w, h, card, _shadow) {
    this._roundRect(x, y, w, h, w * 0.12);
    ctx.fillStyle = '#fbfaf6'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
    const red = SUIT_RED[card.s];
    ctx.fillStyle = red ? '#d63b48' : '#1a1a22';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${h * 0.26}px sans-serif`;
    ctx.fillText(rankLabel(card.r), x + w * 0.1, y + h * 0.06);
    ctx.font = `${h * 0.34}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[card.s], x + w / 2, y + h * 0.6);
  }
  _cardBack(ctx, x, y, w, h, accent) {
    this._roundRect(x, y, w, h, w * 0.14);
    ctx.fillStyle = '#243042'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = accent || '#5a7'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    this._roundRect(x + w * 0.18, y + h * 0.14, w * 0.64, h * 0.72, w * 0.1); ctx.fill();
  }
  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}
