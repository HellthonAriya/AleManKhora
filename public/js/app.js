/* =========================================================================
   اَلِ من خورا — App shell: router, navbar, socket, boot
   ========================================================================= */
import { h, $, $$, store, api, clear, toast, applyTheme, initials } from './core.js';
import { HomeView } from './views/home.js';
import { AuthView } from './views/auth.js';
import { LobbyView } from './views/lobby.js';
import { GameView } from './views/game.js';
import { LeaderboardView } from './views/leaderboard.js';
import { ProfileView } from './views/profile.js';
import { AdminView } from './views/admin.js';

/* -------------------------------- Socket --------------------------------- */
let socket = null;
export function getSocket() {
  if (!socket) {
    socket = io({ withCredentials: true });
    socket.on('connect_error', () => toast('اتصال بلادرنگ برقرار نشد', 'error'));
  }
  return socket;
}

/* ------------------------------ Navigation ------------------------------- */
let pendingPath = null;
/** After a successful login/guest sign-in, go to the originally requested page. */
export function redirectAfterAuth(fallback = '/lobby') {
  const target = pendingPath || fallback;
  pendingPath = null;
  navigate(target);
}

export function navigate(path) {
  if (!path.startsWith('#')) path = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === path) router();
  else location.hash = path;
}

export async function refreshMe() {
  const { auth } = await api('/me');
  store.set({ me: auth });
  if (auth && !auth.isGuest && auth.prefs?.theme) applyTheme(auth.prefs.theme);
  renderNav();
}

/* -------------------------------- Router --------------------------------- */
const routes = [
  { re: /^\/?$/, view: () => HomeView() },
  { re: /^\/play$/, view: () => AuthView('login') },
  { re: /^\/register$/, view: () => AuthView('register') },
  { re: /^\/lobby$/, view: () => LobbyView(), auth: true },
  { re: /^\/game\/([\w-]+)$/, view: (m) => GameView(m[1]), auth: true },
  { re: /^\/leaderboard$/, view: () => LeaderboardView() },
  { re: /^\/profile$/, view: () => ProfileView(), auth: true },
  { re: /^\/u\/(.+)$/, view: (m) => ProfileView(decodeURIComponent(m[1])) },
  { re: /^\/admin$/, view: () => AdminView(), admin: true },
];

let currentView = null;
async function router() {
  const path = (location.hash || '#/').slice(1) || '/';
  const appEl = $('#app');

  // Tear down previous view (cleanup timers / socket handlers).
  if (currentView) {
    currentView.dispatchEvent(new CustomEvent('view:destroy'));
    currentView = null;
  }

  const match = routes.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) { clear(appEl).append(NotFound()); return; }
  const { r, m } = match;

  // Guard: require login (guests allowed for auth:true that just needs identity)
  if (r.auth && !store.me) { pendingPath = path; navigate('/play'); return; }
  if (r.admin && !store.isAdmin) {
    clear(appEl).append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, '⛔ دسترسی غیرمجاز')));
    return;
  }

  try {
    const node = await r.view(m);
    clear(appEl);
    appEl.append(node);
    currentView = node;
    window.scrollTo(0, 0);
    updateActiveNav(path);
  } catch (e) {
    console.error(e);
    clear(appEl).append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'خطا در بارگذاری صفحه.')));
  }
}

function NotFound() {
  return h('div', { class: 'card center fade-in' },
    h('h1', {}, '۴۰۴'),
    h('p', { class: 'muted' }, 'این صفحه پیدا نشد.'),
    h('a', { class: 'btn btn-primary', href: '#/', 'data-link': true, style: 'margin-top:14px' }, 'بازگشت به خانه'));
}

/* -------------------------------- Navbar --------------------------------- */
function renderNav() {
  const nav = $('#topnav');
  clear(nav);

  if (store.me) {
    // ---- Primary navigation links (single row) ----
    const links = h('div', { class: 'nav-links' },
      link('#/lobby', '🎮', 'سالن بازی'),
      link('#/leaderboard', '🏆', 'رتبه‌بندی'),
    );
    if (store.isAdmin) links.append(link('#/admin', '🛡', 'مدیریت'));
    nav.append(links);

    // ---- User menu (avatar chip + dropdown) ----
    const name = store.displayName;
    const color = store.me.avatarColor || '#13c08a';
    const isGuest = store.me.isGuest;

    const menu = h('div', { class: 'nav-menu' },
      h('a', { class: 'nav-menu-item', href: '#/profile', 'data-link': true }, '👤 نمایه من'),
      isGuest ? h('a', { class: 'nav-menu-item', href: '#/register', 'data-link': true }, '✨ ساخت حساب') : null,
      h('div', { class: 'nav-menu-sep' }),
      h('button', { class: 'nav-menu-item danger', onclick: (e) => { e.stopPropagation(); logout(); } }, '🚪 خروج'),
    );

    const chip = h('div', { class: 'nav-chip', tabindex: '0' },
      h('span', { class: 'nav-avatar', style: `background:${color}` }, initials(name)),
      h('span', { class: 'nav-chip-name' }, name),
      isGuest ? h('span', { class: 'nav-chip-tag' }, 'مهمان') : null,
      h('span', { class: 'nav-chip-caret' }, '▾'),
    );

    const userBox = h('div', { class: 'nav-user' }, chip, menu);
    const toggle = (e) => { e.stopPropagation(); userBox.classList.toggle('open'); };
    chip.addEventListener('click', toggle);
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
    document.addEventListener('click', () => userBox.classList.remove('open'));
    nav.append(userBox);
  } else {
    nav.append(h('div', { class: 'nav-links' }, link('#/leaderboard', '🏆', 'رتبه‌بندی')));
    nav.append(h('a', { class: 'btn btn-ghost btn-sm', href: '#/play', 'data-link': true }, 'ورود'));
    nav.append(h('a', { class: 'btn btn-primary btn-sm', href: '#/register', 'data-link': true }, 'ثبت‌نام'));
  }
}
function link(href, icon, label) {
  return h('a', { href, 'data-link': true, class: 'nav-link' },
    h('span', { class: 'nav-link-ico' }, icon),
    h('span', { class: 'nav-link-text' }, label));
}
function updateActiveNav(path) {
  $$('#topnav a').forEach((a) => {
    const href = a.getAttribute('href').slice(1);
    a.classList.toggle('active', href === path || (href !== '/' && path.startsWith(href)));
  });
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  store.set({ me: null });
  if (socket) { socket.disconnect(); socket = null; }
  renderNav();
  toast('خارج شدی', 'success');
  navigate('/');
}

/* --------------------------------- Boot ---------------------------------- */
async function boot() {
  // intercept data-link clicks for SPA navigation
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a) { e.preventDefault(); navigate(a.getAttribute('href')); }
  });
  window.addEventListener('hashchange', router);

  try {
    const cfg = await api('/config');
    store.set({ config: cfg });
    applyTheme(cfg.defaultTheme);
    document.title = cfg.siteName || 'اَلِ من خورا';
  } catch { /* offline */ }

  await refreshMe().catch(() => renderNav());
  // Guests: restore their last-picked page theme (logged-in users get theirs
  // from prefs inside refreshMe).
  if (!store.isLoggedIn) {
    try { const t = localStorage.getItem('theme'); if (t) applyTheme(t); } catch {}
  }
  // pre-connect socket if identified
  if (store.me) getSocket();
  router();
}

boot();
