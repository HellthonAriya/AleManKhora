/* اَلِ من خورا — Leaderboard (overall ELO, per-game, and monthly season) */
import { h, api, faNum, initials, clear } from '../core.js';

const GAME_NAMES = {
  quoridor: '🧱 اَلِ من خورا', chess: '♛ شطرنج', chess4: '♞ شطرنج ۴ نفره',
  chesszade: '🔀 شطرنج زاده‌ای', hokm: '🃏 حکم', pasur: '🎴 پاسور',
  backgammon: '🎲 تخته‌نرد', othello: '⚫ اوتلو', gomoku: '⬤ گوموکو',
  dots: '▦ نقطه‌خط', tictactoe: '✕ دوز',
};

export function LeaderboardView() {
  let scope = 'overall'; // overall | season | <gameType>
  const sub = h('p', { class: 'section-sub' });
  const tabs = h('div', { class: 'seg', style: 'flex-wrap:wrap' });
  const gameSel = h('select', { class: 'input', style: 'max-width:200px',
    onchange: () => { scope = gameSel.value; syncTabs(); load(); } });
  gameSel.append(h('option', { value: '' }, '— بر اساس بازی —'));
  Object.entries(GAME_NAMES).forEach(([id, name]) => gameSel.append(h('option', { value: id }, name)));
  const body = h('div', {}, h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' }), 'در حال بارگذاری…'));

  function tab(label, value) {
    const b = h('button', { class: scope === value ? 'active' : '', onclick: () => { scope = value; gameSel.value = ''; syncTabs(); load(); } }, label);
    return b;
  }
  function syncTabs() {
    clear(tabs);
    tabs.append(tab('کلی (ELO)', 'overall'), tab('فصل ماهانه', 'season'));
    [...tabs.children].forEach((b) => b.classList.toggle('active',
      (scope === 'overall' && b.textContent === 'کلی (ELO)') || (scope === 'season' && b.textContent === 'فصل ماهانه')));
    tabs.append(gameSel);
  }

  async function load() {
    clear(body);
    body.append(h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' }), 'در حال بارگذاری…'));
    try {
      const q = scope === 'overall' ? '' : scope === 'season' ? '?scope=season' : `?game=${scope}`;
      const res = await api(`/leaderboard${q}`);
      clear(body);
      const list = res.leaderboard || [];
      sub.textContent = res.scope === 'season' ? `بیشترین برد در این ماه (${res.season})`
        : res.scope === 'game' ? `رتبه‌بندی ${GAME_NAMES[res.game] || res.game} بر اساس امتیاز این بازی`
        : 'برترین بازیکنان بر اساس امتیاز ELO کلی.';
      if (!list.length) {
        body.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'هنوز داده‌ای برای این جدول نیست.')));
        return;
      }
      body.append(renderTable(res.scope, list));
    } catch (e) {
      clear(body);
      body.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'خطا در بارگذاری جدول.')));
    }
  }

  function renderTable(sc, list) {
    const isSeason = sc === 'season';
    const isGame = sc === 'game';
    const scoreLabel = isSeason ? 'برد این ماه' : isGame ? 'امتیاز بازی' : 'امتیاز';
    const head = isSeason
      ? [h('th', {}, 'رتبه'), h('th', {}, 'بازیکن'), h('th', {}, scoreLabel)]
      : [h('th', {}, 'رتبه'), h('th', {}, 'بازیکن'), h('th', {}, scoreLabel), h('th', {}, 'بازی'), h('th', {}, 'برد'), h('th', {}, 'باخت'), h('th', {}, 'نرخ برد')];
    const rows = list.map((u, i) => {
      const rank = i + 1;
      const medal = h('td', {}, h('span', { class: `rank-medal rank-${rank}` }, rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : faNum(rank)));
      const who = h('td', {}, h('a', { href: `#/u/${encodeURIComponent(u.username)}`, 'data-link': true, style: 'display:inline-flex;align-items:center;gap:10px' },
        h('span', { class: 'nav-avatar', style: `background:${u.avatarColor}` }, initials(u.username)),
        h('strong', {}, u.username)));
      if (isSeason) return h('tr', {}, medal, who, h('td', {}, h('strong', { style: 'color:var(--accent)' }, faNum(u.wins))));
      const score = isGame ? u.rating : u.elo;
      const winRate = u.gamesPlayed ? Math.round((u.wins / u.gamesPlayed) * 100) : 0;
      return h('tr', {}, medal, who,
        h('td', {}, h('strong', { style: 'color:var(--accent)' }, faNum(score))),
        h('td', {}, faNum(u.gamesPlayed)), h('td', {}, faNum(u.wins)),
        h('td', {}, faNum(u.losses)), h('td', {}, faNum(winRate) + '٪'));
    });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
  }

  syncTabs();
  load();
  return h('div', { class: 'fade-in' },
    h('h1', { class: 'section-title' }, '🏆 جدول رتبه‌بندی'),
    sub,
    h('div', { style: 'margin:14px 0' }, tabs),
    body);
}
