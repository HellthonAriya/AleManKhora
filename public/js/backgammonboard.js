/* =========================================================================
   اَلِ من خورا — Backgammon (تخته‌نرد) renderer.
   Fixed orientation (seat 0 home = bottom-right). On your turn you first TAP
   THE DICE to roll (they tumble, then settle), then tap one of your checkers to
   pick it up — every legal destination lights up clearly — and tap a glowing
   point or the bear-off tray. A checker can use both dice in turn: after the
   first hop, just tap it again to use the other die. Checkers slide when they
   move and hits fly to the bar. Emits { type:'move', from, to }.
   ========================================================================= */
import { BackgammonGame } from './backgammon.js';
import { tableTheme } from './boardthemes.js';

const FELT = '#16321f', FELT2 = '#0f2417', FRAME = '#5a3a1c', FRAME2 = '#73491f';
const POINT_A = '#d9b572', POINT_B = '#8a4f28', BAR = '#3a2614';
const GOLD = '#ffd76b', GREEN = '#56e08c', CYAN = '#46d6ff';
const SLIDE_MS = 300, FLY_MS = 400, DICE_MS = 620;

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
    this.targets = [];     // legal single-die to-values for the selection
    this.combos = [];      // combined two-dice landings { to, path:[m1,m2] }
    this._pendingSecond = null; // second leg of a combined move, fired next state

    // animation / roll state
    this._anim = null;          // { seat, from, to, t0 } checker slide
    this._hitAnim = null;       // { seat, to, t0 } a hit checker; t0 = when it STARTS flying out
    this._pendingBurst = null;  // { at, x, y, color, n } spark burst fired on arrival
    this._shockwaves = [];      // [ { x, y, t0, dur, color } ] expanding impact rings
    this._diceUntil = 0;        // tumbling-dice animation end timestamp
    this._diceSettleT = null;   // one-shot timer that guarantees the settle redraw
    this._rolledKey = null;     // turn identity for which we've already rolled
    this._curTurn = null;
    this._init = false;
    this._raf = null;
    this._lastTap = null;       // { from, t } for double-tap detection
    this._particles = [];       // sparkle bursts (hits / bear-offs)

    this._dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this._bind();
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    // Returning to a backgrounded tab pauses rAF mid-animation; redraw fresh.
    this._onVis = () => { if (document.visibilityState === 'visible') { this._anim = null; this._hitAnim = null; this._pendingBurst = null; this._shockwaves = []; this._ensureAnim(); this.draw(); } };
    document.addEventListener('visibilitychange', this._onVis);
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._diceSettleT) { clearTimeout(this._diceSettleT); this._diceSettleT = null; }
    if (this._passTimer) { clearTimeout(this._passTimer); this._passTimer = null; }
  }

  /** Begin the cosmetic dice tumble and GUARANTEE a settle redraw afterwards —
   *  a one-shot timer fixes the case where the rAF loop stops on a tumbling
   *  frame (which used to leave a stale/random face until the next tap). */
  _startDiceTumble() {
    this._diceUntil = now() + DICE_MS;
    if (this._diceSettleT) clearTimeout(this._diceSettleT);
    this._diceSettleT = setTimeout(() => { this._diceSettleT = null; this._ensureAnim(); this.draw(); }, DICE_MS + 40);
    this._ensureAnim();
    this.draw();
  }

  setConfig(config) { this.config = { ...this.config, ...config }; this.draw(); }
  setMySeat(seat) { this.mySeat = seat; this._clearSel(); this.draw(); }
  setInteractive(v) { this.interactive = v; this.canvas.style.cursor = v ? 'pointer' : 'default'; if (!v) this._clearSel(); this._ensureAnim(); this.draw(); }

  setState(state) {
    const prev = this.state;
    this.state = state;
    this._clearSel();
    if (this._passTimer) { clearTimeout(this._passTimer); this._passTimer = null; }

    // Detect & animate the move that produced this state. Always drop any
    // previous in-flight animation first so a resync can't leave one frozen.
    this._anim = null; this._hitAnim = null; this._pendingBurst = null; this._shockwaves = [];
    const mv = this._detectMove(prev, state);
    if (mv) {
      this._anim = { ...mv, t0: now() };
      const g = this._geo();
      if (mv.hit != null) {
        // Sequential hit: my checker slides (SLIDE_MS), then the burst + shockwave
        // fire at the moment of contact, then the opponent flies out (FLY_MS).
        this._hitAnim = { seat: mv.hitSeat, to: mv.to, t0: now() + SLIDE_MS };
        const s = this._slot(mv.to);
        const bx = s.x, by = s.y + (s.top ? g.ckR : -g.ckR);
        this._pendingBurst = { at: now() + SLIDE_MS, x: bx, y: by, color: '#ff5040', n: 30, shockwave: true };
      } else if (mv.to === 'off') {
        // Gold sparks when a checker is borne off (fires as it reaches the tray).
        const os = this._offSlot(mv.seat, g);
        this._pendingBurst = { at: now() + SLIDE_MS, x: os.x, y: os.y + (os.top ? g.ckR : -g.ckR), color: GOLD, n: 26, shockwave: true };
      }
    }

    // Roll gating: a fresh turn (no dice spent) by the opponent auto-tumbles;
    // on my own fresh turn I must tap the dice myself.
    const turnChanged = this._init && state.turn !== this._curTurn;
    if (this._init && turnChanged && state.turn !== this.mySeat && state.winner == null && countUsed(state) === 0) {
      this._startDiceTumble(); // opponent's roll tumbles into view (then settles)
    }
    this._curTurn = state.turn;
    this._init = true;

    // Fire the queued second leg of a combined (two-dice) move once the first
    // leg's state has landed.
    if (this._pendingSecond) {
      const ps = this._pendingSecond; this._pendingSecond = null;
      if (state.winner == null && state.turn === this.mySeat) {
        const eng = this._engine();
        const ok = eng && eng.legalMoves(this.mySeat).some((m) => m.from === ps.from && m.to === ps.to);
        if (ok) setTimeout(() => this.onAction?.({ type: 'move', from: ps.from, to: ps.to }), SLIDE_MS + 60);
      }
    }

    this._ensureAnim();
    this.draw();
  }
  _clearSel() { this.sel = null; this.targets = []; this.combos = []; }

  /** Two-dice combined landings for the selected source: where the SAME checker
   *  ends up after using both dice (e.g. 5+2 → 7 away), with both legs legal. */
  _computeCombos(from) {
    const base = this._engine();
    if (!base) return [];
    const out = new Map();
    const firsts = base.legalMoves(this.mySeat).filter((m) => m.from === from && m.to !== 'off');
    for (const m1 of firsts) {
      let g2; try { g2 = BackgammonGame.fromState(base.toState()); g2.apply(this.mySeat, { type: 'move', from: m1.from, to: m1.to }); } catch { continue; }
      if (g2.winner != null || g2.turn !== this.mySeat) continue; // turn ended after one die
      for (const m2 of g2.legalMoves(this.mySeat).filter((m) => m.from === m1.to)) {
        const key = String(m2.to);
        if (this.targets.includes(m2.to)) continue; // already a single-die target
        if (!out.has(key)) out.set(key, { to: m2.to, path: [{ from: m1.from, to: m1.to }, { from: m1.to, to: m2.to }] });
      }
    }
    return [...out.values()];
  }
  _seatColor(s) { return (this.config.colors && this.config.colors[s]) || ['#efe9dc', '#21242b'][s] || '#ccc'; }

  /** Do I still need to tap-to-roll on this turn? */
  _needRoll() {
    const st = this.state;
    if (!st || st.winner != null) return false;
    if (!this.interactive) return false;            // previews/spectators just show dice
    if (st.turn !== this.mySeat) return false;
    if (countUsed(st) > 0) return false;            // already moved → rolled
    return this._rolledKey !== this._turnKey(st);
  }
  _turnKey(st) { return `${st.turn}:${st.moveCount}`; }

  /** Expire finished animations. Called at the start of EVERY draw so the board
   *  converges to the correct settled state even if the rAF loop never runs
   *  (e.g. a frame was dropped while the tab was backgrounded). */
  _tickAnims() {
    const t = now();
    // Fire the arrival burst + optional shockwave exactly once at contact.
    if (this._pendingBurst && t >= this._pendingBurst.at) {
      const b = this._pendingBurst; this._pendingBurst = null;
      this._spawnBurst(b.x, b.y, b.color, b.n);
      if (b.shockwave) {
        this._shockwaves.push({ x: b.x, y: b.y, t0: t, dur: 380, color: b.color });
        this._shockwaves.push({ x: b.x, y: b.y, t0: t + 60, dur: 320, color: b.color }); // delayed 2nd ring
      }
    }
    this._shockwaves = this._shockwaves.filter((sw) => t - sw.t0 < sw.dur);
    if (this._anim && t - this._anim.t0 >= SLIDE_MS) this._anim = null;
    // _hitAnim.t0 is when it STARTS moving (after the slide); it ends FLY_MS later.
    if (this._hitAnim && t - this._hitAnim.t0 >= FLY_MS) this._hitAnim = null;
  }
  _animActive() {
    if (this._anim || this._hitAnim || this._pendingBurst || this._shockwaves.length) return true;
    if (this._particles.length) return true;
    if (now() < this._diceUntil) return true;
    if (this.interactive && (this.sel != null || this._needRoll())) return true; // pulse
    return false;
  }
  _ensureAnim() {
    // Always cancel any pending frame and reschedule — never trust a stale _raf
    // id (a backgrounded tab can leave one that never fires and would otherwise
    // block every future loop, freezing the board mid-animation).
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    const step = () => {
      this._raf = null;
      this.draw(); // draw() ticks/expires animations itself
      if (this._animActive()) this._raf = requestAnimationFrame(step);
    };
    if (this._animActive()) this._raf = requestAnimationFrame(step);
  }

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
  _slot(index) {
    const g = this._geo();
    const top = index >= 12;
    let posInRow;
    if (top) posInRow = index - 12;     // 12..23 → 0..11 left→right
    else posInRow = 11 - index;         // bottom: 11..0 → 0..11 left→right
    const half = posInRow < 6 ? 0 : 1;
    const col = posInRow % 6;
    const baseX = half === 0 ? g.leftX : g.rightX;
    const x = baseX + col * g.colW + g.colW / 2;
    const y = top ? g.topY : g.botY;
    return { x, y, top };
  }
  /** Vertical step between stacked checkers — compresses for tall stacks so a
   *  big column shows every checker (overlapping) instead of a number. */
  _stackStep(count, g) {
    const r = g.ckR;
    if (count <= 5) return 2 * r;
    const maxH = g.fieldH * 0.46;
    // Never wider than touching (2r): a tall stack overlaps, it must not spread.
    return Math.min(2 * r, Math.max(r * 0.5, (maxH - 2 * r) / (count - 1)));
  }
  /** Centre of the k-th checker (0 = nearest baseline) in a stack of `count`. */
  _checkerXY(slot, k, count, g) {
    const r = g.ckR;
    const step = this._stackStep(count, g);
    const cy = slot.top ? slot.y + r + k * step : slot.y - r - k * step;
    return { x: slot.x, y: cy };
  }
  _barSlot(seat, g) { return { x: g.barX + g.barW / 2, y: seat === 0 ? g.botY : g.topY, top: seat !== 0 }; }
  _offSlot(seat, g) { return { x: g.offX + g.offW / 2, y: seat === 0 ? g.botY : g.topY, top: seat !== 0 }; }

  /* ------------------------------ Pointer -------------------------------- */
  _bind() { this.canvas.addEventListener('pointerup', (e) => this._onClick(e)); }
  _pos(e) { const rect = this.canvas.getBoundingClientRect(); return { mx: e.clientX - rect.left, my: e.clientY - rect.top }; }
  _engine() { try { return BackgammonGame.fromState(this.state); } catch { return null; } }

  _hitRegion(mx, my) {
    const g = this._geo();
    if (mx >= g.offX) return { kind: 'off' };
    if (mx >= g.barX && mx < g.barX + g.barW) return { kind: 'bar' };
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
    // Roll first: any tap rolls the dice on my fresh turn.
    if (this._needRoll()) {
      this._rolledKey = this._turnKey(this.state);
      this._startDiceTumble();
      // If this roll has no playable move, show it for a beat then pass.
      const eng = this._engine();
      if (eng && eng.legalMoves(this.mySeat).length === 0) {
        clearTimeout(this._passTimer);
        this._passTimer = setTimeout(() => { this._passTimer = null; this.onAction?.({ type: 'pass' }); }, DICE_MS + 1300);
      }
      return;
    }
    if (now() < this._diceUntil) return; // ignore taps while dice tumble

    const { mx, my } = this._pos(e);
    const hit = this._hitRegion(mx, my);
    if (!hit) { this._clearSel(); this.draw(); return; }

    if (this.sel != null) {
      const want = hit.kind === 'off' ? 'off' : hit.kind === 'point' ? hit.index : null;
      if (want != null && this.targets.some((t) => t === want)) {
        const from = this.sel; this._clearSel();
        this.onAction?.({ type: 'move', from, to: want });
        return;
      }
      // Combined two-dice landing: play the first leg now, queue the second.
      const combo = want != null && this.combos.find((c) => c.to === want);
      if (combo) {
        this._clearSel();
        this._pendingSecond = combo.path[1];
        this.onAction?.({ type: 'move', from: combo.path[0].from, to: combo.path[0].to });
        return;
      }
    }
    // (re)select a source — this is what lets the same checker use the 2nd die.
    const eng = this._engine();
    if (!eng) { this._clearSel(); this.draw(); return; }
    const moves = eng.legalMoves(this.mySeat);
    let from = null;
    if (hit.kind === 'bar' && this.state.bar[this.mySeat] > 0) from = 'bar';
    else if (hit.kind === 'point') from = hit.index;
    const tos = moves.filter((mv) => mv.from === from).map((mv) => mv.to);
    if (from != null && tos.length) {
      // Double-tap (or tap an already-selected checker) that has exactly ONE
      // legal move → play it straight away.
      const dbl = this._lastTap && this._lastTap.from === from && (now() - this._lastTap.t) < 450;
      const already = this.sel === from;
      this._lastTap = { from, t: now() };
      if (tos.length === 1 && (dbl || already)) {
        this._clearSel();
        this.onAction?.({ type: 'move', from, to: tos[0] });
        return;
      }
      this.sel = from; this.targets = tos; this.combos = this._computeCombos(from);
    } else { this._clearSel(); this._lastTap = null; }
    this._ensureAnim();
    this.draw();
  }

  /* ------------------------------ Render --------------------------------- */
  draw() {
    const ctx = this.ctx; if (!ctx) return;
    this._tickAnims(); // self-heal: expire stale animations even without the loop
    const g = this._geo();
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, g.S, g.S);

    // Frame (wood) + felt (vertical gradient)
    const fr = ctx.createLinearGradient(0, 0, 0, g.S);
    fr.addColorStop(0, FRAME2); fr.addColorStop(1, FRAME);
    this._roundRect(0, 0, g.S, g.S, 16); ctx.fillStyle = fr; ctx.fill();
    const th = tableTheme(this.config.boardTheme);
    const fg = ctx.createLinearGradient(0, g.m, 0, g.m + g.fieldH);
    fg.addColorStop(0, th.felt); fg.addColorStop(0.5, th.edge); fg.addColorStop(1, th.felt);
    ctx.fillStyle = fg; ctx.fillRect(g.m, g.m, g.S - 2 * g.m, g.fieldH);
    // Bar + off tray
    ctx.fillStyle = BAR; ctx.fillRect(g.barX, g.m, g.barW, g.fieldH);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(g.offX, g.m, g.offW, g.fieldH);
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.strokeRect(g.offX, g.m, g.offW, g.fieldH);
    if (!this.state) { ctx.restore(); return; }
    const st = this.state;
    const triH = g.fieldH * 0.42;

    // Points (triangles) with a subtle vertical shade
    for (let i = 0; i < 24; i++) {
      const s = this._slot(i);
      const posInRow = i >= 12 ? i - 12 : 11 - i;
      const half = posInRow < 6 ? 0 : 1;
      const colParity = (posInRow % 6 + half) % 2;
      const tip = s.top ? s.y + triH : s.y - triH;
      const grad = ctx.createLinearGradient(0, s.y, 0, tip);
      const base = colParity === 0 ? POINT_A : POINT_B;
      grad.addColorStop(0, base); grad.addColorStop(1, shade(base, -0.28));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, tip);
      ctx.closePath(); ctx.fill();
    }

    // Borne-off checkers, shown as flat stacked slabs in the tray
    this._drawOff(ctx, g, st);

    // Bear-off target glow
    const pulse = 0.5 + 0.5 * Math.sin(now() / 240);
    for (const t of this.targets) {
      if (t === 'off') {
        ctx.save(); ctx.globalAlpha = 0.25 + 0.2 * pulse;
        ctx.fillStyle = GREEN; ctx.fillRect(g.offX, g.m, g.offW, g.fieldH);
        ctx.restore();
        ctx.strokeStyle = GREEN; ctx.lineWidth = 2.5; ctx.strokeRect(g.offX + 1.5, g.m + 1.5, g.offW - 3, g.fieldH - 3);
      }
    }
    // Selected source highlight
    if (this.sel != null && this.sel !== 'bar') this._highlightPoint(ctx, this._slot(this.sel), g, triH, GOLD, 0.32);
    if (this.sel === 'bar') { ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.strokeRect(g.barX + 2, g.m + 2, g.barW - 4, g.fieldH - 4); }

    // Checkers on points (omit one at the slide destination while animating)
    for (let i = 0; i < 24; i++) {
      const p = st.points[i];
      if (!p || !p.count) continue;
      let count = p.count;
      if (this._anim && this._anim.to === i) count -= 1; // the in-flight checker
      if (count > 0) this._stack(ctx, this._slot(i), p.seat, count, g, this.sel === i);
    }
    // Bar checkers — hide the one that's currently flying out (entering) or
    // flying in (just hit) so it isn't drawn twice.
    const barShown = (seat) => {
      let n = st.bar[seat] || 0;
      if (this._anim && this._anim.from === 'bar' && this._anim.seat === seat) n -= 1;
      if (this._hitAnim && this._hitAnim.seat === seat) n -= 1;
      return Math.max(0, n);
    };
    if (barShown(0)) this._stack(ctx, this._barSlot(0, g), 0, barShown(0), g, this.sel === 'bar' && this.mySeat === 0);
    if (barShown(1)) this._stack(ctx, this._barSlot(1, g), 1, barShown(1), g, this.sel === 'bar' && this.mySeat === 1);

    // Off tray
    this._offCount(ctx, g, 0, st.off[0]);
    this._offCount(ctx, g, 1, st.off[1]);

    // Combined two-dice landings (cyan) — drawn first so single-die green wins overlaps
    for (const c of this.combos) {
      if (c.to === 'off') {
        ctx.save(); ctx.globalAlpha = 0.18 + 0.14 * pulse; ctx.fillStyle = CYAN;
        ctx.fillRect(g.offX, g.m, g.offW, g.fieldH); ctx.restore();
        ctx.strokeStyle = CYAN; ctx.lineWidth = 2.5; ctx.strokeRect(g.offX + 1.5, g.m + 1.5, g.offW - 3, g.fieldH - 3);
      } else {
        this._landingMarker(ctx, this._slot(c.to), st, c.to, g, pulse, CYAN);
      }
    }
    // Legal single-die target landing markers
    for (const t of this.targets) {
      if (t === 'off') continue;
      this._landingMarker(ctx, this._slot(t), st, t, g, pulse, GREEN);
    }

    // Flying checkers (move + hit)
    this._drawAnims(ctx, g);
    // Sparkle particles
    this._drawParticles(ctx);

    // Dice / roll prompt
    this._dice(ctx, g, st);
    // Pip counts + turn chip
    this._hud(ctx, g, st);

    ctx.restore();
  }

  /** Borne-off checkers drawn as flat, glossy slabs stacked in the off tray —
   *  seat 0 builds up from the bottom, seat 1 down from the top — with a count. */
  _drawOff(ctx, g, st) {
    if (!st.off) return;
    const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
    const x = g.offX + g.offW * 0.12, w = g.offW * 0.76;
    const slabH = Math.max(3, g.ckR * 0.46);
    for (const seat of [0, 1]) {
      const n = st.off[seat] || 0;
      if (!n) continue;
      const top = seat === 1;
      const halfH = g.fieldH * 0.46;
      const step = Math.min(slabH * 1.12, (halfH - slabH) / Math.max(1, n));
      const color = this._seatColor(seat);
      for (let k = 0; k < n; k++) {
        const y = top ? g.m + 3 + k * step : g.m + g.fieldH - 3 - slabH - k * step;
        const grad = ctx.createLinearGradient(0, y, 0, y + slabH);
        grad.addColorStop(0, shade(color, 0.4)); grad.addColorStop(1, shade(color, -0.22));
        this._roundRect(x, y, w, slabH, slabH * 0.45); ctx.fillStyle = grad; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // count badge near the centre line, on the seat's side
      const by = top ? g.m + g.fieldH * 0.5 - g.ckR * 1.5 : g.m + g.fieldH * 0.5 + g.ckR * 1.5;
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${g.ckR * 1.05}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4;
      ctx.fillText(`${fa(n)}`, g.offX + g.offW / 2, by);
      ctx.restore();
    }
  }

  _highlightPoint(ctx, s, g, triH, color, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const tip = s.top ? s.y + triH : s.y - triH;
    ctx.beginPath(); ctx.moveTo(s.x - g.colW * 0.42, s.y); ctx.lineTo(s.x + g.colW * 0.42, s.y); ctx.lineTo(s.x, tip);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  /** A bright pulsing ring where a checker can land (clearly visible). */
  _landingMarker(ctx, slot, st, idx, g, pulse, color = GREEN) {
    const p = st.points[idx];
    const have = (p && p.seat === this.mySeat) ? p.count : 0;
    const xy = this._checkerXY(slot, have, have + 1, g); // where the new one lands
    const r = g.ckR * (0.82 + 0.12 * pulse);
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(xy.x, xy.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    ctx.globalAlpha = 0.2 + 0.1 * pulse; ctx.fillStyle = color; ctx.fill();
    // rotating dashed outer ring for extra flash
    ctx.globalAlpha = 0.9; ctx.shadowBlur = 0;
    ctx.setLineDash([4, 5]); ctx.lineDashOffset = -(now() / 60) % 100;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(xy.x, xy.y, r + g.ckR * 0.28, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  _drawAnims(ctx, g) {
    // Shockwave rings — drawn under everything so checkers appear on top.
    for (const sw of this._shockwaves) {
      const dt = now() - sw.t0;
      if (dt < 0 || dt >= sw.dur) continue;
      const t = dt / sw.dur;
      const r = g.ckR * (0.4 + 3.2 * t);   // expands from small to large
      const alpha = (1 - t) * (1 - t) * 0.9;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = sw.color; ctx.shadowBlur = 18 * (1 - t);
      ctx.strokeStyle = sw.color; ctx.lineWidth = 4 * (1 - t) + 0.5;
      ctx.beginPath(); ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Hit checker FIRST (so my landing checker draws on top of it).
    // It sits on its point while my checker slides, then gets "thrown" to the bar.
    if (this._hitAnim) {
      const slot = this._slot(this._hitAnim.to);
      const a = this._checkerXY(slot, 0, 1, g);
      const bs = this._barSlot(this._hitAnim.seat, g);
      const b = { x: bs.x, y: bs.top ? bs.y + g.ckR : bs.y - g.ckR };
      const dt = now() - this._hitAnim.t0;
      if (dt < 0) {
        this._checker(ctx, a.x, a.y, g.ckR, this._hitAnim.seat, false); // still waiting
      } else {
        // easeOutQuart: fast initial burst (feels thrown), then decelerates into bar
        const t = easeOutQuart(Math.min(1, dt / FLY_MS));
        // Slight parabolic arc: peak at halfway between a and b
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - g.ckR * 1.8; // arc upward
        // Quadratic bezier
        const bx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
        const by = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        // Slightly shrink and fade as it leaves (squished by the hit)
        const scale = 1 - 0.15 * t;
        this._checkerScaled(ctx, bx, by, g.ckR * scale, this._hitAnim.seat, false);
      }
    }

    // My sliding checker — easeOutBack gives a tiny bounce on landing (has weight).
    if (this._anim) {
      const raw = Math.min(1, (now() - this._anim.t0) / SLIDE_MS);
      const t = this._anim.hit ? easeOutBack(raw) : easeOut(raw);
      const from = this._anim.from === 'bar' ? this._barSlot(this._anim.seat, g) : this._slot(this._anim.from);
      const a = this._anim.from === 'bar' ? { x: from.x, y: from.top ? from.y + g.ckR : from.y - g.ckR } : this._checkerXY(from, 0, 1, g);
      let b;
      if (this._anim.to === 'off') { const os = this._offSlot(this._anim.seat, g); b = { x: os.x, y: os.y + (os.top ? g.ckR : -g.ckR) }; }
      else { const ds = this._slot(this._anim.to); const dp = this.state.points[this._anim.to]; const cnt = (dp && dp.seat === this._anim.seat) ? dp.count : 1; b = this._checkerXY(ds, cnt - 1, cnt, g); }
      this._checker(ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, g.ckR, this._anim.seat, true);
    }
  }
  _checkerScaled(ctx, cx, cy, r, seat, highlight) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r / Math.max(0.1, r), r / Math.max(0.1, r));
    ctx.translate(-cx, -cy);
    this._checker(ctx, cx, cy, r, seat, highlight);
    ctx.restore();
  }

  _stack(ctx, slot, seat, count, g, selected) {
    if (count <= 0) return;
    const r = g.ckR;
    // Draw every checker; tall stacks overlap (compressed step) — no number.
    for (let k = 0; k < count; k++) {
      const { x, y } = this._checkerXY(slot, k, count, g);
      this._checker(ctx, x, y, r, seat, selected && k === count - 1);
    }
  }
  _checker(ctx, cx, cy, r, seat, highlight) {
    const color = this._seatColor(seat);
    const dark = this._lum(color) < 0.5;
    // bevel via radial gradient
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grad.addColorStop(0, shade(color, 0.25)); grad.addColorStop(1, shade(color, -0.18));
    if (highlight) { ctx.save(); ctx.shadowColor = GOLD; ctx.shadowBlur = 16; }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.strokeStyle = highlight ? GOLD : (dark ? 'rgba(250,250,253,.55)' : 'rgba(20,20,24,.5)');
    ctx.stroke();
    if (highlight) ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; ctx.stroke();
  }
  _offCount(ctx, g, seat, count) {
    if (!count) return;
    const y = seat === 0 ? g.botY - g.ckR : g.topY + g.ckR;
    // little bars stacked
    ctx.fillStyle = this._seatColor(seat);
    ctx.font = `bold ${g.ckR * 1.0}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`✓${count}`, g.offX + g.offW / 2, y);
  }

  _dice(ctx, g, st) {
    const cy = g.S / 2;
    const sz = g.colW * 0.74, gap = sz * 0.4;
    const cxMid = (st.turn === 0 ? g.rightX + 3 * g.colW : g.leftX + 3 * g.colW);

    // My fresh turn, not yet rolled → show a clear tap-to-roll prompt.
    if (this._needRoll()) {
      const pulse = 0.5 + 0.5 * Math.sin(now() / 200);
      const w = sz * 2 + gap;
      const x0 = cxMid - w / 2, y0 = cy - sz / 2;
      ctx.save(); ctx.globalAlpha = 0.6 + 0.4 * pulse;
      for (let i = 0; i < 2; i++) {
        this._dieFace(ctx, x0 + i * (sz + gap), y0, sz, 0, true);
      }
      ctx.restore();
      ctx.fillStyle = GOLD; ctx.font = `bold ${sz * 0.42}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('🎲 بزن تا تاس بریزی', cxMid, y0 + sz + sz * 0.18);
      return;
    }

    const rolled = st.rolled || [];
    if (!rolled.length) return;

    // While tumbling, show just TWO dice with random faces; the real values
    // (and the 4-die spread for doubles) reveal together when they settle.
    if (now() < this._diceUntil) {
      const n = 2, w = n * sz + (n - 1) * gap;
      const x0 = cxMid - w / 2, y0 = cy - sz / 2;
      for (let i = 0; i < n; i++) this._dieFace(ctx, x0 + i * (sz + gap), y0, sz, 1 + Math.floor(Math.random() * 6), false, false);
      return;
    }

    const disp = diceDisplay(st);
    const w = disp.length * sz + (disp.length - 1) * gap;
    const x0 = cxMid - w / 2, y0 = cy - sz / 2;
    disp.forEach((entry, i) => {
      this._dieFace(ctx, x0 + i * (sz + gap), y0, sz, entry.d, false, entry.spent);
    });
  }
  _dieFace(ctx, x, y, sz, val, blank, spent) {
    ctx.save();
    if (spent) ctx.globalAlpha = 0.3;
    const grad = ctx.createLinearGradient(x, y, x, y + sz);
    grad.addColorStop(0, '#fdfcf7'); grad.addColorStop(1, '#e6e1d2');
    if (!spent && !blank) { ctx.shadowColor = 'rgba(255,235,170,.6)'; ctx.shadowBlur = 10; }
    this._roundRect(x, y, sz, sz, sz * 0.2); ctx.fillStyle = grad; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.lineWidth = 1.5; ctx.stroke();
    // glossy sheen
    ctx.globalAlpha = (spent ? 0.3 : 1) * 0.5;
    const sh = ctx.createLinearGradient(x, y, x, y + sz * 0.5);
    sh.addColorStop(0, 'rgba(255,255,255,.85)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    this._roundRect(x + sz * 0.12, y + sz * 0.08, sz * 0.76, sz * 0.4, sz * 0.14); ctx.fillStyle = sh; ctx.fill();
    ctx.globalAlpha = spent ? 0.3 : 1;
    if (!blank && val) this._pips(ctx, x, y, sz, val);
    ctx.restore();
  }
  _pips(ctx, x, y, sz, d) {
    ctx.fillStyle = '#1a1a1f';
    const o = sz * 0.26, mid = sz / 2, r = sz * 0.085;
    const P = { tl: [o, o], tr: [sz - o, o], ml: [o, mid], mr: [sz - o, mid], bl: [o, sz - o], br: [sz - o, sz - o], c: [mid, mid] };
    const map = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
    for (const key of (map[d] || [])) { const [px, py] = P[key]; ctx.beginPath(); ctx.arc(x + px, y + py, r, 0, Math.PI * 2); ctx.fill(); }
  }

  /** Pip counts for both players + a "your turn" chip. */
  _hud(ctx, g, st) {
    const pip = (seat) => {
      let total = st.bar[seat] * (seat === 0 ? 25 : 25);
      for (let i = 0; i < 24; i++) {
        const p = st.points[i];
        if (p && p.seat === seat) total += p.count * (seat === 0 ? i + 1 : 24 - i);
      }
      return total;
    };
    ctx.font = `${g.ckR * 0.8}px sans-serif`; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const mine = this.mySeat >= 0 ? this.mySeat : 0;
    // my pip bottom-left, opp pip top-left
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(`پیپ تو: ${pip(mine)}`, g.m + 4, g.botY - g.ckR * 0.7);
    ctx.fillText(`پیپ حریف: ${pip(1 - mine)}`, g.m + 4, g.topY + g.ckR * 0.7);
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

  /* ----------------------------- Particles ------------------------------- */
  _spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 3.8; // faster / more spread
      this._particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.0, life: 1, color, r: 2.5 + Math.random() * 3.5, t0: now() });
    }
    this._ensureAnim();
  }
  _drawParticles(ctx) {
    if (!this._particles.length) return;
    const dt = 16;
    const alive = [];
    for (const p of this._particles) {
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06; p.vy += 0.08; p.life -= 0.03;
      if (p.life > 0) {
        alive.push(p);
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.shadowColor = p.color; ctx.shadowBlur = 8;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    this._particles = alive;
  }

  /* --------------------------- Move detection ---------------------------- */
  _detectMove(prev, next) {
    if (!prev || !next) return null;
    const seat = prev.turn;
    const sc = (st, i) => { const p = st.points[i]; return p && p.seat === seat ? p.count : 0; };
    // Only animate a CLEAN single move: exactly one of the mover's checkers left
    // a slot and exactly one arrived. Anything else (a multi-move resync after
    // backgrounding/reconnecting) renders without animation, so a stale or bogus
    // slide never plays.
    let leaving = 0, arriving = 0, from = null, to = null;
    const barDec = Math.max(0, (prev.bar[seat] ?? 0) - (next.bar[seat] ?? 0));
    if (barDec) { leaving += barDec; from = 'bar'; }
    const offInc = Math.max(0, (next.off[seat] ?? 0) - (prev.off[seat] ?? 0));
    if (offInc) { arriving += offInc; to = 'off'; }
    for (let i = 0; i < 24; i++) {
      const d = sc(prev, i) - sc(next, i);
      if (d > 0) { leaving += d; if (from == null) from = i; }
      else if (d < 0) { arriving += -d; if (to == null) to = i; }
    }
    if (leaving !== 1 || arriving !== 1 || from == null || to == null) return null;
    const opp = seat === 0 ? 1 : 0;
    const hit = (next.bar[opp] ?? 0) > (prev.bar[opp] ?? 0) ? true : null;
    return { seat, from, to, hit, hitSeat: opp };
  }
}

/* The number of dice in the full roll (doubles play four times). */
function fullDiceCount(st) {
  const r = st.rolled || [];
  return (r.length === 2 && r[0] === r[1]) ? 4 : r.length;
}
/* How many of the originally-rolled dice have been consumed this turn. */
function countUsed(st) {
  return Math.max(0, fullDiceCount(st) - (st.dice ? st.dice.length : 0));
}
/* Per-die display list: { d, spent } with the actually-consumed faces greyed. */
function diceDisplay(st) {
  const r = st.rolled || [];
  const isDouble = r.length === 2 && r[0] === r[1];
  const full = isDouble ? [r[0], r[0], r[0], r[0]] : r.slice();
  const rem = (st.dice || []).slice();
  return full.map((d) => {
    const i = rem.indexOf(d);
    if (i >= 0) { rem.splice(i, 1); return { d, spent: false }; }
    return { d, spent: true };
  });
}
function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
// Slight overshoot ~5% past target, then snaps back — checker feels like it has weight.
function easeOutBack(t) {
  const c = 0.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}
function shade(hex, amt) {
  const m = (hex || '#888888').replace('#', ''); if (m.length < 6) return hex;
  let r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
