/* اَلِ من خورا — Profile & account settings */
import { h, api, store, toast, faNum, timeAgo, initials, applyTheme, PLAYER_COLORS, THEMES } from '../core.js';
import { refreshMe } from '../app.js';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from '../achievements.js';

const GAME_NAMES = {
  quoridor: '🧱 اَلِ من خورا', chess: '♛ شطرنج', chess4: '♞ شطرنج ۴ نفره',
  chesszade: '🔀 شطرنج زاده‌ای', hokm: '🃏 حکم', pasur: '🎴 پاسور',
  backgammon: '🎲 تخته‌نرد', othello: '⚫ اوتلو', gomoku: '⬤ گوموکو',
  dots: '▦ نقطه‌خط', tictactoe: '✕ دوز',
};

export async function ProfileView(username) {
  const target = username || store.displayName;
  const mount = h('div', { class: 'fade-in' },
    h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' }), 'در حال بارگذاری…'));

  if (!target || (store.me?.isGuest && !username)) {
    return h('div', { class: 'card center fade-in' },
      h('p', { class: 'muted' }, 'برای دیدن پروفایل باید وارد حساب شوی.'),
      h('a', { class: 'btn btn-primary', href: '#/play', 'data-link': true, style: 'margin-top:14px' }, 'ورود / ثبت‌نام'));
  }

  try {
    const { user, recent, gameStats, achievements } = await api(`/profile/${encodeURIComponent(target)}`);
    mount.innerHTML = '';
    const isMe = store.isLoggedIn && store.me.id === user.id;
    const winRate = user.gamesPlayed ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;

    mount.append(
      h('div', { class: 'card' },
        h('div', { class: 'profile-head' },
          h('div', { class: 'profile-avatar', style: `background:${user.avatarColor}` }, initials(user.username)),
          h('div', { style: 'flex:1' },
            h('h1', { style: 'margin:0' }, user.username,
              user.isAdmin ? h('span', { class: 'badge badge-admin', style: 'margin-inline-start:10px' }, 'مدیر') : null),
            h('p', { class: 'muted' }, `عضو از ${timeAgo(user.createdAt)} · آخرین بازدید ${timeAgo(user.lastSeen)}`),
          ),
          h('div', { style: 'text-align:center' },
            h('div', { style: 'font-size:2.4rem;font-weight:800;color:var(--accent)' }, faNum(user.elo)),
            h('div', { class: 'faint' }, 'امتیاز ELO')),
        ),
        h('div', { class: 'stat-grid' },
          statBox(user.gamesPlayed, 'بازی'),
          statBox(user.wins, 'برد'),
          statBox(user.losses, 'باخت'),
          statBox(faNum(winRate) + '٪', 'نرخ برد'),
          user.predTotal ? statBox(faNum(Math.round((user.predCorrect / user.predTotal) * 100)) + '٪', 'دقت پیش‌بینی') : null,
        ),
      ),
    );

    // achievements / badges
    {
      const earnedAt = {};
      (achievements || []).forEach((a) => { earnedAt[a.code] = a.earned_at; });
      const earnedCount = Object.keys(earnedAt).length;
      const grid = h('div', { class: 'badge-grid' });
      ACHIEVEMENTS.forEach((a) => {
        const got = earnedAt[a.code] != null;
        grid.append(h('div', { class: 'badge-tile' + (got ? ' got' : ''), title: a.desc },
          h('div', { class: 'badge-ico' }, a.icon),
          h('div', { class: 'badge-name' }, a.name),
          h('div', { class: 'badge-desc faint' }, got ? `🔓 ${timeAgo(earnedAt[a.code])}` : a.desc)));
      });
      mount.append(h('div', { class: 'card', style: 'margin-top:20px' },
        h('div', { class: 'card-title' }, `🏅 دستاوردها (${faNum(earnedCount)} از ${faNum(ACHIEVEMENTS.length)})`),
        grid));
    }

    // per-game stats
    if (gameStats && gameStats.length) {
      mount.append(h('div', { class: 'card', style: 'margin-top:20px' },
        h('div', { class: 'card-title' }, '🎯 آمار به تفکیک بازی'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'بازی'), h('th', {}, 'بازی‌ها'), h('th', {}, 'برد'), h('th', {}, 'باخت'), h('th', {}, 'مساوی'), h('th', {}, 'امتیاز'))),
          h('tbody', {}, ...gameStats.map((s) => {
            const wr = s.played ? Math.round((s.wins / s.played) * 100) : 0;
            return h('tr', {},
              h('td', {}, GAME_NAMES[s.game_type] || s.game_type),
              h('td', {}, faNum(s.played)),
              h('td', {}, h('span', { style: 'color:var(--ok,#13c08a)' }, faNum(s.wins)), h('span', { class: 'faint', style: 'font-size:.72rem' }, ` (${faNum(wr)}٪)`)),
              h('td', {}, faNum(s.losses)),
              h('td', {}, faNum(s.draws)),
              h('td', {}, h('strong', { style: 'color:var(--accent)' }, faNum(s.rating))));
          })))),
      ));
    }

    // recent games
    mount.append(h('div', { class: 'card', style: 'margin-top:20px' },
      h('div', { class: 'card-title' }, '📜 بازی‌های اخیر'),
      recent.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'نتیجه'), h('th', {}, 'بازی'), h('th', {}, 'حریف'), h('th', {}, 'حرکت‌ها'), h('th', {}, 'زمان'))),
        h('tbody', {}, ...recent.map((g) => {
          const oppName = g.p0_name === user.username ? g.p1_name : g.p0_name;
          return h('tr', {},
            h('td', {}, h('span', { class: 'badge ' + (g.result === 'win' ? 'badge-ok' : 'badge-ban') },
              g.result === 'win' ? 'برد' : (g.result === 'loss' ? 'باخت' : 'مساوی'))),
            h('td', { class: 'faint' }, GAME_NAMES[g.gameType] || g.gameType || '—'),
            h('td', {}, oppName || '—'),
            h('td', {}, faNum(g.moveCount)),
            h('td', {}, timeAgo(g.finishedAt)));
        })))) : h('p', { class: 'muted' }, 'هنوز بازی‌ای انجام نشده.'),
    ));

    if (isMe) mount.append(SettingsCard(user));
  } catch (e) {
    mount.innerHTML = '';
    mount.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'کاربر پیدا نشد.')));
  }
  return mount;
}

function statBox(num, lbl) {
  return h('div', { class: 'stat-box' }, h('div', { class: 'num' }, typeof num === 'number' ? faNum(num) : num), h('div', { class: 'lbl' }, lbl));
}

function SettingsCard(user) {
  const card = h('div', { class: 'card', style: 'margin-top:20px' });
  card.append(h('div', { class: 'card-title' }, '⚙️ تنظیمات حساب'));

  // avatar color
  const colorWrap = h('div', { class: 'swatches' });
  let chosen = user.avatarColor;
  PLAYER_COLORS.forEach((c) => colorWrap.append(h('div', {
    class: 'swatch' + (c === chosen ? ' active' : ''), style: `background:${c}`,
    onclick: () => { chosen = c; [...colorWrap.children].forEach((x, i) => x.classList.toggle('active', PLAYER_COLORS[i] === c)); },
  })));

  // theme preference
  const prefs = user.prefs || {};
  const themeRow = h('div', { class: 'theme-row' });
  let theme = prefs.theme || document.body.dataset.theme;
  THEMES.forEach((t) => themeRow.append(h('div', {
    class: 'theme-chip' + (t.id === theme ? ' active' : ''), title: t.name,
    style: `background:linear-gradient(135deg,${t.from},${t.to})`,
    onclick: () => { theme = t.id; applyTheme(t.id); [...themeRow.children].forEach((c, i) => c.classList.toggle('active', THEMES[i].id === theme)); },
  })));

  card.append(
    h('div', { class: 'opt-group' }, h('label', {}, 'رنگ آواتار'), colorWrap),
    h('div', { class: 'opt-group' }, h('label', {}, 'تم پیش‌فرض رابط'), themeRow),
    h('button', { class: 'btn btn-primary', onclick: async () => {
      try {
        await api('/profile', { method: 'PATCH', body: { avatarColor: chosen, prefs: { ...prefs, theme } } });
        await refreshMe();
        toast('تنظیمات ذخیره شد', 'success');
      } catch (e) { toast(e.message, 'error'); }
    } }, 'ذخیرهٔ تنظیمات'),
  );

  // change password
  const cur = h('input', { class: 'input', type: 'password', placeholder: 'رمز فعلی' });
  const nxt = h('input', { class: 'input', type: 'password', placeholder: 'رمز جدید' });
  card.append(
    h('hr', { style: 'border:none;border-top:1px solid var(--border);margin:20px 0' }),
    h('div', { class: 'card-title', style: 'font-size:1rem' }, 'تغییر رمز عبور'),
    h('div', { class: 'row', style: 'margin-top:10px' }, cur, nxt),
    h('button', { class: 'btn', style: 'margin-top:12px', onclick: async () => {
      try {
        await api('/profile/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
        cur.value = nxt.value = '';
        toast('رمز عبور تغییر کرد', 'success');
      } catch (e) { toast(e.message, 'error'); }
    } }, 'تغییر رمز'),
  );
  return card;
}
