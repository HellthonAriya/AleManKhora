/* اِل من خورا — Lobby: choose a mode, customize, and start playing */
import { h, store, toast, modal, faNum, $ } from '../core.js';
import { GameCustomizer } from '../components.js';
import { getSocket, navigate } from '../app.js';

export function LobbyView() {
  const socket = getSocket();
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
  const statsTimer = setInterval(refreshStats, 5000);
  const cleanup = () => clearInterval(statsTimer);

  const view = h('div', { class: 'fade-in', dataset: { cleanup: '1' } },
    h('div', {},
      h('h1', { class: 'section-title' }, 'سالن بازی'),
      h('p', { class: 'section-sub' }, `سلام ${store.displayName} 👋 — یک حالت بازی را انتخاب کن.`),
      statsPills,
    ),
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
  );

  view.addEventListener('view:destroy', cleanup);

  /* -------------------------- Mode handlers ----------------------------- */

  function customizerModal(title, primaryLabel, onStart, opts = {}) {
    const customizer = GameCustomizer(opts);
    modal({
      title,
      body: customizer.element,
      actions: [
        { label: 'انصراف', class: 'btn-ghost' },
        { label: primaryLabel, class: 'btn-primary', onClick: () => { onStart(customizer.getConfig()); } },
      ],
    });
  }

  function openRandom() {
    customizerModal('بازی تصادفی', 'جست‌وجوی حریف', (config) => startQueue(config));
  }

  function quickMatch() {
    startQueue({
      size: store.config?.defaultBoardSize || 9,
      walls: store.config?.defaultWalls || 10,
      theme: store.config?.defaultTheme || 'emerald',
      ranked: !!store.isLoggedIn,
    });
  }

  function startQueue(config) {
    const overlay = queueOverlay(() => socket.emit('match:cancel'));
    socket.once('match:found', ({ roomId, seat }) => {
      overlay.close();
      navigate(`/game/${roomId}`);
    });
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
    const customizer = GameCustomizer({ showRanked: false });
    let difficulty = store.config?.aiDifficulty || 'normal';
    const diffSeg = h('div', { class: 'seg', style: 'margin-top:6px' });
    [['easy', 'آسان'], ['normal', 'متوسط'], ['hard', 'سخت']].forEach(([v, l]) => {
      const b = h('button', { class: v === difficulty ? 'active' : '' }, l);
      b.addEventListener('click', () => { difficulty = v; [...diffSeg.children].forEach((x) => x.classList.toggle('active', x === b)); });
      diffSeg.append(b);
    });
    modal({
      title: 'بازی با هوش مصنوعی',
      body: h('div', {},
        h('div', { class: 'opt-group' }, h('label', {}, 'سطح سختی'), diffSeg),
        customizer.element),
      actions: [
        { label: 'انصراف', class: 'btn-ghost' },
        { label: 'شروع', class: 'btn-primary', onClick: () => {
          socket.emit('room:createAI', { config: customizer.getConfig(), difficulty }, (res) => {
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
