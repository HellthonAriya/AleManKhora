/* اَل من خورا — Leaderboard */
import { h, api, faNum, initials } from '../core.js';

export async function LeaderboardView() {
  const mount = h('div', { class: 'fade-in' },
    h('h1', { class: 'section-title' }, '🏆 جدول رتبه‌بندی'),
    h('p', { class: 'section-sub' }, 'برترین بازیکنان اَل من خورا بر اساس امتیاز ELO.'),
    h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' }), 'در حال بارگذاری…'),
  );

  try {
    const { leaderboard } = await api('/leaderboard');
    mount.removeChild(mount.lastChild);
    if (!leaderboard.length) {
      mount.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'هنوز بازی‌ای ثبت نشده. اولین قهرمان تو باش!')));
      return mount;
    }
    const rows = leaderboard.map((u, i) => {
      const rank = i + 1;
      const winRate = u.gamesPlayed ? Math.round((u.wins / u.gamesPlayed) * 100) : 0;
      return h('tr', {},
        h('td', {}, h('span', { class: `rank-medal rank-${rank}` }, rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : faNum(rank))),
        h('td', {},
          h('a', { href: `#/u/${encodeURIComponent(u.username)}`, 'data-link': true, style: 'display:inline-flex;align-items:center;gap:10px' },
            h('span', { class: 'nav-avatar', style: `background:${u.avatarColor}` }, initials(u.username)),
            h('strong', {}, u.username))),
        h('td', {}, h('strong', { style: 'color:var(--accent)' }, faNum(u.elo))),
        h('td', {}, faNum(u.gamesPlayed)),
        h('td', {}, faNum(u.wins)),
        h('td', {}, faNum(u.losses)),
        h('td', {}, faNum(winRate) + '٪'),
      );
    });
    mount.append(h('div', { class: 'table-wrap' },
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'رتبه'), h('th', {}, 'بازیکن'), h('th', {}, 'امتیاز'),
          h('th', {}, 'بازی'), h('th', {}, 'برد'), h('th', {}, 'باخت'), h('th', {}, 'نرخ برد'))),
        h('tbody', {}, ...rows))));
  } catch (e) {
    mount.removeChild(mount.lastChild);
    mount.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'خطا در بارگذاری جدول.')));
  }
  return mount;
}
