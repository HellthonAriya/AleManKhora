/* =========================================================================
   اَل من خورا — Core helpers: DOM, state, API, toasts, modals
   ========================================================================= */

/* ----------------------------- DOM helpers ------------------------------- */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* --------------------------- Persian numerals ---------------------------- */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
export function faNum(n) {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}
export function formatClock(ms) {
  ms = Math.max(0, ms);
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return faNum(m) + ':' + faNum(String(s).padStart(2, '0'));
}
export function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'همین حالا';
  if (s < 3600) return faNum(Math.floor(s / 60)) + ' دقیقه پیش';
  if (s < 86400) return faNum(Math.floor(s / 3600)) + ' ساعت پیش';
  return faNum(Math.floor(s / 86400)) + ' روز پیش';
}

/* -------------------------------- Store ---------------------------------- */
export const store = {
  me: null,          // { isGuest, username, ... } | null
  config: null,      // site config
  _subs: new Set(),
  set(patch) { Object.assign(this, patch); this._subs.forEach((fn) => fn(this)); },
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  get displayName() { return this.me ? this.me.username : null; },
  get isLoggedIn() { return this.me && !this.me.isGuest; },
  get isAdmin() { return this.me && this.me.isAdmin; },
};

/* --------------------------------- API ----------------------------------- */
export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error || 'خطای سرور');
    err.status = res.status;
    throw err;
  }
  return data;
}

/* -------------------------------- Toasts --------------------------------- */
export function toast(msg, type = '') {
  const stack = $('#toast-stack');
  const t = h('div', { class: `toast ${type}` }, msg);
  stack.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

/* -------------------------------- Modals --------------------------------- */
export function modal({ title, body, actions = [], onClose } = {}) {
  const root = $('#modal-root');
  const close = () => { clear(root); onClose?.(); };
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const box = h('div', { class: 'modal' });
  if (title) box.appendChild(h('h2', {}, title));
  if (body) box.appendChild(typeof body === 'string' ? h('div', { html: body }) : body);
  if (actions.length) {
    const bar = h('div', { class: 'modal-actions' });
    actions.forEach((a) => bar.appendChild(h('button', {
      class: `btn ${a.class || ''}`,
      onclick: () => { const keep = a.onClick?.(); if (!keep) close(); },
    }, a.label)));
    box.appendChild(bar);
  }
  overlay.appendChild(box);
  clear(root).appendChild(overlay);
  return { close };
}

export function confirmDialog(title, message, { danger = false, confirmLabel = 'تأیید' } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { class: 'muted' }, message),
      actions: [
        { label: 'انصراف', class: 'btn-ghost', onClick: () => resolve(false) },
        { label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ------------------------------ Theme ------------------------------------ */
export function applyTheme(theme) {
  if (theme) document.body.dataset.theme = theme;
}

/* ----------------------------- Color sets -------------------------------- */
export const PLAYER_COLORS = ['#36c6ff', '#ff6b6b', '#ffd36b', '#9b8cff', '#5ee6a0', '#ff8ad8'];
export const THEMES = [
  { id: 'emerald', name: 'زمرد', from: '#13c08a', to: '#0e8f7e' },
  { id: 'midnight', name: 'نیمه‌شب', from: '#6d8bff', to: '#4c63d4' },
  { id: 'sunset', name: 'غروب', from: '#ff8a4c', to: '#ff5d6c' },
  { id: 'sakura', name: 'شکوفه', from: '#ff7eb6', to: '#d65b95' },
  { id: 'ocean', name: 'اقیانوس', from: '#2bc4d6', to: '#1d8aad' },
  { id: 'mono', name: 'مونو', from: '#c7d2e3', to: '#8c99ad' },
];

export function initials(name = '?') {
  return (name.trim()[0] || '?').toUpperCase();
}
