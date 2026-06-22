/* اَلِ من خورا — In-game view (real-time room): Quoridor or Chess (2/4-player),
   chess clock, spectating, chat, invites, resign, draw offers, rematch, voice. */
import { h, store, toast, modal, faNum, clear, initials, confirmDialog, formatClock, copyText, applyTheme, THEMES, api } from '../core.js';
import { TABLE_THEMES, CARD_STYLES, GRID_THEMES } from '../boardthemes.js';
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
import { playSound, toggleSound, isSoundMuted } from '../sound.js';

const SEAT_LABELS = ['۱', '۲', '۳', '۴'];
const GAME_NAMES = {
  quoridor: '🧱 اَلِ من خورا', chess: '♛ شطرنج', chess4: '♞ شطرنج ۴ نفره',
  chesszade: '🔀 شطرنج زاده‌ای', hokm: '🃏 حکم', pasur: '🎴 پاسور',
  backgammon: '🎲 تخته‌نرد', othello: '⚫ اوتلو', gomoku: '⬤ گوموکو',
  dots: '▦ نقطه‌خط', tictactoe: '✕ دوز',
};
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_FA = { p: 'سرباز', n: 'اسب', b: 'فیل', r: 'رخ', q: 'وزیر', k: 'شاه' };
const TEAM_NAMES = ['تیم قرمز/زرد', 'تیم آبی/سبز'];
// Games whose felt/table can be re-themed in-game (chess/quoridor have their own).
const BOARD_THEME_GAMES = ['backgammon', 'hokm', 'pasur'];
// Card-based games with card face/back style options.
const CARD_STYLE_GAMES = ['hokm', 'pasur'];
// Grid games with board palette options.
const GRID_GAMES = ['tictactoe', 'gomoku', 'othello', 'dots'];

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
  let series = null;          // multi-game league state (null for single games)
  let seriesPending = false;  // true after we vote ready for the next series game
  let tournament = null;      // knockout state (null otherwise)
  let myPrediction = null;    // spectator's predicted winner seat
  let overModalHandle = null; // handle to the open game-over popup, if any
  let drawWaitModal = null;   // our "waiting for opponent" draw popup (offerer side)
  let drawRecvModal = null;   // the incoming draw-offer popup (receiver side)

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
  const seriesMount = h('div', {});
  const tournamentMount = h('div', {});
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
    socket.emit('game:action', { action }, (res) => {
      if (res?.ok) return;
      // The socket may have silently reconnected with a new id, leaving the
      // server binding stale. Re-join this room and retry the move once before
      // surfacing any error — the player shouldn't have to refresh.
      const lost = res?.error === 'بازی یافت نشد' || res?.error === 'شما بازیکن این بازی نیستید';
      if (lost && !spectator) {
        rejoinRoom(() => {
          if (spectator) return;
          socket.emit('game:action', { action }, (r2) => { if (!r2?.ok) toast(r2?.error || 'حرکت نامعتبر', 'error'); });
        });
        return;
      }
      toast(res?.error || 'حرکت نامعتبر', 'error');
    });
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
    renderSeriesPanel();
    renderTournamentPanel();
    updateWallTray();
  }

  /** Knockout bracket progress panel (the human's path to the title). */
  function renderTournamentPanel() {
    clear(tournamentMount);
    if (!tournament) return;
    const roundLabel = (i) => {
      const left = tournament.totalRounds - i;
      return left === 1 ? 'فینال' : left === 2 ? 'نیمه‌نهایی' : left === 3 ? 'یک‌چهارم' : `دور ${faNum(i + 1)}`;
    };
    const card = h('div', { class: 'card series-card' },
      h('div', { class: 'card-title' }, `🏆 تورنمنت حذفی (${faNum(tournament.size)} نفره)`));
    const rounds = h('div', { class: 'bracket' });
    for (let i = 0; i < tournament.totalRounds; i++) {
      const p = tournament.path[i];
      const state = !p ? 'todo' : p.result === 'win' ? 'win' : p.result === 'loss' ? 'loss' : i === tournament.round ? 'current' : 'todo';
      rounds.append(h('div', { class: 'bracket-round ' + state },
        h('span', { class: 'bracket-r' }, roundLabel(i)),
        h('span', { class: 'bracket-vs' }, p ? `تو ⚔ ${p.opponent}` : '—'),
        h('span', { class: 'bracket-res' },
          p?.result === 'win' ? '✅' : p?.result === 'loss' ? '❌' : p?.result === 'draw' ? '🤝' : i === tournament.round ? '🎯' : '')));
    }
    card.append(rounds);
    if (tournament.done) {
      card.append(h('p', { style: 'font-weight:700;margin-top:8px;color:var(--accent)' },
        tournament.champion === 0 ? '🎉 قهرمان شدی!' : '❌ حذف شدی.'));
    }
    tournamentMount.append(card);
  }

  /** Compact league scoreboard shown in the sidebar throughout a series. */
  function renderSeriesPanel() {
    clear(seriesMount);
    if (!series) return;
    const card = h('div', { class: 'card series-card' },
      h('div', { class: 'card-title' }, `🏆 لیگ — بازی ${faNum(series.index + 1)} از ${faNum(series.total)}`));
    // playlist progress
    const list = h('div', { class: 'series-games' });
    series.games.forEach((g, i) => {
      const cls = i < series.index || (series.done) ? 'done' : i === series.index ? 'current' : '';
      list.append(h('span', { class: 'series-chip ' + cls }, GAME_NAMES[g] || g));
    });
    card.append(list);
    // scoreboard, ranked
    const order = players.map((p, s) => ({ s, p })).filter((x) => x.p)
      .sort((a, b) => (series.scores[b.s] || 0) - (series.scores[a.s] || 0));
    const board = h('div', { class: 'series-scores' });
    order.forEach(({ s, p }) => {
      board.append(h('div', { class: 'series-score-row' + (s === seat ? ' me' : '') },
        h('span', { class: 'dotc', style: `background:${seatColor(s)}` }),
        h('span', { class: 'series-name' }, p.name, p.isAI ? ' 🤖' : ''),
        h('span', { class: 'series-pts' }, faNum(series.scores[s] ?? 0))));
    });
    card.append(board);
    seriesMount.append(card);
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

  /** The pieces seat `s` has captured from the opponent (their missing men),
   *  shown as glyphs in the opponent's colour. 2-player standard board only. */
  function capturedRow(s) {
    if (!isChess || numPlayers !== 2 || !state?.board || state.cols !== 8) return null;
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
    const opp = 1 - s;
    const have = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
    for (const pc of state.board) if (pc && pc.seat === opp) have[pc.t] = (have[pc.t] || 0) + 1;
    const GLY = { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
    const row = h('div', { class: 'cap-row', style: 'display:flex;gap:1px;flex-wrap:wrap;font-size:1.05rem;line-height:1;margin-top:4px;min-height:1.05rem' });
    let any = false;
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const n = (start[t] || 0) - (have[t] || 0);
      for (let i = 0; i < n; i++) { any = true; row.append(h('span', { style: `color:${seatColor(opp)}` }, GLY[t])); }
    }
    return any ? row : null;
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
        const capRow = capturedRow(s);
        detail = h('div', {},
          h('div', { class: 'pc-walls' }, `♟ ارزش: ${faNum(mat)}`),
          capRow,
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

  function diffLabel(d) { return d === 'easy' ? 'آسان' : d === 'hard' ? 'سخت' : 'متوسط'; }

  /** Invite online friends straight into this waiting room (no code needed). */
  function inviteFriendsCard() {
    if (spectator || !store.isLoggedIn || store.me?.isGuest) return null;
    const card = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-title' }, '👥 دعوت دوستان آنلاین'));
    const body = h('div', {}, h('p', { class: 'faint' }, 'در حال یافتن دوستان…'));
    card.append(body);
    api('/friends').then(({ friends }) => {
      const online = (friends || []).filter((f) => f.online);
      clear(body);
      if (!online.length) { body.append(h('p', { class: 'faint' }, 'هیچ دوست آنلاینی نداری. از صفحهٔ دوستان اضافه کن.')); return; }
      online.forEach((f) => body.append(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' },
        h('span', { class: 'nav-avatar', style: `background:${f.avatarColor}` }, initials(f.username)),
        h('span', { style: 'flex:1' }, f.username, h('span', { class: 'online-dot' })),
        h('button', { class: 'btn btn-sm btn-primary', onclick: (e) => {
          e.target.disabled = true; e.target.textContent = 'ارسال شد ✓';
          socket.emit('friend:invite', { toUserId: f.id, roomId }, (res) => {
            toast(res?.ok ? `دعوت برای ${f.username} فرستاده شد` : (res?.error || 'خطا'), res?.ok ? 'success' : 'error');
            if (!res?.ok) { e.target.disabled = false; e.target.textContent = 'دعوت'; }
          });
        } }, 'دعوت'))));
    }).catch(() => { clear(body); body.append(h('p', { class: 'faint' }, 'خطا در بارگذاری دوستان.')); });
    return card;
  }

  /** Host-only panel for filling empty seats with bots while the room waits. */
  function seatManagerCard() {
    if (seat !== 0 || !code || status !== 'waiting') return null;
    let manageable = false;
    for (let s = 1; s < numPlayers; s++) { const p = players[s]; if (!p || p.isAI) { manageable = true; break; } }
    if (!manageable) return null;

    let botDifficulty = 'normal';
    let botPersonality = 'balanced';
    const diffSeg = h('div', { class: 'seg', style: 'margin:6px 0' });
    [['easy', 'آسان'], ['normal', 'متوسط'], ['hard', 'سخت']].forEach(([v, l]) => {
      const b = h('button', { class: v === botDifficulty ? 'active' : '' }, l);
      b.addEventListener('click', () => { botDifficulty = v; [...diffSeg.children].forEach((x) => x.classList.toggle('active', x === b)); });
      diffSeg.append(b);
    });
    const personaSeg = h('div', { class: 'seg', style: 'margin:6px 0' });
    [['balanced', 'متعادل'], ['aggressive', '⚔️ تهاجمی'], ['defensive', '🛡️ تدافعی']].forEach(([v, l]) => {
      const b = h('button', { class: v === botPersonality ? 'active' : '' }, l);
      b.addEventListener('click', () => { botPersonality = v; [...personaSeg.children].forEach((x) => x.classList.toggle('active', x === b)); });
      personaSeg.append(b);
    });

    const card = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-title' }, '🤖 صندلی‌ها و بات‌ها'),
      h('div', { class: 'opt-group' }, h('label', {}, 'سطح سختی بات جدید'), diffSeg),
      h('div', { class: 'opt-group' }, h('label', {}, 'شخصیت بات جدید'), personaSeg));

    for (let s = 1; s < numPlayers; s++) {
      const p = players[s];
      const teamTag = config?.teams ? ` · ${TEAM_NAMES[s % 2]}` : '';
      const label = h('div', { style: 'flex:1;min-width:0;display:flex;align-items:center;gap:6px' },
        h('span', { class: 'dotc', style: `background:${seatColor(s)}` }),
        h('span', {}, p ? (p.isAI ? `${p.name} · ${diffLabel(p.aiDifficulty)}` : p.name) : `صندلی ${SEAT_LABELS[s]} — خالی`),
        teamTag ? h('span', { class: 'faint' }, teamTag) : null);
      let btn;
      if (p && p.isAI) btn = h('button', { class: 'btn btn-sm btn-ghost', onclick: () => socket.emit('room:removeBot', { seat: s }) }, '✕ حذف');
      else if (!p) btn = h('button', { class: 'btn btn-sm', onclick: () => socket.emit('room:addBot', { seat: s, difficulty: botDifficulty, personality: botPersonality }) }, '+ بات');
      else btn = h('span', { class: 'badge' }, 'آماده');
      card.append(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, label, btn));
    }
    return card;
  }

  /** Spectator-only: predict the winner while the game is live. */
  function predictionCard() {
    if (!spectator || status !== 'active' || gameIsOver()) return null;
    const card = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-title' }, '🔮 پیش‌بینی برنده'),
      h('p', { class: 'card-sub' }, myPrediction != null ? 'پیش‌بینی‌ات ثبت شد — می‌توانی عوضش کنی.' : 'حدس بزن کی می‌برد؛ دقت پیش‌بینی‌هایت ثبت می‌شود.'));
    for (let s = 0; s < numPlayers; s++) {
      const p = players[s];
      if (!p) continue;
      const teamTag = config?.teams ? ` (${TEAM_NAMES[s % 2]})` : '';
      card.append(h('button', {
        class: 'btn btn-sm btn-block' + (myPrediction === s ? ' btn-primary' : ''), style: 'margin-top:6px',
        onclick: () => { myPrediction = s; socket.emit('predict:set', { seat: s }); renderControls(); },
      }, h('span', { class: 'dotc', style: `background:${seatColor(s)}` }), ` ${p.name}${teamTag}`));
    }
    return card;
  }

  function renderControls() {
    clear(controlsMount);
    if (spectator) {
      controlsMount.append(h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '👁 حالت تماشاگر'),
        h('p', { class: 'card-sub', style: 'margin:0' }, 'تو در حال تماشای زندهٔ این بازی هستی.'),
        h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:12px', onclick: () => navigate('/lobby') }, 'بازگشت به سالن')));
      const pc = predictionCard();
      if (pc) controlsMount.append(pc);
    } else if (status === 'waiting') {
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
      const fc = inviteFriendsCard();
      if (fc) controlsMount.append(fc);
      const sm = seatManagerCard();
      if (sm) controlsMount.append(sm);
    } else if (status === 'active') {
      const card = h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'کنترل نوبت'),
        h('p', { class: 'hint-line', style: 'margin-bottom:10px' }, hintFor()),
      );
      if (gameType === 'quoridor' && state.wallsLeft[seat] <= 0) card.append(h('p', { class: 'faint' }, 'دیوارهایت تمام شده است.'));
      if (isChess && numPlayers === 2) {
        card.append(h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:6px', onclick: offerDraw }, '🤝 پیشنهاد مساوی'));
      }
      card.append(h('button', { class: 'btn btn-danger btn-sm btn-block', style: 'margin-top:10px', onclick: doResign },
        series ? '🏳 تسلیم این بازی' : '🏳 تسلیم'));
      controlsMount.append(card);
    } else if (status === 'finished') {
      const canRematch = !spectator && (aiSeats.length > 0 || players.filter((p) => p && !p.isAI).length >= 1);
      const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, '🏁 پایان بازی'));
      if (rematchPending) {
        card.append(h('div', { class: 'center', style: 'padding:12px 0' },
          h('span', { class: 'spinner spinner-sm' }), ' در انتظار شروع بازی مجدد…'));
      } else {
        card.append(h('button', { class: 'btn btn-block', style: 'margin-top:10px',
          onclick: () => navigate('/lobby') }, '🏠 بازگشت به سالن'));
        if (canRematch) {
          card.append(h('button', { class: 'btn btn-primary btn-block', style: 'margin-top:8px',
            onclick: () => {
              socket.emit('game:rematch');
              rematchPending = true;
              updateBanner(false);
              if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
              renderControls();
            },
          }, '🔄 بازی مجدد'));
        }
      }
      controlsMount.append(card);
    }
    controlsMount.append(appearanceCard());
  }

  /* ----- In-game appearance: page theme (all games) + board theme ----- */
  function setPageTheme(id) {
    applyTheme(id);
    if (store.me) {
      const prefs = { ...(store.me.prefs || {}), theme: id };
      store.set({ me: { ...store.me, prefs } });
      api('/profile', { method: 'PATCH', body: { prefs } }).catch(() => {});
    } else {
      try { localStorage.setItem('theme', id); } catch {}
    }
  }
  function appearanceCard() {
    const card = h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'card-title' }, '🎨 ظاهر'));
    const cur = document.body.dataset.theme;
    const row = h('div', { class: 'theme-row' });
    THEMES.forEach((t) => {
      const chip = h('div', {
        class: 'theme-chip' + (t.id === cur ? ' active' : ''), title: t.name,
        style: `background:linear-gradient(135deg, ${t.from}, ${t.to})`,
        onclick: () => { setPageTheme(t.id); [...row.children].forEach((c, i) => c.classList.toggle('active', THEMES[i].id === t.id)); },
      });
      row.append(chip);
    });
    card.append(h('div', { class: 'opt-group' }, h('label', {}, 'تم صفحه'), row));
    const bt = boardThemeSelector();
    if (bt) card.append(bt);
    const cs = cardStyleSelector();
    if (cs) card.append(cs);
    return card;
  }
  function boardThemeSelector() {
    let opts, label, cur, apply;
    if (isChess) {
      opts = [['classic', 'کلاسیک'], ['green', 'سبز'], ['blue', 'آبی'], ['wood', 'چوب'], ['gray', 'خاکستری'], ['midnight', 'نیمه‌شب']];
      label = 'تم تخته'; cur = config?.boardTheme || 'classic';
      apply = (v) => { config.boardTheme = v; renderer?.setConfig({ boardTheme: v }); };
    } else if (gameType === 'quoridor') {
      opts = THEMES.map((t) => [t.id, t.name]);
      label = 'تم تخته'; cur = config?.theme || 'emerald';
      apply = (v) => { config.theme = v; renderer?.setConfig({ theme: v }); };
    } else if (BOARD_THEME_GAMES.includes(gameType)) {
      opts = TABLE_THEMES.map((t) => [t.id, t.name]);
      label = 'تم میز'; cur = config?.boardTheme || 'classic';
      apply = (v) => { config.boardTheme = v; renderer?.setConfig({ boardTheme: v }); };
    } else if (GRID_GAMES.includes(gameType)) {
      const themes = GRID_THEMES[gameType] || [];
      if (!themes.length) return null;
      opts = themes.map((t) => [t.id, t.name]);
      label = 'تم تخته'; cur = config?.boardTheme || themes[0].id;
      apply = (v) => { config.boardTheme = v; renderer?.setConfig({ boardTheme: v }); };
    } else return null;
    const seg = h('div', { class: 'seg seg-wrap', style: 'flex-wrap:wrap;gap:6px' });
    opts.forEach(([v, lbl]) => {
      const b = h('button', { class: v === cur ? 'active' : '', onclick: () => { apply(v); [...seg.children].forEach((x) => x.classList.toggle('active', x === b)); } }, lbl);
      seg.append(b);
    });
    return h('div', { class: 'opt-group', style: 'margin-top:8px' }, h('label', {}, label), seg);
  }
  function cardStyleSelector() {
    if (!CARD_STYLE_GAMES.includes(gameType)) return null;
    const cur = config?.cardStyle || 'classic';
    const apply = (v) => { config.cardStyle = v; renderer?.setConfig({ cardStyle: v }); };
    const seg = h('div', { class: 'seg seg-wrap', style: 'flex-wrap:wrap;gap:6px' });
    CARD_STYLES.forEach(({ id, name }) => {
      const b = h('button', { class: id === cur ? 'active' : '', onclick: () => { apply(id); [...seg.children].forEach((x) => x.classList.toggle('active', x === b)); } }, name);
      seg.append(b);
    });
    return h('div', { class: 'opt-group', style: 'margin-top:8px' }, h('label', {}, 'سبک کارت'), seg);
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
    const msg = series
      ? 'این بازیِ لیگ را واگذار می‌کنی و به بازی بعد می‌روید. مطمئنی؟'
      : 'مطمئنی می‌خواهی تسلیم شوی؟';
    if (await confirmDialog('تسلیم شدن', msg, { danger: true, confirmLabel: 'تسلیم' })) socket.emit('game:resign');
  }
  function offerDraw() {
    if (drawWaitModal) { toast('یک پیشنهاد مساوی در جریان است', 'error'); return; }
    socket.emit('game:drawOffer', (res) => {
      if (!res?.ok) { toast(res?.error || 'پیشنهاد مساوی ارسال نشد', 'error'); return; }
      drawWaitModal = modal({
        title: '🤝 پیشنهاد مساوی',
        body: h('div', { class: 'center' },
          h('span', { class: 'spinner spinner-sm' }), ' در انتظار پاسخ حریف…'),
        actions: [
          { label: 'لغو درخواست', class: 'btn-ghost', onClick: () => { socket.emit('game:drawCancel'); } },
        ],
        onClose: () => { drawWaitModal = null; },
      });
    });
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

  /* ========================= Reactions ========================= */
  const REACTIONS = ['👍', '😂', '🔥', '😮', '😢', '👏', '❤️', '🤔', '🎉', '🧠'];
  const reactionLayer = h('div', { class: 'reaction-layer' });
  const reactionBar = h('div', { class: 'reaction-bar' },
    ...REACTIONS.map((e) => h('button', { class: 'reaction-btn', type: 'button', title: 'واکنش', onclick: () => socket.emit('game:reaction', { emoji: e }) }, e)));
  /** Float a reaction emoji up over the board, tagged with who sent it. */
  function flyReaction(emoji, fromSeat) {
    const who = players[fromSeat]?.name;
    const pop = h('div', { class: 'reaction-pop' },
      h('span', { class: 'reaction-emoji' }, emoji),
      who ? h('span', { class: 'reaction-who', style: `border-color:${seatColor(fromSeat)}` }, who) : null);
    pop.style.left = (12 + Math.random() * 72) + '%';
    pop.style.setProperty('--drift', (Math.random() * 40 - 20) + 'px');
    reactionLayer.append(pop);
    setTimeout(() => pop.remove(), 2400);
  }

  /* ========================= Socket events ========================= */
  function applyView(v) {
    config = v.config; state = v.state; players = v.players;
    numPlayers = v.numPlayers || v.players?.length || 2;
    aiSeats = v.aiSeats || []; status = v.status; code = v.code;
    if (v.series !== undefined) series = v.series;
    if (v.tournament !== undefined) tournament = v.tournament;
    gameType = v.gameType || config?.gameType || 'quoridor';
    isChess = gameType === 'chess' || gameType === 'chess4' || gameType === 'chesszade';
    if (v.clock) setClock(v.clock);
    syncRenderer();
  }

  const handlers = {
    'game:start': (v) => {
      rematchPending = false; seriesPending = false; myPrediction = null;
      if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
      applyView(v);
      playSound('start');
      const msg = v.series ? `بازی ${faNum((v.series.index ?? 0) + 1)}: ${GAME_NAMES[v.gameType] || v.gameType}` : 'بازی شروع شد! موفق باشی';
      toast(msg, 'success');
    },
    'series:ready': ({ votes }) => toast(`آمادهٔ بازی بعد (${faNum(votes.length)})`),
    'predict:result': ({ correct }) => {
      toast(correct ? '🔮 پیش‌بینی‌ات درست بود! ✅' : '🔮 پیش‌بینی‌ات اشتباه بود.', correct ? 'success' : 'error');
      playSound(correct ? 'win' : 'notify');
    },
    'achievement:earned': ({ achievements }) => {
      (achievements || []).forEach((a, i) => setTimeout(() => {
        toast(`${a.icon} دستاورد جدید: ${a.name}`, 'success');
        playSound('achievement');
      }, i * 900));
    },
    'room:update': (v) => applyView(v),
    'game:update': ({ state: s }) => {
      state = s; syncRenderer();
      if (status === 'active' && !gameIsOver()) playSound(isMyTurnActive() ? 'turn' : 'move');
    },
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
    'game:reaction': ({ emoji, seat: s }) => { flyReaction(emoji, s); playSound('reaction'); },
    'chat:message': (m) => addChat(m),
    'game:rematchVote': ({ votes }) => toast(`درخواست بازی مجدد (${faNum(votes.length)})`),
    'game:drawOffer': ({ name }) => {
      if (drawRecvModal) return; // don't stack repeated offers
      drawRecvModal = modal({
        title: '🤝 پیشنهاد مساوی',
        body: h('p', { class: 'muted' }, `«${name}» به تو پیشنهاد مساوی داده است.`),
        actions: [
          { label: 'رد', class: 'btn-ghost', onClick: () => socket.emit('game:drawRespond', { accept: false }) },
          { label: 'قبول مساوی', class: 'btn-primary', onClick: () => socket.emit('game:drawRespond', { accept: true }) },
        ],
        onClose: () => { drawRecvModal = null; },
      });
    },
    'game:drawCancelled': () => {
      if (drawRecvModal) { drawRecvModal.close(); drawRecvModal = null; }
      toast('پیشنهاد مساوی پس گرفته شد');
    },
    'game:drawDeclined': () => { if (drawWaitModal) { drawWaitModal.close(); drawWaitModal = null; } toast('پیشنهاد مساوی رد شد', 'error'); },
    'game:error': ({ error }) => toast(error, 'error'),
    'game:over': (data) => {
      state = data.state; status = 'finished';
      if (data.series !== undefined) series = data.series;
      if (data.tournament !== undefined) tournament = data.tournament;
      if (data.clock) setClock({ ...data.clock, running: false });
      syncRenderer();
      if (!spectator) {
        const iWon = data.winner === seat || (config?.teams && data.winner != null && data.winner % 2 === seat % 2);
        playSound(data.draw ? 'notify' : iWon ? 'win' : 'lose');
      }
      if (data.tournament) showTournamentStandings(data);
      else if (data.series) showSeriesStandings(data);
      else showGameOver(data);
    },
  };
  for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);

  function showGameOver(data) {
    if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
    if (drawWaitModal) { drawWaitModal.close(); drawWaitModal = null; }
    if (drawRecvModal) { drawRecvModal.close(); drawRecvModal = null; }
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
    // Per-game rating change (any 2-player game between two rated humans).
    let gameEloLine = '';
    if (data.gameElo && store.me?.id) {
      const mine = [data.gameElo.winner, data.gameElo.loser].find((x) => x.id === store.me.id);
      if (mine) { const d = mine.after - mine.before; gameEloLine = `امتیاز این بازی: ${faNum(mine.before)} → ${faNum(mine.after)} (${d >= 0 ? '+' : ''}${faNum(d)})`; }
    }
    // Head-to-head record vs the opponent (filled async).
    const h2hLine = h('p', { class: 'muted', style: 'min-height:1px' });
    maybeFillH2H(h2hLine);
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
        eloLine ? h('p', { class: 'muted' }, eloLine) : null,
        gameEloLine ? h('p', { class: 'muted' }, gameEloLine) : null,
        h2hLine),
      actions: [
        { label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') },
        ...(canRematch ? [{ label: '🔄 بازی مجدد', class: 'btn-primary', onClick: () => { socket.emit('game:rematch'); rematchPending = true; updateBanner(false); /* close popup, show waiting state */ } }] : []),
      ],
    });
  }
  /** Fetch & display the head-to-head record vs a single rated human opponent. */
  function maybeFillH2H(target) {
    if (spectator || numPlayers !== 2 || !store.isLoggedIn) return;
    const opp = players[1 - seat];
    if (!opp || opp.isAI || !opp.userId) return;
    api(`/h2h/${opp.userId}`).then(({ h2h }) => {
      if (!h2h || !h2h.total) return;
      target.textContent = `رو در رو با ${opp.name}: ${faNum(h2h.wins)} برد · ${faNum(h2h.losses)} باخت · ${faNum(h2h.draws)} مساوی`;
    }).catch(() => {});
  }

  /** Between-games (and final) standings popup for a league/series room. */
  function showSeriesStandings(data) {
    if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
    const sv = data.series;
    const done = sv.done;
    // This game's headline
    let gameLine;
    if (data.draw) gameLine = 'این بازی مساوی شد.';
    else if (config?.teams && data.winner != null) gameLine = `${TEAM_NAMES[data.winner % 2]} این بازی را برد.`;
    else gameLine = `${data.winnerName || ('بازیکن ' + SEAT_LABELS[data.winner])} این بازی را برد.`;

    // Ranked scoreboard
    const order = players.map((p, s) => ({ s, p })).filter((x) => x.p)
      .sort((a, b) => (sv.scores[b.s] || 0) - (sv.scores[a.s] || 0));
    const board = h('div', { class: 'series-scores', style: 'margin:12px 0' });
    order.forEach(({ s, p }, rank) => {
      board.append(h('div', { class: 'series-score-row' + (s === seat ? ' me' : '') },
        h('span', {}, done && rank === 0 ? '🥇 ' : `${faNum(rank + 1)}. `),
        h('span', { class: 'dotc', style: `background:${seatColor(s)}` }),
        h('span', { class: 'series-name' }, p.name, p.isAI ? ' 🤖' : ''),
        h('span', { class: 'series-pts' }, faNum(sv.scores[s] ?? 0))));
    });

    let title, footer;
    if (done) {
      const champ = order[0];
      title = '🏆 پایان لیگ';
      footer = h('p', { style: 'font-weight:700;color:var(--accent)' },
        champ?.s === seat ? 'تو قهرمان لیگ شدی! 🎉' : `${champ?.p?.name || '—'} قهرمان لیگ شد.`);
    } else {
      title = `پایان بازی ${faNum(sv.index + 1)} از ${faNum(sv.total)}`;
      const next = sv.games[sv.index + 1];
      footer = h('p', { class: 'muted' }, `بازی بعد: ${GAME_NAMES[next] || next}`);
    }

    const actions = [{ label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') }];
    if (!done && !spectator) {
      actions.push({ label: seriesPending ? 'در انتظار بقیه…' : '▶ بازی بعد', class: 'btn-primary',
        onClick: () => { socket.emit('series:next'); seriesPending = true; return true; } });
    }
    overModalHandle = modal({
      title,
      body: h('div', { class: 'center' }, h('p', {}, gameLine), board, footer),
      actions,
      onClose: () => { overModalHandle = null; },
    });
  }

  /** Between-rounds (and final) popup for a knockout tournament. */
  function showTournamentStandings(data) {
    if (overModalHandle) { overModalHandle.close(); overModalHandle = null; }
    const tv = data.tournament;
    const iWon = data.winner === seat;
    let title, headline;
    if (tv.done && tv.champion === 0) { title = '🏆 قهرمان تورنمنت!'; headline = 'همهٔ حریف‌ها را شکست دادی و قهرمان شدی! 🎉'; }
    else if (tv.done) { title = 'پایان تورنمنت'; headline = 'در این دور حذف شدی. دفعهٔ بعد!'; }
    else if (data.draw) { title = 'مساوی'; headline = 'این دور مساوی شد — دوباره بازی می‌کنی.'; }
    else { title = iWon ? '✅ به دور بعد رفتی!' : 'پایان بازی'; headline = iWon ? 'یک قدم به قهرمانی نزدیک‌تر شدی.' : 'حذف شدی.'; }

    const actions = [{ label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') }];
    if (!tv.done && !spectator) {
      const label = data.draw ? '🔁 بازی دوباره' : '▶ دور بعد';
      actions.push({ label, class: 'btn-primary', onClick: () => { socket.emit('tournament:next'); return true; } });
    }
    overModalHandle = modal({
      title,
      body: h('div', { class: 'center' }, h('p', { style: 'font-size:1.05rem' }, headline)),
      actions,
      onClose: () => { overModalHandle = null; },
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

  /* ========================= Join / reconnect ========================= */
  let joinedOnce = false;
  let connLost = false;

  /** (Re)bind this socket to the room and refresh state. Safe to call anytime;
   *  the server returns the existing seat if we're already seated. */
  function rejoinRoom(after) {
    socket.emit('room:join', { roomId }, (res) => {
      if (!res?.ok) {
        // The room is genuinely gone (expired / finished and cleaned up).
        toast(res?.error || (joinedOnce ? 'بازی دیگر در دسترس نیست' : 'بازی پیدا نشد'), 'error');
        navigate('/lobby');
        return;
      }
      const firstTime = !joinedOnce;
      seat = res.seat;
      spectator = !!res.spectator;
      applyView(res.view);
      joinedOnce = true;
      connLost = false; updateConnBanner();
      if (firstTime) {
        if (res.reconnected) toast('به بازی برگشتی', 'success');
        if (res.spectator) toast('در حال تماشای زنده', 'success');
        renderVoicePanel();
      }
      after?.();
    });
  }

  // Auto re-join whenever the socket (re)connects after the first join — mobile
  // backgrounding / network blips drop the socket and it returns with a NEW id,
  // which would otherwise leave moves failing with «بازی یافت نشد».
  function onConnect() { if (joinedOnce) rejoinRoom(); }
  function onDisconnect() { connLost = true; updateConnBanner(); }
  function onVisible() {
    if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
  }
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  document.addEventListener('visibilitychange', onVisible);

  function updateConnBanner() {
    if (connLost) {
      clear(turnBanner);
      turnBanner.append(h('span', { class: 'spinner spinner-sm' }), ' اتصال قطع شد — در حال اتصال مجدد…');
    } else if (state) {
      updateBanner(isMyTurnActive());
    }
  }

  rejoinRoom();

  /* ========================= Layout ========================= */
  const soundBtn = h('button', { class: 'btn btn-sm btn-ghost', title: 'صدا',
    onclick: () => { const m = toggleSound(); soundBtn.textContent = m ? '🔇 صدا' : '🔊 صدا'; } },
    isSoundMuted() ? '🔇 صدا' : '🔊 صدا');
  sideTop.append(tournamentMount, seriesMount, playerCardsMount, controlsMount);
  sideBottom.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '💬 گفتگو'),
      h('div', { class: 'chat-box' }, chatLog,
        h('div', { class: 'chat-input' }, chatInput, h('button', { class: 'btn btn-sm', onclick: sendChat }, 'ارسال'))),
      reactionBar),
    voiceMount,
  );

  const view = h('div', { class: 'game-view fade-in' },
    sideTop,
    h('div', { class: 'board-stage' },
      turnBanner,
      h('div', { class: 'board-frame' }, canvas, reactionLayer),
      wallTray,
      h('div', { class: 'board-foot' },
        h('span', { class: 'faint' }, `اتاق: ${roomId.slice(0, 6)}`),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openRules(gameType) }, '📖 قوانین'),
        soundBtn,
      ),
    ),
    sideBottom,
  );

  view.addEventListener('view:destroy', () => {
    for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    document.removeEventListener('visibilitychange', onVisible);
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
