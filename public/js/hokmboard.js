/* =========================================================================
   اَلِ من خورا — Hokm (حکم) card-table renderer  (v3)
   ========================================================================= */
import { HokmGame } from './hokm.js';

// Traditional 2-colour deck: ♠/♣ black, ♥/♦ red.
// The symbol itself distinguishes ♠ from ♣ and ♥ from ♦, so we keep colour
// simple — but we always render a large centre pip + corner pair so the suit
// is instantly readable on small cards.
const SUIT       = ['♠', '♥', '♦', '♣'];
const SUIT_NAME  = ['پیک', 'دل', 'خشت', 'گشنیز'];
const SUIT_COLOR = ['#14161e', '#c8202e', '#c8202e', '#14161e']; // ♠black ♥red ♦red ♣black
const RANK       = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel  = (r) => RANK[r] || String(r);

// When sorting the hand we want alternating colours so between two same-colour
// suits there is always a different-colour suit: ♠ ♥ ♣ ♦ (black-red-black-red).
const SUIT_SORT  = [0, 1, 3, 2]; // index = card.s → visual order position

const FELT      = '#0c5132';
const FELT_EDGE = '#063b22';
const GOLD      = '#ffd76b';
const HOLD_MS   = 2400;      // ms the completed trick stays on the felt
const TRUMP_MS  = 1300;      // ms for the trump-burst effect

/* ─── Layout constants (all fractions of canvas CSS size S) ─────────────
   Zone A: info bar               y = 0.02 – 0.10
   Zone B: top-opponent stack     cy ≈ 0.175, stack y ≈ 0.11 – 0.24
   Zone C: side opponents         cy ≈ 0.48, vertical stacks
   Zone D: centre trick area      centre ± 0.155  → trick cards 0.29 – 0.71
   Zone E: my hand                y ≈ 0.76 – 0.94
──────────────────────────────────────────────────────────────────────── */
const OPP_CY_TOP   = 0.175;   // cy for top-positioned opponents
const OPP_CX_SIDE  = 0.09;    // cx for left/right opponents (symmetric)
const OPP_CY_SIDE  = 0.48;
const TRICK_OFF    = 0.155;    // trick card centre offset from S/2
const HAND_BASE_Y  = 0.765;   // top of my hand area

export class HokmRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.onAction = onAction;

    this.state  = null;
    this.engine = null;
    this.config = { colors: ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'] };
    this.mySeat = -1;
    this.interactive = false;
    this.hand      = [];   // { card, x, y, w, h, legal }
    this.trumpBtns = [];   // { suit, x, y, w, h }
    this.hover     = -1;

    // Timed effects
    this.holdUntil     = 0;
    this.trumpFxUntil  = 0;
    this.trumpFxSuit   = null;
    this._shownTrickNo = 0;
    this._shownTrump   = null;
    this._raf          = null;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  setConfig(config)    { this.config  = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat)      { this.mySeat  = seat;  this.draw(); }
  setInteractive(v)    { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; this.draw(); }

  setState(state) {
    const prev = this.state;
    this.state = state;
    try { this.engine = HokmGame.fromState(state); } catch { this.engine = null; }
    this.hover = -1;

    // Trump burst (only on transition, not on reconnect).
    if (state && state.trump != null && this._shownTrump == null && prev && prev.trump == null) {
      this.trumpFxSuit  = state.trump;
      this.trumpFxUntil = ts() + TRUMP_MS;
    }
    this._shownTrump = state ? state.trump : null;

    // Hold completed trick on the felt.
    const tn = (state && state.trickNumber) || 0;
    if (prev && tn > this._shownTrickNo && state?.lastTrick?.length && state.winner == null) {
      this.holdUntil = ts() + HOLD_MS;
    }
    this._shownTrickNo = Math.max(this._shownTrickNo, tn);

    this._ensureAnim();
    this.draw();
  }

  _seatColor(s) {
    return (this.config.colors && this.config.colors[s]) ||
      ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'][s] || '#ccc';
  }

  _ensureAnim() {
    if (this._raf) return;
    const step = () => {
      this._raf = null;
      this.draw();
      if (ts() < this.holdUntil || ts() < this.trumpFxUntil)
        this._raf = requestAnimationFrame(step);
    };
    if (ts() < this.holdUntil || ts() < this.trumpFxUntil)
      this._raf = requestAnimationFrame(step);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width  = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.css = size;
    this.draw();
  }

  _legalCards() {
    const st = this.state;
    if (!this.interactive || !st || st.phase !== 'play' || !this.engine) return null;
    try {
      return new Set(this.engine.legalMoves(this.mySeat).map((m) => `${m.card.s},${m.card.r}`));
    } catch { return null; }
  }

  /* ── Pointer ─────────────────────────────────────────────────────────── */
  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  }
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
    if (this.state.phase === 'choose-trump') {
      for (const b of this.trumpBtns) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          this.onAction?.({ type: 'trump', suit: b.suit });
          return;
        }
      }
      return;
    }
    const i = this._handIndexAt(mx, my);
    if (i >= 0 && this.hand[i].legal) this.onAction?.({ type: 'play', card: this.hand[i].card });
  }

  /* ── Seating ──────────────────────────────────────────────────────────── */
  _placement() {
    const st = this.state, n = st.numPlayers;
    const me = this.mySeat >= 0 ? this.mySeat : 0;
    const order = n === 4 ? ['bottom', 'left', 'top', 'right']
      : n === 3            ? ['bottom', 'topleft', 'topright']
      :                      ['bottom', 'top'];
    const pos = {};
    for (let s = 0; s < n; s++) pos[s] = order[(s - me + n) % n];
    return pos;
  }

  /* ── Main draw ────────────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const S   = this.css;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // Table background
    this._rr(0, 0, S, S, 16); ctx.fillStyle = FELT_EDGE; ctx.fill();
    this._rr(S * 0.03, S * 0.03, S * 0.94, S * 0.94, S * 0.47); ctx.fillStyle = FELT; ctx.fill();

    this.hand = []; this.trumpBtns = [];
    if (!this.state) { ctx.restore(); return; }

    const st    = this.state;
    const place = this._placement();
    // Card dimensions (consistent throughout the table)
    const CW = S * 0.10, CH = CW * 1.40;

    // ── Zone A: info bar ──
    this._drawInfoBar(ctx, S, st, CW, CH);

    // ── Zone B/C: opponent stacks ──
    for (let s = 0; s < st.numPlayers; s++) {
      if (s === this.mySeat) continue;
      this._drawOpponent(ctx, S, place[s], st, s, CW, CH);
    }

    // ── Zone D: centre trick cards ──
    const holding = ts() < this.holdUntil && st.lastTrick?.length;
    const centre  = holding ? st.lastTrick : (st.trick || []);
    const trickWinner = (holding || st.winner != null) ? st.lastTrickWinner : null;
    for (const t of centre) {
      const isWinner = t.seat === trickWinner;
      this._drawTrickCard(ctx, S, place[t.seat], t.card, CW, CH, isWinner);
    }
    if (trickWinner != null && centre.length)
      this._winnerBadge(ctx, S, place[trickWinner], st, trickWinner);

    // ── Zone E: my hand ──
    this._drawMyHand(ctx, S, st, CW, CH);

    // ── Overlays ──
    if (st.phase === 'choose-trump') this._drawTrumpChooser(ctx, S, st);
    if (ts() < this.trumpFxUntil && this.trumpFxSuit != null)
      this._drawTrumpBurst(ctx, S, this.trumpFxSuit);

    ctx.restore();
  }

  /* ── Zone A: compact info bar ─────────────────────────────────────────── */
  _drawInfoBar(ctx, S, st) {
    const bh = S * 0.065, by = S * 0.025;

    // Trump badge (left)
    if (st.trump != null) {
      const bw = S * 0.19;
      this._rr(S * 0.04, by, bw, bh, bh * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = `${bh * 0.44}px sans-serif`;
      ctx.fillText('حکم:', S * 0.04 + bw * 0.58, by + bh / 2);
      ctx.fillStyle = SUIT_COLOR[st.trump];
      ctx.font = `bold ${bh * 0.60}px serif`; ctx.textAlign = 'center';
      ctx.fillText(SUIT[st.trump], S * 0.04 + bw * 0.80, by + bh / 2 + 1);
    }

    // Score chips (right side)
    const scoreX = S * 0.26;
    if (st.teams) {
      const myTeam   = (this.mySeat >= 0 ? this.mySeat : 0) % 2;
      const myTricks = st.teamTricks?.[myTeam]    ?? 0;
      const opTricks = st.teamTricks?.[1 - myTeam] ?? 0;
      this._scoreChip(ctx, scoreX,         by, S * 0.33, bh, 'تیم ما',    myTricks, st.winThreshold, this._seatColor(myTeam),      true);
      this._scoreChip(ctx, scoreX + S*0.36, by, S * 0.33, bh, 'تیم حریف', opTricks, st.winThreshold, this._seatColor(1 - myTeam), false);
    } else {
      const n   = st.numPlayers;
      const gap = S * 0.01;
      const cw  = (S * 0.94 - scoreX - gap * (n - 1)) / n;
      for (let s = 0; s < n; s++) {
        const me = s === this.mySeat;
        this._scoreChip(ctx, scoreX + s * (cw + gap), by, cw, bh,
          me ? 'من' : `بازیکن ${FA[s + 1]}`,
          st.tricksWon?.[s] ?? 0, st.winThreshold, this._seatColor(s), me);
      }
    }
  }

  _scoreChip(ctx, x, y, w, h, label, val, thr, color, highlight) {
    this._rr(x, y, w, h, h * 0.35);
    ctx.fillStyle = highlight ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.36)'; ctx.fill();
    ctx.strokeStyle = highlight ? GOLD : 'rgba(255,255,255,.12)';
    ctx.lineWidth = highlight ? 1.5 : 0.8; ctx.stroke();

    // Colour dot
    ctx.beginPath(); ctx.arc(x + h * 0.44, y + h * 0.50, h * 0.18, 0, 6.28);
    ctx.fillStyle = color; ctx.fill();

    // Label left-aligned after dot
    ctx.fillStyle = 'rgba(255,255,255,.80)'; ctx.font = `${h * 0.33}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + h * 0.72, y + h * 0.32);

    // Score right-aligned
    ctx.fillStyle = val >= thr ? GOLD : (highlight ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.70)');
    ctx.font      = `bold ${h * 0.36}px sans-serif`;
    ctx.fillText(`${fa(val)} / ${fa(thr)}`, x + h * 0.72, y + h * 0.72);
  }

  /* ── Opponent stacks (Zone B / C) ─────────────────────────────────────── */
  _drawOpponent(ctx, S, where, st, seat, CW, CH) {
    const active  = st.turn === seat && st.winner == null && st.phase === 'play';
    const count   = st.handCounts?.[seat] ?? 0;
    const isHakem = st.hakem === seat;
    const tricks  = st.tricksWon?.[seat] ?? 0;

    // Stack centre position
    let cx, cy, horizontal = true;
    switch (where) {
      case 'top':       cx = S / 2;       cy = S * OPP_CY_TOP;  break;
      case 'topleft':   cx = S * 0.25;    cy = S * OPP_CY_TOP;  break;
      case 'topright':  cx = S * 0.75;    cy = S * OPP_CY_TOP;  break;
      case 'left':      cx = S*OPP_CX_SIDE; cy = S*OPP_CY_SIDE; horizontal = false; break;
      default:          cx = S*(1-OPP_CX_SIDE); cy = S*OPP_CY_SIDE; horizontal = false; break;
    }

    // Small face-down stack (fan style, cap at 7)
    const shown = Math.min(count, 7);
    const gap   = CW * 0.28;
    const span  = (shown - 1) * gap;
    for (let i = 0; i < shown; i++) {
      const off = -span / 2 + i * gap;
      const x   = (horizontal ? cx + off : cx) - CW / 2;
      const y   = (horizontal ? cy : cy + off) - CH / 2;
      this._cardBack(ctx, x, y, CW, CH, this._seatColor(seat));
    }

    // Active glow ring
    if (active) {
      ctx.save();
      const pad = CW * 0.3;
      const rw  = (horizontal ? span + CW : CW) + pad * 2;
      const rh  = (horizontal ? CH : span + CH) + pad * 2;
      this._rr(cx - rw / 2, cy - rh / 2, rw, rh, 10);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 12; ctx.stroke(); ctx.restore();
    }

    // Compact label: directly on the stack (small badge) — no floating text.
    // Draw a pill at the bottom edge of the stack.
    const pillW = CW * 1.6, pillH = S * 0.038;
    const pillX = cx - pillW / 2, pillY = (horizontal ? cy + CH / 2 : cy + span / 2 + CH / 2) + S * 0.012;
    this._rr(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    const labelText = (isHakem ? '👑 ' : '') + (active ? '● ' : '') + `${fa(tricks)}/${fa(st.winThreshold)}`;
    ctx.fillStyle = active ? GOLD : 'rgba(255,255,255,.85)';
    ctx.font = `${pillH * 0.60}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(labelText, cx, pillY + pillH / 2);
  }

  /* ── Centre trick cards (Zone D) ─────────────────────────────────────── */
  _drawTrickCard(ctx, S, where, card, CW, CH, isWinner) {
    const c   = S / 2, off = S * TRICK_OFF;
    let x = c, y = c;
    if      (where === 'bottom')   { y = c + off; }
    else if (where === 'top')      { y = c - off; }
    else if (where === 'topleft')  { x = c - off; y = c - off * 0.6; }
    else if (where === 'topright') { x = c + off; y = c - off * 0.6; }
    else if (where === 'left')     { x = c - off; }
    else                           { x = c + off; }

    if (isWinner) {
      ctx.save();
      ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
      this._rr(x - CW / 2 - 3, y - CH / 2 - 3, CW + 6, CH + 6, CW * 0.14);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
    this._cardFace(ctx, x - CW / 2, y - CH / 2, CW, CH, card);
  }

  _winnerBadge(ctx, S, where, st, seat) {
    const c = S / 2, off = S * TRICK_OFF + S * 0.14;
    let x = c, y = c;
    if      (where === 'bottom')   { y = c + off; }
    else if (where === 'top')      { y = c - off; }
    else if (where === 'topleft')  { x = c - off; y = c - off * 0.6; }
    else if (where === 'topright') { x = c + off; y = c - off * 0.6; }
    else if (where === 'left')     { x = c - off; }
    else                           { x = c + off; }

    const w = S * 0.22, h = S * 0.055;
    const pulse = 0.5 + 0.5 * Math.sin(ts() / 180);
    ctx.save();
    ctx.globalAlpha = 0.88 + 0.12 * pulse;
    this._rr(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = 'rgba(8,16,12,.92)'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5 + 0.5 * pulse; ctx.stroke();
    ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.52}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = seat === this.mySeat ? 'تو' : `بازیکن ${FA[seat + 1]}`;
    ctx.fillText(`🏆 ${name}`, x, y);
    ctx.restore();
  }

  /* ── My hand (Zone E) ────────────────────────────────────────────────── */
  _drawMyHand(ctx, S, st, CW, CH) {
    const cards = st.hands?.[this.mySeat];
    if (!cards || !cards.length) return;

    // Sort: alternating colours (♠ ♥ ♣ ♦), descending rank within each suit.
    const sorted = [...cards].sort((a, b) =>
      (SUIT_SORT[a.s] - SUIT_SORT[b.s]) || (b.r - a.r));

    const legal   = this._legalCards();
    const maxSpan = S * 0.88;
    const spacing = Math.min(CW * 0.90, (maxSpan - CW) / Math.max(1, sorted.length - 1));
    const totalW  = CW + (sorted.length - 1) * spacing;
    const startX  = (S - totalW) / 2;
    const baseY   = S * HAND_BASE_Y;

    sorted.forEach((card, i) => {
      const isLegal = !legal || legal.has(`${card.s},${card.r}`);
      const lift    = (this.hover === i && isLegal) ? S * 0.028 : 0;
      const x = startX + i * spacing;
      const y = baseY - lift;
      this.hand.push({ card, x, y, w: CW, h: CH, legal: !!(legal && isLegal) });
      this._cardFace(ctx, x, y, CW, CH, card);
      if (legal && !isLegal) {
        this._rr(x, y, CW, CH, CW * 0.12);
        ctx.fillStyle = 'rgba(10,20,14,.52)'; ctx.fill();
      } else if (legal && isLegal) {
        this._rr(x, y, CW, CH, CW * 0.12);
        ctx.strokeStyle = 'rgba(80,230,140,.95)'; ctx.lineWidth = 2.5; ctx.stroke();
      }
    });

    // My status strip — drawn BELOW my cards (inside bottom felt area).
    const my    = this.mySeat;
    const ySub  = baseY + CH + S * 0.018;
    if (ySub + S * 0.04 < S * 0.98) {
      const isHakem = st.hakem === my;
      const myActive = st.turn === my && st.winner == null && st.phase === 'play';
      ctx.fillStyle = myActive ? GOLD : 'rgba(255,255,255,.75)';
      ctx.font = `${S * 0.028}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tricks = st.tricksWon?.[my] ?? 0;
      ctx.fillText(
        (isHakem ? '👑 حاکم · ' : '') + `${fa(tricks)} / ${fa(st.winThreshold)} دست` + (myActive ? ' · نوبت توست ●' : ''),
        S / 2, ySub + S * 0.016
      );
    }
  }

  /* ── Trump chooser overlay ────────────────────────────────────────────── */
  _drawTrumpChooser(ctx, S, st) {
    const choosing = st.hakem === this.mySeat && this.interactive;
    const ow = S * 0.68, oh = S * 0.26, ox = (S - ow) / 2, oy = (S - oh) / 2;
    this._rr(ox, oy, ow, oh, 14); ctx.fillStyle = 'rgba(8,16,12,.93)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.042}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(choosing ? '👑 حکم را انتخاب کن:' : '👑 حاکم در حال انتخاب حکم…', S / 2, oy + oh * 0.08);
    if (!choosing) return;

    const bw = ow * 0.19, bh = oh * 0.48, gy = oy + oh * 0.40;
    for (let s = 0; s < 4; s++) {
      const bx = ox + ow * 0.06 + s * (bw + ow * 0.027);
      this._rr(bx, gy, bw, bh, 8);
      ctx.fillStyle = '#fbfaf6'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke();
      // Big suit symbol
      ctx.fillStyle = SUIT_COLOR[s];
      ctx.font = `${bh * 0.52}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[s], bx + bw / 2, gy + bh * 0.40);
      // Suit name below
      ctx.font = `${bh * 0.20}px sans-serif`; ctx.textBaseline = 'bottom';
      ctx.fillText(SUIT_NAME[s], bx + bw / 2, gy + bh * 0.94);
      this.trumpBtns.push({ suit: s, x: bx, y: gy, w: bw, h: bh });
    }
  }

  /* ── Trump burst effect ───────────────────────────────────────────────── */
  _drawTrumpBurst(ctx, S, suit) {
    const t    = 1 - Math.max(0, (this.trumpFxUntil - ts()) / TRUMP_MS);
    const ease = 1 - Math.pow(1 - t, 3);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha) * 0.88;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * (0.07 + ease * 0.30), 0, Math.PI * 2);
    ctx.strokeStyle = SUIT_COLOR[suit]; ctx.lineWidth = 5 * (1 - ease) + 1; ctx.stroke();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle  = SUIT_COLOR[suit];
    ctx.shadowColor = SUIT_COLOR[suit]; ctx.shadowBlur = 24 * (1 - ease) + 6;
    ctx.font = `bold ${S * (0.12 + ease * 0.13)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[suit], S / 2, S * 0.46);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.044}px sans-serif`;
    ctx.fillText(`حکم: ${SUIT_NAME[suit]}`, S / 2, S * 0.58);
    ctx.restore();
  }

  /* ── Card art ─────────────────────────────────────────────────────────── */
  _cardFace(ctx, x, y, w, h, card) {
    this._rr(x, y, w, h, w * 0.12);
    ctx.fillStyle = '#fbfaf6'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1; ctx.stroke();

    const col = SUIT_COLOR[card.s];
    const r   = rankLabel(card.r);

    // Top-left: rank + suit (stacked, same colour as suit)
    ctx.fillStyle    = col;
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'left';
    ctx.font         = `bold ${h * 0.22}px sans-serif`;
    ctx.fillText(r, x + w * 0.09, y + h * 0.05);
    ctx.font = `${h * 0.20}px serif`;
    ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);

    // Centre: large suit symbol — always readable
    ctx.font         = `${h * 0.40}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
  }

  _cardBack(ctx, x, y, w, h, accent) {
    this._rr(x, y, w, h, w * 0.14);
    ctx.fillStyle = '#1e2a3a'; ctx.fill();
    ctx.strokeStyle = accent || '#3a7a'; ctx.lineWidth = 1.5; ctx.stroke();
    // Inner inlay pattern
    ctx.fillStyle = 'rgba(255,255,255,.09)';
    this._rr(x + w * 0.18, y + h * 0.13, w * 0.64, h * 0.74, w * 0.10); ctx.fill();
  }

  _rr(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);         ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function fa(n) { return String(n).replace(/\d/g, (d) => FA[+d]); }
function ts()  { return (typeof performance !== 'undefined' ? performance : Date).now(); }
