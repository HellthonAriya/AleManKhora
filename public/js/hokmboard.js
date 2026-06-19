/* =========================================================================
   اَلِ من خورا — Hokm (حکم) card-table renderer.
   The viewer always sits at the bottom; opponents sit around the table with
   face-down stacks. Shows the current trick, the trump (حکم) suit, a live
   trick-score board, and — when it's the viewer's turn to choose trump — four
   suit buttons. Tapping a legal hand card plays it.

   Visual touches requested by the players:
     • Four-colour deck so the two red suits (♥/♦) and the two black suits
       (♠/♣) are each instantly distinguishable in hand.
     • When a trick completes the four cards stay on the felt for ~2.4s and the
       winning card is haloed with a "برندهٔ دست" badge pointing at the winner.
     • Choosing the trump fires a short suit-burst effect in the centre.
     • A scoreboard graphic shows how many tricks each side/player has taken.

   Emits { type:'play', card } or { type:'trump', suit }. Interface matches the
   other renderers (setConfig/setMySeat/setState/setInteractive/destroy).
   ========================================================================= */
import { HokmGame } from './hokm.js';

const SUIT = ['♠', '♥', '♦', '♣'];
const SUIT_NAME = ['پیک', 'دل', 'خشت', 'گشنیز'];
// Four-colour deck: spades black, hearts red, diamonds blue, clubs green.
// This keeps ♥ vs ♦ and ♠ vs ♣ apart at a glance.
const SUIT_COLOR = ['#16181f', '#d6263b', '#1f6fd6', '#1f9d52'];
const SUIT_RED = [false, true, true, false];
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel = (r) => RANK[r] || String(r);
const FELT = '#0c5132', FELT_EDGE = '#063b22';
const GOLD = '#ffd76b';
const HOLD_MS = 2400;      // how long a completed trick stays on the felt
const TRUMP_FX_MS = 1300;  // trump-burst duration

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

    // Animation bookkeeping.
    this.holdUntil = 0;       // timestamp while a completed trick is held
    this.trumpFxUntil = 0;    // timestamp while the trump burst plays
    this.trumpFxSuit = null;
    this._shownTrickNo = 0;
    this._shownTrump = null;
    this._raf = null;

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

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; this.draw(); }
  setState(state) {
    const prev = this.state;
    this.state = state;
    try { this.engine = HokmGame.fromState(state); } catch { this.engine = null; }
    this.hover = -1;

    // Trump just chosen → burst effect (skip on the very first paint/restore).
    if (state && state.trump != null && this._shownTrump == null && prev && prev.trump == null) {
      this.trumpFxSuit = state.trump;
      this.trumpFxUntil = now() + TRUMP_FX_MS;
    }
    this._shownTrump = state ? state.trump : null;

    // A new trick just completed → hold the four cards on the felt. Only when
    // we already had a prior state (so joining/reconnecting mid-game doesn't
    // replay an old trick), and not on top of the game-over screen.
    const tn = (state && state.trickNumber) || 0;
    if (prev && tn > this._shownTrickNo && state && state.lastTrick && state.lastTrick.length && state.winner == null) {
      this.holdUntil = now() + HOLD_MS;
    }
    this._shownTrickNo = Math.max(this._shownTrickNo, tn);

    this._ensureAnim();
    this.draw();
  }
  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'][s] || '#ccc'; }

  /** Run a redraw loop while any timed effect is active, then stop. */
  _ensureAnim() {
    if (this._raf) return;
    const step = () => {
      this._raf = null;
      this.draw();
      if (now() < this.holdUntil || now() < this.trumpFxUntil) {
        this._raf = requestAnimationFrame(step);
      }
    };
    if (now() < this.holdUntil || now() < this.trumpFxUntil) {
      this._raf = requestAnimationFrame(step);
    }
  }

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
    const place = this._placement();
    const cw = S * 0.115, ch = cw * 1.4;

    // Trump badge + scoreboard
    if (st.trump != null) this._trumpBadge(ctx, S, st.trump);
    this._scoreboard(ctx, S, st);

    // Opponent stacks (face-down) + active glow
    for (let s = 0; s < st.numPlayers; s++) {
      if (s === this.mySeat) continue;
      this._drawOpponent(ctx, S, place[s], st.handCounts[s], s, st);
    }

    // Centre: held (completed) trick, or the live trick.
    const holding = now() < this.holdUntil && st.lastTrick && st.lastTrick.length;
    const overTrick = st.winner != null && st.trick && st.trick.length;
    let centre = st.trick || [];
    let winnerSeat = null;
    if (holding) { centre = st.lastTrick; winnerSeat = st.lastTrickWinner; }
    else if (overTrick) { centre = st.trick; winnerSeat = st.lastTrickWinner; }
    for (const t of centre) {
      const win = t.seat === winnerSeat;
      this._drawTrickCard(ctx, S, place[t.seat], t.card, cw, ch, win);
    }
    if (winnerSeat != null) this._winnerBadge(ctx, S, place[winnerSeat], st, winnerSeat);

    // My hand
    this._drawMyHand(ctx, S, st, cw, ch);

    // Overlays
    if (st.phase === 'choose-trump') this._drawTrumpChooser(ctx, S, st);
    if (now() < this.trumpFxUntil && this.trumpFxSuit != null) this._drawTrumpBurst(ctx, S, this.trumpFxSuit);

    ctx.restore();
  }

  _trumpBadge(ctx, S, suit) {
    const x = S * 0.06, y = S * 0.055, w = S * 0.17, h = S * 0.078;
    this._roundRect(x, y, w, h, 8); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `${h * 0.46}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('حکم:', x + w * 0.1, y + h / 2);
    this._pip(ctx, suit, x + w * 0.68, y + h / 2, h * 0.58);
  }

  /** Live trick-score board, top-centre. Teams → two side scores; else a row. */
  _scoreboard(ctx, S, st) {
    ctx.textBaseline = 'middle';
    const thr = st.winThreshold;
    if (st.teams) {
      const myTeam = (this.mySeat >= 0 ? this.mySeat : 0) % 2;
      const mine = st.teamTricks ? st.teamTricks[myTeam] : 0;
      const them = st.teamTricks ? st.teamTricks[1 - myTeam] : 0;
      this._scoreChip(ctx, S * 0.30, S * 0.045, S * 0.18, S * 0.066, 'تیم ما', mine, thr, this._seatColor(myTeam), true);
      this._scoreChip(ctx, S * 0.52, S * 0.045, S * 0.18, S * 0.066, 'تیم حریف', them, thr, this._seatColor(1 - myTeam), false);
    } else {
      const n = st.numPlayers;
      const w = S * 0.14, gap = S * 0.012, total = n * w + (n - 1) * gap;
      let x = (S - total) / 2;
      for (let s = 0; s < n; s++) {
        const me = s === this.mySeat;
        this._scoreChip(ctx, x, S * 0.045, w, S * 0.066, me ? 'من' : this._seatLabel(s, st), st.tricksWon?.[s] ?? 0, thr, this._seatColor(s), me);
        x += w + gap;
      }
    }
  }
  _scoreChip(ctx, x, y, w, h, label, val, thr, color, hi) {
    this._roundRect(x, y, w, h, h * 0.32);
    ctx.fillStyle = hi ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.34)'; ctx.fill();
    ctx.strokeStyle = hi ? GOLD : 'rgba(255,255,255,.14)'; ctx.lineWidth = hi ? 1.5 : 1; ctx.stroke();
    // colour dot
    ctx.beginPath(); ctx.arc(x + h * 0.42, y + h / 2, h * 0.18, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.font = `${h * 0.34}px sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w - h * 0.28, y + h * 0.32);
    ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.4}px sans-serif`;
    ctx.fillText(`🏆 ${faNum(val)} / ${faNum(thr)}`, x + w - h * 0.28, y + h * 0.72);
  }

  _seatLabel(seat, st) {
    if (st.teams) return seat % 2 === ((this.mySeat >= 0 ? this.mySeat : 0) % 2) ? 'هم‌تیمی' : 'حریف';
    return `بازیکن ${['۱', '۲', '۳', '۴'][seat]}`;
  }

  _drawOpponent(ctx, S, where, count, seat, st) {
    const cw = S * 0.06, ch = cw * 1.4, gap = cw * 0.34;
    const active = st.turn === seat && st.winner == null && st.phase === 'play';
    const isHakem = st.hakem === seat;
    let cx, cy, horizontal = true;
    if (where === 'top') { cx = S / 2; cy = S * 0.16; }
    else if (where === 'topleft') { cx = S * 0.26; cy = S * 0.17; }
    else if (where === 'topright') { cx = S * 0.74; cy = S * 0.17; }
    else if (where === 'left') { cx = S * 0.11; cy = S * 0.52; horizontal = false; }
    else { cx = S * 0.89; cy = S * 0.52; horizontal = false; } // right
    const shown = Math.min(count, 8);
    const span = (shown - 1) * gap;
    for (let i = 0; i < shown; i++) {
      const off = -span / 2 + i * gap;
      const x = (horizontal ? cx + off : cx) - cw / 2;
      const y = (horizontal ? cy : cy + off) - ch / 2;
      this._cardBack(ctx, x, y, cw, ch, this._seatColor(seat));
    }
    // active glow ring behind the stack
    if (active) {
      const pad = cw * 0.4;
      const rw = (horizontal ? span + cw : cw) + pad * 2;
      const rh = (horizontal ? ch : span + ch) + pad * 2;
      ctx.save();
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 14;
      this._roundRect(cx - rw / 2, cy - rh / 2, rw, rh, 10);
      ctx.stroke(); ctx.restore();
    }
    // label: name · tricks · hakem
    ctx.fillStyle = active ? GOLD : 'rgba(255,255,255,.8)';
    ctx.font = `${S * 0.03}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tricks = st.tricksWon?.[seat] ?? 0;
    const ly = cy + ch * 0.85;
    ctx.fillText(`${this._seatLabel(seat, st)} · 🏆${faNum(tricks)}${isHakem ? ' · 👑' : ''}`, cx, ly);
  }

  _drawTrickCard(ctx, S, where, card, cw, ch, win) {
    const c = S / 2, off = S * 0.155;
    let x = c, y = c;
    if (where === 'bottom') { y = c + off; }
    else if (where === 'top') { y = c - off; }
    else if (where === 'topleft') { x = c - off; y = c - off * 0.6; }
    else if (where === 'topright') { x = c + off; y = c - off * 0.6; }
    else if (where === 'left') { x = c - off; }
    else { x = c + off; }
    if (win) {
      ctx.save();
      ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
      this._roundRect(x - cw / 2 - 3, y - ch / 2 - 3, cw + 6, ch + 6, cw * 0.14);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }
    this._cardFace(ctx, x - cw / 2, y - ch / 2, cw, ch, card);
  }

  /** Small "winner of the trick" badge pointing at the winning seat. */
  _winnerBadge(ctx, S, where, st, seat) {
    const c = S / 2;
    let x = c, y = c;
    const off = S * 0.30;
    if (where === 'bottom') { y = c + off; }
    else if (where === 'top') { y = c - off; }
    else if (where === 'topleft') { x = c - off; y = c - off * 0.55; }
    else if (where === 'topright') { x = c + off; y = c - off * 0.55; }
    else if (where === 'left') { x = c - off; }
    else { x = c + off; }
    const w = S * 0.2, h = S * 0.062;
    // gentle pulse
    const pulse = 0.5 + 0.5 * Math.sin(now() / 180);
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.15 * pulse;
    this._roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = 'rgba(8,16,12,.92)'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5 + pulse; ctx.stroke();
    ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.5}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = seat === this.mySeat ? 'تو' : this._seatLabel(seat, st);
    ctx.fillText(`🏆 برندهٔ دست: ${name}`, x, y);
    ctx.restore();
  }

  _drawMyHand(ctx, S, st, cw, ch) {
    const cards = (st.hands && st.hands[this.mySeat]) ? st.hands[this.mySeat] : null;
    // my trick/hakem label strip
    if (this.mySeat >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `${S * 0.032}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const myActive = st.turn === this.mySeat && st.winner == null && st.phase === 'play';
      const t = st.tricksWon?.[this.mySeat] ?? 0;
      ctx.fillStyle = myActive ? GOLD : 'rgba(255,255,255,.82)';
      ctx.fillText(`تو · 🏆${faNum(t)}${st.hakem === this.mySeat ? ' · 👑 حاکم' : ''}${myActive ? ' · نوبت توست' : ''}`, S / 2, S - ch - S * 0.115);
    }
    if (!cards || !cards.length) return;
    const sorted = [...cards].sort((a, b) => (a.s - b.s) || (b.r - a.r));
    const legal = this._legalCards();
    const maxW = S * 0.9;
    const spacing = Math.min(cw * 0.92, (maxW - cw) / Math.max(1, sorted.length - 1));
    const totalW = cw + (sorted.length - 1) * spacing;
    const startX = (S - totalW) / 2;
    const baseY = S - ch - S * 0.06;
    sorted.forEach((card, i) => {
      const isLegal = !legal || legal.has(`${card.s},${card.r}`);
      const lifted = (this.hover === i && isLegal) ? S * 0.03 : 0;
      const x = startX + i * spacing;
      const y = baseY - lifted;
      this.hand.push({ card, x, y, w: cw, h: ch, legal: !!(legal && legal.has(`${card.s},${card.r}`)) });
      this._cardFace(ctx, x, y, cw, ch, card);
      if (legal && !isLegal) { ctx.fillStyle = 'rgba(10,20,14,.5)'; this._roundRect(x, y, cw, ch, cw * 0.12); ctx.fill(); }
      else if (legal && isLegal) { ctx.strokeStyle = 'rgba(120,240,170,.95)'; ctx.lineWidth = 2.5; this._roundRect(x, y, cw, ch, cw * 0.12); ctx.stroke(); }
    });
  }

  _drawTrumpChooser(ctx, S, st) {
    const choosing = st.hakem === this.mySeat && this.interactive;
    const w = S * 0.66, h = S * 0.24, x = (S - w) / 2, y = (S - h) / 2;
    this._roundRect(x, y, w, h, 14); ctx.fillStyle = 'rgba(8,16,12,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.04}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(choosing ? '👑 حکم را انتخاب کن:' : '👑 حاکم در حال انتخاب حکم…', S / 2, y + h * 0.08);
    if (!choosing) return;
    const bw = w * 0.2, bh = h * 0.46, gy = y + h * 0.42;
    for (let s = 0; s < 4; s++) {
      const bx = x + w * 0.06 + s * (bw + w * 0.026);
      this._roundRect(bx, gy, bw, bh, 8); ctx.fillStyle = '#fbfaf6'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke();
      this._pip(ctx, s, bx + bw / 2, gy + bh * 0.42, bh * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = `${bh * 0.2}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT_NAME[s], bx + bw / 2, gy + bh * 0.82);
      this.trumpBtns.push({ suit: s, x: bx, y: gy, w: bw, h: bh });
    }
  }

  /** Brief burst of the chosen trump suit, scaling up and fading out. */
  _drawTrumpBurst(ctx, S, suit) {
    const t = 1 - Math.max(0, (this.trumpFxUntil - now()) / TRUMP_FX_MS); // 0→1
    const ease = 1 - Math.pow(1 - t, 3);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha) * 0.9;
    // glow ring
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * (0.08 + ease * 0.34), 0, Math.PI * 2);
    ctx.strokeStyle = SUIT_COLOR[suit]; ctx.lineWidth = 5 * (1 - ease) + 1; ctx.stroke();
    // big symbol
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = SUIT_COLOR[suit];
    ctx.shadowColor = SUIT_COLOR[suit]; ctx.shadowBlur = 30 * (1 - ease) + 8;
    ctx.font = `bold ${S * (0.12 + ease * 0.14)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[suit], S / 2, S / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.045}px sans-serif`;
    ctx.fillText(`حکم: ${SUIT_NAME[suit]}`, S / 2, S / 2 + S * 0.16);
    ctx.restore();
  }

  /* ------------------------------ Card art ------------------------------- */
  /** A coloured suit pip with a soft outline so it reads on any background. */
  _pip(ctx, suit, cx, cy, size) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${size}px serif`;
    ctx.fillStyle = SUIT_COLOR[suit];
    ctx.fillText(SUIT[suit], cx, cy);
    ctx.restore();
  }

  _cardFace(ctx, x, y, w, h, card) {
    this._roundRect(x, y, w, h, w * 0.12);
    ctx.fillStyle = '#fbfaf6'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.stroke();
    const col = SUIT_COLOR[card.s];
    // top-left rank + tiny pip (suit colour everywhere so suits stay distinct)
    ctx.fillStyle = col;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${h * 0.24}px sans-serif`;
    ctx.fillText(rankLabel(card.r), x + w * 0.1, y + h * 0.06);
    ctx.font = `${h * 0.18}px serif`;
    ctx.fillText(SUIT[card.s], x + w * 0.12, y + h * 0.32);
    // big centre pip
    ctx.font = `${h * 0.36}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[card.s], x + w * 0.5, y + h * 0.62);
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

function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function faNum(n) { return String(n).replace(/\d/g, (d) => FA[+d]); }
