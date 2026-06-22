/* اَلِ من خورا — Friends: requests, online presence, add/remove */
import { h, api, toast, faNum, initials, clear, timeAgo, store } from '../core.js';

export function FriendsView() {
  if (store.me?.isGuest) {
    return h('div', { class: 'card center fade-in' },
      h('p', { class: 'muted' }, 'برای داشتن لیست دوستان باید حساب بسازی.'),
      h('a', { class: 'btn btn-primary', href: '#/register', 'data-link': true, style: 'margin-top:14px' }, 'ساخت حساب'));
  }

  const listMount = h('div', {});
  const reqMount = h('div', {});
  const searchResults = h('div', { class: 'friend-search-results' });
  const searchInput = h('input', { class: 'input', placeholder: 'جست‌وجوی نام کاربری…', oninput: onSearch });

  let searchTimer = null;
  function onSearch() {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { clear(searchResults); return; }
    searchTimer = setTimeout(async () => {
      try {
        const { results } = await api(`/friends/search?q=${encodeURIComponent(q)}`);
        clear(searchResults);
        if (!results.length) { searchResults.append(h('p', { class: 'faint', style: 'padding:6px' }, 'کاربری پیدا نشد.')); return; }
        results.forEach((u) => searchResults.append(personRow(u, u.isFriend
          ? h('span', { class: 'badge badge-ok' }, 'دوست')
          : h('button', { class: 'btn btn-sm btn-primary', onclick: async (e) => {
              e.target.disabled = true;
              const r = await api('/friends/request', { method: 'POST', body: { userId: u.id } }).catch(() => null);
              toast(r?.accepted ? 'حالا دوست شدید!' : r?.requested ? 'درخواست فرستاده شد' : 'از قبل در فهرست بود');
              load();
            } }, '➕ افزودن'))));
      } catch { /* ignore */ }
    }, 250);
  }

  function personRow(u, action) {
    return h('div', { class: 'friend-row' },
      h('a', { href: `#/u/${encodeURIComponent(u.username)}`, 'data-link': true, class: 'friend-id' },
        h('span', { class: 'nav-avatar', style: `background:${u.avatarColor}` }, initials(u.username)),
        h('div', {},
          h('div', {}, h('strong', {}, u.username),
            u.online ? h('span', { class: 'online-dot', title: 'آنلاین' }) : null),
          h('div', { class: 'faint', style: 'font-size:.72rem' }, u.online ? 'آنلاین' : (u.lastSeen ? `آخرین بازدید ${timeAgo(u.lastSeen)}` : '')))),
      action);
  }

  async function load() {
    try {
      const { friends, incoming, outgoing } = await api('/friends');
      // incoming requests
      clear(reqMount);
      if (incoming.length) {
        reqMount.append(h('div', { class: 'card', style: 'margin-bottom:18px' },
          h('div', { class: 'card-title' }, `📨 درخواست‌های دوستی (${faNum(incoming.length)})`),
          ...incoming.map((u) => personRow(u, h('div', { style: 'display:flex;gap:6px' },
            h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { await api('/friends/accept', { method: 'POST', body: { userId: u.id } }); toast('دوست اضافه شد', 'success'); load(); } }, 'قبول'),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api('/friends/remove', { method: 'POST', body: { userId: u.id } }); load(); } }, 'رد'))))));
      }
      // friends list
      clear(listMount);
      const onlineCount = friends.filter((f) => f.online).length;
      const card = h('div', { class: 'card' },
        h('div', { class: 'card-title' }, `👥 دوستان (${faNum(onlineCount)} آنلاین از ${faNum(friends.length)})`));
      if (!friends.length) {
        card.append(h('p', { class: 'muted' }, 'هنوز دوستی اضافه نکرده‌ای. از بالا جست‌وجو کن!'));
      } else {
        // online first
        friends.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
        friends.forEach((u) => card.append(personRow(u,
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (confirm(`حذف ${u.username} از دوستان؟`)) { await api('/friends/remove', { method: 'POST', body: { userId: u.id } }); load(); } } }, 'حذف'))));
      }
      listMount.append(card);
      if (outgoing.length) {
        listMount.append(h('div', { class: 'card', style: 'margin-top:18px' },
          h('div', { class: 'card-title' }, `⏳ درخواست‌های در انتظار (${faNum(outgoing.length)})`),
          ...outgoing.map((u) => personRow(u, h('span', { class: 'faint' }, 'در انتظار…')))));
      }
    } catch (e) {
      clear(listMount);
      listMount.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'خطا در بارگذاری دوستان.')));
    }
  }

  load();
  return h('div', { class: 'fade-in' },
    h('h1', { class: 'section-title' }, '👥 دوستان'),
    h('p', { class: 'section-sub' }, 'دوست اضافه کن، ببین کی آنلاین است و از داخل بازی مستقیم دعوتش کن.'),
    h('div', { class: 'card', style: 'margin:16px 0' },
      h('div', { class: 'card-title' }, '🔍 افزودن دوست'),
      searchInput, searchResults),
    reqMount,
    listMount);
}
