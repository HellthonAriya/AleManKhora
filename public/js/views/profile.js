/* اِل من خورا — Profile & account settings */
import { h, api, store, toast, faNum, timeAgo, initials, applyTheme, PLAYER_COLORS, THEMES } from '../core.js';
import { refreshMe } from '../app.js';

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
    const { user, recent } = await api(`/profile/${encodeURIComponent(target)}`);
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
        ),
      ),
    );

    // recent games
    mount.append(h('div', { class: 'card', style: 'margin-top:20px' },
      h('div', { class: 'card-title' }, '📜 بازی‌های اخیر'),
      recent.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'نتیجه'), h('th', {}, 'حریف'), h('th', {}, 'حرکت‌ها'), h('th', {}, 'زمان'))),
        h('tbody', {}, ...recent.map((g) => {
          const oppName = g.p0_name === user.username ? g.p1_name : g.p0_name;
          return h('tr', {},
            h('td', {}, h('span', { class: 'badge ' + (g.result === 'win' ? 'badge-ok' : 'badge-ban') },
              g.result === 'win' ? 'برد' : (g.result === 'loss' ? 'باخت' : 'مساوی'))),
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
