/* =========================================================================
   اَلِ من خورا — Hokm (حکم) card-table renderer  (v4)
   ========================================================================= */
import { HokmGame } from './hokm.js';
import { tableTheme } from './boardthemes.js';

const SUIT       = ['♠', '♥', '♦', '♣'];
const SUIT_NAME  = ['پیک', 'دل', 'خشت', 'گشنیز'];
const SUIT_COLOR = ['#14161e', '#c8202e', '#c8202e', '#14161e'];
const RANK       = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel  = (r) => RANK[r] || String(r);

// Hand sort: alternating colours ♠ ♥ ♣ ♦ (black/red/black/red)
const SUIT_SORT  = [0, 1, 3, 2];

const FELT      = '#0c5132';
const FELT_EDGE = '#063b22';
const GOLD      = '#ffd76b';
const HOLD_MS   = 2400;
const TRUMP_MS  = 1300;
const FLY_DUR   = 300;    // ms: card flies from seat to centre
const SHAKE_DUR = 480;    // ms: canvas shake after trump chosen

// Vertical layout anchors are fractions of the canvas HEIGHT (H), horizontal
// anchors are fractions of the WIDTH (S). The board is taller than wide.
const OPP_CY_TOP  = 0.135;   // ×H — top opponent row
const OPP_CX_SIDE = 0.085;   // ×S — left/right opponent columns
const OPP_CY_SIDE = 0.44;    // ×H — left/right opponent vertical centre
const TABLE_CY    = 0.50;    // ×H — centre of the trick area
const TRICK_OFF   = 0.150;   // ×S — spread of trick cards from centre
const HAND_BASE_Y = 0.80;    // ×H — top edge of my hand

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
    this.hand      = [];
    this.trumpBtns = [];
    this.hover     = -1;

    // Timed effects
    this.holdUntil       = 0;
    this.trumpFxUntil    = 0;
    this.trumpFxSuit     = null;
    this._trumpShakeStart = -9999;
    this._shownTrickNo   = 0;
    this._shownTrump     = null;
    this._raf            = null;

    // Flying-card animations: [{card, seat, from, to, startAngle, startTs, dur}]
    this._flyingCards    = [];
    this._trickPileAnims = [];   // [{winner, from, to, t0, dur}]
    this._pendingCollect = null; // {at, winner}

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    const frame = this.canvas.parentElement;
    if (frame) frame.style.aspectRatio = '';
    this.canvas.style.height = '';
  }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat)   { this.mySeat = seat; this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; this.draw(); }

  setState(state) {
    const prev = this.state;
    this.state = state;
    try { this.engine = HokmGame.fromState(state); } catch { this.engine = null; }
    this.hover = -1;

    // Trump chosen → burst + canvas shake (only on actual transition)
    if (state?.trump != null && this._shownTrump == null && prev && prev.trump == null) {
      this.trumpFxSuit    = state.trump;
      this.trumpFxUntil   = ts() + TRUMP_MS;
      this._trumpShakeStart = ts();
    }
    this._shownTrump = state ? state.trump : null;

    // Hold completed trick on the felt
    const tn = (state && state.trickNumber) || 0;
    if (prev && tn > this._shownTrickNo && state?.lastTrick?.length && state.winner == null) {
      this.holdUntil = ts() + HOLD_MS;
      this._pendingCollect = { at: this.holdUntil, winner: state.lastTrickWinner };
    }
    this._shownTrickNo = Math.max(this._shownTrickNo, tn);

    // A new trick's first card just hit the table → stop holding the old one,
    // so the previous trick and the new card never show on top of each other.
    if (prev && (prev.trick?.length ?? 0) === 0 && (state?.trick?.length ?? 0) >= 1) {
      this.holdUntil = 0;
      this._pendingCollect = null;
    }

    // Queue card-flight animation for the newly played card. If that card is
    // of the trump (حکم) suit, jolt the table — a "بُر" feels weighty.
    if (prev && state) {
      const played = this._detectAndQueueFlight(prev, state);
      if (played && state.trump != null && played.card.s === state.trump) {
        this._trumpShakeStart = ts();
      }
    }

    this._ensureAnim();
    this.draw();
  }

  /** Compare previous vs new state, launch a flying-card animation if a card
   *  was just played, and return that played entry ({seat,card}) or null. */
  _detectAndQueueFlight(prev, state) {
    if (!prev.trick || !state) return null;
    const S  = this.css;
    const CW = S * 0.10, CH = CW * 1.40;
    const place = this._placement(state);

    let newEntry = null;
    if ((state.trick?.length ?? 0) > (prev.trick?.length ?? 0)) {
      // A card was added to the live trick
      newEntry = state.trick[state.trick.length - 1];
    } else if ((prev.trick?.length ?? 0) > 0 && (state.trick?.length ?? 0) === 0 &&
               (state.trickNumber || 0) > (prev.trickNumber || 0)) {
      // Trick just resolved — the last card in lastTrick completed it
      newEntry = state.lastTrick?.[state.lastTrick.length - 1];
    }
    if (!newEntry) return null;

    const where = place[newEntry.seat];
    const from  = this._seatPos(where, S, CH);
    const to    = this._trickPos(where, S);
    // Random starting tilt so the card looks naturally tossed
    const startAngle = (Math.random() - 0.5) * 0.45;
    this._flyingCards.push({ card: newEntry.card, seat: newEntry.seat, from, to, startAngle, startTs: ts(), dur: FLY_DUR });
    return newEntry;
  }

  /** Screen-centre of where a seat's cards live (for fly-from). */
  _seatPos(where, S, CH) {
    const H = this.cssH || S;
    switch (where) {
      case 'bottom':    return { x: S / 2,              y: H * HAND_BASE_Y + CH / 2 };
      case 'top':       return { x: S / 2,              y: H * OPP_CY_TOP };
      case 'topleft':   return { x: S * 0.25,           y: H * OPP_CY_TOP };
      case 'topright':  return { x: S * 0.75,           y: H * OPP_CY_TOP };
      case 'left':      return { x: S * OPP_CX_SIDE,    y: H * OPP_CY_SIDE };
      default:          return { x: S * (1-OPP_CX_SIDE), y: H * OPP_CY_SIDE };
    }
  }

  /** Screen-centre of where a trick card from this seat lands. */
  _trickPos(where, S) {
    const H = this.cssH || S;
    const cx = S / 2, cy = H * TABLE_CY, off = S * TRICK_OFF;
    switch (where) {
      case 'bottom':    return { x: cx,       y: cy + off };
      case 'top':       return { x: cx,       y: cy - off };
      case 'topleft':   return { x: cx - off, y: cy - off * 0.6 };
      case 'topright':  return { x: cx + off, y: cy - off * 0.6 };
      case 'left':      return { x: cx - off, y: cy };
      default:          return { x: cx + off, y: cy };
    }
  }

  _seatColor(s) {
    return (this.config.colors?.[s]) || ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'][s] || '#ccc';
  }

  _ensureAnim() {
    if (this._raf) return;
    const active = () =>
      ts() < this.holdUntil ||
      ts() < this.trumpFxUntil ||
      ts() < this._trumpShakeStart + SHAKE_DUR ||
      this._flyingCards.some((f) => ts() < f.startTs + f.dur) ||
      this._trickPileAnims.some((a) => ts() < a.t0 + a.dur);
    const step = () => {
      this._raf = null;
      this.draw();
      if (active()) this._raf = requestAnimationFrame(step);
    };
    if (active()) this._raf = requestAnimationFrame(step);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width  = size * this._dpr;
    this.canvas.height = size * 1.30 * this._dpr;
    this.canvas.style.height = 'auto';
    const frame = this.canvas.parentElement;
    if (frame) frame.style.aspectRatio = '1 / 1.30';
    this.css  = size;
    this.cssH = size * 1.30;
    this.draw();
  }

  _legalCards() {
    const st = this.state;
    if (!this.interactive || !st || st.phase !== 'play' || !this.engine) return null;
    try { return new Set(this.engine.legalMoves(this.mySeat).map((m) => `${m.card.s},${m.card.r}`)); }
    catch { return null; }
  }

  /* ── Pointer ────────────────────────────────────────────────────────── */
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

  /* ── Seating ─────────────────────────────────────────────────────────── */
  _placement(st = this.state) {
    const n  = st.numPlayers;
    const me = this.mySeat >= 0 ? this.mySeat : 0;
    const order = n === 4 ? ['bottom', 'left', 'top', 'right']
      : n === 3            ? ['bottom', 'topleft', 'topright']
      :                      ['bottom', 'top'];
    const pos = {};
    for (let s = 0; s < n; s++) pos[s] = order[(s - me + n) % n];
    return pos;
  }

  /* ── Shake helper ────────────────────────────────────────────────────── */
  _shakeOffset() {
    const age = ts() - this._trumpShakeStart;
    if (age >= SHAKE_DUR) return [0, 0];
    const decay = Math.pow(1 - age / SHAKE_DUR, 2);
    const amp   = 9 * decay;
    return [
      Math.sin(age * 0.055) * amp,
      Math.sin(age * 0.043) * amp * 0.5,
    ];
  }

  /* ── Main draw ───────────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const S   = this.css;
    const H   = this.cssH || S;
    const now = ts();

    // Expire completed flights
    this._flyingCards = this._flyingCards.filter((f) => now < f.startTs + f.dur);
    const flyingSeats = new Set(this._flyingCards.map((f) => f.seat));

    ctx.save();
    // Clear the whole canvas first WITHOUT the shake offset — otherwise the
    // offset clear leaves trails of the previous frame.
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, H);
    // Apply the brief trump shake to everything drawn below.
    const [sx, sy] = this._shakeOffset();
    if (sx || sy) ctx.setTransform(this._dpr, 0, 0, this._dpr, sx * this._dpr, sy * this._dpr);

    // Table background — overscan by OVER px so the shake never reveals the
    // transparent page behind the felt at the edges.
    const OVER = 18;
    const th = tableTheme(this.config.boardTheme);
    this._rr(-OVER, -OVER, S + OVER * 2, H + OVER * 2, 16); ctx.fillStyle = th.edge; ctx.fill();
    this._rr(S * 0.03, S * 0.03, S * 0.94, H - S * 0.06, S * 0.22); ctx.fillStyle = th.felt; ctx.fill();

    this.hand = []; this.trumpBtns = [];
    if (!this.state) { ctx.restore(); return; }

    const st    = this.state;
    const place = this._placement(st);
    const CW = S * 0.10, CH = CW * 1.40;

    // Fire pending trick-collect animation once holdUntil expires
    if (this._pendingCollect && now >= this._pendingCollect.at) {
      const winner = this._pendingCollect.winner;
      if (winner != null) {
        let to;
        if (st.teams && st.numPlayers > 2) {
          const myTeam  = this.mySeat >= 0 ? this.mySeat % 2 : 0;
          const winTeam = winner % 2;
          to = this._teamPilePos(winTeam === myTeam ? 'mine' : 'opp', S, H);
        } else {
          to = this._pilePos(place[winner], S, H);
        }
        this._trickPileAnims.push({ winner, from: { x: S / 2, y: H * TABLE_CY }, to, t0: now, dur: 540 });
      }
      this._pendingCollect = null;
      this._ensureAnim();
    }

    // ── Zone A: info bar ──
    this._drawInfoBar(ctx, S, st);

    // ── Zone B/C: opponent stacks ──
    for (let s = 0; s < st.numPlayers; s++) {
      if (s === this.mySeat) continue;
      this._drawOpponent(ctx, S, place[s], st, s, CW, CH);
    }

    // ── Zone D: centre trick cards (skip seats still in-flight) ──
    const holding     = now < this.holdUntil && st.lastTrick?.length;
    const centre      = holding ? st.lastTrick : (st.trick || []);
    const trickWinner = (holding || st.winner != null) ? st.lastTrickWinner : null;
    for (const t of centre) {
      if (flyingSeats.has(t.seat)) continue; // card is still mid-air
      const isWinner = t.seat === trickWinner;
      this._drawTrickCard(ctx, S, place[t.seat], t.card, CW, CH, isWinner);
    }
    if (trickWinner != null && centre.length && !flyingSeats.has(trickWinner))
      this._winnerBadge(ctx, S, place[trickWinner], st, trickWinner);

    // ── Zone E: my hand ──
    this._drawMyHand(ctx, S, st, CW, CH);

    // ── Trick piles on top of all static layers ──
    this._drawTrickPiles(ctx, S, H, st, place);

    // ── Trick collect animations ──
    this._drawTrickAnims(ctx, S, H);

    // ── Flying cards on top of everything ──
    for (const f of this._flyingCards) {
      const raw  = Math.min(1, (now - f.startTs) / f.dur);
      const ease = 1 - Math.pow(1 - raw, 3); // ease-out cubic
      // Parabolic arc: control point is above the midpoint
      const cpx = (f.from.x + f.to.x) / 2;
      const cpy = (f.from.y + f.to.y) / 2 - S * 0.07;
      const t   = ease;
      const bx  = (1-t)*(1-t)*f.from.x + 2*(1-t)*t*cpx + t*t*f.to.x;
      const by  = (1-t)*(1-t)*f.from.y + 2*(1-t)*t*cpy + t*t*f.to.y;
      const angle = f.startAngle * (1 - ease);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(angle);
      // Slight shadow while airborne
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur  = 14 * (1 - ease) + 2;
      this._cardFace(ctx, -CW / 2, -CH / 2, CW, CH, f.card);
      ctx.restore();
    }

    // ── Overlays ──
    if (st.phase === 'choose-trump') this._drawTrumpChooser(ctx, S, st);
    if (now < this.trumpFxUntil && this.trumpFxSuit != null)
      this._drawTrumpBurst(ctx, S, this.trumpFxSuit, now);

    ctx.restore();
  }

  /* ── Zone A: compact info bar ──────────────────────────────────────── */
  _drawInfoBar(ctx, S, st) {
    const bh = S * 0.065, by = S * 0.025;

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

    const scoreX = S * 0.26;
    if (st.teams) {
      const myTeam   = (this.mySeat >= 0 ? this.mySeat : 0) % 2;
      const myTricks = st.teamTricks?.[myTeam]    ?? 0;
      const opTricks = st.teamTricks?.[1 - myTeam] ?? 0;
      this._scoreChip(ctx, scoreX,           by, S * 0.33, bh, 'تیم ما',    myTricks, st.winThreshold, this._seatColor(myTeam),      true);
      this._scoreChip(ctx, scoreX + S * 0.36, by, S * 0.33, bh, 'تیم حریف', opTricks, st.winThreshold, this._seatColor(1 - myTeam), false);
    } else {
      const n = st.numPlayers, gap = S * 0.01;
      const cw = (S * 0.94 - scoreX - gap * (n - 1)) / n;
      for (let s = 0; s < n; s++) {
        this._scoreChip(ctx, scoreX + s * (cw + gap), by, cw, bh,
          s === this.mySeat ? 'من' : `بازیکن ${FA[s + 1]}`,
          st.tricksWon?.[s] ?? 0, st.winThreshold, this._seatColor(s), s === this.mySeat);
      }
    }
  }

  _scoreChip(ctx, x, y, w, h, label, val, thr, color, hi) {
    this._rr(x, y, w, h, h * 0.35);
    ctx.fillStyle = hi ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.36)'; ctx.fill();
    ctx.strokeStyle = hi ? GOLD : 'rgba(255,255,255,.12)'; ctx.lineWidth = hi ? 1.5 : 0.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + h * 0.44, y + h * 0.50, h * 0.18, 0, 6.28);
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.80)'; ctx.font = `${h * 0.33}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + h * 0.72, y + h * 0.32);
    ctx.fillStyle = val >= thr ? GOLD : (hi ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.70)');
    ctx.font = `bold ${h * 0.36}px sans-serif`;
    ctx.fillText(`${fa(val)} / ${fa(thr)}`, x + h * 0.72, y + h * 0.72);
  }

  /* ── Opponent stacks ────────────────────────────────────────────────── */
  _drawOpponent(ctx, S, where, st, seat, CW, CH) {
    const active  = st.turn === seat && st.winner == null && st.phase === 'play';
    const isHakem = st.hakem === seat;
    const tricks  = st.tricksWon?.[seat] ?? 0;
    const count   = st.handCounts?.[seat] ?? 0;

    const H = this.cssH || S;
    let cx, cy, horizontal = true;
    switch (where) {
      case 'top':       cx = S / 2;              cy = H * OPP_CY_TOP;  break;
      case 'topleft':   cx = S * 0.25;           cy = H * OPP_CY_TOP;  break;
      case 'topright':  cx = S * 0.75;           cy = H * OPP_CY_TOP;  break;
      case 'left':      cx = S * OPP_CX_SIDE;    cy = H * OPP_CY_SIDE; horizontal = false; break;
      default:          cx = S*(1-OPP_CX_SIDE);  cy = H * OPP_CY_SIDE; horizontal = false; break;
    }

    const shown = Math.min(count, 7), gap = CW * 0.30, span = (shown - 1) * gap;
    for (let i = 0; i < shown; i++) {
      const off = -span / 2 + i * gap;
      const px = (horizontal ? cx + off : cx);
      const py = (horizontal ? cy : cy + off);
      // Slight fan tilt — cards feel like a held hand, not a flat stack.
      const tilt = horizontal ? (i - (shown - 1) / 2) * 0.055 : 0;
      ctx.save();
      if (tilt) { ctx.translate(px, py); ctx.rotate(tilt); ctx.translate(-px, -py); }
      this._cardBack(ctx, px - CW / 2, py - CH / 2, CW, CH, this._seatColor(seat));
      ctx.restore();
    }

    if (active) {
      const pad = CW * 0.3;
      const rw  = (horizontal ? span + CW : CW) + pad * 2;
      const rh  = (horizontal ? CH : span + CH) + pad * 2;
      ctx.save();
      this._rr(cx - rw / 2, cy - rh / 2, rw, rh, 10);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 12; ctx.stroke(); ctx.restore();
    }

    // Compact badge below the stack
    const pillW = CW * 1.6, pillH = S * 0.038;
    const pillX = cx - pillW / 2;
    const pillY = (horizontal ? cy + CH / 2 : cy + span / 2 + CH / 2) + S * 0.012;
    this._rr(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    ctx.fillStyle = active ? GOLD : 'rgba(255,255,255,.85)';
    ctx.font = `${pillH * 0.60}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${isHakem ? '👑' : ''}${active ? '●' : ''}${fa(tricks)}/${fa(st.winThreshold)}`, cx, pillY + pillH / 2);
  }

  /* ── Trick cards ────────────────────────────────────────────────────── */
  _drawTrickCard(ctx, S, where, card, CW, CH, isWinner) {
    const H = this.cssH || S;
    const cx = S / 2, cy = H * TABLE_CY, off = S * TRICK_OFF;
    let x = cx, y = cy;
    if      (where === 'bottom')   { y = cy + off; }
    else if (where === 'top')      { y = cy - off; }
    else if (where === 'topleft')  { x = cx - off; y = cy - off * 0.6; }
    else if (where === 'topright') { x = cx + off; y = cy - off * 0.6; }
    else if (where === 'left')     { x = cx - off; }
    else                           { x = cx + off; }
    if (isWinner) {
      ctx.save();
      ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
      this._rr(x - CW / 2 - 3, y - CH / 2 - 3, CW + 6, CH + 6, CW * 0.14);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
    this._cardFace(ctx, x - CW / 2, y - CH / 2, CW, CH, card);
  }

  _winnerBadge(ctx, S, where, st, seat) {
    const H = this.cssH || S;
    const cx = S / 2, cy = H * TABLE_CY, off = S * TRICK_OFF + S * 0.14;
    let x = cx, y = cy;
    if      (where === 'bottom')   { y = cy + off; }
    else if (where === 'top')      { y = cy - off; }
    else if (where === 'topleft')  { x = cx - off; y = cy - off * 0.6; }
    else if (where === 'topright') { x = cx + off; y = cy - off * 0.6; }
    else if (where === 'left')     { x = cx - off; }
    else                           { x = cx + off; }
    const w = S * 0.22, h = S * 0.055, pulse = 0.5 + 0.5 * Math.sin(ts() / 180);
    ctx.save(); ctx.globalAlpha = 0.88 + 0.12 * pulse;
    this._rr(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = 'rgba(8,16,12,.92)'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5 + 0.5 * pulse; ctx.stroke();
    ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.52}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`🏆 ${seat === this.mySeat ? 'تو' : `بازیکن ${FA[seat + 1]}`}`, x, y);
    ctx.restore();
  }

  /* ── My hand ────────────────────────────────────────────────────────── */
  _drawMyHand(ctx, S, st, CW, CH) {
    const cards = st.hands?.[this.mySeat];
    if (!cards || !cards.length) return;
    const sorted  = [...cards].sort((a, b) => (SUIT_SORT[a.s] - SUIT_SORT[b.s]) || (b.r - a.r));
    const legal   = this._legalCards();
    const maxSpan = S * 0.88;
    const spacing = Math.min(CW * 0.90, (maxSpan - CW) / Math.max(1, sorted.length - 1));
    const totalW  = CW + (sorted.length - 1) * spacing;
    const startX  = (S - totalW) / 2;
    const H       = this.cssH || S;
    const baseY   = H * HAND_BASE_Y;
    sorted.forEach((card, i) => {
      const isLegal = !legal || legal.has(`${card.s},${card.r}`);
      const lift    = (this.hover === i && isLegal) ? S * 0.028 : 0;
      const x = startX + i * spacing, y = baseY - lift;
      this.hand.push({ card, x, y, w: CW, h: CH, legal: !!(legal && isLegal) });
      this._cardFace(ctx, x, y, CW, CH, card);
      if (legal && !isLegal) { this._rr(x, y, CW, CH, CW * 0.12); ctx.fillStyle = 'rgba(10,20,14,.52)'; ctx.fill(); }
      else if (legal && isLegal) { this._rr(x, y, CW, CH, CW * 0.12); ctx.strokeStyle = 'rgba(80,230,140,.95)'; ctx.lineWidth = 2.5; ctx.stroke(); }
    });
    // Status strip below my cards
    const ySub = baseY + CH + S * 0.016;
    if (ySub < H * 0.99) {
      const myActive = st.turn === this.mySeat && st.winner == null && st.phase === 'play';
      ctx.fillStyle = myActive ? GOLD : 'rgba(255,255,255,.75)';
      ctx.font = `${S * 0.028}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const t = st.tricksWon?.[this.mySeat] ?? 0;
      ctx.fillText(
        (st.hakem === this.mySeat ? '👑 حاکم · ' : '') + `${fa(t)} / ${fa(st.winThreshold)} دست` + (myActive ? ' · نوبت توست ●' : ''),
        S / 2, ySub + S * 0.014,
      );
    }
  }

  /* ── Trick pile geometry ─────────────────────────────────────────────── */
  // Individual seat positions (2-player or non-team 4-player)
  _pilePos(where, S, H) {
    switch (where) {
      case 'bottom':   return { x: S * 0.09, y: H * HAND_BASE_Y + S * 0.07 };
      case 'top':      return { x: S * 0.91, y: H * OPP_CY_TOP };
      case 'topleft':  return { x: S * 0.07, y: H * OPP_CY_TOP + S * 0.01 };
      case 'topright': return { x: S * 0.93, y: H * OPP_CY_TOP + S * 0.01 };
      case 'left':     return { x: S * 0.07, y: H * OPP_CY_SIDE + S * 0.15 };
      default:         return { x: S * 0.93, y: H * OPP_CY_SIDE + S * 0.15 };
    }
  }
  // Shared team pile positions (used in team mode and for animation targets)
  _teamPilePos(which, S, H) {
    if (which === 'mine') return { x: S * 0.09, y: H * HAND_BASE_Y + S * 0.07 };
    return { x: S * 0.91, y: H * OPP_CY_TOP };
  }

  /* ── Graphical trick-pile stacks ─────────────────────────────────────── */
  _drawTrickPiles(ctx, S, H, st, place) {
    if (st.teams && st.numPlayers > 2) {
      // Team mode — one shared pile per team, teammates' tricks combined
      const myTeam   = this.mySeat >= 0 ? this.mySeat % 2 : 0;
      const myCount  = st.teamTricks?.[myTeam]     ?? 0;
      const oppCount = st.teamTricks?.[1 - myTeam] ?? 0;
      const myColor  = this._seatColor(this.mySeat >= 0 ? this.mySeat : 0);
      const oppColor = this._seatColor((this.mySeat >= 0 ? this.mySeat : 0) % 2 === 0 ? 1 : 0);
      this._drawPileStack(ctx, this._teamPilePos('mine', S, H), myCount,  myColor,  S, true);
      this._drawPileStack(ctx, this._teamPilePos('opp',  S, H), oppCount, oppColor, S, false);
    } else {
      for (let s = 0; s < st.numPlayers; s++) {
        const count = st.tricksWon?.[s] ?? 0;
        if (count === 0 && s !== this.mySeat) continue;
        this._drawPileStack(ctx, this._pilePos(place[s], S, H), count, this._seatColor(s), S, s === this.mySeat);
      }
    }
  }

  _drawPileStack(ctx, pos, count, color, S, showEmpty) {
    const mw = S * 0.068, mh = mw * 1.40;
    const dx = mw * 0.30;          // 30% of card width — each card clearly peeks out
    const dy = mh * 0.08;          // slight upward shift gives depth
    const shown = Math.min(count, 7);
    const totalW = shown > 0 ? mw + (shown - 1) * dx : mw;
    const sx = pos.x - totalW / 2; // left-align from centre so label stays centred

    if (count === 0) {
      if (!showEmpty) return;
      this._rr(sx, pos.y - mh / 2, mw, mh, mw * 0.14);
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      for (let i = 0; i < shown; i++) {
        this._cardBack(ctx, sx + i * dx, pos.y - mh / 2 - i * dy, mw, mh, color);
      }
    }
    ctx.fillStyle = count > 0 ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.28)';
    ctx.font = `bold ${S * 0.023}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${fa(count)} دست`, pos.x, pos.y + mh / 2 + 4);
  }

  /* ── Trick-collection fly animation ──────────────────────────────────── */
  _drawTrickAnims(ctx, S, H) {
    const now = ts();
    this._trickPileAnims = this._trickPileAnims.filter((a) => now < a.t0 + a.dur);
    const mw = S * 0.068, mh = mw * 1.40;
    for (const a of this._trickPileAnims) {
      const raw  = Math.min(1, (now - a.t0) / a.dur);
      const ease = 1 - Math.pow(1 - raw, 3);
      const cpx  = (a.from.x + a.to.x) / 2;
      const cpy  = (a.from.y + a.to.y) / 2 - S * 0.12;
      const t    = ease;
      const bx   = (1-t)*(1-t)*a.from.x + 2*(1-t)*t*cpx + t*t*a.to.x;
      const by   = (1-t)*(1-t)*a.from.y + 2*(1-t)*t*cpy + t*t*a.to.y;
      ctx.save();
      ctx.globalAlpha = 0.92 - raw * 0.25;
      ctx.shadowColor = this._seatColor(a.winner); ctx.shadowBlur = 8 * (1 - raw);
      this._cardBack(ctx, bx - mw / 2, by - mh / 2, mw, mh, this._seatColor(a.winner));
      ctx.restore();
    }
  }

  /* ── Trump chooser overlay ──────────────────────────────────────────── */
  _drawTrumpChooser(ctx, S, st) {
    const H = this.cssH || S;
    const choosing = st.hakem === this.mySeat && this.interactive;
    const ow = S * 0.68, oh = S * 0.26, ox = (S - ow) / 2, oy = (H - oh) / 2;
    this._rr(ox, oy, ow, oh, 14); ctx.fillStyle = 'rgba(8,16,12,.93)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.042}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(choosing ? '👑 حکم را انتخاب کن:' : '👑 حاکم در حال انتخاب حکم…', S / 2, oy + oh * 0.08);
    if (!choosing) return;
    const bw = ow * 0.19, bh = oh * 0.48, gy = oy + oh * 0.40;
    for (let s = 0; s < 4; s++) {
      const bx = ox + ow * 0.06 + s * (bw + ow * 0.027);
      this._rr(bx, gy, bw, bh, 8); ctx.fillStyle = '#fbfaf6'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = SUIT_COLOR[s];
      ctx.font = `${bh * 0.52}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[s], bx + bw / 2, gy + bh * 0.40);
      ctx.font = `${bh * 0.20}px sans-serif`; ctx.textBaseline = 'bottom';
      ctx.fillText(SUIT_NAME[s], bx + bw / 2, gy + bh * 0.94);
      this.trumpBtns.push({ suit: s, x: bx, y: gy, w: bw, h: bh });
    }
  }

  /* ── Trump burst effect ─────────────────────────────────────────────── */
  _drawTrumpBurst(ctx, S, suit, now) {
    const H    = this.cssH || S;
    const cy   = H * TABLE_CY;
    const t    = 1 - Math.max(0, (this.trumpFxUntil - now) / TRUMP_MS);
    const ease = 1 - Math.pow(1 - t, 3);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.save(); ctx.globalAlpha = Math.max(0, alpha) * 0.88;
    ctx.beginPath(); ctx.arc(S / 2, cy, S * (0.07 + ease * 0.30), 0, Math.PI * 2);
    ctx.strokeStyle = SUIT_COLOR[suit]; ctx.lineWidth = 5 * (1 - ease) + 1; ctx.stroke();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = SUIT_COLOR[suit];
    ctx.shadowColor = SUIT_COLOR[suit]; ctx.shadowBlur = 24 * (1 - ease) + 6;
    ctx.font = `bold ${S * (0.12 + ease * 0.13)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[suit], S / 2, cy - S * 0.04);
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.044}px sans-serif`;
    ctx.fillText(`حکم: ${SUIT_NAME[suit]}`, S / 2, cy + S * 0.08);
    ctx.restore();
  }

  /* ── Card art ───────────────────────────────────────────────────────── */
  _cardFace(ctx, x, y, w, h, card) {
    const style = this.config?.cardStyle || 'classic';
    const r = w * 0.12;
    if (style === 'dark') {
      const NEON = ['#4ee6f8', '#ff6b77', '#ffd76b', '#56e08c'];
      this._rr(x, y, w, h, r); ctx.fillStyle = '#131926'; ctx.fill();
      ctx.strokeStyle = NEON[card.s] + '55'; ctx.lineWidth = 1.2; ctx.stroke();
      const col = NEON[card.s];
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillStyle = '#e8eaf6'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.22}px sans-serif`;
      ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.05);
      ctx.fillStyle = col;
      ctx.font = `${h * 0.20}px serif`;
      ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);
      ctx.font = `${h * 0.40}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
      ctx.restore();
    } else if (style === 'royal') {
      const RICH = ['#0d1012', '#b8122a', '#b8122a', '#0d1012'];
      this._rr(x, y, w, h, r); ctx.fillStyle = '#fdf6e3'; ctx.fill();
      ctx.strokeStyle = RICH[card.s]; ctx.lineWidth = 1.5; ctx.stroke();
      // Inner decorative border
      ctx.save(); ctx.strokeStyle = RICH[card.s] + '33'; ctx.lineWidth = 1;
      this._rr(x + w * 0.1, y + h * 0.07, w * 0.8, h * 0.86, r * 0.5); ctx.stroke(); ctx.restore();
      const col = RICH[card.s];
      ctx.fillStyle = col;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.22}px Georgia,serif`;
      ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.04);
      ctx.font = `${h * 0.19}px serif`;
      ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.26);
      ctx.font = `${h * 0.42}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.60);
      // Upside-down corner (double-headed)
      ctx.save(); ctx.translate(x + w, y + h); ctx.rotate(Math.PI);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.20}px Georgia,serif`;
      ctx.fillText(rankLabel(card.r), w * 0.09, h * 0.05);
      ctx.font = `${h * 0.17}px serif`;
      ctx.fillText(SUIT[card.s], w * 0.09, h * 0.24);
      ctx.restore();
    } else {
      // classic
      this._rr(x, y, w, h, r); ctx.fillStyle = '#fbfaf6'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1; ctx.stroke();
      const col = SUIT_COLOR[card.s];
      ctx.fillStyle = col;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.22}px sans-serif`;
      ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.05);
      ctx.font = `${h * 0.20}px serif`;
      ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);
      ctx.font = `${h * 0.40}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
    }
  }
  _cardBack(ctx, x, y, w, h, accent) {
    const style = this.config?.cardStyle || 'classic';
    const r = w * 0.14;
    if (style === 'dark') {
      this._rr(x, y, w, h, r); ctx.fillStyle = '#0c1020'; ctx.fill();
      ctx.strokeStyle = (accent || '#4ee6f8') + 'aa'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.save(); ctx.strokeStyle = (accent || '#4ee6f8') + '33'; ctx.lineWidth = 0.8;
      this._rr(x + w * 0.18, y + h * 0.12, w * 0.64, h * 0.76, r * 0.6); ctx.stroke(); ctx.restore();
    } else if (style === 'royal') {
      this._rr(x, y, w, h, r); ctx.fillStyle = accent || '#1a2a4a'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,160,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      // Diagonal hatching
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
      for (let d = -h; d < w + h; d += w * 0.22) {
        ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke();
      }
      ctx.restore();
      // Center ornament
      ctx.fillStyle = 'rgba(255,230,160,.55)';
      ctx.font = `${h * 0.30}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦', x + w / 2, y + h / 2);
    } else {
      // classic
      this._rr(x, y, w, h, r); ctx.fillStyle = '#1e2a3a'; ctx.fill();
      ctx.strokeStyle = accent || '#3a7a'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.09)';
      this._rr(x + w * 0.18, y + h * 0.13, w * 0.64, h * 0.74, w * 0.10); ctx.fill();
    }
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
