/* =========================================================================
   اَلِ من خورا — Monopoly (مونوپولی) renderer.
   Classic 11×11 perimeter board (GO at the bottom-right, numbered
   counter-clockwise). The centre holds the dice, the turn/money panel, the
   event log, the drawn card, and the action buttons. Tap any tile to open its
   deed panel (buy-back / build / mortgage when it's legally your move).
   Emits actions via onAction({type,...}) — mirrors the other renderers'
   interface (setConfig / setMySeat / setState / setInteractive / destroy).
   ========================================================================= */
import { BOARD, GROUPS, GROUP_COLOR, MonopolyGame } from './monopoly.js';

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
const TOKENS = ['🎩', '🚗', '🐕', '🚢'];
const TOKEN_KINDS = ['hat', 'car', 'dog', 'ship']; // hand-drawn vector tokens
const GOLD = '#ffd76b', FELT = '#16472f', INK = '#16202a';

const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

export class MonopolyRenderer {
  constructor(canvas, { onAction } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;

    this.state = null;
    this.config = { colors: ['#e7503a', '#3d7fe0', '#3bb15f', '#e8b730'] };
    this.mySeat = -1;
    this.interactive = false;

    this.buttons = [];      // [{id, x,y,w,h, action, enabled}]
    this.tileRects = [];    // hit rects per tile
    this.selTile = -1;      // open deed panel tile (or -1)

    this._tok = [];         // animated token positions [{x,y}]
    this._walk = [];        // per-seat walk animation
    this._drawnPos = [];    // last seen state pos per seat
    this._dice = { until: 0, a: 1, b: 1 };
    this._card = { until: 0, card: null };
    this._flash = [];       // money-change flashes [{seat,amt,t0}]
    this._raf = null;

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.addEventListener('pointerup', (e) => this._onClick(e));
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();
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
    try { this.engine = MonopolyGame.fromState(state); } catch { this.engine = null; }
    const n = state.numPlayers || 2;
    // init token positions on first state
    if (!this._tok.length) {
      for (let s = 0; s < n; s++) { const c = this._tileCenter(state.pos[s]); this._tok[s] = { x: c.x, y: c.y }; this._drawnPos[s] = state.pos[s]; }
    }
    // detect dice roll
    if (state.dice && (!prev || !prev.dice || prev.dice[0] !== state.dice[0] || prev.dice[1] !== state.dice[1] || (prev.moveCount !== state.moveCount && state.mustRoll === false && prev.mustRoll))) {
      this._dice = { until: now() + 520, a: state.dice[0], b: state.dice[1] };
    } else if (state.dice) {
      this._dice.a = state.dice[0]; this._dice.b = state.dice[1];
    }
    // detect movement → walk animation
    for (let s = 0; s < n; s++) {
      const from = this._drawnPos[s] ?? state.pos[s];
      const to = state.pos[s];
      if (from !== to) this._startWalk(s, from, to);
      this._drawnPos[s] = to;
    }
    // money flashes
    if (prev && prev.money) {
      for (let s = 0; s < n; s++) {
        const d = (state.money[s] ?? 0) - (prev.money[s] ?? 0);
        if (d !== 0) this._flash.push({ seat: s, amt: d, t0: now() });
      }
    }
    // a fresh drawn card
    if (state.lastCard && (!prev || prev.lastCard?.text !== state.lastCard.text || prev.moveCount !== state.moveCount)) {
      if (state.lastCard) this._card = { until: now() + 2600, card: state.lastCard };
    }
    // close deed panel if it became irrelevant
    if (this.selTile >= 0 && !this._tileIsOwnedView(this.selTile)) { /* keep open for info */ }
    this._ensureAnim();
    this.draw();
  }

  _seatColor(s) { return this.config.colors?.[s] || ['#e7503a', '#3d7fe0', '#3bb15f', '#e8b730'][s] || '#ccc'; }
  _tileIsOwnedView() { return true; }

  /* ----------------------------- geometry ------------------------------- */
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 280);
    this.canvas.width = size * this._dpr;
    this.canvas.height = size * this._dpr;
    this.S = size;
    this.C = size * 0.135;                       // corner size
    this.E = (size - 2 * this.C) / 9;            // edge tile length
    this.draw();
  }
  _tileRect(i) {
    const S = this.S, c = this.C, e = this.E;
    if (i === 0) return { x: S - c, y: S - c, w: c, h: c, edge: 'corner' };
    if (i >= 1 && i <= 9) return { x: S - c - i * e, y: S - c, w: e, h: c, edge: 'bottom' };
    if (i === 10) return { x: 0, y: S - c, w: c, h: c, edge: 'corner' };
    if (i >= 11 && i <= 19) { const j = i - 10; return { x: 0, y: S - c - j * e, w: c, h: e, edge: 'left' }; }
    if (i === 20) return { x: 0, y: 0, w: c, h: c, edge: 'corner' };
    if (i >= 21 && i <= 29) { const k = i - 20; return { x: c + (k - 1) * e, y: 0, w: e, h: c, edge: 'top' }; }
    if (i === 30) return { x: S - c, y: 0, w: c, h: c, edge: 'corner' };
    const k = i - 30; return { x: S - c, y: c + (k - 1) * e, w: c, h: e, edge: 'right' };
  }
  _tileCenter(i) { const r = this._tileRect(i); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  /* ----------------------------- animation ------------------------------ */
  _startWalk(seat, from, to) {
    const steps = (to - from + 40) % 40;
    const centers = [];
    if (steps >= 1 && steps <= 13) {
      for (let k = 1; k <= steps; k++) centers.push(this._tileCenter((from + k) % 40));
      this._walk[seat] = { centers, t0: now(), per: Math.min(150, 1100 / steps) };
    } else {
      // teleport / backward → straight glide
      this._walk[seat] = { centers: [this._tileCenter(to)], t0: now(), per: 480 };
    }
  }
  _ensureAnim() {
    if (this._raf) return;
    const step = () => {
      this._raf = null;
      const busy = this._tickAnim();
      this.draw();
      if (busy) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
  _tickAnim() {
    const t = now();
    let busy = false;
    // tokens
    for (let s = 0; s < (this.state?.numPlayers || 0); s++) {
      const w = this._walk[s];
      if (w) {
        const total = w.centers.length * w.per;
        const el = t - w.t0;
        if (el >= total) { const last = w.centers[w.centers.length - 1]; this._tok[s] = { x: last.x, y: last.y }; this._walk[s] = null; }
        else {
          const idx = Math.min(w.centers.length - 1, Math.floor(el / w.per));
          const localT = (el - idx * w.per) / w.per;
          const a = idx === 0 ? this._tok[s] : w.centers[idx - 1];
          const b = w.centers[idx];
          this._tok[s] = { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
          busy = true;
        }
      }
    }
    if (t < this._dice.until) busy = true;
    if (t < this._card.until) busy = true;
    this._flash = this._flash.filter((f) => t - f.t0 < 1400);
    if (this._flash.length) busy = true;
    return busy;
  }

  /* ------------------------------- render ------------------------------- */
  draw() {
    const ctx = this.ctx; if (!ctx || !this.S) return;
    const S = this.S;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const c = this.C;
    // backdrop — deep green gradient with a soft outer frame
    const bg = ctx.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, '#0e3322'); bg.addColorStop(1, '#082316');
    this._rr(0, 0, S, S, 16); ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,107,.18)'; ctx.lineWidth = 2;
    this._rr(3, 3, S - 6, S - 6, 14); ctx.stroke();
    // inner felt with a centre sheen and a vignette for depth
    const felt = ctx.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S * 0.62);
    felt.addColorStop(0, '#1b5235'); felt.addColorStop(1, '#123a26');
    ctx.fillStyle = felt; ctx.fillRect(c, c, S - 2 * c, S - 2 * c);
    const vig = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.6);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = vig; ctx.fillRect(c, c, S - 2 * c, S - 2 * c);

    this.tileRects = [];
    this.buttons = [];
    if (!this.state) { ctx.restore(); return; }

    for (let i = 0; i < 40; i++) this._drawTile(i);
    this._drawCenter();
    this._drawTokens();
    if (this.selTile >= 0) this._drawDeed();
    if (now() < this._card.until && this._card.card) this._drawCardPopup();
    if (this.state.winner != null || this.state.draw) this._drawWinner();
    ctx.restore();
  }

  _drawTile(i) {
    const ctx = this.ctx, t = BOARD[i], r = this._tileRect(i);
    this.tileRects.push({ i, ...r });
    // soft drop shadow under each tile for depth
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = Math.max(2, r.w * 0.06);
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
    // base — subtle parchment gradient
    const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grad.addColorStop(0, '#fbf8ef'); grad.addColorStop(1, '#ece6d3');
    ctx.fillStyle = grad;
    this._rr(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Math.min(r.w, r.h) * 0.06); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
    this._rr(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Math.min(r.w, r.h) * 0.06); ctx.stroke();

    if (r.edge === 'corner') { this._drawCorner(i, r); }
    else if (t.type === 'prop') {
      // colour band on the inner edge (with a soft gloss)
      const col = GROUP_COLOR[t.group];
      const bd = Math.min(r.w, r.h) * 0.26;
      ctx.fillStyle = col;
      let bx = r.x, by = r.y, bw = r.w, bh = bd;
      if (r.edge === 'bottom') { by = r.y; }
      else if (r.edge === 'top') { by = r.y + r.h - bd; }
      else if (r.edge === 'left') { bx = r.x + r.w - bd; bw = bd; bh = r.h; }
      else { bw = bd; bh = r.h; }
      ctx.fillRect(bx, by, bw, bh);
      const gloss = ctx.createLinearGradient(bx, by, bx, by + bh);
      gloss.addColorStop(0, 'rgba(255,255,255,.35)'); gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.75; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      this._tileLabel(r, t.name, `${fa(t.price)}`);
      this._drawHouses(i, r, bd);
    } else if (t.type === 'rail') {
      this._tileLabel(r, t.name, fa(200), '🚆');
    } else if (t.type === 'util') {
      this._tileLabel(r, t.name, fa(150), t.name.includes('برق') ? '💡' : '💧');
    } else if (t.type === 'tax') {
      this._tileLabel(r, t.name, fa(t.tax), '💰');
    } else if (t.type === 'chance') {
      this._tileLabel(r, 'شانس', '', '❓');
    } else if (t.type === 'chest') {
      this._tileLabel(r, 'صندوق', '', '🎁');
    }
    // ownership marker
    if (this.state.owner[i] >= 0) {
      const oc = this._seatColor(this.state.owner[i]);
      ctx.fillStyle = oc;
      const m = Math.min(r.w, r.h) * 0.18;
      ctx.beginPath(); ctx.arc(r.x + r.w - m * 0.7, r.y + r.h - m * 0.7, m * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // mortgage overlay
    if (this.state.mortgaged[i]) {
      ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#000';
      ctx.fillRect(r.x, r.y, r.w, r.h); ctx.restore();
      ctx.fillStyle = GOLD; ctx.font = `bold ${Math.min(r.w, r.h) * 0.3}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('رهن', r.x + r.w / 2, r.y + r.h / 2);
    }
    // highlight buildable/mortgageable tiles for the active player
    if (this._isMyTurn() && this._legalTilesSet().has(i)) {
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    }
  }

  _tileLabel(r, name, price, icon) {
    const ctx = this.ctx;
    const horiz = r.edge === 'bottom' || r.edge === 'top';
    const fs = Math.min(r.w, r.h) * (horiz ? 0.165 : 0.18);
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    if (r.edge === 'left') ctx.rotate(Math.PI / 2);
    if (r.edge === 'right') ctx.rotate(-Math.PI / 2);
    const w = horiz ? r.w : r.h;
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${fs}px sans-serif`;
    const short = name.length > 7 ? name : name;
    if (icon) { ctx.font = `${fs * 1.5}px serif`; ctx.fillText(icon, 0, -fs * 0.7); ctx.font = `600 ${fs}px sans-serif`; }
    ctx.fillText(this._fit(ctx, short, w * 0.92), 0, icon ? fs * 0.5 : -fs * 0.2);
    if (price) { ctx.fillStyle = '#3a6b3a'; ctx.font = `bold ${fs * 0.95}px sans-serif`; ctx.fillText(price, 0, icon ? fs * 1.6 : fs * 0.95); }
    ctx.restore();
  }
  _fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  _drawHouses(i, r, bd) {
    const ctx = this.ctx, h = this.state.houses[i];
    if (!h) return;
    const horiz = r.edge === 'bottom' || r.edge === 'top';
    const isHotel = h === 5;
    const n = isHotel ? 1 : h;
    const span = horiz ? r.w : r.h;
    const size = Math.min(bd * 0.5, span / (isHotel ? 3 : 5.5));
    for (let k = 0; k < n; k++) {
      let cx, cy;
      if (horiz) { cx = r.x + span * ((k + 1) / (n + 1)); cy = (r.edge === 'bottom' ? r.y + bd * 0.5 : r.y + r.h - bd * 0.5); }
      else { cy = r.y + span * ((k + 1) / (n + 1)); cx = (r.edge === 'left' ? r.x + r.w - bd * 0.5 : r.x + bd * 0.5); }
      if (isHotel) this._hotelIcon(ctx, cx, cy, size * 1.5);
      else this._houseIcon(ctx, cx, cy, size);
    }
  }
  _houseIcon(ctx, cx, cy, s) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = s * 0.3; ctx.shadowOffsetY = s * 0.12;
    ctx.fillStyle = '#2faa55'; this._rr(cx - s * 0.5, cy - s * 0.12, s, s * 0.62, s * 0.08); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1f7d3f';
    ctx.beginPath(); ctx.moveTo(cx - s * 0.62, cy - s * 0.1); ctx.lineTo(cx, cy - s * 0.66); ctx.lineTo(cx + s * 0.62, cy - s * 0.1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  _hotelIcon(ctx, cx, cy, s) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = s * 0.3; ctx.shadowOffsetY = s * 0.12;
    ctx.fillStyle = '#d63b3b'; this._rr(cx - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.15, s * 0.08); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#a82a2a'; this._rr(cx - s * 0.62, cy - s * 0.68, s * 1.24, s * 0.18, s * 0.05); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      ctx.fillRect(cx - s * 0.3 + col * s * 0.42 - s * 0.07, cy - s * 0.28 + row * s * 0.42 - s * 0.07, s * 0.2, s * 0.24);
    }
    ctx.restore();
  }

  _drawCorner(i, r) {
    const ctx = this.ctx, S = this.S;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const fs = r.w * 0.2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (i === 0) { // GO
      ctx.fillStyle = '#2faa55'; ctx.font = `${r.w * 0.36}px serif`; ctx.fillText('➜', cx, cy - fs * 0.3);
      ctx.fillStyle = INK; ctx.font = `bold ${fs}px sans-serif`; ctx.fillText('شروع', cx, cy + fs * 0.9);
      ctx.fillStyle = '#3a6b3a'; ctx.font = `bold ${fs * 0.8}px sans-serif`; ctx.fillText(`+${fa(200)}`, cx, cy + fs * 2);
    } else if (i === 10) { // jail
      ctx.font = `${r.w * 0.34}px serif`; ctx.fillText('🔒', cx, cy - fs * 0.3);
      ctx.fillStyle = INK; ctx.font = `bold ${fs}px sans-serif`; ctx.fillText('زندان', cx, cy + fs * 1.1);
    } else if (i === 20) { // free parking
      ctx.font = `${r.w * 0.34}px serif`; ctx.fillText('🅿️', cx, cy - fs * 0.4);
      ctx.fillStyle = INK; ctx.font = `bold ${fs * 0.92}px sans-serif`; ctx.fillText('پارکینگ', cx, cy + fs * 0.8);
      if (this.state.freeParkingJackpot) {
        ctx.fillStyle = '#2faa55'; ctx.font = `bold ${fs * 0.85}px sans-serif`;
        ctx.fillText(`💰 ${fa(this.state.pot || 0)}`, cx, cy + fs * 1.9);
      }
    } else if (i === 30) { // go to jail
      ctx.font = `${r.w * 0.34}px serif`; ctx.fillText('🚨', cx, cy - fs * 0.2);
      ctx.fillStyle = INK; ctx.font = `bold ${fs * 0.85}px sans-serif`; ctx.fillText('به زندان', cx, cy + fs * 1.2);
    }
  }

  _drawTokens() {
    const ctx = this.ctx, n = this.state.numPlayers;
    // group tokens by tile to spread overlap
    const perTile = {};
    for (let s = 0; s < n; s++) { if (this.state.eliminated[s]) continue; const p = Math.round(this._drawnPos[s]); (perTile[p] ||= []).push(s); }
    for (let s = 0; s < n; s++) {
      if (this.state.eliminated[s]) continue;
      const base = this._tok[s] || this._tileCenter(this.state.pos[s]);
      const group = perTile[Math.round(this._drawnPos[s])] || [s];
      const idx = group.indexOf(s);
      const off = (idx - (group.length - 1) / 2) * this.C * 0.28;
      const x = base.x + off, y = base.y + off * 0.4;
      this._token(ctx, s, x, y, this.C * 0.27);
    }
  }

  /** A glossy game token: beveled colour disc + a white vector piece. */
  _token(ctx, seat, x, y, r) {
    const color = this._seatColor(seat);
    const active = this.state.turn === seat;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.14;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, this._shade(color, 0.45)); g.addColorStop(1, this._shade(color, -0.28));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = active ? r * 0.16 : r * 0.09;
    ctx.strokeStyle = active ? GOLD : 'rgba(255,255,255,.92)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.stroke();
    // top sheen
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.ellipse(x, y - r * 0.42, r * 0.55, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    // vector piece
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(1, r * 0.05); ctx.lineJoin = 'round';
    this._tokenIcon(ctx, TOKEN_KINDS[seat] || 'hat', x, y, r * 0.6);
    ctx.restore();
  }
  _tokenIcon(ctx, kind, cx, cy, s) {
    const fillStroke = () => { ctx.fill(); ctx.stroke(); };
    if (kind === 'hat') {
      ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.55, s * 0.95, s * 0.22, 0, 0, Math.PI * 2); fillStroke();
      this._rr(cx - s * 0.5, cy - s * 0.72, s, s * 1.18, s * 0.12); fillStroke();
    } else if (kind === 'car') {
      this._rr(cx - s * 0.95, cy - s * 0.12, s * 1.9, s * 0.62, s * 0.2); fillStroke();
      this._rr(cx - s * 0.42, cy - s * 0.58, s * 0.9, s * 0.5, s * 0.16); fillStroke();
      ctx.beginPath(); ctx.arc(cx - s * 0.5, cy + s * 0.52, s * 0.27, 0, Math.PI * 2); fillStroke();
      ctx.beginPath(); ctx.arc(cx + s * 0.5, cy + s * 0.52, s * 0.27, 0, Math.PI * 2); fillStroke();
    } else if (kind === 'ship') {
      ctx.beginPath(); ctx.moveTo(cx - s * 0.9, cy + s * 0.32); ctx.lineTo(cx + s * 0.9, cy + s * 0.32);
      ctx.lineTo(cx + s * 0.55, cy + s * 0.78); ctx.lineTo(cx - s * 0.55, cy + s * 0.78); ctx.closePath(); fillStroke();
      ctx.fillRect(cx - s * 0.05, cy - s * 0.95, s * 0.1, s * 1.25);
      ctx.beginPath(); ctx.moveTo(cx + s * 0.12, cy - s * 0.9); ctx.lineTo(cx + s * 0.12, cy + s * 0.18); ctx.lineTo(cx + s * 0.82, cy + s * 0.18); ctx.closePath(); fillStroke();
    } else { // dog (Scottie silhouette)
      this._rr(cx - s * 0.85, cy - s * 0.12, s * 1.5, s * 0.72, s * 0.2); ctx.fill();
      this._rr(cx + s * 0.28, cy - s * 0.72, s * 0.6, s * 0.72, s * 0.14); ctx.fill();
      this._rr(cx + s * 0.68, cy - s * 0.46, s * 0.5, s * 0.32, s * 0.1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + s * 0.4, cy - s * 0.7); ctx.lineTo(cx + s * 0.56, cy - s * 1.08); ctx.lineTo(cx + s * 0.72, cy - s * 0.7); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - s * 0.85, cy - s * 0.1); ctx.lineTo(cx - s * 1.08, cy - s * 0.52); ctx.lineTo(cx - s * 0.62, cy - s * 0.32); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - s * 0.62, cy + s * 0.5, s * 0.22, s * 0.4);
      ctx.fillRect(cx + s * 0.32, cy + s * 0.5, s * 0.22, s * 0.4);
      ctx.stroke();
    }
  }
  /** Lighten (amt>0) or darken (amt<0) a hex colour; returns an rgb() string. */
  _shade(hex, amt) {
    const m = (hex || '#888888').replace('#', '');
    if (m.length < 6) return hex;
    let r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
    r = Math.max(0, Math.min(255, Math.round(r * f + add)));
    g = Math.max(0, Math.min(255, Math.round(g * f + add)));
    b = Math.max(0, Math.min(255, Math.round(b * f + add)));
    return `rgb(${r},${g},${b})`;
  }

  /* ------------------------------- centre ------------------------------- */
  _drawCenter() {
    const ctx = this.ctx, S = this.S, c = this.C;
    const x0 = c, y0 = c, w = S - 2 * c, h = S - 2 * c;
    const st = this.state;

    // centre logo with a soft glow and gold gradient
    ctx.save();
    ctx.translate(x0 + w / 2, y0 + h * 0.16);
    const fs = w * 0.092;
    ctx.font = `bold ${fs}px "Vazirmatn", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,215,107,.55)'; ctx.shadowBlur = fs * 0.5;
    const lg = ctx.createLinearGradient(0, -fs / 2, 0, fs / 2);
    lg.addColorStop(0, '#ffe89a'); lg.addColorStop(1, '#e8a93c');
    ctx.fillStyle = lg;
    ctx.fillText('مونوپولی', 0, 0);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120,80,10,.55)'; ctx.lineWidth = Math.max(1, fs * 0.02);
    ctx.strokeText('مونوپولی', 0, 0);
    ctx.restore();

    // money / players panel
    const panelY = y0 + h * 0.27;
    const rowH = Math.min(h * 0.085, w * 0.075);
    for (let s = 0; s < st.numPlayers; s++) {
      const ry = panelY + s * (rowH + 4);
      const active = s === st.turn && !st.winner;
      this._rr(x0 + w * 0.1, ry, w * 0.8, rowH, rowH * 0.28);
      ctx.fillStyle = active ? 'rgba(255,215,107,.16)' : 'rgba(0,0,0,.28)'; ctx.fill();
      if (active) { ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke(); }
      // token + name
      ctx.fillStyle = this._seatColor(s);
      ctx.beginPath(); ctx.arc(x0 + w * 0.16, ry + rowH / 2, rowH * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${rowH * 0.42}px sans-serif`;
      const meTag = s === this.mySeat ? ' (تو)' : '';
      const tags = (st.eliminated[s] ? ' ✖' : '') + (st.inJail[s] ? ' 🔒' : '') + (st.jailCards[s] ? ' 🎟️' : '');
      ctx.fillText(`${TOKENS[s] || ''} بازیکن ${fa(s + 1)}${meTag}${tags}`, x0 + w * 0.84, ry + rowH / 2);
      // money
      ctx.fillStyle = st.eliminated[s] ? 'rgba(255,255,255,.4)' : GOLD;
      ctx.textAlign = 'left'; ctx.font = `bold ${rowH * 0.46}px sans-serif`;
      ctx.fillText(`${fa(st.money[s])}`, x0 + w * 0.22, ry + rowH / 2);
      // money flash
      const fl = this._flash.find((f) => f.seat === s);
      if (fl) {
        const age = (now() - fl.t0) / 1400;
        ctx.globalAlpha = 1 - age; ctx.fillStyle = fl.amt > 0 ? '#5be08c' : '#ff7a7a';
        ctx.textAlign = 'left'; ctx.font = `bold ${rowH * 0.5}px sans-serif`;
        ctx.fillText(`${fl.amt > 0 ? '+' : ''}${fa(fl.amt)}`, x0 + w * 0.45, ry + rowH / 2 - age * rowH);
        ctx.globalAlpha = 1;
      }
    }

    // dice
    const diceY = panelY + st.numPlayers * (rowH + 4) + h * 0.04;
    if (st.dice) this._drawDice(x0 + w / 2, diceY, w * 0.1);

    // last event log line
    const logY = y0 + h * 0.74;
    const last = st.log && st.log[st.log.length - 1];
    if (last) {
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `${w * 0.038}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this._wrapText(last, x0 + w / 2, logY, w * 0.82, w * 0.05);
    }

    // action buttons
    this._drawActions(x0, y0 + h * 0.82, w, h * 0.16);
  }

  _drawDice(cx, cy, sz) {
    const ctx = this.ctx;
    const rolling = now() < this._dice.until;
    let a = this._dice.a, b = this._dice.b;
    if (rolling) { a = 1 + ((Math.floor(now() / 80) + 1) % 6); b = 1 + ((Math.floor(now() / 80) + 4) % 6); }
    this._die(cx - sz * 0.75, cy, sz, a);
    this._die(cx + sz * 0.75, cy, sz, b);
  }
  _die(cx, cy, sz, val) {
    const ctx = this.ctx, r = sz * 0.5;
    this._rr(cx - r, cy - r, sz, sz, sz * 0.18);
    ctx.fillStyle = '#fbfaf6'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    const pip = sz * 0.11;
    const pts = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    }[val] || [];
    ctx.fillStyle = INK;
    for (const [dx, dy] of pts) { ctx.beginPath(); ctx.arc(cx + dx * r * 0.5, cy + dy * r * 0.5, pip, 0, Math.PI * 2); ctx.fill(); }
  }

  _drawActions(x0, y, w, h) {
    const ctx = this.ctx, st = this.state;
    if (st.winner != null || st.draw) return;
    if (st.auction) { this._drawAuction(x0, y, w, h); return; }
    const mine = this._isMyTurn();
    const legal = mine ? (st.legal || []) : [];
    const has = (t) => legal.some((m) => m.type === t);
    const btns = [];
    if (!mine) {
      // spectator / waiting line
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${w * 0.04}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('در انتظار نوبت حریف…', x0 + w / 2, y + h / 2);
      return;
    }
    if (st.pending?.kind === 'debt') {
      ctx.fillStyle = '#ff9a9a'; ctx.font = `bold ${w * 0.04}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`بدهی ${fa(st.pending.amount)} — ملک بفروش/رهن بگذار`, x0 + w / 2, y - h * 0.18);
      if (has('pay')) btns.push({ id: 'pay', label: `پرداخت ${fa(st.pending.amount)}`, action: { type: 'pay' }, kind: 'good' });
      btns.push({ id: 'bankrupt', label: 'اعلام ورشکستگی', action: { type: 'bankrupt' }, kind: 'bad' });
    } else if (st.pending?.kind === 'buy') {
      const t = BOARD[st.pending.tile];
      if (has('buy')) btns.push({ id: 'buy', label: `بخر ${t.name} (${fa(t.price)})`, action: { type: 'buy' }, kind: 'good' });
      btns.push({ id: 'pass', label: 'بی‌خیال', action: { type: 'pass' }, kind: 'plain' });
    } else if (st.mustRoll) {
      if (st.inJail[this.mySeat]) {
        if (has('jailRoll')) btns.push({ id: 'jailRoll', label: 'تاس برای جفت', action: { type: 'jailRoll' }, kind: 'good' });
        if (has('jailPay')) btns.push({ id: 'jailPay', label: `پرداخت ${fa(50)}`, action: { type: 'jailPay' }, kind: 'plain' });
        if (has('jailCard')) btns.push({ id: 'jailCard', label: 'کارت آزادی 🎟️', action: { type: 'jailCard' }, kind: 'plain' });
      } else if (has('roll')) {
        btns.push({ id: 'roll', label: 'تاس بریز 🎲', action: { type: 'roll' }, kind: 'good' });
      }
    } else {
      if (has('endTurn')) btns.push({ id: 'endTurn', label: 'پایان نوبت', action: { type: 'endTurn' }, kind: 'good' });
    }
    // build hint
    if (this._legalTilesSet().size && !st.pending) {
      ctx.fillStyle = 'rgba(255,215,107,.85)'; ctx.font = `${w * 0.03}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('روی ملکِ نشان‌دار بزن تا بسازی/رهن کنی', x0 + w / 2, y - 2);
    }

    const bw = Math.min(w * 0.42, (w * 0.92) / Math.max(1, btns.length));
    const gap = w * 0.02;
    const totalW = btns.length * bw + (btns.length - 1) * gap;
    let bx = x0 + (w - totalW) / 2;
    const bh = h * 0.62, by = y + h * 0.18;
    for (const b of btns) {
      this._button(b.id, bx, by, bw, bh, b.label, b.kind, b.action);
      bx += bw + gap;
    }
  }
  _drawAuction(x0, y, w, h) {
    const ctx = this.ctx, st = this.state, a = st.auction, t = BOARD[a.tile];
    ctx.fillStyle = GOLD; ctx.font = `bold ${w * 0.05}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`🔨 حراجِ ${t.name}`, x0 + w / 2, y - h * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `${w * 0.038}px sans-serif`;
    const highTxt = a.bidder >= 0 ? `بالاترین پیشنهاد: ${fa(a.high)} — بازیکن ${fa(a.bidder + 1)}` : 'هنوز پیشنهادی نیست';
    ctx.fillText(highTxt, x0 + w / 2, y - h * 0.04);
    if (!this._isMyTurn()) {
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${w * 0.038}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`در انتظار پیشنهادِ بازیکن ${fa(st.turn + 1)}…`, x0 + w / 2, y + h * 0.55);
      return;
    }
    const cash = st.money[this.mySeat];
    const btns = [10, 50, 100].filter((inc) => a.high + inc <= cash)
      .map((inc) => ({ id: 'bid' + inc, label: `+${fa(inc)} (${fa(a.high + inc)})`, action: { type: 'bid', amount: a.high + inc }, kind: 'good' }));
    btns.push({ id: 'auctionPass', label: 'کنار می‌کشم', action: { type: 'auctionPass' }, kind: 'plain' });
    const gap = w * 0.015, bw = Math.min(w * 0.3, (w * 0.94 - (btns.length - 1) * gap) / btns.length);
    const totalW = btns.length * bw + (btns.length - 1) * gap;
    let bx = x0 + (w - totalW) / 2; const bh = h * 0.62, by = y + h * 0.2;
    for (const b of btns) { this._button(b.id, bx, by, bw, bh, b.label, b.kind, b.action); bx += bw + gap; }
  }
  _button(id, x, y, w, h, label, kind, action) {
    const ctx = this.ctx;
    this._rr(x, y, w, h, h * 0.26);
    const fill = kind === 'good' ? '#2faa55' : kind === 'bad' ? '#c8202e' : 'rgba(255,255,255,.14)';
    ctx.fillStyle = fill; ctx.fill();
    if (kind === 'plain') { ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${h * 0.34}px sans-serif`;
    ctx.fillText(this._fit(ctx, label, w * 0.92), x + w / 2, y + h / 2);
    this.buttons.push({ id, x, y, w, h, action, enabled: true });
  }

  /* --------------------------- deed (tile) panel ------------------------ */
  _drawDeed() {
    const ctx = this.ctx, S = this.S, i = this.selTile, t = BOARD[i], st = this.state;
    const w = S * 0.46, h = S * 0.5, x = (S - w) / 2, y = (S - h) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, S, S);
    this._rr(x, y, w, h, 12); ctx.fillStyle = '#1b2530'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke();
    // header band
    const col = t.type === 'prop' ? GROUP_COLOR[t.group] : '#3a4a5a';
    this._rr(x, y, w, h * 0.16, 12); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${w * 0.072}px sans-serif`;
    ctx.fillText(t.name || 'خانه', x + w / 2, y + h * 0.08);

    const lines = [];
    if (t.price) lines.push(`قیمت: ${fa(t.price)}`);
    if (st.owner[i] >= 0) lines.push(`مالک: بازیکن ${fa(st.owner[i] + 1)}${st.mortgaged[i] ? ' (رهن)' : ''}`);
    else if (t.price) lines.push('بدون مالک');
    if (t.type === 'prop') {
      lines.push(`خانه: ${fa(st.houses[i] === 5 ? 0 : st.houses[i])}${st.houses[i] === 5 ? ' + هتل' : ''}`);
      lines.push(`اجاره پایه: ${fa(t.rent[0])} • با هتل: ${fa(t.rent[5])}`);
      lines.push(`هزینه ساخت هر خانه: ${fa(t.house)}`);
    }
    if (t.mortgage) lines.push(`ارزش رهن: ${fa(t.mortgage)}`);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = `${w * 0.05}px sans-serif`;
    lines.forEach((ln, k) => ctx.fillText(ln, x + w * 0.9, y + h * 0.26 + k * h * 0.082));

    // contextual action buttons (only legal ones for me)
    const legal = this._isMyTurn() ? (st.legal || []) : [];
    const onTile = (type) => legal.some((m) => m.type === type && m.tile === i);
    const acts = [];
    if (onTile('build')) acts.push({ id: 'build', label: st.houses[i] === 4 ? `هتل (${fa(t.house)})` : `خانه (${fa(t.house)})`, action: { type: 'build', tile: i }, kind: 'good' });
    if (onTile('sell')) acts.push({ id: 'sell', label: `فروش بنا (+${fa(t.house / 2)})`, action: { type: 'sell', tile: i }, kind: 'plain' });
    if (onTile('mortgage')) acts.push({ id: 'mortgage', label: `رهن (+${fa(t.mortgage)})`, action: { type: 'mortgage', tile: i }, kind: 'plain' });
    if (onTile('unmortgage')) acts.push({ id: 'unmortgage', label: `آزادسازی (-${fa(Math.ceil(t.mortgage * 1.1))})`, action: { type: 'unmortgage', tile: i }, kind: 'plain' });

    const bw = w * 0.8, bh = h * 0.1, bx = x + w * 0.1;
    let by = y + h * 0.62;
    for (const a of acts) { this._button(a.id, bx, by, bw, bh, a.label, a.kind, a.action); by += bh + h * 0.02; }
    // close
    this._button('deedClose', x + w * 0.1, y + h * 0.88, w * 0.8, bh, 'بستن', 'plain', { type: '_close' });
    ctx.restore();
  }

  _drawCardPopup() {
    const ctx = this.ctx, S = this.S, card = this._card.card;
    const w = S * 0.5, h = S * 0.26, x = (S - w) / 2, y = S * 0.3;
    const age = 1 - (this._card.until - now()) / 2600;
    ctx.save();
    ctx.globalAlpha = age < 0.12 ? age / 0.12 : (age > 0.9 ? (1 - age) / 0.1 : 1);
    this._rr(x, y, w, h, 14);
    ctx.fillStyle = card.deck === 'chance' ? '#e8923c' : '#3d7fe0'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `bold ${w * 0.07}px sans-serif`;
    ctx.fillText(card.deck === 'chance' ? '❓ شانس' : '🎁 صندوق', x + w / 2, y + h * 0.1);
    ctx.font = `${w * 0.05}px sans-serif`;
    this._wrapText(card.text, x + w / 2, y + h * 0.55, w * 0.86, w * 0.066);
    ctx.restore();
  }

  _drawWinner() {
    const ctx = this.ctx, S = this.S, st = this.state;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, S, S);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = GOLD; ctx.font = `bold ${S * 0.07}px sans-serif`;
    if (st.draw) ctx.fillText('🤝 مساوی', S / 2, S / 2);
    else {
      const me = st.winner === this.mySeat;
      ctx.fillText(me ? '🏆 بردی!' : `🏆 برندهٔ بازی: بازیکن ${fa(st.winner + 1)}`, S / 2, S / 2);
    }
    ctx.restore();
  }

  /* ------------------------------- helpers ------------------------------ */
  _isMyTurn() { const st = this.state; return this.interactive && st && st.turn === this.mySeat && !st.winner && !st.draw && !this.state.eliminated[this.mySeat]; }
  _legalTilesSet() {
    const set = new Set();
    if (!this._isMyTurn()) return set;
    for (const m of (this.state.legal || [])) {
      if (['build', 'sell', 'mortgage', 'unmortgage'].includes(m.type) && typeof m.tile === 'number') set.add(m.tile);
    }
    return set;
  }
  _wrapText(text, cx, cy, maxW, lh) {
    const ctx = this.ctx;
    const words = String(text).split(' ');
    const lines = []; let line = '';
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = wd; }
      else line = test;
    }
    if (line) lines.push(line);
    const startY = cy - (lines.length - 1) * lh / 2;
    lines.forEach((ln, k) => ctx.fillText(ln, cx, startY + k * lh));
  }
  _rr(x, y, w, h, r) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ------------------------------- input -------------------------------- */
  _onClick(e) {
    if (!this.state) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // buttons first (top-most)
    for (let k = this.buttons.length - 1; k >= 0; k--) {
      const b = this.buttons[k];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        if (b.action?.type === '_close') { this.selTile = -1; this.draw(); return; }
        if (b.action) { this.selTile = -1; this.onAction?.(b.action); }
        return;
      }
    }
    // deed panel open → a click outside its buttons closes it
    if (this.selTile >= 0) { this.selTile = -1; this.draw(); return; }
    // otherwise: tap a tile to open its deed
    for (const r of this.tileRects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        const t = BOARD[r.i];
        if (['prop', 'rail', 'util'].includes(t.type)) { this.selTile = r.i; this.draw(); }
        return;
      }
    }
  }
}
