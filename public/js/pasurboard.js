/* =========================================================================
   اَلِ من خورا — Pasur (پاسور / چهاربرگ) renderer.
   The viewer sits at the bottom; the opponent's hand is a face-down fan up top.
   The table cards sit in the middle. To play:
     • Tap a card in your hand to "stage" it (it lifts up).
       – Picture cards (سرباز/بی‌بی/شاه) auto-target what they'd take.
       – Number cards make matching table cards tappable; pick cards that, with
         your card, total ۱۱.
     • Tap «بازی کن» to commit (capture, or lay the card down if nothing valid
       is selected), or «لغو» to un-stage.
   Emits { type:'play', card, capture:[…] }. Mirrors the other renderers'
   interface (setConfig/setMySeat/setState/setInteractive/destroy).

   Layout is organised in clear vertical bands so nothing overlaps:
     ┌─ info bar (جادو/کارت باقی/نوبت) ──────────────┐
     │           opponent fan + pill                 │
     │ piles                  table cards            │
     │ (left)                 my hand                │
     │           my stats · play/cancel              │
     └───────────────────────────────────────────────┘
   ========================================================================= */
import { PasurGame, fishValue, subsetsSummingTo } from './pasur.js';
import { tableTheme } from './boardthemes.js';

const SUIT       = ['♠', '♥', '♦', '♣'];
const SUIT_COLOR = ['#14161e', '#c8202e', '#c8202e', '#14161e'];
const RANK       = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const rankLabel = (r) => RANK[r] || String(r);
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
const cardName = (c) => ({ 11: 'سرباز', 12: 'بی‌بی', 13: 'شاه', 14: 'آس' }[c.r] || fa(c.r)) + ' ' + SUIT[c.s];
const key = (c) => `${c.s},${c.r}`;

const GOLD = '#ffd76b', GREEN = '#5be08c';
const FLASH_MS = 650, FLY_MS = 440, DEAL_MS = 380, DEAL_STAGGER = 65, SUR_MS = 1600;
// How long captured cards linger (outlined in the capturer's colour) before
// flying to the pile — so you can SEE what the opponent just took.
const CAP_HOLD_MS = 950;

// Layout bands (fractions of the square canvas S).
const INFO_Y = 0.022, INFO_H = 0.058;
const OPP_CY = 0.155, OPP_PILL_Y = 0.222;
const TABLE_CY = 0.445;
const HAND_Y = 0.625;
const STRIP_Y = 0.83;
const PILE_OPP_Y = 0.30, PILE_ME_Y = 0.52, PILE_X = 0.038;
const DECK_SPOT = { x: 0.5, y: 0.085 }; // where dealt cards fly from

export class PasurRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.engine = null;
    this.config = { colors: ['#e7503a', '#3d7fe0'] };
    this.mySeat = -1;
    this.interactive = false;

    this.staged = null;        // { card } staged from my hand
    this.sel = new Set();      // selected table card keys (number-card capture)
    this.hand = [];            // hit rects for my hand cards
    this.tableRects = [];      // hit rects for table cards
    this.buttons = [];         // { id, x, y, w, h, enabled }
    this.hover = -1;

    // animation state
    this._flyCards = [];       // [{card, fx, fy, tx, ty, t0, dur, w, h, faceDown, accent, kind, pileSeat}]
    this._particles = [];
    this._surFx = { until: 0, seat: -1 };
    this._flashUntil = 0;
    this._flashKeys = new Set();
    this._captureHold = null;  // { until, seat, color, cards:[{card,x,y,w,h,appearAt}] }
    this._shownPlayId = 0;     // id of the last play we've already animated
    this._dealKeys = new Set();    // keys of cards mid-deal (skip in static layer)
    this._oppFlyCount = 0;         // face-down deal cards heading to opponent
    this._raf = null;
    this._init = false;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._onVis = () => { if (document.visibilityState === 'visible') { this._flyCards = []; this._particles = []; this._ensureAnim(); this.draw(); } };
    document.addEventListener('visibilitychange', this._onVis);
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this.draw(); }
  setInteractive(v) {
    this.interactive = v;
    this.canvas.style.cursor = v ? 'pointer' : 'default';
    if (!v) { this.staged = null; this.sel.clear(); }
    this._ensureAnim();
    this.draw();
  }
  setState(state) {
    const prev = this.state;
    this.state = state;
    try { this.engine = PasurGame.fromState(state); } catch { this.engine = null; }

    if (!prev) {
      // First state (join / rejoin): sync the play id so we don't replay a
      // capture that already happened before we were watching.
      this._shownPlayId = state?.lastPlay?.id ?? 0;
    } else if (state) {
      const lp = state.lastPlay;
      if (lp && lp.id !== this._shownPlayId) {
        this._shownPlayId = lp.id;
        this._animatePlay(prev, state, lp);   // exact, authoritative animation
      } else if (!lp) {
        this._detectCapture(prev, state);     // fallback for older states
      }
      this._detectSur(prev, state);
    }
    this._detectDeal(prev, state);

    // A fresh state means my staged selection is stale.
    this.staged = null; this.sel.clear(); this.hover = -1;
    this._init = true;
    this._ensureAnim();
    this.draw();
  }
  _seatColor(s) { return this.config.colors?.[s] || ['#e7503a', '#3d7fe0'][s] || '#ccc'; }

  /* ── Transition detection ───────────────────────────────────────────── */
  _detectCapture(prev, state) {
    const before = new Set((prev.table || []).map(key));
    const after = new Set((state.table || []).map(key));
    const gone = (prev.table || []).filter((c) => !after.has(key(c)));
    const grew = (state.capturedCounts || []).some((c, i) => c > (prev.capturedCounts?.[i] ?? 0));
    if (!gone.length || !grew) return;
    const seat = state.lastCapturer != null ? state.lastCapturer : this.mySeat;
    const S = this.css;
    const prevLayout = this._tableLayout(prev.table || [], S);
    const target = this._pilePos(seat, S);
    const color = this._seatColor(seat);
    const t0base = now() + CAP_HOLD_MS;   // fly only AFTER the cards have lingered
    const held = [];
    gone.forEach((c, idx) => {
      const slot = prevLayout.find((p) => key(p.card) === key(c));
      const w = slot ? slot.w : S * 0.108, hgt = slot ? slot.h : S * 0.151;
      const x = slot ? slot.x : S * 0.5 - w / 2, y = slot ? slot.y : S * TABLE_CY - hgt / 2;
      held.push({ card: c, x, y, w, h: hgt });
      this._flyCards.push({
        card: c, fx: x + w / 2, fy: y + hgt / 2, tx: target.x, ty: target.y,
        t0: t0base + idx * 40, dur: FLY_MS,
        w: S * 0.10, h: S * 0.14, faceDown: false, accent: color,
        kind: 'capture', pileSeat: seat, arcH: S * 0.05,
      });
    });
    // Hold the captured cards in place, outlined in the capturer's colour, so
    // the move is readable (especially the opponent's) before they fly off.
    this._captureHold = { until: t0base, seat, color, cards: held };
    this._flashKeys = new Set(gone.map(key));
    this._flashUntil = t0base;
  }
  /** Authoritative play animation driven by state.lastPlay. The played card
   *  flies in from the player who played it, lingers (showing exactly which
   *  table cards it sweeps, outlined in that player's colour), then the whole
   *  group flies to the capturer's pile. Lay-downs simply fly to their slot. */
  _animatePlay(prev, state, lp) {
    const S = this.css;
    const seat = lp.seat;
    const me = this.mySeat >= 0 ? this.mySeat : 0;
    const color = this._seatColor(seat);
    const card = lp.card;
    // Where the card flies FROM: my hand (bottom) or the opponent fan (top).
    const from = seat === me
      ? { x: S * 0.5, y: S * (HAND_Y + 0.04) }
      : { x: S * 0.5, y: S * OPP_CY };

    // Lay-down: glide the card to its new spot on the table, then it stays.
    if (lp.placed) {
      const slot = this._tableLayout(state.table || [], S).find((p) => key(p.card) === key(card));
      if (!slot) return;
      this._flyCards.push({
        card, fx: from.x, fy: from.y, tx: slot.x + slot.w / 2, ty: slot.y + slot.h / 2,
        t0: now(), dur: FLY_MS, w: slot.w, h: slot.h, faceDown: false,
        kind: 'layin', accent: color, arcH: S * 0.05,
      });
      return;
    }

    // Capture: where the swept cards were sitting (use the PREVIOUS table).
    const prevLayout = this._tableLayout(prev.table || [], S);
    const capSlots = (lp.captured || []).map((c) => {
      const s = prevLayout.find((p) => key(p.card) === key(c));
      const w = s ? s.w : S * 0.108, h = s ? s.h : S * 0.151;
      const x = s ? s.x : S * 0.5 - w / 2, y = s ? s.y : S * TABLE_CY - h / 2;
      return { card: c, x, y, w, h };
    });
    // The played card parks CLEAR of the swept cards (above them, or below if
    // there's no room) so it never hides which cards we took.
    const n = Math.max(1, capSlots.length);
    const cx = capSlots.reduce((a, g) => a + g.x + g.w / 2, 0) / n;
    const topY = capSlots.reduce((a, g) => Math.min(a, g.y), Infinity);
    const botY = capSlots.reduce((a, g) => Math.max(a, g.y + g.h), -Infinity);
    const pw = S * 0.108, ph = pw * 1.4, gap = S * 0.016;
    let py = topY - ph - gap;                       // prefer just above the group
    if (py < S * 0.11) py = Math.min(botY + gap, S * 0.62 - ph); // else just below
    const playSlot = { card, x: cx - pw / 2, y: py, w: pw, h: ph };

    const tArrive = now();
    const tLand = tArrive + FLY_MS;        // played card has reached the table
    const tFly = tLand + CAP_HOLD_MS;      // group lifts off toward the pile

    // 1) played card flies in (face up)
    this._flyCards.push({
      card, fx: from.x, fy: from.y, tx: playSlot.x + playSlot.w / 2, ty: playSlot.y + playSlot.h / 2,
      t0: tArrive, dur: FLY_MS, w: playSlot.w, h: playSlot.h, faceDown: false,
      kind: 'playin', accent: color, arcH: S * 0.06,
    });
    // 2) hold: swept cards are shown immediately; the played card joins once landed
    const holdCards = capSlots.map((g) => ({ ...g, appearAt: 0 }));
    holdCards.push({ ...playSlot, appearAt: tLand });
    this._captureHold = { until: tFly, seat, color, cards: holdCards };
    // 3) the whole group flies to the pile
    const target = this._pilePos(seat, S);
    [playSlot, ...capSlots].forEach((g, idx) => {
      this._flyCards.push({
        card: g.card, fx: g.x + g.w / 2, fy: g.y + g.h / 2, tx: target.x, ty: target.y,
        t0: tFly + idx * 40, dur: FLY_MS, w: S * 0.10, h: S * 0.14,
        faceDown: false, accent: color, kind: 'capture', pileSeat: seat, arcH: S * 0.05,
      });
    });
  }

  _detectSur(prev, state) {
    for (let s = 0; s < 2; s++) {
      if ((state.surs?.[s] ?? 0) > (prev.surs?.[s] ?? 0)) {
        this._surFx = { until: now() + SUR_MS, seat: s };
        const S = this.css;
        this._spawnBurst(S * 0.5, S * TABLE_CY, GOLD, 36, 4.5);
      }
    }
  }
  _detectDeal(prev, state) {
    if (!state) return;
    const me = this.mySeat >= 0 ? this.mySeat : 0;
    const myCount = state.handCounts?.[me] ?? 0;
    const prevCount = prev?.handCounts?.[me] ?? 0;
    const isDeal = (!prev && myCount > 0) || (myCount > prevCount);
    if (!isDeal) return;
    const S = this.css;
    const from = { x: S * DECK_SPOT.x, y: S * DECK_SPOT.y };

    // My hand cards fly in (face up), staggered.
    const handLayout = this._handLayout(state.hands?.[me] || [], S);
    handLayout.forEach((slot, i) => {
      this._dealKeys.add(key(slot.card));
      this._flyCards.push({
        card: slot.card, fx: from.x, fy: from.y, tx: slot.x + slot.w / 2, ty: slot.y + slot.h / 2,
        t0: now() + i * DEAL_STAGGER, dur: DEAL_MS, w: slot.w, h: slot.h,
        faceDown: false, kind: 'deal', arcH: S * 0.04,
      });
    });
    // Table cards fly in (face up) only on the opening deal (no prev).
    if (!prev) {
      const tblLayout = this._tableLayout(state.table || [], S);
      tblLayout.forEach((slot, i) => {
        this._dealKeys.add(key(slot.card));
        this._flyCards.push({
          card: slot.card, fx: from.x, fy: from.y, tx: slot.x + slot.w / 2, ty: slot.y + slot.h / 2,
          t0: now() + (handLayout.length + i) * DEAL_STAGGER, dur: DEAL_MS, w: slot.w, h: slot.h,
          faceDown: false, kind: 'deal', arcH: S * 0.04,
        });
      });
    }
    // Opponent hand backs fly in (face down).
    const oppSeat = 1 - me;
    const oppN = state.handCounts?.[oppSeat] ?? 0;
    const oppLayout = this._oppLayout(oppN, S);
    oppLayout.forEach((slot, i) => {
      this._flyCards.push({
        card: null, fx: from.x, fy: from.y, tx: slot.x + slot.w / 2, ty: slot.y + slot.h / 2,
        t0: now() + i * DEAL_STAGGER, dur: DEAL_MS, w: slot.w, h: slot.h,
        faceDown: true, accent: this._seatColor(oppSeat), kind: 'deal-opp', arcH: S * 0.03,
      });
    });
  }

  /* ── Capture helpers for the staged number card ─────────────────────── */
  _target() { return this.staged ? 11 - fishValue(this.staged.card) : null; }
  _isPicture(card) { return card.r === 11 || card.r === 12 || card.r === 13; }
  _capturable() {
    if (!this.staged || this._isPicture(this.staged.card)) return new Set();
    const nums = (this.state.table || []).filter((c) => fishValue(c) != null);
    const subs = subsetsSummingTo(nums, this._target());
    const s = new Set();
    for (const sub of subs) for (const c of sub) s.add(key(c));
    return s;
  }
  _selSum() {
    let sum = 0;
    for (const k of this.sel) {
      const c = (this.state.table || []).find((t) => key(t) === k);
      if (c) sum += fishValue(c) || 0;
    }
    return sum;
  }
  _pictureTargets() {
    const card = this.staged.card;
    const s = new Set();
    for (const c of (this.state.table || [])) {
      if (card.r === 11) { if (c.r !== 12 && c.r !== 13) s.add(key(c)); }
      else if (c.r === card.r) s.add(key(c));
    }
    return s;
  }

  /* ── Pointer ─────────────────────────────────────────────────────────── */
  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._onHover(e); });
    this.canvas.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } });
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
  }
  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; }
  _hit(rects, mx, my) {
    for (let i = rects.length - 1; i >= 0; i--) {
      const c = rects[i];
      if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return i;
    }
    return -1;
  }
  _onHover(e) {
    if (!this.interactive) return;
    const { mx, my } = this._pos(e);
    const i = this._hit(this.hand, mx, my);
    if (i !== this.hover) { this.hover = i; this.draw(); }
  }
  _onClick(e) {
    if (!this.interactive || !this.state) return;
    const { mx, my } = this._pos(e);

    for (const b of this.buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        if (b.id === 'play' && b.enabled) this._commit();
        else if (b.id === 'cancel') { this.staged = null; this.sel.clear(); this.draw(); }
        return;
      }
    }
    const ti = this._hit(this.tableRects, mx, my);
    if (ti >= 0 && this.staged && !this._isPicture(this.staged.card)) {
      const k = this.tableRects[ti].key;
      if (this._capturable().has(k)) {
        if (this.sel.has(k)) this.sel.delete(k); else this.sel.add(k);
        this.draw();
      }
      return;
    }
    const hi = this._hit(this.hand, mx, my);
    if (hi >= 0) {
      const card = this.hand[hi].card;
      if (this.staged && key(this.staged.card) === key(card)) { this.staged = null; this.sel.clear(); }
      else { this.staged = { card }; this.sel.clear(); this._autoSelect(); }
      this.draw();
    }
  }

  /** When the staged number card has exactly ONE way to capture, pre-select it
   *  (capture is mandatory, so there's no point making the user click it). */
  _autoSelect() {
    if (!this.staged || this._isPicture(this.staged.card)) return;
    const nums = (this.state.table || []).filter((c) => fishValue(c) != null);
    const subs = subsetsSummingTo(nums, this._target());
    if (subs.length === 1) this.sel = new Set(subs[0].map(key));
  }

  _commit() {
    if (!this.staged) return;
    const card = this.staged.card;
    let capture = [];
    if (this._isPicture(card)) {
      capture = [];
    } else {
      const nums = (this.state.table || []).filter((c) => fishValue(c) != null);
      const canCapture = subsetsSummingTo(nums, this._target()).length > 0;
      if (canCapture) {
        // Capture is mandatory — only commit a valid selection summing to 11.
        if (!this.sel.size || this._selSum() !== this._target()) return;
        capture = [...this.sel].map((k) => { const [s, r] = k.split(',').map(Number); return { s, r }; });
      }
      // else: no capture possible → lay the card down (capture stays []).
    }
    this.onAction?.({ type: 'play', card: { s: card.s, r: card.r }, capture });
    this.staged = null; this.sel.clear();
  }

  /* ── Animation loop ─────────────────────────────────────────────────── */
  _ensureAnim() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    const step = () => { this._raf = null; this.draw(); if (this._active()) this._raf = requestAnimationFrame(step); };
    if (this._active()) this._raf = requestAnimationFrame(step);
  }
  _active() {
    const t = now();
    if (this._flyCards.some((f) => t < f.t0 + f.dur)) return true;
    if (this._particles.length) return true;
    if (t < this._flashUntil) return true;
    if (this._captureHold && t < this._captureHold.until) return true;
    if (t < this._surFx.until) return true;
    // gentle pulse while it's my turn (glow on playable cards)
    if (this.interactive && this.state && this.state.turn === this.mySeat && !this.state.winner && !this.state.draw) return true;
    return false;
  }
  _tick() {
    const t = now();
    this._flyCards = this._flyCards.filter((f) => t < f.t0 + f.dur);
    // recompute which cards are still flying TO the table (deal or lay-down),
    // so the static layer doesn't draw them in place while they're mid-air.
    this._dealKeys = new Set(this._flyCards
      .filter((f) => (f.kind === 'deal' || f.kind === 'layin') && f.card)
      .map((f) => key(f.card)));
    this._oppFlyCount = this._flyCards.filter((f) => f.kind === 'deal-opp').length;
  }
  _pileFlying(seat) { return this._flyCards.filter((f) => f.kind === 'capture' && f.pileSeat === seat && now() < f.t0 + f.dur).length; }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.css = size;
    this.draw();
  }

  /* ── Layout geometry (pure — used by both draw and animations) ──────── */
  _handLayout(cards, S) {
    if (!cards || !cards.length) return [];
    const sorted = [...cards].sort((a, b) => (a.s - b.s) || (b.r - a.r));
    const cw = S * 0.115, ch = cw * 1.4;
    const maxW = S * 0.86;
    const spacing = Math.min(cw * 1.06, (maxW - cw) / Math.max(1, sorted.length - 1));
    const totalW = cw + (sorted.length - 1) * spacing;
    const startX = (S - totalW) / 2;
    return sorted.map((card, i) => ({ card, x: startX + i * spacing, y: S * HAND_Y, w: cw, h: ch }));
  }
  _tableLayout(cards, S) {
    if (!cards || !cards.length) return [];
    const cw = S * 0.108, ch = cw * 1.4, gap = cw * 0.2;
    const perRow = 6;
    const rows = Math.ceil(cards.length / perRow);
    const startY = S * TABLE_CY - (rows * ch + (rows - 1) * (ch * 0.16)) / 2;
    return cards.map((card, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(cards.length - row * perRow, perRow);
      const rowW = inRow * cw + (inRow - 1) * gap;
      const sx = (S - rowW) / 2;
      const idxInRow = i - row * perRow;
      const x = sx + idxInRow * (cw + gap);
      const y = startY + row * (ch + ch * 0.16);
      return { card, x, y, w: cw, h: ch };
    });
  }
  _oppLayout(count, S) {
    const cw = S * 0.064, ch = cw * 1.4, gap = cw * 0.46;
    const shown = Math.min(count, 8);
    const span = (shown - 1) * gap;
    const cx = S / 2, cy = S * OPP_CY;
    const out = [];
    for (let i = 0; i < shown; i++) out.push({ x: cx - span / 2 + i * gap - cw / 2, y: cy - ch / 2, w: cw, h: ch });
    return out;
  }
  _pilePos(seat, S) {
    const oppSeat = 1 - (this.mySeat >= 0 ? this.mySeat : 0);
    const y0 = seat === oppSeat ? S * PILE_OPP_Y : S * PILE_ME_Y;
    const cw = S * 0.052;
    return { x: S * PILE_X + cw / 2, y: y0 + S * 0.06 };
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    this._tick();
    const S = this.css;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const th = tableTheme(this.config.boardTheme);
    this._rr(0, 0, S, S, 16); ctx.fillStyle = th.edge; ctx.fill();
    this._rr(S * 0.03, S * 0.03, S * 0.94, S * 0.94, S * 0.06); ctx.fillStyle = th.felt; ctx.fill();
    // soft vignette for depth
    const vg = ctx.createRadialGradient(S * 0.5, S * 0.5, S * 0.2, S * 0.5, S * 0.5, S * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.28)');
    this._rr(S * 0.03, S * 0.03, S * 0.94, S * 0.94, S * 0.06); ctx.fillStyle = vg; ctx.fill();

    this.hand = []; this.tableRects = []; this.buttons = [];
    if (!this.state) { ctx.restore(); return; }
    const st = this.state;
    const oppSeat = 1 - (this.mySeat >= 0 ? this.mySeat : 0);

    this._drawInfoBar(ctx, S, st);
    this._drawCapturePiles(ctx, S, st, oppSeat);
    this._drawOpponent(ctx, S, st, oppSeat);
    this._drawTable(ctx, S, st);
    this._drawCaptureHold(ctx, S);
    this._drawMyHand(ctx, S, st);
    this._drawControls(ctx, S, st);

    // effects layered on top
    this._drawFlyCards(ctx, S);
    this._drawParticles(ctx);
    if (now() < this._surFx.until) this._drawSur(ctx, S);

    ctx.restore();
  }

  /* ── Info bar: three evenly-spaced chips, no overlap ────────────────── */
  _drawInfoBar(ctx, S, st) {
    const y = S * INFO_Y, h = S * INFO_H;
    const x0 = S * 0.05, x1 = S * 0.95, gap = S * 0.018;
    const cw = (x1 - x0 - 2 * gap) / 3;
    const mine = st.turn === this.mySeat && !st.winner && !st.draw;
    const me = this.mySeat >= 0 ? this.mySeat : 0, opp = 1 - me;
    const lastRound = (st.deckCount ?? 0) === 0 && st.phase === 'play';
    const target = st.target ?? 62;
    const ms = st.matchScores || [0, 0];

    // chip 1 — round number + deck remaining (turns orange on the last round)
    this._chip(ctx, x0, y, cw, h,
      lastRound ? 'rgba(232,146,60,.22)' : 'rgba(0,0,0,.42)',
      lastRound ? '#e8923c' : 'rgba(255,255,255,.12)');
    this._chipText(ctx, x0, cw, y, h,
      lastRound ? '#ffb877' : 'rgba(255,255,255,.9)',
      `دست ${fa(st.roundNumber ?? 1)}`, lastRound ? '⚑ آخر' : `🂠 ${fa(st.deckCount ?? 0)}`);
    // chip 2 — running match score (تو : حریف) toward the target
    this._chip(ctx, x0 + cw + gap, y, cw, h, 'rgba(255,215,107,.12)', 'rgba(255,215,107,.4)');
    this._chipText(ctx, x0 + cw + gap, cw, y, h, GOLD, `هدف ${fa(target)}`, `${fa(ms[me])} : ${fa(ms[opp])}`);
    // chip 3 — turn
    const tx = x0 + 2 * (cw + gap);
    this._chip(ctx, tx, y, cw, h, mine ? 'rgba(91,224,140,.18)' : 'rgba(0,0,0,.42)', mine ? GREEN : 'rgba(255,255,255,.12)');
    ctx.fillStyle = mine ? GREEN : 'rgba(255,255,255,.8)';
    ctx.font = `bold ${h * 0.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mine ? '✦ نوبت توست' : 'نوبت حریف', tx + cw / 2, y + h / 2);

    // Last-round banner under the info bar.
    if (lastRound) {
      ctx.fillStyle = '#ffb877'; ctx.font = `bold ${S * 0.024}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('⚑ دست آخر — کارتی برای پخش نمانده', S / 2, y + h + S * 0.006);
    }
  }
  _chip(ctx, x, y, w, h, fill, stroke) {
    this._rr(x, y, w, h, h * 0.32); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  }
  _chipText(ctx, x, w, y, h, valColor, label, val) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = `${h * 0.32}px sans-serif`;
    ctx.fillText(label, x + w * 0.12, y + h / 2);
    ctx.textAlign = 'right'; ctx.fillStyle = valColor;
    ctx.font = `bold ${h * 0.42}px sans-serif`;
    ctx.fillText(val, x + w * 0.88, y + h / 2);
  }

  /* ── Capture piles (left margin, tidy) ──────────────────────────────── */
  _drawCapturePiles(ctx, S, st, oppSeat) {
    this._capturePile(ctx, S, S * PILE_X, S * PILE_OPP_Y, Math.max(0, (st.capturedCounts?.[oppSeat] ?? 0) - this._pileFlying(oppSeat)),
      this._seatColor(oppSeat), 'حریف', st.clubCounts?.[oppSeat] ?? 0, st.surs?.[oppSeat] ?? 0);
    this._capturePile(ctx, S, S * PILE_X, S * PILE_ME_Y, Math.max(0, (st.capturedCounts?.[this.mySeat] ?? 0) - this._pileFlying(this.mySeat)),
      this._seatColor(this.mySeat), 'تو', st.clubCounts?.[this.mySeat] ?? 0, st.surs?.[this.mySeat] ?? 0);
  }
  _capturePile(ctx, S, x, y0, count, accent, label, clubs, surs) {
    const cw = S * 0.052, ch = cw * 1.42, bandH = S * 0.155;
    // header label
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `bold ${S * 0.022}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${label} · ${fa(count)}`, x, y0 - S * 0.008);
    // pile of backs
    if (count) {
      const shown = Math.min(count, 24);
      const step = shown > 1 ? Math.min(ch * 0.16, (bandH - ch) / (shown - 1)) : 0;
      for (let i = 0; i < shown; i++) this._cardBack(ctx, x + (i % 2) * 1.5, y0 + i * step, cw, ch, accent);
    } else {
      ctx.save(); ctx.globalAlpha = 0.4;
      this._rr(x, y0, cw, ch, cw * 0.14); ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
    // سور marks — a fan of tilted (کج) gold cards tucked by the pile, one per
    // سور, so the count is readable at a glance.
    if (surs > 0) {
      const sw = S * 0.032, sh = sw * 1.42;
      const fx0 = x + cw * 0.72, fy0 = y0 + bandH * 0.32;
      const shown = Math.min(surs, 6);
      for (let i = 0; i < shown; i++) {
        ctx.save();
        ctx.translate(fx0 + i * sw * 0.62 + sw / 2, fy0 + sh / 2 + i * S * 0.004);
        ctx.rotate(0.26 + i * 0.04);     // کج
        this._rr(-sw / 2, -sh / 2, sw, sh, sw * 0.16);
        ctx.fillStyle = '#2a2208'; ctx.fill();
        ctx.shadowColor = GOLD; ctx.shadowBlur = 6;
        ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = GOLD; ctx.font = `${sh * 0.46}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✦', 0, 0);
        ctx.restore();
      }
    }
    // club + sur mini-stats under the pile
    const sy = y0 + bandH + S * 0.018;
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `${S * 0.02}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`♣ ${fa(clubs)}`, x, sy);
    if (surs > 0) {
      ctx.fillStyle = GOLD; ctx.font = `bold ${S * 0.02}px sans-serif`;
      ctx.fillText(`سور ${fa(surs)}`, x, sy + S * 0.026);
    }
  }

  /* ── Opponent fan + compact pill ────────────────────────────────────── */
  _drawOpponent(ctx, S, st, oppSeat) {
    const count = st.handCounts?.[oppSeat] ?? 0;
    const layout = this._oppLayout(count, S);
    const drawN = Math.max(0, layout.length - this._oppFlyCount);
    const active = st.turn === oppSeat && !st.winner && !st.draw;
    for (let i = 0; i < drawN; i++) {
      const slot = layout[i];
      this._cardBack(ctx, slot.x, slot.y, slot.w, slot.h, this._seatColor(oppSeat));
    }
    // compact pill: just name + turn dot (detailed stats live by the pile now)
    const pw = S * 0.34, ph = S * 0.044, px = (S - pw) / 2, py = S * OPP_PILL_Y;
    this._rr(px, py, pw, ph, ph / 2);
    ctx.fillStyle = active ? 'rgba(255,215,107,.14)' : 'rgba(0,0,0,.5)'; ctx.fill();
    ctx.strokeStyle = active ? GOLD : 'rgba(255,255,255,.12)'; ctx.lineWidth = active ? 1.4 : 0.8; ctx.stroke();
    ctx.fillStyle = active ? GOLD : 'rgba(255,255,255,.82)';
    ctx.font = `${ph * 0.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${active ? '● ' : ''}حریف · ${fa(count)} کارت`, S / 2, py + ph / 2);
  }

  /* ── Table cards ────────────────────────────────────────────────────── */
  _drawTable(ctx, S, st) {
    const cards = st.table || [];
    const layout = this._tableLayout(cards, S);
    const capset = this.staged && !this._isPicture(this.staged.card) ? this._capturable() : null;
    const pictureCap = this.staged && this._isPicture(this.staged.card) ? this._pictureTargets() : null;
    const flashing = now() < this._flashUntil;

    if (!cards.length) {
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `${S * 0.032}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('میز خالی است', S / 2, S * TABLE_CY);
      return;
    }
    for (const slot of layout) {
      const { card, x, y, w, h } = slot;
      this.tableRects.push({ key: key(card), x, y, w, h, card });
      if (this._dealKeys.has(key(card))) continue; // still flying in
      const k = key(card);
      const selected = this.sel.has(k);
      const dim = capset ? !capset.has(k) && !selected : (pictureCap ? !pictureCap.has(k) : false);
      const willTake = (pictureCap && pictureCap.has(k)) || selected;
      const flash = flashing && this._flashKeys.has(k);

      this._cardFace(ctx, x, y, w, h, card, dim);
      if (flash) this._cardOutline(ctx, x, y, w, h, GOLD, 3);
      else if (willTake) this._cardOutline(ctx, x, y, w, h, GREEN, 3);
      else if (capset && capset.has(k)) this._cardOutline(ctx, x, y, w, h, 'rgba(91,224,140,.55)', 2);
    }
  }

  /* ── My hand (with playable glow) ───────────────────────────────────── */
  _drawMyHand(ctx, S, st) {
    const cards = st.hands?.[this.mySeat];
    const baseY = S * HAND_Y;
    if (!cards || !cards.length) {
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = `${S * 0.03}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('در انتظار پخش دست بعد…', S / 2, baseY + S * 0.08);
      return;
    }
    const layout = this._handLayout(cards, S);
    const myTurn = st.turn === this.mySeat && !st.winner && !st.draw && this.interactive;
    const pulse = 0.5 + 0.5 * Math.sin(now() / 300);
    layout.forEach((slot, i) => {
      const card = slot.card;
      if (this._dealKeys.has(key(card))) { this.hand.push({ card, x: slot.x, y: slot.y, w: slot.w, h: slot.h }); return; }
      const staged = this.staged && key(this.staged.card) === key(card);
      const lift = staged ? S * 0.05 : (this.hover === i ? S * 0.025 : 0);
      const x = slot.x, y = slot.y - lift, cw = slot.w, ch = slot.h;
      this.hand.push({ card, x, y, w: cw, h: ch });
      // playable glow (pulsing halo) on my turn
      if (myTurn && !staged) {
        ctx.save();
        ctx.shadowColor = GREEN; ctx.shadowBlur = 10 + 8 * pulse;
        this._rr(x, y, cw, ch, cw * 0.12); ctx.strokeStyle = `rgba(91,224,140,${0.35 + 0.25 * pulse})`;
        ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      this._cardFace(ctx, x, y, cw, ch, card, false);
      if (staged) this._cardOutline(ctx, x, y, cw, ch, GOLD, 3);
    });
  }

  /* ── My stats strip + play/cancel controls ──────────────────────────── */
  _drawControls(ctx, S, st) {
    // always-on stats strip (own line, clear of the hand and buttons)
    const sy = S * STRIP_Y;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `${S * 0.028}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const livePts = st.liveScores?.[this.mySeat] ?? 0;
    ctx.fillText(
      `تو · 🃏 ${fa(st.capturedCounts?.[this.mySeat] ?? 0)} برگ · ♣ ${fa(st.clubCounts?.[this.mySeat] ?? 0)} · سور ${fa(st.surs?.[this.mySeat] ?? 0)} · ★ ${fa(livePts)} امتیازِ این دست`,
      S / 2, sy);

    if (!this.staged || !this.interactive) return;
    const card = this.staged.card;
    let hint, canPlay;
    if (this._isPicture(card)) {
      const tgt = this._pictureTargets();
      hint = tgt.size ? `${cardName(card)} → ${fa(tgt.size)} برگ برمی‌دارد` : `${cardName(card)} روی میز گذاشته می‌شود`;
      canPlay = true;
    } else {
      const target = this._target();
      const sum = this._selSum();
      const cur = sum + fishValue(card);
      const canCapture = this._capturable().size > 0;
      if (!canCapture) {
        hint = 'برداشتی ممکن نیست — روی میز گذاشته می‌شود';
        canPlay = true;
      } else if (this.sel.size === 0) {
        // Capture is mandatory: must pick a valid combination first.
        hint = 'باید برگ بگیری — برگ‌هایی که با کارتت ۱۱ شوند را انتخاب کن';
        canPlay = false;
      } else {
        hint = `جمع: ${fa(cur)} از ${fa(11)}` + (cur === 11 ? ' ✓' : '');
        canPlay = cur === 11;
      }
    }

    // hint on its own line above the buttons
    ctx.fillStyle = canPlay ? GREEN : 'rgba(255,210,120,.95)';
    ctx.font = `${S * 0.027}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hint, S / 2, S * 0.862);

    const bw = S * 0.26, bh = S * 0.072, gap = S * 0.03;
    const bx = S / 2 - bw - gap / 2, cx = S / 2 + gap / 2, byb = S * 0.885;
    // Play
    this._rr(bx, byb, bw, bh, bh * 0.3);
    ctx.fillStyle = canPlay ? GREEN : 'rgba(120,140,130,.4)'; ctx.fill();
    ctx.fillStyle = canPlay ? '#06231a' : 'rgba(255,255,255,.5)';
    ctx.font = `bold ${bh * 0.42}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('بازی کن ✓', bx + bw / 2, byb + bh / 2);
    this.buttons.push({ id: 'play', x: bx, y: byb, w: bw, h: bh, enabled: canPlay });
    // Cancel
    this._rr(cx, byb, bw, bh, bh * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('لغو ✕', cx + bw / 2, byb + bh / 2);
    this.buttons.push({ id: 'cancel', x: cx, y: byb, w: bw, h: bh, enabled: true });
  }

  /* ── Captured cards lingering on the table before they fly to a pile ──── */
  _drawCaptureHold(ctx, S) {
    const ch = this._captureHold;
    if (!ch || now() >= ch.until) return;
    const pulse = 0.5 + 0.5 * Math.sin(now() / 150);
    const t = now();
    const shown = ch.cards.filter((g) => !g.appearAt || t >= g.appearAt);
    if (!shown.length) return;
    for (const g of shown) {
      this._cardFace(ctx, g.x, g.y, g.w, g.h, g.card, false);
      ctx.save();
      ctx.shadowColor = ch.color; ctx.shadowBlur = 10 + 10 * pulse;
      this._cardOutline(ctx, g.x, g.y, g.w, g.h, ch.color, 3.5);
      ctx.restore();
    }
    // little "who took it" tag above the held cards
    const top = shown.reduce((m, g) => Math.min(m, g.y), Infinity);
    const cx = shown.reduce((s, g) => s + g.x + g.w / 2, 0) / shown.length;
    const label = ch.seat === this.mySeat ? 'تو برداشتی' : 'حریف برداشت';
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.fillStyle = ch.color; ctx.font = `bold ${S * 0.026}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(label, cx, top - S * 0.012);
    ctx.restore();
  }

  /* ── Effects: flying cards, particles, sur ──────────────────────────── */
  _drawFlyCards(ctx, S) {
    const t = now();
    for (const f of this._flyCards) {
      const dt = t - f.t0;
      if (dt < 0 || dt >= f.dur) continue;
      const raw = dt / f.dur, e = 1 - Math.pow(1 - raw, 3);
      const cpx = (f.fx + f.tx) / 2, cpy = (f.fy + f.ty) / 2 - (f.arcH || 0);
      const bx = (1 - e) * (1 - e) * f.fx + 2 * (1 - e) * e * cpx + e * e * f.tx;
      const by = (1 - e) * (1 - e) * f.fy + 2 * (1 - e) * e * cpy + e * e * f.ty;
      ctx.save();
      ctx.translate(bx, by);
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 12 * (1 - e) + 3;
      if (f.faceDown) this._cardBack(ctx, -f.w / 2, -f.h / 2, f.w, f.h, f.accent);
      else this._cardFace(ctx, -f.w / 2, -f.h / 2, f.w, f.h, f.card, false);
      ctx.restore();
    }
  }
  _spawnBurst(x, y, color, n, speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * speed;
      this._particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 1, color, r: 2 + Math.random() * 3 });
    }
  }
  _drawParticles(ctx) {
    if (!this._particles.length) return;
    const alive = [];
    for (const p of this._particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.026;
      if (p.life > 0) {
        alive.push(p);
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life);
        ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    this._particles = alive;
  }
  _drawSur(ctx, S) {
    const left = this._surFx.until - now();
    const t = 1 - Math.max(0, left / SUR_MS);
    const e = 1 - Math.pow(1 - t, 3);
    const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    const who = this._surFx.seat === this.mySeat ? 'سورِ تو!' : 'سورِ حریف!';
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    // expanding gold ring
    ctx.beginPath(); ctx.arc(S / 2, S * TABLE_CY, S * (0.06 + e * 0.32), 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 6 * (1 - e) + 1; ctx.shadowColor = GOLD; ctx.shadowBlur = 24 * (1 - e) + 6;
    ctx.stroke();
    // big text
    ctx.fillStyle = GOLD; ctx.shadowBlur = 20;
    ctx.font = `bold ${S * (0.07 + e * 0.04)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✦ سور ✦', S / 2, S * TABLE_CY - S * 0.03);
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.04}px sans-serif`;
    ctx.fillText(who, S / 2, S * TABLE_CY + S * 0.05);
    ctx.restore();
  }

  /* ── Card art (style-aware: classic / royal / dark) ─────────────────── */
  _cardFace(ctx, x, y, w, h, card, dim) {
    const style = this.config?.cardStyle || 'classic';
    const r = w * 0.12;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.48;
    if (style === 'dark') {
      const NEON = ['#4ee6f8', '#ff6b77', '#ffd76b', '#56e08c'];
      this._rr(x, y, w, h, r); ctx.fillStyle = dim ? '#0c111d' : '#131926'; ctx.fill();
      ctx.strokeStyle = NEON[card.s] + '55'; ctx.lineWidth = 1.2; ctx.stroke();
      const col = NEON[card.s];
      ctx.shadowColor = col; ctx.shadowBlur = dim ? 0 : 7;
      ctx.fillStyle = '#dde0f0'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.22}px sans-serif`;
      ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.05);
      ctx.fillStyle = col;
      ctx.font = `${h * 0.20}px serif`;
      ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);
      ctx.font = `${h * 0.40}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
    } else if (style === 'royal') {
      const RICH = ['#0d1012', '#b8122a', '#b8122a', '#0d1012'];
      this._rr(x, y, w, h, r); ctx.fillStyle = dim ? '#e8e0cc' : '#fdf6e3'; ctx.fill();
      ctx.strokeStyle = RICH[card.s]; ctx.lineWidth = 1.5; ctx.stroke();
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
      ctx.save(); ctx.translate(x + w, y + h); ctx.rotate(Math.PI);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.20}px Georgia,serif`;
      ctx.fillText(rankLabel(card.r), w * 0.09, h * 0.05);
      ctx.font = `${h * 0.17}px serif`;
      ctx.fillText(SUIT[card.s], w * 0.09, h * 0.24);
      ctx.restore();
    } else {
      this._rr(x, y, w, h, r);
      ctx.fillStyle = dim ? '#d9d6cd' : '#fbfaf6'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1; ctx.stroke();
      const col = SUIT_COLOR[card.s];
      ctx.fillStyle = col;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `bold ${h * 0.22}px sans-serif`;
      ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.05);
      ctx.font = `${h * 0.2}px serif`;
      ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);
      ctx.font = `${h * 0.4}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
    }
    ctx.restore();
  }
  _cardOutline(ctx, x, y, w, h, color, lw) {
    ctx.save();
    if (color === GOLD || color === GREEN) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
    this._rr(x - lw / 2, y - lw / 2, w + lw, h + lw, w * 0.14);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    ctx.restore();
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
      ctx.save(); this._rr(x, y, w, h, r); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
      for (let d = -h; d < w + h; d += w * 0.22) { ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,230,160,.55)';
      ctx.font = `${h * 0.30}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦', x + w / 2, y + h / 2);
    } else {
      this._rr(x, y, w, h, r); ctx.fillStyle = '#1e2a3a'; ctx.fill();
      ctx.strokeStyle = accent || '#3a7a'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.09)';
      this._rr(x + w * 0.18, y + h * 0.13, w * 0.64, h * 0.74, w * 0.1); ctx.fill();
    }
  }
  _rr(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
