/* اِل من خورا — In-game view (real-time room) */
import { h, store, toast, modal, faNum, clear, initials, confirmDialog } from '../core.js';
import { BoardRenderer } from '../board.js';
import { getSocket, navigate } from '../app.js';

export function GameView(roomId) {
  const socket = getSocket();
  let seat = -1;
  let spectator = false;
  let state = null;
  let config = null;
  let players = [null, null];
  let aiSeat = null;
  let mode = 'move';
  let status = 'waiting';
  let code = null;

  const canvas = h('canvas', { id: 'board' });
  const turnBanner = h('div', { class: 'turn-banner' }, 'در حال اتصال…');
  const playerCardsMount = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const controlsMount = h('div', {});
  const chatLog = h('div', { class: 'chat-log' });
  const sideTop = h('div', { class: 'game-side' });
  const sideBottom = h('div', { class: 'game-side' });

  const renderer = new BoardRenderer(canvas, {
    onMove: (r, c) => act({ type: 'move', r, c }),
    onWall: (r, c, o) => act({ type: 'wall', r, c, o }),
  });

  function act(action) {
    socket.emit('game:action', { action }, (res) => {
      if (!res?.ok) toast(res?.error || 'حرکت نامعتبر', 'error');
    });
  }

  /* ----------------------------- Rendering ------------------------------ */
  function syncRenderer() {
    if (!state) return;
    renderer.setConfig({ theme: config.theme, p0Color: config.p0Color, p1Color: config.p1Color });
    renderer.setMySeat(seat);
    renderer.setMode(mode);
    renderer.setState(state);
    const myTurn = !spectator && status === 'active' && state.winner === null && state.turn === seat;
    renderer.setInteractive(myTurn);
    updateBanner(myTurn);
    renderPlayerCards();
    renderControls();
  }

  function updateBanner(myTurn) {
    clear(turnBanner);
    if (status === 'waiting') {
      turnBanner.append('⏳ در انتظار حریف…');
      return;
    }
    if (state.winner !== null) {
      const wname = players[state.winner]?.name || `بازیکن ${faNum(state.winner + 1)}`;
      turnBanner.append(h('span', { class: 'dot', style: `color:${seatColor(state.winner)}` }), `🏆 ${wname} برنده شد`);
      return;
    }
    const turnName = players[state.turn]?.name || `بازیکن ${faNum(state.turn + 1)}`;
    turnBanner.append(
      h('span', { class: 'dot', style: `color:${seatColor(state.turn)}` }),
      myTurn ? '✦ نوبت توست' : `نوبت ${turnName}`,
    );
  }

  function seatColor(s) { return s === 0 ? config.p0Color : config.p1Color; }

  function renderPlayerCards() {
    clear(playerCardsMount);
    for (let s = 0; s < 2; s++) {
      const p = players[s];
      const isTurn = status === 'active' && state.winner === null && state.turn === s;
      const wallsLeft = state.wallsLeft[s];
      const dots = h('div', { class: 'walls-dots' });
      for (let i = 0; i < state.wallsEach; i++) {
        dots.append(h('i', { class: i < wallsLeft ? '' : 'used' }));
      }
      playerCardsMount.append(h('div', { class: 'player-card' + (isTurn ? ' turn' : '') },
        h('div', { class: 'pc-avatar', style: `background:${seatColor(s)}` }, p ? initials(p.name) : '?'),
        h('div', { style: 'flex:1' },
          h('div', { class: 'pc-name' }, p ? p.name : 'در انتظار…',
            s === seat ? h('span', { class: 'faint' }, ' (تو)') : null,
            p && p.connected === false ? h('span', { class: 'badge badge-ban', style: 'margin-inline-start:6px' }, 'قطع') : null),
          h('div', { class: 'pc-walls' }, `🧱 ${faNum(wallsLeft)} دیوار باقی‌مانده`),
          dots,
        ),
      ));
    }
  }

  function renderControls() {
    clear(controlsMount);
    if (spectator) {
      controlsMount.append(h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '👁 حالت تماشاگر'),
        h('p', { class: 'card-sub', style: 'margin:0' }, 'تو در حال تماشای این بازی هستی.')));
      return;
    }
    if (status === 'waiting') {
      const inviteBox = code ? h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '🔗 دعوت دوست'),
        h('p', { class: 'card-sub' }, 'این کد یا لینک را برای حریفت بفرست:'),
        h('div', { class: 'invite-box' },
          h('span', { class: 'invite-code' }, code),
          h('button', { class: 'btn btn-sm', onclick: copyCode }, 'کپی کد')),
        h('button', { class: 'btn btn-sm btn-block', style: 'margin-top:10px', onclick: copyLink }, '📋 کپی لینک دعوت'),
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
          mode === 'move'
            ? '🚶 روی خانه‌ای که برجسته شده کلیک کن تا حرکت کنی.'
            : '🧱 نشانگر را بین خانه‌ها ببر و کلیک کن تا دیوار بسازی.'),
        noWalls ? h('p', { class: 'faint' }, 'دیوارهایت تمام شده است.') : null,
        h('button', { class: 'btn btn-danger btn-sm btn-block', style: 'margin-top:14px', onclick: doResign }, '🏳 تسلیم'),
      ));
    }
  }

  function setMode(m) { mode = m; renderer.setMode(m); renderControls(); }

  /* ----------------------------- Actions -------------------------------- */
  function copyCode() { navigator.clipboard?.writeText(code); toast('کد کپی شد', 'success'); }
  function copyLink() {
    const url = `${location.origin}/#/game/${roomId}`;
    navigator.clipboard?.writeText(url);
    toast('لینک دعوت کپی شد', 'success');
  }
  async function doResign() {
    if (await confirmDialog('تسلیم شدن', 'مطمئنی می‌خواهی تسلیم شوی؟ بازی را می‌بازی.', { danger: true, confirmLabel: 'تسلیم' })) {
      socket.emit('game:resign');
    }
  }

  /* ------------------------------- Chat --------------------------------- */
  function addChat({ from, text, seat: fromSeat }) {
    const mine = fromSeat === seat;
    chatLog.append(h('div', { class: 'chat-msg' + (mine ? ' me' : '') },
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
    config = v.config; state = v.state; players = v.players; aiSeat = v.aiSeat;
    status = v.status; code = v.code;
    syncRenderer();
  }

  const handlers = {
    'game:start': (v) => { applyView(v); toast('بازی شروع شد! موفق باشی', 'success'); },
    'room:update': (v) => applyView(v),
    'game:update': ({ state: s }) => { state = s; syncRenderer(); },
    'player:disconnect': ({ seat: s }) => { if (players[s]) players[s].connected = false; renderPlayerCards(); toast('حریف اتصالش قطع شد', 'error'); },
    'player:reconnect': ({ seat: s }) => { if (players[s]) players[s].connected = true; renderPlayerCards(); toast('حریف دوباره وصل شد', 'success'); },
    'chat:message': (m) => addChat(m),
    'game:rematchVote': ({ votes }) => toast(`درخواست بازی مجدد (${faNum(votes.length)}/۲)`),
    'game:error': ({ error }) => toast(error, 'error'),
    'game:over': (data) => { state = data.state; status = 'finished'; syncRenderer(); showGameOver(data); },
  };
  for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);

  function showGameOver(data) {
    const iWon = data.winner === seat;
    let eloLine = '';
    if (data.elo) {
      const me = data.elo.winner.id === store.me?.id ? data.elo.winner
        : (data.elo.loser.id === store.me?.id ? data.elo.loser : null);
      if (me) {
        const diff = me.after - me.before;
        eloLine = `امتیاز ELO: ${faNum(me.before)} → ${faNum(me.after)} (${diff >= 0 ? '+' : ''}${faNum(diff)})`;
      }
    }
    const rematchBtn = aiSeat !== null || players.every((p) => p)
      ? { label: '🔄 بازی مجدد', class: 'btn-primary', onClick: () => { socket.emit('game:rematch'); return true; } }
      : null;
    modal({
      title: spectator ? 'پایان بازی' : (iWon ? '🏆 بردی!' : 'باختی'),
      body: h('div', { class: 'center' },
        h('p', { style: 'font-size:1.1rem;margin-bottom:6px' },
          `${data.winnerName || ('بازیکن ' + faNum(data.winner + 1))} برندهٔ بازی شد.`),
        eloLine ? h('p', { class: 'muted' }, eloLine) : null,
      ),
      actions: [
        { label: 'بازگشت به سالن', class: 'btn-ghost', onClick: () => navigate('/lobby') },
        ...(rematchBtn ? [rematchBtn] : []),
      ],
    });
  }

  /* ------------------------------- Join --------------------------------- */
  socket.emit('room:join', { roomId }, (res) => {
    if (!res?.ok) {
      toast(res?.error || 'بازی پیدا نشد', 'error');
      navigate('/lobby');
      return;
    }
    seat = res.seat;
    spectator = !!res.spectator;
    applyView(res.view);
    if (res.reconnected) toast('به بازی برگشتی', 'success');
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
  });

  requestAnimationFrame(() => renderer._resize());
  return view;
}
