/* اَلِ من خورا — Lobby: choose a game, a mode, customize, and start playing */
import { h, store, toast, modal, faNum, $ } from '../core.js';
import { makeCustomizer } from '../components.js';
import { openRules } from '../rules.js';
import { getSocket, navigate } from '../app.js';

const GAMES = [
  { id: 'quoridor', icon: '🧱', name: 'اَلِ من خورا', desc: 'حرکت کن یا دیوار بساز' },
  { id: 'chess', icon: '♛', name: 'شطرنج', desc: 'نبرد کلاسیک دو نفره' },
  { id: 'chess4', icon: '♞', name: 'شطرنج ۴ نفره', desc: 'تخته صلیبی، ۴ ارتش' },
  { id: 'chesszade', icon: '🔀', name: 'شطرنج زاده‌ای', desc: 'چیدمان تصادفی، نبرد نو' },
  { id: 'backgammon', icon: '🎲', name: 'تخته‌نرد', desc: 'تاس بریز، مهره‌ها را خارج کن' },
  { id: 'othello', icon: '⚫', name: 'اوتلو', desc: 'مهره‌ها را برگردان، اکثریت بگیر' },
  { id: 'gomoku', icon: '⬤', name: 'گوموکو', desc: 'پنج مهره در یک خط' },
  { id: 'dots', icon: '▦', name: 'نقطه‌خط', desc: 'خط بکش، مربع بساز' },
  { id: 'tictactoe', icon: '✕', name: 'دوز', desc: 'سه‌تا در یک خط' },
];
function gameLabel(id) { const g = GAMES.find((x) => x.id === id); return g ? `${g.icon} ${g.name}` : id; }

export function LobbyView() {
  const socket = getSocket();
  let gameType = 'quoridor';
  const statsPills = h('div', { class: 'stat-pills' });

  function refreshStats() {
    socket.emit('lobby:stats', (s) => {
      if (!s) return;
      statsPills.innerHTML = '';
      statsPills.append(
        pill(`${faNum(s.online)} آنلاین`, true),
        pill(`${faNum(s.activeGames)} بازی فعال`),
        pill(`${faNum(s.queue)} در صف`),
      );
    });
  }
  refreshStats();

  // ---- Live games (spectate) ----
  const liveMount = h('div', { class: 'live-list' });
  function refreshLive() {
    socket.emit('lobby:games', (res) => {
      const games = res?.games || [];
      liveMount.innerHTML = '';
      if (!games.length) {
        liveMount.append(h('p', { class: 'muted', style: 'padding:6px' }, 'هیچ بازی زنده‌ای در جریان نیست.'));
        return;
      }
      games.forEach((g) => liveMount.append(liveGameCard(g)));
    });
  }
  refreshLive();

  const statsTimer = setInterval(refreshStats, 5000);
  const liveTimer = setInterval(refreshLive, 6000);
  const cleanup = () => { clearInterval(statsTimer); clearInterval(liveTimer); };

  function liveGameCard(g) {
    const names = g.players.map((p, i) => h('span', { class: 'live-player' },
      h('span', { class: 'dotc', style: `background:${p?.color || '#888'}` }),
      p ? p.name : '—')).reduce((acc, el, i) => {
        if (i) acc.push(h('span', { class: 'faint' }, '⚔'));
        acc.push(el); return acc;
      }, []);
    const gt = g.gameType || 'quoridor';
    const gdef = GAMES.find((x) => x.id === gt);
    const typeLabel = gt === 'chess4' && g.teams ? '♞ شطرنج ۴ تیمی'
      : gdef ? `${gdef.icon} ${gdef.name}`
      : '🧱 اَلِ من خورا';
    const meta = gt === 'quoridor'
      ? `${typeLabel} · ${faNum(g.size)}×${faNum(g.size)} · ${faNum(g.moveCount)} حرکت`
      : `${typeLabel} · ${faNum(g.moveCount)} حرکت`;
    return h('div', { class: 'live-card', onclick: () => navigate(`/game/${g.id}`) },
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'live-players' }, ...names),
        h('div', { class: 'faint' }, meta)),
      h('div', { class: 'live-watch' },
        h('span', { class: 'pill' }, `👁 ${faNum(g.spectators)}`),
        h('button', { class: 'btn btn-sm' }, 'تماشا')),
    );
  }

  // ---- Game picker ----
  const gameSelect = h('div', { class: 'game-select' });
  GAMES.forEach((g) => {
    const tile = h('div', { class: 'game-tile' + (g.id === gameType ? ' active' : ''), dataset: { game: g.id },
      onclick: () => {
        gameType = g.id;
        [...gameSelect.children].forEach((t) => t.classList.toggle('active', t.dataset.game === gameType));
      } },
      h('div', { class: 'gt-ico' }, g.icon),
      h('div', { class: 'gt-name' }, g.name),
      h('div', { class: 'gt-desc' }, g.desc));
    gameSelect.append(tile);
  });

  const view = h('div', { class: 'fade-in', dataset: { cleanup: '1' } },
    h('div', {},
      h('h1', { class: 'section-title' }, 'سالن بازی'),
      h('p', { class: 'section-sub' }, `سلام ${store.displayName} 👋 — اول بازی را انتخاب کن، بعد حالت را.`),
      statsPills,
    ),
    h('div', { style: 'margin-top:22px' },
      h('div', { class: 'rules-bar' },
        h('div', { class: 'card-title' }, '🎮 کدام بازی؟'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openRules(gameType) }, '📖 قوانین این بازی')),
      gameSelect),
    h('div', { class: 'lobby-grid', style: 'margin-top:26px' },
      h('div', { class: 'mode-list' },
        modeCard('🎲', 'بازی تصادفی', 'با یک حریف هم‌سطح به‌صورت آنی همگام شو.', () => openRandom()),
        modeCard('🤝', 'دعوت دوست', 'یک اتاق خصوصی بساز و کد دعوت را بفرست.', () => openPrivate()),
        modeCard('🤖', 'بازی با هوش مصنوعی', 'با سه سطح سختی تمرین کن.', () => openAI()),
        modeCard('🔑', 'ورود با کد', 'به اتاق دوستت با کد دعوت بپیوند.', () => openJoin()),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '⚡ بازی سریع'),
        h('p', { class: 'card-sub' }, 'با تنظیمات پیش‌فرض و یک حریف تصادفی فوراً شروع کن.'),
        h('button', { class: 'btn btn-primary btn-block', onclick: () => quickMatch() }, 'پیدا کردن حریف'),
        h('div', { class: 'divider' }, 'یا'),
        h('button', { class: 'btn btn-block', onclick: () => openAI() }, '🤖 بازی فوری با هوش مصنوعی'),
      ),
    ),
    h('div', { class: 'card', style: 'margin-top:22px' },
      h('div', { class: 'card-title' }, '📺 بازی‌های زندهٔ در حال پخش'),
      h('p', { class: 'card-sub' }, 'روی هر بازی بزن تا به‌صورت زنده تماشا کنی.'),
      liveMount,
    ),
  );

  view.addEventListener('view:destroy', cleanup);

  /* -------------------------- Mode handlers ----------------------------- */

  function customizerModal(title, primaryLabel, onStart, opts = {}) {
    const customizer = makeCustomizer(gameType, opts);
    modal({
      title: `${gameLabel(gameType)} — ${title}`,
      body: customizer.element,
      actions: [
        { label: 'انصراف', class: 'btn-ghost' },
        { label: primaryLabel, class: 'btn-primary', onClick: () => { onStart({ ...customizer.getConfig(), gameType }); } },
      ],
    });
  }

  function openRandom() {
    customizerModal('بازی تصادفی', 'جست‌وجوی حریف', (config) => startQueue(config));
  }

  function quickMatch() {
    const base = gameType === 'quoridor'
      ? { size: store.config?.defaultBoardSize || 9, walls: store.config?.defaultWalls || 10, theme: store.config?.defaultTheme || 'emerald', ranked: !!store.isLoggedIn }
      : { ranked: gameType === 'chess' && !!store.isLoggedIn };
    startQueue({ ...base, gameType });
  }

  function startQueue(config) {
    const onFound = ({ roomId, seat }) => {
      overlay.close();
      navigate(`/game/${roomId}`);
    };
    const overlay = queueOverlay(() => {
      socket.off('match:found', onFound);
      socket.emit('match:cancel');
      // returning nothing (undefined) lets the modal close
    });
    socket.once('match:found', onFound);
    socket.emit('match:queue', config, (res) => {
      if (res?.matched) { /* match:found will fire */ }
    });
  }

  function openPrivate() {
    customizerModal('ساخت اتاق خصوصی', 'ساخت اتاق', (config) => {
      socket.emit('room:createPrivate', config, (res) => {
        if (!res?.ok) return toast(res?.error || 'خطا در ساخت اتاق', 'error');
        navigate(`/game/${res.roomId}`);
      });
    });
  }

  function openAI() {
    const customizer = makeCustomizer(gameType, { showRanked: false });
    let difficulty = store.config?.aiDifficulty || 'normal';
    const diffSeg = h('div', { class: 'seg', style: 'margin-top:6px' });
    [['easy', 'آسان'], ['normal', 'متوسط'], ['hard', 'سخت']].forEach(([v, l]) => {
      const b = h('button', { class: v === difficulty ? 'active' : '' }, l);
      b.addEventListener('click', () => { difficulty = v; [...diffSeg.children].forEach((x) => x.classList.toggle('active', x === b)); });
      diffSeg.append(b);
    });
    modal({
      title: `${gameLabel(gameType)} — بازی با هوش مصنوعی`,
      body: h('div', {},
        h('div', { class: 'opt-group' }, h('label', {}, 'سطح سختی'), diffSeg),
        customizer.element),
      actions: [
        { label: 'انصراف', class: 'btn-ghost' },
        { label: 'شروع', class: 'btn-primary', onClick: () => {
          socket.emit('room:createAI', { config: { ...customizer.getConfig(), gameType }, difficulty }, (res) => {
            if (!res?.ok) return toast(res?.error || 'خطا', 'error');
            navigate(`/game/${res.roomId}`);
          });
        } },
      ],
    });
  }

  function openJoin() {
    const input = h('input', { class: 'input', placeholder: 'کد ۶ حرفی', maxlength: 6, style: 'text-transform:uppercase;letter-spacing:4px;text-align:center;font-size:1.3rem' });
    modal({
      title: 'ورود با کد دعوت',
      body: h('div', { class: 'field' }, input),
      actions: [
        { label: 'انصراف', class: 'btn-ghost' },
        { label: 'پیوستن', class: 'btn-primary', onClick: () => {
          const code = input.value.trim().toUpperCase();
          if (code.length !== 6) { toast('کد باید ۶ حرف باشد', 'error'); return true; }
          socket.emit('room:join', { code }, (res) => {
            if (!res?.ok) return toast(res?.error || 'اتاق پیدا نشد', 'error');
            navigate(`/game/${res.roomId}`);
          });
        } },
      ],
    });
    setTimeout(() => input.focus(), 50);
  }

  return view;
}

function modeCard(ico, title, desc, onClick) {
  return h('div', { class: 'card mode-card', onclick: onClick },
    h('div', { class: 'ico' }, ico),
    h('div', { class: 'card-title' }, title),
    h('p', { class: 'card-sub', style: 'margin:0' }, desc),
  );
}
function pill(text, live) {
  return h('span', { class: 'pill' }, live ? h('span', { class: 'dot' }) : null, text);
}
function queueOverlay(onCancel) {
  return modal({
    title: 'در حال جست‌وجوی حریف…',
    body: h('div', { class: 'center', style: 'padding:10px 0' },
      h('div', { class: 'queue-pulse', style: 'margin:10px auto 20px' }, h('div', { class: 'spinner' })),
      h('p', { class: 'muted' }, 'لطفاً صبر کن، داریم یک حریف مناسب پیدا می‌کنیم.'),
    ),
    actions: [{ label: 'لغو', class: 'btn-ghost', onClick: onCancel }],
  });
}
