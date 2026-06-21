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
   ========================================================================= */
import { PasurGame, fishValue, subsetsSummingTo } from './pasur.js';

const SUIT       = ['♠', '♥', '♦', '♣'];
const SUIT_COLOR = ['#14161e', '#c8202e', '#c8202e', '#14161e'];
const RANK       = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const rankLabel = (r) => RANK[r] || String(r);
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
const cardName = (c) => ({ 11: 'سرباز', 12: 'بی‌بی', 13: 'شاه', 14: 'آس' }[c.r] || fa(c.r)) + ' ' + SUIT[c.s];
const key = (c) => `${c.s},${c.r}`;

const FELT = '#0c5132', FELT_EDGE = '#063b22', GOLD = '#ffd76b', GREEN = '#5be08c';
const FLASH_MS = 650;

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

    this._flashUntil = 0;
    this._flashKeys = new Set();
    this._lastCapCounts = null;
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
  setInteractive(v) {
    this.interactive = v;
    this.canvas.style.cursor = v ? 'pointer' : 'default';
    if (!v) { this.staged = null; this.sel.clear(); }
    this.draw();
  }
  setState(state) {
    const prev = this.state;
    this.state = state;
    try { this.engine = PasurGame.fromState(state); } catch { this.engine = null; }

    // Flash newly captured table cards (anything that left the table).
    if (prev && state) {
      const before = new Set((prev.table || []).map(key));
      const after = new Set((state.table || []).map(key));
      const gone = [...before].filter((k) => !after.has(k));
      // Only flash when a capture happened (a pile grew), not a simple lay-down.
      const grew = (state.capturedCounts || []).some((c, i) => c > (prev.capturedCounts?.[i] ?? 0));
      if (gone.length && grew) { this._flashKeys = new Set(gone); this._flashUntil = now() + FLASH_MS; this._ensureAnim(); }
    }

    // A fresh state means my staged selection is stale.
    this.staged = null; this.sel.clear(); this.hover = -1;
    this.draw();
  }
  _seatColor(s) { return this.config.colors?.[s] || ['#e7503a', '#3d7fe0'][s] || '#ccc'; }

  _ensureAnim() {
    if (this._raf) return;
    const step = () => {
      this._raf = null;
      this.draw();
      if (now() < this._flashUntil) this._raf = requestAnimationFrame(step);
    };
    if (now() < this._flashUntil) this._raf = requestAnimationFrame(step);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 240);
    this.canvas.width = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.css = size;
    this.draw();
  }

  /* ── Capture helpers for the staged number card ─────────────────────── */
  _target() { return this.staged ? 11 - fishValue(this.staged.card) : null; }
  _isPicture(card) { return card.r === 11 || card.r === 12 || card.r === 13; }
  /** Table cards that appear in SOME valid subset for the staged number card. */
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

    // Buttons first
    for (const b of this.buttons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        if (b.id === 'play' && b.enabled) this._commit();
        else if (b.id === 'cancel') { this.staged = null; this.sel.clear(); this.draw(); }
        return;
      }
    }
    // Table cards (toggle selection when a number card is staged)
    const ti = this._hit(this.tableRects, mx, my);
    if (ti >= 0 && this.staged && !this._isPicture(this.staged.card)) {
      const k = this.tableRects[ti].key;
      if (this._capturable().has(k)) {
        if (this.sel.has(k)) this.sel.delete(k); else this.sel.add(k);
        this.draw();
      }
      return;
    }
    // Hand cards (stage / re-stage)
    const hi = this._hit(this.hand, mx, my);
    if (hi >= 0) {
      const card = this.hand[hi].card;
      if (this.staged && key(this.staged.card) === key(card)) { this.staged = null; this.sel.clear(); }
      else { this.staged = { card }; this.sel.clear(); }
      this.draw();
    }
  }

  _commit() {
    if (!this.staged) return;
    const card = this.staged.card;
    let capture = [];
    if (this._isPicture(card)) {
      capture = []; // engine recomputes the forced capture for J/Q/K
    } else {
      const sum = this._selSum();
      if (this.sel.size && sum === this._target()) {
        capture = [...this.sel].map((k) => {
          const [s, r] = k.split(',').map(Number); return { s, r };
        });
      } else if (this.sel.size) {
        return; // invalid partial selection — ignore
      }
    }
    this.onAction?.({ type: 'play', card: { s: card.s, r: card.r }, capture });
    this.staged = null; this.sel.clear();
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const S = this.css;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    this._rr(0, 0, S, S, 16); ctx.fillStyle = FELT_EDGE; ctx.fill();
    this._rr(S * 0.03, S * 0.03, S * 0.94, S * 0.94, S * 0.06); ctx.fillStyle = FELT; ctx.fill();

    this.hand = []; this.tableRects = []; this.buttons = [];
    if (!this.state) { ctx.restore(); return; }
    const st = this.state;
    const oppSeat = 1 - this.mySeat;

    this._drawInfoBar(ctx, S, st);
    this._drawCapturePiles(ctx, S, st, oppSeat);
    this._drawOpponent(ctx, S, st, oppSeat);
    this._drawTable(ctx, S, st);
    this._drawMyHand(ctx, S, st);
    this._drawControls(ctx, S, st);

    ctx.restore();
  }

  /** Physical "won" piles down the left margin that visibly grow as you
   *  collect برگ — opponent's near the top, yours lower down. */
  _drawCapturePiles(ctx, S, st, oppSeat) {
    this._capturePile(ctx, S, S * 0.045, S * 0.16, st.capturedCounts?.[oppSeat] ?? 0, this._seatColor(oppSeat), 'حریف');
    this._capturePile(ctx, S, S * 0.045, S * 0.50, st.capturedCounts?.[this.mySeat] ?? 0, this._seatColor(this.mySeat), 'تو');
  }
  _capturePile(ctx, S, x, y0, count, accent, label) {
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = `bold ${S * 0.023}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${label}: ${fa(count)}`, x, y0 - S * 0.006);
    if (!count) return;
    const cw = S * 0.052, ch = cw * 1.42;
    const bandH = S * 0.26;
    const shown = Math.min(count, 30);
    const step = shown > 1 ? Math.min(ch * 0.16, (bandH - ch) / (shown - 1)) : 0;
    for (let i = 0; i < shown; i++) {
      this._cardBack(ctx, x + (i % 2) * 1.5, y0 + i * step, cw, ch, accent);
    }
  }

  _drawInfoBar(ctx, S, st) {
    const by = S * 0.045, bh = S * 0.07;
    // magic 11 + deck count (left)
    this._rr(S * 0.04, by, S * 0.26, bh, bh * 0.32);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = GOLD; ctx.font = `bold ${bh * 0.42}px sans-serif`;
    ctx.fillText(`جادو: ${fa(11)}`, S * 0.04 + bh * 0.3, by + bh * 0.34);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `${bh * 0.34}px sans-serif`;
    ctx.fillText(`🂠 ${fa(st.deckCount ?? 0)} باقی`, S * 0.04 + bh * 0.3, by + bh * 0.72);

    // turn indicator (right)
    const mine = st.turn === this.mySeat && !st.winner && !st.draw;
    this._rr(S * 0.62, by, S * 0.34, bh, bh * 0.32);
    ctx.fillStyle = mine ? 'rgba(91,224,140,.18)' : 'rgba(0,0,0,.4)'; ctx.fill();
    ctx.strokeStyle = mine ? GREEN : 'rgba(255,255,255,.12)'; ctx.lineWidth = mine ? 1.6 : 0.8; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = mine ? GREEN : 'rgba(255,255,255,.75)'; ctx.font = `bold ${bh * 0.4}px sans-serif`;
    ctx.fillText(mine ? '✦ نوبت توست' : 'نوبت حریف', S * 0.62 + S * 0.17, by + bh / 2);
  }

  _drawOpponent(ctx, S, st, oppSeat) {
    const count = st.handCounts?.[oppSeat] ?? 0;
    const cw = S * 0.066, ch = cw * 1.4, gap = cw * 0.42;
    const shown = Math.min(count, 8);
    const span = (shown - 1) * gap;
    const cx = S / 2, cy = S * 0.18;
    for (let i = 0; i < shown; i++) {
      this._cardBack(ctx, cx - span / 2 + i * gap - cw / 2, cy - ch / 2, cw, ch, this._seatColor(oppSeat));
    }
    // opponent stats pill
    const pw = S * 0.5, ph = S * 0.045, px = (S - pw) / 2, py = cy + ch / 2 + S * 0.014;
    this._rr(px, py, pw, ph, ph / 2); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `${ph * 0.56}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`حریف · 🃏 ${fa(st.capturedCounts?.[oppSeat] ?? 0)} برگ · ♣ ${fa(st.clubCounts?.[oppSeat] ?? 0)} · سور ${fa(st.surs?.[oppSeat] ?? 0)}`, S / 2, py + ph / 2);
  }

  _drawTable(ctx, S, st) {
    const cards = st.table || [];
    const cw = S * 0.115, ch = cw * 1.4;
    const capset = this.staged && !this._isPicture(this.staged.card) ? this._capturable() : null;
    const pictureCap = this.staged && this._isPicture(this.staged.card) ? this._pictureTargets() : null;
    const flashing = now() < this._flashUntil;

    // Lay out in up to two centred rows.
    const perRow = Math.min(cards.length, 6) || 1;
    const rows = Math.ceil(cards.length / 6) || 1;
    const startY = S * 0.42 - (rows - 1) * (ch * 0.55);
    cards.forEach((card, i) => {
      const row = Math.floor(i / 6);
      const inRow = Math.min(cards.length - row * 6, 6);
      const rowW = inRow * cw + (inRow - 1) * (cw * 0.18);
      const sx = (S - rowW) / 2;
      const idxInRow = i - row * 6;
      const x = sx + idxInRow * (cw + cw * 0.18);
      const y = startY + row * (ch * 1.12);
      this.tableRects.push({ key: key(card), x, y, w: cw, h: ch, card });

      const k = key(card);
      const selected = this.sel.has(k);
      const dim = capset ? !capset.has(k) && !selected : (pictureCap ? !pictureCap.has(k) : false);
      const willTake = (pictureCap && pictureCap.has(k)) || selected;
      const flash = flashing && this._flashKeys.has(k);

      this._cardFace(ctx, x, y, cw, ch, card, dim);
      if (flash) { this._cardOutline(ctx, x, y, cw, ch, GOLD, 3); }
      else if (willTake) { this._cardOutline(ctx, x, y, cw, ch, GREEN, 3); }
      else if (capset && capset.has(k)) { this._cardOutline(ctx, x, y, cw, ch, 'rgba(91,224,140,.55)', 2); }
    });
    if (!cards.length) {
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = `${S * 0.035}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('میز خالی است', S / 2, S * 0.45);
    }
  }

  /** For a staged picture card, which table cards it will take (highlight). */
  _pictureTargets() {
    const card = this.staged.card;
    const s = new Set();
    for (const c of (this.state.table || [])) {
      if (card.r === 11) { if (c.r !== 12 && c.r !== 13) s.add(key(c)); }
      else if (c.r === card.r) s.add(key(c)); // Q/K match
    }
    return s;
  }

  _drawMyHand(ctx, S, st) {
    const cards = st.hands?.[this.mySeat];
    const cw = S * 0.12, ch = cw * 1.4;
    const baseY = S * 0.70;
    if (!cards || !cards.length) {
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = `${S * 0.03}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('در انتظار پخش دست بعد…', S / 2, baseY + ch / 2);
      return;
    }
    const sorted = [...cards].sort((a, b) => (a.s - b.s) || (b.r - a.r));
    const maxW = S * 0.9;
    const spacing = Math.min(cw * 1.04, (maxW - cw) / Math.max(1, sorted.length - 1));
    const totalW = cw + (sorted.length - 1) * spacing;
    const startX = (S - totalW) / 2;
    sorted.forEach((card, i) => {
      const staged = this.staged && key(this.staged.card) === key(card);
      const lift = staged ? S * 0.05 : (this.hover === i ? S * 0.025 : 0);
      const x = startX + i * spacing, y = baseY - lift;
      this.hand.push({ card, x, y, w: cw, h: ch });
      this._cardFace(ctx, x, y, cw, ch, card, false);
      if (staged) this._cardOutline(ctx, x, y, cw, ch, GOLD, 3);
    });
  }

  _drawControls(ctx, S, st) {
    // My stats strip (always shown)
    const sy = S * 0.90;
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.font = `${S * 0.03}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`تو · 🃏 ${fa(st.capturedCounts?.[this.mySeat] ?? 0)} برگ · ♣ ${fa(st.clubCounts?.[this.mySeat] ?? 0)} · سور ${fa(st.surs?.[this.mySeat] ?? 0)}`, S / 2, sy);

    if (!this.staged || !this.interactive) return;
    const card = this.staged.card;

    // Hint + Play/Cancel buttons
    let hint, canPlay;
    if (this._isPicture(card)) {
      const tgt = this._pictureTargets();
      hint = tgt.size ? `${cardName(card)} → ${fa(tgt.size)} برگ برمی‌دارد` : `${cardName(card)} روی میز گذاشته می‌شود`;
      canPlay = true;
    } else {
      const target = this._target();
      const sum = this._selSum();
      const cur = sum + fishValue(card);
      if (this.sel.size === 0) {
        const has = this._capturable().size > 0;
        hint = has ? `${cardName(card)} — برگ‌هایی را انتخاب کن که با کارتت ۱۱ شوند` : `برداشتی ممکن نیست — روی میز گذاشته می‌شود`;
        canPlay = true; // lay down
      } else {
        hint = `جمع: ${fa(cur)} از ${fa(11)}` + (cur === 11 ? ' ✓' : '');
        canPlay = cur === 11;
      }
    }

    const bw = S * 0.26, bh = S * 0.082, gap = S * 0.03;
    const bx = S / 2 - bw - gap / 2, cx = S / 2 + gap / 2, byb = S * 0.935 - bh;
    // hint above buttons
    ctx.fillStyle = canPlay ? GREEN : 'rgba(255,210,120,.95)';
    ctx.font = `${S * 0.028}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(hint, S / 2, byb - S * 0.012);

    // Play button
    this._rr(bx, byb, bw, bh, bh * 0.3);
    ctx.fillStyle = canPlay ? GREEN : 'rgba(120,140,130,.4)'; ctx.fill();
    ctx.fillStyle = canPlay ? '#06231a' : 'rgba(255,255,255,.5)';
    ctx.font = `bold ${bh * 0.42}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('بازی کن ✓', bx + bw / 2, byb + bh / 2);
    this.buttons.push({ id: 'play', x: bx, y: byb, w: bw, h: bh, enabled: canPlay });

    // Cancel button
    this._rr(cx, byb, bw, bh, bh * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('لغو ✕', cx + bw / 2, byb + bh / 2);
    this.buttons.push({ id: 'cancel', x: cx, y: byb, w: bw, h: bh, enabled: true });
  }

  /* ── Card art ───────────────────────────────────────────────────────── */
  _cardFace(ctx, x, y, w, h, card, dim) {
    this._rr(x, y, w, h, w * 0.12);
    ctx.fillStyle = dim ? '#d9d6cd' : '#fbfaf6'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save();
    if (dim) ctx.globalAlpha = 0.5;
    const col = SUIT_COLOR[card.s];
    ctx.fillStyle = col;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${h * 0.22}px sans-serif`;
    ctx.fillText(rankLabel(card.r), x + w * 0.09, y + h * 0.05);
    ctx.font = `${h * 0.2}px serif`;
    ctx.fillText(SUIT[card.s], x + w * 0.09, y + h * 0.28);
    ctx.font = `${h * 0.4}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT[card.s], x + w * 0.52, y + h * 0.63);
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
    this._rr(x, y, w, h, w * 0.14);
    ctx.fillStyle = '#1e2a3a'; ctx.fill();
    ctx.strokeStyle = accent || '#3a7a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.09)';
    this._rr(x + w * 0.18, y + h * 0.13, w * 0.64, h * 0.74, w * 0.1); ctx.fill();
  }
  _rr(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}

function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
