/* اَلِ من خورا — Admin panel */
import { h, api, store, toast, faNum, timeAgo, clear, confirmDialog, modal } from '../core.js';

export async function AdminView() {
  if (!store.isAdmin) {
    return h('div', { class: 'card center fade-in' }, h('p', { class: 'muted' }, '⛔ دسترسی مدیریت لازم است.'));
  }
  let tab = 'dashboard';
  const tabsBar = h('div', { class: 'admin-tabs' });
  const body = h('div', {});
  const TABS = [['dashboard', '📊 داشبورد'], ['users', '👥 کاربران'], ['games', '🎮 بازی‌ها'], ['settings', '⚙️ تنظیمات سایت']];
  TABS.forEach(([id, label]) => {
    const b = h('button', { class: id === tab ? 'active' : '' }, label);
    b.addEventListener('click', () => { tab = id; [...tabsBar.children].forEach((x) => x.classList.toggle('active', x === b)); render(); });
    tabsBar.append(b);
  });

  async function render() {
    clear(body);
    body.append(h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' })));
    try {
      if (tab === 'dashboard') clear(body).append(await Dashboard());
      else if (tab === 'users') clear(body).append(await UsersTab());
      else if (tab === 'games') clear(body).append(await GamesTab());
      else if (tab === 'settings') clear(body).append(await SettingsTab());
    } catch (e) {
      clear(body).append(h('p', { class: 'muted' }, 'خطا: ' + e.message));
    }
  }
  render();

  return h('div', { class: 'fade-in' },
    h('h1', { class: 'section-title' }, '🛡 پنل مدیریت'),
    h('p', { class: 'section-sub' }, 'مدیریت کاربران، بازی‌ها و پیکربندی سایت.'),
    tabsBar, body);
}

/* ------------------------------ Dashboard -------------------------------- */
async function Dashboard() {
  const { users, games, live } = await api('/admin/stats');
  return h('div', {},
    h('div', { class: 'kpi-grid' },
      kpi(users, 'کاربران'),
      kpi(games.total, 'کل بازی‌ها'),
      kpi(games.finished, 'بازی تمام‌شده'),
      kpi(live.online, 'آنلاین اکنون'),
      kpi(live.activeGames, 'بازی فعال'),
      kpi(live.queue, 'در صف انتظار'),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'وضعیت زنده'),
      h('p', { class: 'muted' }, `${faNum(live.rooms)} اتاق در حافظه · ${faNum(live.online)} اتصال فعال`)),
  );
}
function kpi(num, lbl) {
  return h('div', { class: 'kpi' }, h('div', { class: 'num' }, faNum(num)), h('div', { class: 'lbl' }, lbl));
}

/* -------------------------------- Users ---------------------------------- */
async function UsersTab() {
  const wrap = h('div', {});
  const search = h('input', { class: 'input', placeholder: '🔍 جست‌وجوی نام کاربری یا ایمیل…', style: 'max-width:340px;margin-bottom:16px',
    oninput: debounce((e) => load(e.target.value), 350) });
  const tableMount = h('div', {});
  wrap.append(search, tableMount);

  async function load(q = '') {
    clear(tableMount).append(h('div', { class: 'loading-wrap' }, h('div', { class: 'spinner' })));
    const { users } = await api('/admin/users?q=' + encodeURIComponent(q));
    clear(tableMount).append(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'کاربر'), h('th', {}, 'ایمیل'), h('th', {}, 'ELO'),
        h('th', {}, 'برد/باخت'), h('th', {}, 'وضعیت'), h('th', {}, 'عضویت'), h('th', {}, 'عملیات'))),
      h('tbody', {}, ...users.map((u) => userRow(u, () => load(search.value)))))));
  }
  load();
  return wrap;
}

function userRow(u, reload) {
  const statusBadges = [
    u.isAdmin ? h('span', { class: 'badge badge-admin' }, 'مدیر') : null,
    u.isBanned ? h('span', { class: 'badge badge-ban' }, 'مسدود') : h('span', { class: 'badge badge-ok' }, 'فعال'),
  ];
  const actions = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    h('button', { class: 'btn btn-sm', onclick: async () => {
      await api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { banned: !u.isBanned } });
      toast(u.isBanned ? 'رفع مسدودیت شد' : 'کاربر مسدود شد', 'success'); reload();
    } }, u.isBanned ? 'رفع مسدودیت' : 'مسدود'),
    h('button', { class: 'btn btn-sm', onclick: async () => {
      await api(`/admin/users/${u.id}/admin`, { method: 'POST', body: { admin: !u.isAdmin } }).catch((e) => toast(e.message, 'error'));
      reload();
    } }, u.isAdmin ? 'سلب مدیریت' : 'ارتقا به مدیر'),
    h('button', { class: 'btn btn-sm', onclick: () => resetPw(u) }, 'رمز جدید'),
    u.id !== store.me.id ? h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
      if (await confirmDialog('حذف کاربر', `«${u.username}» برای همیشه حذف شود؟`, { danger: true, confirmLabel: 'حذف' })) {
        await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('کاربر حذف شد', 'success'); reload();
      }
    } }, 'حذف') : null,
  );
  return h('tr', {},
    h('td', {}, h('strong', {}, u.username)),
    h('td', {}, u.email || '—'),
    h('td', {}, faNum(u.elo)),
    h('td', {}, `${faNum(u.wins)} / ${faNum(u.losses)}`),
    h('td', {}, ...statusBadges),
    h('td', {}, timeAgo(u.createdAt)),
    h('td', {}, actions));
}

function resetPw(u) {
  const input = h('input', { class: 'input', type: 'text', placeholder: 'رمز جدید (حداقل ۶ کاراکتر)' });
  modal({
    title: `رمز جدید برای ${u.username}`,
    body: h('div', { class: 'field' }, input),
    actions: [
      { label: 'انصراف', class: 'btn-ghost' },
      { label: 'تنظیم', class: 'btn-primary', onClick: async () => {
        try { await api(`/admin/users/${u.id}/password`, { method: 'POST', body: { password: input.value } }); toast('رمز تغییر کرد', 'success'); }
        catch (e) { toast(e.message, 'error'); return true; }
      } },
    ],
  });
}

/* -------------------------------- Games ---------------------------------- */
async function GamesTab() {
  const { games } = await api('/admin/games');
  if (!games.length) return h('div', { class: 'card' }, h('p', { class: 'muted' }, 'هنوز بازی‌ای ثبت نشده.'));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, h('th', {}, 'شناسه'), h('th', {}, 'حالت'), h('th', {}, 'بازیکنان'),
      h('th', {}, 'وضعیت'), h('th', {}, 'حرکت‌ها'), h('th', {}, 'زمان'))),
    h('tbody', {}, ...games.map((g) => h('tr', {},
      h('td', {}, g.id.slice(0, 8)),
      h('td', {}, modeLabel(g.mode)),
      h('td', {}, `${g.p0_name || '—'} ⚔ ${g.p1_name || '—'}`),
      h('td', {}, statusLabel(g.status)),
      h('td', {}, faNum(g.move_count)),
      h('td', {}, timeAgo(g.created_at)))))));
}
function modeLabel(m) { return { private: 'خصوصی', random: 'تصادفی', ai: 'هوش مصنوعی' }[m] || m; }
function statusLabel(s) {
  const map = { waiting: ['در انتظار', ''], active: ['فعال', 'badge-ok'], finished: ['تمام', 'badge-admin'], aborted: ['لغو', 'badge-ban'] };
  const [t, c] = map[s] || [s, ''];
  return h('span', { class: 'badge ' + c }, t);
}

/* ------------------------------ Settings --------------------------------- */
async function SettingsTab() {
  const { settings } = await api('/admin/settings');
  const fields = {};
  const wrap = h('div', { class: 'card' });
  wrap.append(h('div', { class: 'card-title' }, 'پیکربندی سایت'));

  const text = (key, label) => {
    const inp = h('input', { class: 'input', value: settings[key] || '' });
    fields[key] = () => inp.value;
    return h('div', { class: 'field' }, h('label', {}, label), inp);
  };
  const toggle = (key, label) => {
    const inp = h('input', { type: 'checkbox', checked: settings[key] === 'true' });
    fields[key] = () => (inp.checked ? 'true' : 'false');
    return h('label', { class: 'field', style: 'display:flex;align-items:center;gap:10px;cursor:pointer' }, inp, h('span', {}, label));
  };
  const select = (key, label, opts) => {
    const sel = h('select', { class: 'input' }, ...opts.map(([v, l]) => h('option', { value: v, selected: settings[key] === v }, l)));
    fields[key] = () => sel.value;
    return h('div', { class: 'field' }, h('label', {}, label), sel);
  };

  wrap.append(
    text('site_name', 'نام سایت'),
    h('div', { class: 'row' }, toggle('allow_registration', 'اجازهٔ ثبت‌نام'), toggle('allow_guest', 'اجازهٔ بازی مهمان')),
    h('div', { class: 'row' },
      select('default_board_size', 'اندازهٔ پیش‌فرض صفحه', [['5', '۵×۵'], ['7', '۷×۷'], ['9', '۹×۹'], ['11', '۱۱×۱۱']]),
      text('default_walls', 'تعداد دیوار پیش‌فرض')),
    h('div', { class: 'row' },
      select('default_theme', 'تم پیش‌فرض', [['emerald', 'زمرد'], ['midnight', 'نیمه‌شب'], ['sunset', 'غروب'], ['sakura', 'شکوفه'], ['ocean', 'اقیانوس'], ['mono', 'مونو']]),
      select('ai_difficulty', 'سختی پیش‌فرض هوش مصنوعی', [['easy', 'آسان'], ['normal', 'متوسط'], ['hard', 'سخت']])),
    h('div', { class: 'field' }, h('label', {}, 'اعلان سراسری (در صفحهٔ اصلی نمایش داده می‌شود)'),
      h('textarea', { class: 'input', rows: 2, id: 'amk-announce' }, settings.announcement || '')),
    h('button', { class: 'btn btn-primary', onclick: async () => {
      const payload = {};
      for (const [k, get] of Object.entries(fields)) payload[k] = get();
      payload.announcement = document.getElementById('amk-announce').value;
      try { await api('/admin/settings', { method: 'PATCH', body: payload }); toast('تنظیمات ذخیره شد', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'ذخیرهٔ تنظیمات'),
  );
  return wrap;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
