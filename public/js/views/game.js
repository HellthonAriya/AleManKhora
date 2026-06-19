/* اَلِ من خورا — In-game view (real-time room): Quoridor or Chess (2/4-player),
   chess clock, spectating, chat, invites, resign, draw offers, rematch, voice. */
import { h, store, toast, modal, faNum, clear, initials, confirmDialog, formatClock, copyText } from '../core.js';
import { BoardRenderer } from '../board.js';
import { ChessBoardRenderer } from '../chessboard.js';
import { GridRenderer } from '../gridboard.js';
import { DotsRenderer } from '../dotsboard.js';
import { BackgammonRenderer } from '../backgammonboard.js';
import { HokmRenderer } from '../hokmboard.js';
import { PasurRenderer } from '../pasurboard.js';
import { openRules } from '../rules.js';
import { VoiceChat } from '../voice.js';
import { getSocket, navigate } from '../app.js';

const SEAT_LABELS = ['۱', '۲', '۳', '۴'];
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_FA = { p: 'سرباز', n: 'اسب', b: 'فیل', r: 'رخ', q: 'وزیر', k: 'شاه' };
const TEAM_NAMES = ['تیم قرمز/زرد', 'تیم آبی/سبز'];

export function GameView(roomId) {
  const socket = getSocket();
  let seat = -1;
  let spectator = false;
  let state = null;
  let config = null;
  let players = [];
  let numPlayers = 2;
  let aiSeats = [];
  let status = 'waiting';
  let code = null;
  let gameType = 'quoridor';
  let isChess = false;
  let rematchPending = false; // true after we vote for a rematch, until it starts
  let overModalHandle = null; // handle to the open game-over popup, if any

  // local clock model
  let clock = { enabled: false, remaining: [], turn: 0, running: false, incMs: 0, limitMs: 0 };
  let clockLocalStart = 0;
  let clockTimer = null;

  const canvas = h('canvas', { id: 'board' });
  const turnBanner = h('div', { class: 'turn-banner' }, 'در حال اتصال…');
  const playerCardsMount = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const controlsMount = h('div', {});
  const chatLog = h('div', { class: 'chat-log' });
  const sideTop = h('div', { class: 'game-side' });
  const sideBottom = h('div', { class: 'game-side' });
  const clockEls = {};

  let renderer = null;

  /** Build the renderer lazily once the game type is known (after join). */
  function ensureRenderer() {
    if (renderer) return;
    if (isChess) {
      renderer = new ChessBoardRenderer(canvas, {
        onMove: (from, to, promo) => act({ type: 'move', from, to, promo }),
      });
    } else if (gameType === 'quoridor') {
      renderer = new BoardRenderer(canvas, {
        onMove: (r, c) => act({ type: 'move', r, c }),
        onWall: (r, c, o) => act({ type: 'wall', r, c, o }),
      });
    } else if (gameType === 'dots') {
      renderer = new DotsRenderer(canvas, { onAction: act });
    } else if (gameType === 'backgammon') {
      renderer = new BackgammonRenderer(canvas, { onAction: act });
    } else if (gameType === 'hokm') {
      renderer = new HokmRenderer(canvas, { onAction: act });
    } else if (gameType === 'pasur') {
      renderer = new PasurRenderer(canvas, { onAction: act });
    } else {
      // دوز / گوموکو / اوتلو — shared grid renderer (dispatches on state.gameType)
      renderer = new GridRenderer(canvas, { onAction: act });
    }
    if (gameType !== 'quoridor') wallTray.style.display = 'none';
    requestAnimationFrame(() => renderer._resize?.());
  }

  /* ========================= Wall drag tray (Quoridor only) ============= */
  const wallTray = h('div', { class: 'wall-tray inactive' });
  const wallTrayGrip = h('div', { class: 'wall-tray-grip', title: 'برای جابجایی بکش' });
  const wallTrayRow = h('div', { class: 'wall-tray-row' });

  function makeDragPiece(o) {
    const barCls = o === 'h' ? 'wall-piece-bar-h' : 'wall-piece-bar-v';
    const label = o === 'h' ? 'افقی' : 'عمودی';
    const piece = h('div', { class: 'wall-piece' }, h('div', { class: barCls }), label);
    piece.addEventListener('pointerdown', (e) => startWallDrag(e, o));
    return piece;
  }
  wallTrayRow.append(makeDragPiece('h'), makeDragPiece('v'));
  wallTray.append(wallTrayGrip, wallTrayRow);

  let trayDrag = null;
  wallTrayGrip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = wallTray.getBoundingClientRect();
    trayDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    wallTray.classList.add('placed');
    wallTrayGrip.setPointerCapture?.(e.pointerId);
    document.addEventListener('pointermove', onTrayMove);
    document.addEventListener('pointerup', onTrayUp, { once: true });
  });
  function onTrayMove(e) {
    if (!trayDrag) return;
    const w = wallTray.offsetWidth, hgt = wallTray.offsetHeight;
    let left = Math.max(6, Math.min(e.clientX - trayDrag.dx, window.innerWidth - w - 6));
    let top = Math.max(6, Math.min(e.clientY - trayDrag.dy, window.innerHeight - hgt - 6));
    wallTray.style.left = left + 'px';
    wallTray.style.top = top + 'px';
    wallTray.style.bottom = 'auto';
  }
  function onTrayUp() { trayDrag = null; document.removeEventListener('pointermove', onTrayMove); }

  let dragGhost = null;
  let dragO = null;
  function startWallDrag(e, o) {
    if (gameType !== 'quoridor' || !isMyTurnActive() || !state || state.wallsLeft[seat] <= 0) return;
    e.preventDefault();
    dragO = o;
    renderer.setMode('wall');
    const barCls = o === 'h' ? 'wall-piece-bar-h' : 'wall-piece-bar-v';
    dragGhost = h('div', { class: 'drag-ghost' }, h('div', { class: barCls }));
    document.body.appendChild(dragGhost);
    moveDragGhost(e.clientX, e.clientY);
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd, { once: true });
  }
  function moveDragGhost(cx, cy) { if (dragGhost) { dragGhost.style.left = cx + 'px'; dragGhost.style.top = cy + 'px'; } }
  function canvasRelative(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { mx: clientX - rect.left, my: clientY - rect.top, inCanvas: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom };
  }
  function onDragMove(e) {
    moveDragGhost(e.clientX, e.clientY);
    const { mx, my, inCanvas } = canvasRelative(e.clientX, e.clientY);
    if (inCanvas) renderer.previewDraggedWall(mx, my, dragO);
    else renderer.clearWallPreview();
  }
  function onDragEnd(e) {
    document.removeEventListener('pointermove', onDragMove);
    const { mx, my, inCanvas } = canvasRelative(e.clientX, e.clientY);
    if (inCanvas) {
      const w = renderer.getWallAtPos(mx, my, dragO);
      if (w) act({ type: 'wall', r: w.r, c: w.c, o: dragO });
    }
    dragGhost?.remove(); dragGhost = null; dragO = null;
    renderer.setMode('move');
    renderer.clearWallPreview();
  }
  function updateWallTray() {
    if (gameType !== 'quoridor') { wallTray.classList.add('inactive'); return; }
    const active = isMyTurnActive() && state?.wallsLeft[seat] > 0;
    wallTray.classList.toggle('inactive', !active);
  }

  function isMyTurnActive() {
    if (spectator || status !== 'active' || !state) return false;
    return !gameIsOver() && state.turn === seat && !state.eliminated?.[seat];
  }

  /* ========================= Voice chat ========================= */
  const voice = new VoiceChat(socket);
  const voiceMount = h('div', {});
  voice.onUpdate = (event) => { if (event === 'denied') toast('درخواست صدا رد شد', 'error'); renderVoicePanel(); };
  voice.onSpectatorRequest = ({ socketId, name }) => {
    if (!voice.active || seat < 0) return;
    modal({
      title: '🎙 درخواست ویس چت',
      body: h('p', { class: 'muted' }, `«${name}» (تماشاگر) می‌خواهد به صدا ملحق شود.`),
      actions: [
        { label: 'رد کردن', class: 'btn-ghost', onClick: () => { voice.voteSpectator(socketId, false); } },
        { label: 'پذیرفتن', class: 'btn-primary', onClick: () => { voice.voteSpectator(socketId, true); } },
      ],
    });
  };

  function renderVoicePanel() {
    clear(voiceMount);
    const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, '🎙 صدا'));
    const panel = h('div', { class: 'voice-panel' });
    if (voice.active) {
      panel.append(h('div', { class: 'voice-participant' },
        h('div', { class: `vc-dot ${voice.muted ? 'muted' : 'on'}` }),
        h('div', { class: 'vc-name' }, (store.me?.username || 'من') + ' (تو)'),
        h('button', { class: 'btn btn-sm', onclick: () => { voice.toggleMute(); } }, voice.muted ? '🔇 آنمیوت' : '🎙 میوت')));
      for (const [, p] of voice.participants) {
        panel.append(h('div', { class: 'voice-participant' }, h('div', { class: 'vc-dot on' }), h('div', { class: 'vc-name' }, p.name)));
      }
      card.append(panel, h('button', { class: 'btn btn-sm btn-danger btn-block', style: 'margin-top:12px',
        onclick: () => { voice.leave(); renderVoicePanel(); } }, '📵 خروج از صدا'));
    } else {
      const joinBtn = h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:0',
        onclick: async () => { joinBtn.disabled = true; try { await voice.join(); } catch { toast('دسترسی به میکروفون رد شد', 'error'); } joinBtn.disabled = false; } }, '🎙 ورود به صدا');
      if (spectator) {
        card.append(h('p', { class: 'faint', style: 'margin-bottom:8px' }, 'درخواست پیوستن به ویس چت:'),
          h('button', { class: 'btn btn-sm btn-block', onclick: () => { voice.requestSpectatorAccess(); toast('درخواست فرستاده شد…'); } }, '🙋 درخواست صدا'));
      } else card.append(joinBtn);
    }
    voiceMount.append(card);
  }

  /* ========================= Core rendering ========================= */
  function act(action) {
    socket.emit('game:action', { action }, (res) => { if (!res?.ok) toast(res?.error || 'حرکت نامعتبر', 'error'); });
  }
  function seatColor(s) {
    if (config?.colors && config.colors[s]) return config.colors[s];
    return (isChess ? ['#f3f1ea', '#2b2b30', '#e8b730', '#3bb15f'] : ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff'])[s];
  }

  function syncRenderer() {
    if (!state) return;
    ensureRenderer();
    if (isChess) renderer.setConfig({ boardTheme: config.boardTheme, colors: config.colors });
    else if (gameType === 'quoridor') renderer.setConfig({ theme: config.theme, colors: config.colors || [config.p0Color, config.p1Color, '#ffd36b', '#9b8cff'] });
    else renderer.setConfig({ colors: config.colors || [config.p0Color, config.p1Color] });
    renderer.setMySeat(seat);
    renderer.setState(state);
    const myTurn = isMyTurnActive();
    renderer.setInteractive(myTurn);
    updateBanner(myTurn);
    renderPlayerCards();
    renderControls();
    updateWallTray();
  }

  function gameIsOver() {
    if (isChess) return !!state?.gameOver;
    return (state?.winner !== null && state?.winner !== undefined) || !!state?.draw;
  }

  function updateBanner(myTurn) {
    clear(turnBanner);
    if (rematchPending && status === 'finished') {
      turnBanner.append(h('span', { class: 'spinner spinner-sm' }), ' 🔄 در انتظار شروع بازی مجدد…');
      return;
    }
    if (status === 'waiting') { turnBanner.append('⏳ در انتظار حریف…'); return; }
    if (gameIsOver()) {
      if (state.draw) { turnBanner.append('🤝 بازی مساوی شد'); return; }
      const w = state.winner;
      if (w === null || w === undefined) { turnBanner.append('پایان بازی'); return; }
      const wname = isChess && config.teams ? TEAM_NAMES[w % 2] : (players[w]?.name || `بازیکن ${SEAT_LABELS[w]}`);
      turnBanner.append(h('span', { class: 'dot', style: `color:${seatColor(w)}` }), `🏆 ${wname} برنده شد`);
      return;
    }
    if (gameType === 'hokm' && state.phase === 'choose-trump') {
      const hk = players[state.hakem]?.name || `بازیکن ${SEAT_LABELS[state.hakem]}`;
      turnBanner.append(h('span', { class: 'dot', style: `color:${seatColor(state.hakem)}` }),
        state.hakem === seat ? '✦ حکم را انتخاب کن' : `${hk} در حال انتخاب حکم…`);
      return;
    }
    const inChk = isChess && state.inCheck?.[state.turn];
    const turnName = players[state.turn]?.name || `بازیکن ${SEAT_LABELS[state.turn]}`;
    // Note: native Element.append() turns a null argument into the text "null",
    // so only append the check badge when it actually applies.
    turnBanner.append(
      h('span', { class: 'dot', style: `color:${seatColor(state.turn)}` }),
      myTurn ? '✦ نوبت توست' : `نوبت ${turnName}`,
    );
    if (inChk) turnBanner.append(h('span', { class: 'check-badge' }, ' کیش!'));
  }

  function chessMaterial(s) {
    let v = 0;
    if (!state?.board) return 0;
    for (const p of state.board) if (p && p.seat === s) v += PIECE_VALUE[p.t] || 0;
    return v;
  }

  /** Per-seat status line for the simple board games. */
  function simpleDetail(s) {
    const wrap = (txt) => h('div', {}, h('div', { class: 'pc-walls' }, txt));
    switch (gameType) {
      case 'othello': return wrap(`⬤ ${faNum(state.scores?.[s] ?? 0)} مهره`);
      case 'dots': return wrap(`▦ ${faNum(state.scores?.[s] ?? 0)} خانه`);
      case 'backgammon': return wrap(`✓ ${faNum(state.off?.[s] ?? 0)} از ۱۵`);
      case 'tictactoe': return wrap(s === 0 ? '✕' : '◯');
      case 'gomoku': return wrap(s === 0 ? '● سیاه' : '○ سفید');
      case 'hokm': {
        const tricks = state.tricksWon?.[s] ?? 0;
        const isHakem = state.hakem === s;
        return h('div', {},
          h('div', { class: 'pc-walls' }, `🃏 ${faNum(tricks)} دست` + (isHakem ? ' · حاکم' : '')),
          state.teams ? h('span', { class: 'faint' }, s % 2 === 0 ? 'تیم ۱' : 'تیم ۲') : null);
      }
      case 'pasur': {
        const cards = state.capturedCounts?.[s] ?? 0;
        const clubs = state.clubCounts?.[s] ?? 0;
        const surs = state.surs?.[s] ?? 0;
        const pts = state.scores?.[s];
        return h('div', {},
          h('div', { class: 'pc-walls' }, `🃏 ${faNum(cards)} برگ · ♣ ${faNum(clubs)} · سور ${faNum(surs)}`),
          pts != null ? h('span', { class: 'faint' }, `${faNum(pts)} امتیاز`) : null);
      }
      default: return h('div', {});
    }
  }

  /** One-line how-to-play hint shown in the turn-control card. */
  function hintFor() {
    switch (gameType) {
      case 'chess': case 'chess4': return 'مهرهٔ خود را انتخاب کن و روی خانهٔ مقصد بزن.';
      case 'quoridor': return '🚶 روی نقطه کلیک کن تا حرکت کنی.\n🧱 دیوار را از پایین صفحه به روی تخته بکش.';
      case 'tictactoe': return 'روی یک خانهٔ خالی بزن تا علامتت را بگذاری. سه‌تا در یک خط ببر.';
      case 'gomoku': return 'روی تقاطع خالی بزن تا مهره بگذاری. اولین نفری که پنج‌تا در یک خط کند می‌برد.';
      case 'othello': return 'روی خانه‌های نشان‌دار بزن تا مهرهٔ حریف را بین مهره‌هایت بگیری و برگردانی.';
      case 'dots': return 'روی خط بین دو نقطه بزن. هر مربعی که کامل کنی مال توست و دوباره نوبت توست.';
      case 'backgammon': return 'اول روی مهرهٔ خودت بزن، بعد روی خانهٔ مقصدِ نشان‌دار. تاس‌ها خودکار ریخته می‌شوند.';
      case 'hokm': return 'اگر حاکمی، اول حکم (خال برنده) را انتخاب کن. بعد به نوبت، یک ورق بازی کن؛ اگر خالِ زمین را داری باید همان را بازی کنی.';
      case 'pasur': return 'یک کارت از دستت را بزن تا انتخاب شود. با کارت عددی، برگ‌هایی از میز را بردار که مجموعشان با کارتت ۱۱ شود. سرباز همهٔ میز را جمع می‌کند.';
      default: return '';
    }
  }

  function renderPlayerCards() {
    clear(playerCardsMount);
    for (const k of Object.keys(clockEls)) delete clockEls[k];
    for (let s = 0; s < numPlayers; s++) {
      const p = players[s];
      const isEliminated = state.eliminated?.[s];
      const isTurn = status === 'active' && !gameIsOver() && state.turn === s && !isEliminated;
      const inChk = isChess && state.inCheck?.[s];

      let clockEl = null;
      if (clock.enabled) {
        clockEl = h('div', { class: 'clock' + (isTurn ? ' active' : '') + (isEliminated ? ' flagged' : '') },
          formatClock(clock.remaining[s] ?? clock.limitMs));
        clockEls[s] = clockEl;
      }

      let detail;
      if (isChess) {
        const mat = chessMaterial(s);
        detail = h('div', {},
          h('div', { class: 'pc-walls' }, `♟ ارزش: ${faNum(mat)}`),
          inChk ? h('span', { class: 'badge badge-check' }, 'کیش') : null,
          config.teams ? h('span', { class: 'faint', style: 'margin-inline-start:6px' }, TEAM_NAMES[s % 2]) : null,
        );
      } else if (gameType === 'quoridor') {
        const wallsLeft = state.wallsLeft[s];
        const dots = h('div', { class: 'walls-dots' });
        for (let i = 0; i < state.wallsEach; i++) dots.append(h('i', { class: i < wallsLeft ? '' : 'used' }));
        detail = h('div', {}, h('div', { class: 'pc-walls' }, `🧱 ${faNum(wallsLeft)} دیوار`), dots);
      } else {
        detail = simpleDetail(s);
      }

      playerCardsMount.append(h('div', { class: 'player-card' + (isTurn ? ' turn' : '') + (isEliminated ? ' eliminated' : '') },
        h('div', { class: 'pc-avatar', style: `background:${seatColor(s)}` }, p ? initials(p.name) : SEAT_LABELS[s]),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'pc-name' }, p ? p.name : `بازیکن ${SEAT_LABELS[s]}`,
            s === seat ? h('span', { class: 'faint' }, ' (تو)') : null,
            p && p.connected === false && !p.isAI ? h('span', { class: 'badge badge-ban', style: 'margin-inline-start:6px' }, 'قطع') : null),
          detail,
        ),
        clockEl,
      ));
    }
    paintClocks();
  }

  function renderControls() {
    clear(controlsMount);
    if (spectator) {
      controlsMount.append(h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '👁 حالت تماشاگر'),
        h('p', { class: 'card-sub', style: 'margin:0' }, 'تو در حال تماشای زندهٔ این بازی هستی.'),
        h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:12px', onclick: () => navigate('/lobby') }, 'بازگشت به سالن')));
      return;
    }
    if (status === 'waiting') {
      const inviteBox = code ? h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '🔗 دعوت دوست'),
        h('p', { class: 'card-sub' }, numPlayers === 4 ? 'این کد را برای ۳ نفر دیگر بفرست:' : 'این کد یا لینک را برای حریفت بفرست:'),
        h('div', { class: 'invite-box' },
          h('span', { class: 'invite-code' }, code),
          h('button', { class: 'btn btn-sm', onclick: copyCode }, 'کپی کد')),
        h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:10px', onclick: copyLink }, '📋 کپی لینک دعوت'),
        h('p', { class: 'faint', style: 'margin-top:10px' }, `${faNum(players.filter(Boolean).length)} از ${faNum(numPlayers)} بازیکن آماده`),
      ) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'در انتظار حریف…'));
      controlsMount.append(inviteBox);
      return;
    }
    if (status === 'active') {
      const card = h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'کنترل نوبت'),
        h('p', { class: 'hint-line', style: 'margin-bottom:10px' }, hintFor()),
      );
      if (gameType === 'quoridor' && state.wallsLeft[seat] <= 0) card.append(h('p', { class: 'faint' }, 'دیوارهایت تمام شده است.'));
      if (isChess && numPlayers === 2) {
        card.append(h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:6px', onclick: offerDraw }, '🤝 پیشنهاد مساوی'));
      }
      card.append(h('button', { class: 'btn btn-danger btn-sm btn-block', style: 'margin-top:10px', onclick: doResign }, '🏳 تسلیم'));
      controlsMount.append(card);
    }
  }

  /* ========================= Chess clock ========================= */
  function setClock(cv) {
    if (!cv) return;
    clock = { enabled: cv.enabled, remaining: [...(cv.remaining || [])], turn: cv.turn, running: cv.running, incMs: cv.incMs || 0, limitMs: cv.limitMs || 0 };
    clockLocalStart = performance.now();
    paintClocks();
  }
  function effectiveRemaining(s) {
    let ms = clock.remaining[s] ?? clock.limitMs;
    if (clock.running && s === clock.turn && status === 'active') ms -= (performance.now() - clockLocalStart);
    return Math.max(0, ms);
  }
  function paintClocks() {
    if (!clock.enabled) return;
    for (const s of Object.keys(clockEls)) {
      const seatNum = +s; const el = clockEls[s]; if (!el) continue;
      const ms = effectiveRemaining(seatNum);
      el.textContent = formatClock(ms);
      el.classList.toggle('low', ms <= 15000 && clock.running && seatNum === clock.turn);
    }
  }
  clockTimer = setInterval(paintClocks, 250);

  /* ========================= Actions ========================= */
  async function copyCode() {
    const ok = await copyText(code);
    toast(ok ? 'کد کپی شد' : 'کپی نشد — دستی انتخاب کن', ok ? 'success' : 'error');
  }
  async function copyLink() {
    const ok = await copyText(`${location.origin}/#/game/${roomId}`);
    toast(ok ? 'لینک دعوت کپی شد' : 'کپی نشد — دستی انتخاب کن', ok ? 'success' : 'error');
  }
  async function doResign() {
    if (await confirmDialog('تسلیم شدن', 'مطمئنی می‌خواهی تسلیم شوی؟', { danger: true, confirmLabel: 'تسلیم' })) socket.emit('game:resign');
  }
  function offerDraw() {
    socket.emit('game:drawOffer', () => {});
    toast('پیشنهاد مساوی فرستاده شد');
  }

  /* ========================= Chat ========================= */
  function addChat({ from, text, seat: fromSeat }) {
    chatLog.append(h('div', { class: 'chat-msg' + (fromSeat === seat ? ' me' : '') }, h('span', { class: 'who' }, from), text));
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  const chatInput = h('input', { class: 'input', placeholder: 'پیام…', maxlength: 240, onkeydown: (e) => { if (e.key === 'Enter') sendChat(); } });
  function sendChat() {
    const text = chatInput.value.trim(); if (!text) return;
    socket.emit('chat:message', { text }); chatInput.value = '';
  }

  /* ========================= Socket events ========================= */
  function applyView(v) {
    config = v.config; state = v.state; players = v.players;
    numPlayers = v.numPlayers || v.players?.length || 2;
    aiSeats = v.aiSeats || []; status = v.status; code = v.code;
    gameType = v.gameType || config?.gameType || 'quoridor';
    isChess = gameType === 'chess' || gameType === 'chess4' || gameType === 'chesszade';
    if (v.clock) setClock(v.clock);
    syncRenderer();
  }

  const handlers = {
    'game:start': (v) => { rematchPending = false; if (overModalHandle) { overModalHandle.close(); overModalHandle = null; } applyView(v); toast('بازی شروع شد! موفق باشی', 'success'); },
    'room:update': (v) => applyView(v),
    'game:update': ({ state: s }) => { state = s; syncRenderer(); },
    'game:clock': (cv) => { setClock(cv); },
    'player:disconnect': ({ seat: s }) => { if (players[s]) players[s].connected = false; renderPlayerCards(); toast(`${players[s]?.name || 'بازیکن'} قطع شد`, 'error'); },
    'player:reconnect': ({ seat: s }) => { if (players[s]) players[s].connected = true; renderPlayerCards(); toast('بازیکن دوباره وصل شد', 'success'); },
    'player:eliminated': ({ seat: s, reason, state: st }) => {
      if (st) state = st;
      const why = reason === 'timeout' ? 'زمانش تمام شد'
        : reason === 'idle' ? 'به‌خاطر بی‌حرکتی حذف شد'
        : reason === 'resign' ? 'تسلیم شد'
        : reason === 'checkmate' ? 'کیش‌ومات شد'
        : 'بازی را ترک کرد';
      toast(`${players[s]?.name || 'بازیکن'} ${why}`, 'error');
      syncRenderer();
    },
    'spectator:update': () => {},
    'chat:message': (m) => addChat(m),
    'game:rematchVote': ({ votes }) => toast(`درخواست بازی مجدد (${faNum(votes.length)})`),
    'game:drawOffer': ({ name }) => {
      modal({
        title: '🤝 پیشنهاد مساوی',
        body: h('p', { class: 'muted' }, `«${name}» به تو پیشنهاد مساوی داده است.`),
        actions: [
          { label: 'رد', class: 'btn-ghost', onClick: () => socket.emit('game:drawRespond', { accept: false }) },
          { label: 'قبول مساوی', class: 'btn-primary', onClick: () => socket.emit('game:drawRespond', { accept: true }) },
        ],
      });
    },
    'game:drawDeclined': () => toast('پیشنهاد مساوی رد شد', 'error'),
    'game:error': ({ error }) => toast(error, 'error'),
    'game:over': (data) => { state = data.state; status = 'finished'; if (data.clock) setClock({ ...data.clock, running: false }); syncRenderer(); showGameOver(data); },
  };
  for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);

  function showGameOver(data) {
    if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
    const iWon = data.winner === seat || (config?.teams && data.winner != null && data.winner % 2 === seat % 2);
    let title, headline;
    if (data.draw) { title = '🤝 مساوی'; headline = drawReasonText(data.reason); }
    else if (config?.teams && data.winner != null) {
      title = iWon ? '🏆 تیم تو برد!' : 'پایان بازی';
      headline = `${TEAM_NAMES[data.winner % 2]} برندهٔ بازی شد.`;
    } else {
      title = spectator ? 'پایان بازی' : (iWon ? '🏆 بردی!' : 'پایان بازی');
      headline = `${data.winnerName || ('بازیکن ' + SEAT_LABELS[data.winner])} برندهٔ بازی شد.`;
      if (isChess && data.reason === 'checkmate') headline += ' (کیش‌ومات)';
    }
    let eloLine = '';
    if (data.elo) {
      const me = [data.elo.winner, data.elo.loser].find((x) => x.id === store.me?.id);
      if (me) { const diff = me.after - me.before; eloLine = `امتیاز ELO: ${faNum(me.before)} → ${faNum(me.after)} (${diff >= 0 ? '+' : ''}${faNum(diff)})`; }
    }
    // Pasur final-score line.
    let scoreLine = '';
    if (gameType === 'pasur' && Array.isArray(data.state?.scores) && !spectator && seat >= 0) {
      const mine = data.state.scores[seat] ?? 0;
      const theirs = data.state.scores[1 - seat] ?? 0;
      scoreLine = `امتیاز تو ${faNum(mine)} — حریف ${faNum(theirs)}`;
    } else if (gameType === 'pasur' && Array.isArray(data.state?.scores)) {
      scoreLine = `امتیاز: ${faNum(data.state.scores[0] ?? 0)} — ${faNum(data.state.scores[1] ?? 0)}`;
    }
    const canRematch = !spectator && (aiSeats.length > 0 || players.filter((p) => p && !p.isAI).length >= 1);
    overModalHandle = modal({
      title,
      body: h('div', { class: 'center' },
        h('p', { style: 'font-size:1.1rem;margin-bottom:6px' }, headline),
        scoreLine ? h('p', { style: 'font-weight:700;color:var(--accent)' }, scoreLine) : null,
        eloLine ? h('p', { class: 'muted' }, eloLine) : null),
      actions: [
        { label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') },
        ...(canRematch ? [{ label: '🔄 بازی مجدد', class: 'btn-primary', onClick: () => { socket.emit('game:rematch'); rematchPending = true; updateBanner(false); /* close popup, show waiting state */ } }] : []),
      ],
    });
  }
  function drawReasonText(reason) {
    return reason === 'stalemate' ? 'پات (بدون حرکت مجاز و بدون کیش).'
      : reason === 'fifty' ? 'قانون ۵۰ حرکت.'
      : reason === 'threefold' ? 'تکرار سه‌بارهٔ وضعیت.'
      : reason === 'insufficient' ? 'مهره‌های ناکافی برای مات.'
      : reason === 'draw-agreed' ? 'هر دو بازیکن مساوی را پذیرفتند.'
      : 'بازی مساوی شد.';
  }

  /* ========================= Join ========================= */
  socket.emit('room:join', { roomId }, (res) => {
    if (!res?.ok) { toast(res?.error || 'بازی پیدا نشد', 'error'); navigate('/lobby'); return; }
    seat = res.seat;
    spectator = !!res.spectator;
    applyView(res.view);
    if (res.reconnected) toast('به بازی برگشتی', 'success');
    if (res.spectator) toast('در حال تماشای زنده', 'success');
    renderVoicePanel();
  });

  /* ========================= Layout ========================= */
  sideTop.append(playerCardsMount, controlsMount);
  sideBottom.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '💬 گفتگو'),
      h('div', { class: 'chat-box' }, chatLog,
        h('div', { class: 'chat-input' }, chatInput, h('button', { class: 'btn btn-sm', onclick: sendChat }, 'ارسال')))),
    voiceMount,
  );

  const view = h('div', { class: 'game-view fade-in' },
    sideTop,
    h('div', { class: 'board-stage' },
      turnBanner,
      h('div', { class: 'board-frame' }, canvas),
      wallTray,
      h('div', { class: 'board-foot' },
        h('span', { class: 'faint' }, `اتاق: ${roomId.slice(0, 6)}`),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openRules(gameType) }, '📖 قوانین'),
      ),
    ),
    sideBottom,
  );

  view.addEventListener('view:destroy', () => {
    for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
    if (clockTimer) clearInterval(clockTimer);
    dragGhost?.remove();
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointermove', onTrayMove);
    renderer?.destroy?.();
    voice.destroy();
    socket.emit('room:leave');
  });

  return view;
}
