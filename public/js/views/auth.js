/* اَلِ من خورا — Authentication view (login / register / guest) */
import { h, store, api, toast, $ } from '../core.js';
import { navigate, refreshMe, redirectAfterAuth } from '../app.js';

export function AuthView(mode = 'login') {
  let tab = mode === 'register' ? 'register' : 'login';

  const errorEl = h('div', { class: 'error-text' });
  const formMount = h('div', {});

  const tabs = h('div', { class: 'auth-tabs' },
    h('button', { class: tab === 'login' ? 'active' : '', onclick: () => switchTab('login') }, 'ورود'),
    h('button', { class: tab === 'register' ? 'active' : '', onclick: () => switchTab('register') }, 'ثبت‌نام'),
  );

  function switchTab(t) {
    tab = t;
    [...tabs.children].forEach((b, i) =>
      b.classList.toggle('active', (i === 0 && t === 'login') || (i === 1 && t === 'register')));
    errorEl.textContent = '';
    render();
  }

  async function doLogin(e) {
    e.preventDefault();
    errorEl.textContent = '';
    const f = e.target;
    try {
      await api('/auth/login', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value } });
      await refreshMe();
      toast('خوش آمدی ' + store.displayName + '! 👋', 'success');
      redirectAfterAuth();
    } catch (err) { errorEl.textContent = err.message; }
  }

  async function doRegister(e) {
    e.preventDefault();
    errorEl.textContent = '';
    const f = e.target;
    if (f.password.value !== f.confirm.value) { errorEl.textContent = 'رمز عبور و تکرار آن یکسان نیستند'; return; }
    try {
      const res = await api('/auth/register', { method: 'POST', body: {
        username: f.username.value.trim(),
        email: f.email.value.trim() || undefined,
        password: f.password.value,
      } });
      await refreshMe();
      if (res.firstAdmin) toast('🎉 شما اولین کاربر و مدیر سایت شدید!', 'success');
      else toast('حساب شما ساخته شد! خوش آمدی 🎉', 'success');
      redirectAfterAuth();
    } catch (err) { errorEl.textContent = err.message; }
  }

  async function doGuest() {
    try {
      const name = $('#guest-name')?.value?.trim();
      await api('/auth/guest', { method: 'POST', body: { username: name || undefined } });
      await refreshMe();
      toast('به‌عنوان مهمان وارد شدی', 'success');
      redirectAfterAuth();
    } catch (err) { errorEl.textContent = err.message; }
  }

  function render() {
    formMount.innerHTML = '';
    if (tab === 'login') {
      formMount.append(
        h('form', { onsubmit: doLogin },
          field('نام کاربری یا ایمیل', h('input', { class: 'input', name: 'username', required: true, autocomplete: 'username', placeholder: 'نام کاربری یا ایمیل' })),
          field('رمز عبور', h('input', { class: 'input', name: 'password', type: 'password', required: true, autocomplete: 'current-password', placeholder: '••••••••' })),
          errorEl,
          h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'ورود به حساب'),
        ),
      );
    } else {
      formMount.append(
        h('form', { onsubmit: doRegister },
          field('نام کاربری', h('input', { class: 'input', name: 'username', required: true, autocomplete: 'username', placeholder: '۳ تا ۲۰ کاراکتر' })),
          field('ایمیل (اختیاری)', h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' })),
          field('رمز عبور', h('input', { class: 'input', name: 'password', type: 'password', required: true, autocomplete: 'new-password', placeholder: 'حداقل ۶ کاراکتر' })),
          field('تکرار رمز عبور', h('input', { class: 'input', name: 'confirm', type: 'password', required: true, autocomplete: 'new-password', placeholder: '••••••••' })),
          errorEl,
          h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'ساخت حساب'),
        ),
      );
    }
  }
  render();

  const guestBlock = store.config?.allowGuest !== false ? h('div', {},
    h('div', { class: 'divider' }, 'یا'),
    h('div', { class: 'field' },
      h('input', { class: 'input', id: 'guest-name', placeholder: 'نام نمایشی مهمان (اختیاری)' })),
    h('button', { class: 'btn btn-block', onclick: doGuest }, '👤 ادامه به‌عنوان مهمان'),
    h('p', { class: 'faint center', style: 'margin-top:10px' }, 'با حساب مهمان امتیاز و تاریخچه ذخیره نمی‌شود.'),
  ) : null;

  return h('div', { class: 'auth-wrap fade-in' },
    h('div', { class: 'card' },
      h('h1', { class: 'center', style: 'margin-bottom:6px' }, 'اَلِ من خورا'),
      h('p', { class: 'center muted', style: 'margin-bottom:20px' }, 'وارد شو و نبرد را آغاز کن'),
      tabs,
      formMount,
      guestBlock,
    ),
  );
}

function field(label, input) {
  return h('div', { class: 'field' }, h('label', {}, label), input);
}
