/* اِل من خورا — In-game view (real-time room): 2 or 4 players, chess clock,
   spectating, chat, invites, resign, rematch. */
import { h, store, toast, modal, faNum, clear, initials, confirmDialog, formatClock } from '../core.js';
import { BoardRenderer } from '../board.js';
import { getSocket, navigate } from '../app.js';

const SEAT_LABELS = ['۱', '۲', '۳', '۴'];

export function GameView(roomId) {
  const socket = getSocket();
  let seat = -1;
  let spectator = false;
  let state = null;
  let config = null;
  let players = [];
  let numPlayers = 2;
  let aiSeats = [];
  let mode = 'move';
  let status = 'waiting';
  let code = null;

  // local clock model
  let clock = { enabled: false, remaining: [], turn: 0, running: false, incMs: 0, limitMs: 0 };
  let clockLocalStart = 0; // performance.now() when current turn's countdown began
  let clockTimer = null;

  const canvas = h('canvas', { id: 'board' });
  const turnBanner = h('div', { class: 'turn-banner' }, 'در حال اتصال…');
  const playerCardsMount = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const controlsMount = h('div', {});
  const chatLog = h('div', { class: 'chat-log' });
  const sideTop = h('div', { class: 'game-side' });
  const sideBottom = h('div', { class: 'game-side' });
  // map seat -> clock element for live updates
  const clockEls = {};

  const renderer = new BoardRenderer(canvas, {
    onMove: (r, c) => act({ type: 'move', r, c }),
    onWall: (r, c, o) => act({ type: 'wall', r, c, o }),
  });

  function act(action) {
    socket.emit('game:action', { action }, (res) => {
      if (!res?.ok) toast(res?.error || 'حرکت نامعتبر', 'error');
    });
  }
  function seatColor(s) { return (config?.colors && config.colors[s]) || ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff'][s]; }

  /* ----------------------------- Rendering ------------------------------ */
  function syncRenderer() {
    if (!state) return;
    renderer.setConfig({ theme: config.theme, colors: config.colors || [config.p0Color, config.p1Color, '#ffd36b', '#9b8cff'] });
    renderer.setMySeat(seat);
    renderer.setMode(mode);
    renderer.setState(state);
    const myTurn = !spectator && status === 'active' && state.winner === null &&
      state.turn === seat && !state.eliminated?.[seat];
    renderer.setInteractive(myTurn);
    updateBanner(myTurn);
    renderPlayerCards();
    renderControls();
  }

  function updateBanner(myTurn) {
    clear(turnBanner);
    if (status === 'waiting') { turnBanner.append('⏳ در انتظار حریف…'); return; }
    if (state.winner !== null && state.winner !== undefined) {
      const wname = players[state.winner]?.name || `بازیکن ${SEAT_LABELS[state.winner]}`;
      turnBanner.append(h('span', { class: 'dot', style: `color:${seatColor(state.winner)}` }), `🏆 ${wname} برنده شد`);
      return;
    }
    const turnName = players[state.turn]?.name || `بازیکن ${SEAT_LABELS[state.turn]}`;
    turnBanner.append(
      h('span', { class: 'dot', style: `color:${seatColor(state.turn)}` }),
      myTurn ? '✦ نوبت توست' : `نوبت ${turnName}`,
    );
  }

  function renderPlayerCards() {
    clear(playerCardsMount);
    for (const k of Object.keys(clockEls)) delete clockEls[k];
    for (let s = 0; s < numPlayers; s++) {
      const p = players[s];
      const isEliminated = state.eliminated?.[s];
      const isTurn = status === 'active' && state.winner === null && state.turn === s && !isEliminated;
      const wallsLeft = state.wallsLeft[s];
      const dots = h('div', { class: 'walls-dots' });
      for (let i = 0; i < state.wallsEach; i++) dots.append(h('i', { class: i < wallsLeft ? '' : 'used' }));

      let clockEl = null;
      if (clock.enabled) {
        clockEl = h('div', { class: 'clock' + (isTurn ? ' active' : '') + (isEliminated ? ' flagged' : '') },
          formatClock(clock.remaining[s] ?? clock.limitMs));
        clockEls[s] = clockEl;
      }

      playerCardsMount.append(h('div', { class: 'player-card' + (isTurn ? ' turn' : '') + (isEliminated ? ' eliminated' : '') },
        h('div', { class: 'pc-avatar', style: `background:${seatColor(s)}` }, p ? initials(p.name) : SEAT_LABELS[s]),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'pc-name' }, p ? p.name : `بازیکن ${SEAT_LABELS[s]}`,
            s === seat ? h('span', { class: 'faint' }, ' (تو)') : null,
            p && p.connected === false && !p.isAI ? h('span', { class: 'badge badge-ban', style: 'margin-inline-start:6px' }, 'قطع') : null),
          h('div', { class: 'pc-walls' }, `🧱 ${faNum(wallsLeft)} دیوار`),
          dots,
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
      const noWalls = state.wallsLeft[seat] <= 0;
      if (mode === 'wall' && noWalls) mode = 'move';
      const toggle = h('div', { class: 'mode-toggle' },
        h('button', { class: mode === 'move' ? 'active' : '', onclick: () => setMode('move') }, '🚶 حرکت'),
        h('button', { class: (mode === 'wall' ? 'active' : '') + (noWalls ? ' disabled' : ''),
          onclick: () => { if (!noWalls) setMode('wall'); } }, '🧱 دیوار'),
      );
      controlsMount.append(h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'کنترل نوبت'),
        toggle,
        h('p', { class: 'hint-line', style: 'margin-top:10px' },
          mode === 'move' ? '🚶 روی خانهٔ برجسته‌شده کلیک کن.' : '🧱 نشانگر را بین خانه‌ها ببر و کلیک کن.'),
        noWalls ? h('p', { class: 'faint' }, 'دیوارهایت تمام شده است.') : null,
        h('button', { class: 'btn btn-danger btn-sm btn-block', style: 'margin-top:14px', onclick: doResign }, '🏳 تسلیم'),
      ));
    }
  }

  function setMode(m) { mode = m; renderer.setMode(m); renderControls(); }

  /* ------------------------------ Clock --------------------------------- */
  function setClock(cv) {
    if (!cv) return;
    clock = {
      enabled: cv.enabled, remaining: [...(cv.remaining || [])], turn: cv.turn,
      running: cv.running, incMs: cv.incMs || 0, limitMs: cv.limitMs || 0,
    };
    clockLocalStart = performance.now();
    paintClocks();
  }
  function effectiveRemaining(s) {
    let ms = clock.remaining[s] ?? clock.limitMs;
    if (clock.running && s === clock.turn && status === 'active') {
      ms -= (performance.now() - clockLocalStart);
    }
    return Math.max(0, ms);
  }
  function paintClocks() {
    if (!clock.enabled) return;
    for (const s of Object.keys(clockEls)) {
      const seatNum = +s;
      const el = clockEls[s];
      if (!el) continue;
      const ms = effectiveRemaining(seatNum);
      el.textContent = formatClock(ms);
      el.classList.toggle('low', ms <= 15000 && clock.running && seatNum === clock.turn);
    }
  }
  clockTimer = setInterval(paintClocks, 250);

  /* ----------------------------- Actions -------------------------------- */
  function copyCode() { navigator.clipboard?.writeText(code); toast('کد کپی شد', 'success'); }
  function copyLink() {
    navigator.clipboard?.writeText(`${location.origin}/#/game/${roomId}`);
    toast('لینک دعوت کپی شد', 'success');
  }
  async function doResign() {
    if (await confirmDialog('تسلیم شدن', 'مطمئنی می‌خواهی تسلیم شوی؟', { danger: true, confirmLabel: 'تسلیم' })) {
      socket.emit('game:resign');
    }
  }

  /* ------------------------------- Chat --------------------------------- */
  function addChat({ from, text, seat: fromSeat }) {
    chatLog.append(h('div', { class: 'chat-msg' + (fromSeat === seat ? ' me' : '') },
      h('span', { class: 'who' }, from), text));
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  const chatInput = h('input', { class: 'input', placeholder: 'پیام…', maxlength: 240,
    onkeydown: (e) => { if (e.key === 'Enter') sendChat(); } });
  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat:message', { text });
    chatInput.value = '';
  }

  /* --------------------------- Socket events ---------------------------- */
  function applyView(v) {
    config = v.config; state = v.state; players = v.players;
    numPlayers = v.numPlayers || v.players?.length || 2;
    aiSeats = v.aiSeats || []; status = v.status; code = v.code;
    if (v.clock) setClock(v.clock);
    syncRenderer();
  }

  const handlers = {
    'game:start': (v) => { applyView(v); toast('بازی شروع شد! موفق باشی', 'success'); },
    'room:update': (v) => applyView(v),
    'game:update': ({ state: s }) => { state = s; syncRenderer(); },
    'game:clock': (cv) => { setClock(cv); },
    'player:disconnect': ({ seat: s }) => { if (players[s]) players[s].connected = false; renderPlayerCards(); toast(`${players[s]?.name || 'بازیکن'} قطع شد`, 'error'); },
    'player:reconnect': ({ seat: s }) => { if (players[s]) players[s].connected = true; renderPlayerCards(); toast('بازیکن دوباره وصل شد', 'success'); },
    'player:eliminated': ({ seat: s, reason, state: st }) => {
      if (st) state = st;
      const why = reason === 'timeout' ? 'زمانش تمام شد' : (reason === 'resign' ? 'تسلیم شد' : 'بازی را ترک کرد');
      toast(`${players[s]?.name || 'بازیکن'} ${why}`, 'error');
      syncRenderer();
    },
    'spectator:update': () => {},
    'chat:message': (m) => addChat(m),
    'game:rematchVote': ({ votes }) => toast(`درخواست بازی مجدد (${faNum(votes.length)})`),
    'game:error': ({ error }) => toast(error, 'error'),
    'game:over': (data) => { state = data.state; status = 'finished'; if (data.clock) setClock({ ...data.clock, running: false }); syncRenderer(); showGameOver(data); },
  };
  for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);

  function showGameOver(data) {
    const iWon = data.winner === seat;
    let eloLine = '';
    if (data.elo) {
      const me = [data.elo.winner, data.elo.loser].find((x) => x.id === store.me?.id);
      if (me) {
        const diff = me.after - me.before;
        eloLine = `امتیاز ELO: ${faNum(me.before)} → ${faNum(me.after)} (${diff >= 0 ? '+' : ''}${faNum(diff)})`;
      }
    }
    const canRematch = !spectator && (aiSeats.length > 0 || players.filter((p) => p && !p.isAI).length >= 1);
    modal({
      title: spectator ? 'پایان بازی' : (iWon ? '🏆 بردی!' : 'پایان بازی'),
      body: h('div', { class: 'center' },
        h('p', { style: 'font-size:1.1rem;margin-bottom:6px' },
          `${data.winnerName || ('بازیکن ' + SEAT_LABELS[data.winner])} برندهٔ بازی شد.`),
        eloLine ? h('p', { class: 'muted' }, eloLine) : null,
      ),
      actions: [
        { label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') },
        ...(canRematch ? [{ label: '🔄 بازی مجدد', class: 'btn-primary', onClick: () => { socket.emit('game:rematch'); return true; } }] : []),
      ],
    });
  }

  /* ------------------------------- Join --------------------------------- */
  socket.emit('room:join', { roomId }, (res) => {
    if (!res?.ok) { toast(res?.error || 'بازی پیدا نشد', 'error'); navigate('/lobby'); return; }
    seat = res.seat;
    spectator = !!res.spectator;
    applyView(res.view);
    if (res.reconnected) toast('به بازی برگشتی', 'success');
    if (res.spectator) toast('در حال تماشای زنده', 'success');
  });

  /* ------------------------------ Layout -------------------------------- */
  sideTop.append(playerCardsMount, controlsMount);
  sideBottom.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '💬 گفتگو'),
      h('div', { class: 'chat-box' }, chatLog,
        h('div', { class: 'chat-input' }, chatInput,
          h('button', { class: 'btn btn-sm', onclick: sendChat }, 'ارسال'))),
    ),
  );

  const view = h('div', { class: 'game-view fade-in' },
    sideTop,
    h('div', { class: 'board-stage' },
      turnBanner,
      h('div', { class: 'board-frame' }, canvas),
      h('div', { class: 'faint' }, `اتاق: ${roomId.slice(0, 6)}`),
    ),
    sideBottom,
  );

  view.addEventListener('view:destroy', () => {
    for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
    if (clockTimer) clearInterval(clockTimer);
    socket.emit('room:leave');
  });

  requestAnimationFrame(() => renderer._resize());
  return view;
}
