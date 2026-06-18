/* اِل من خورا — Landing / home view */
import { h, store } from '../core.js';
import { BoardRenderer } from '../board.js';
import { QuoridorGame } from '../engine.js';

export function HomeView() {
  const cta = store.me
    ? h('a', { class: 'btn btn-primary btn-lg', href: '#/lobby', 'data-link': true }, '🎮 شروع بازی')
    : h('a', { class: 'btn btn-primary btn-lg', href: '#/play', 'data-link': true }, '🎮 همین حالا بازی کن');

  const canvas = h('canvas', { id: 'demo-board' });

  const view = h('div', { class: 'fade-in' },
    h('section', { class: 'hero' },
      h('div', {},
        h('span', { class: 'hero-tag' }, '◆ بازی استراتژیک آنلاین'),
        h('h1', {}, 'حرکت کن یا ', h('span', { class: 'grad' }, 'مانع بساز'),
          h('br'), 'اول به آن‌سو برس!'),
        h('p', { class: 'lead' },
          'اِل من خورا یک نبرد فکری دونفره است: در هر نوبت یا مهره‌ات را جلو ببر یا با ساختن دیوار راه حریف را ببند. ساده برای یادگیری، عمیق برای استادشدن.'),
        h('div', { class: 'hero-actions' },
          cta,
          h('a', { class: 'btn btn-ghost btn-lg', href: '#/leaderboard', 'data-link': true }, '🏆 جدول رتبه‌بندی'),
        ),
      ),
      h('div', { class: 'hero-art' }, canvas),
    ),

    h('div', { class: 'feature-grid' },
      feature('🤝', 'بازی با دوستان', 'یک لینک دعوت بساز و دوستت را به میز بازی بیاور.'),
      feature('🎲', 'حریف تصادفی', 'با یک کلیک با بازیکنی هم‌سطح از سراسر دنیا روبه‌رو شو.'),
      feature('🤖', 'تمرین با هوش مصنوعی', 'سه سطح سختی برای تمرین و یادگیری ترفندها.'),
      feature('🎨', 'کاملاً سفارشی', 'اندازهٔ صفحه، تعداد دیوارها، رنگ‌ها و تم را خودت بچین.'),
      feature('🏆', 'رتبه‌بندی ELO', 'برد ببر، امتیاز جمع کن و در صدر جدول بایست.'),
      feature('⚡', 'بلادرنگ', 'هر حرکت در یک لحظه برای حریفت ارسال می‌شود.'),
    ),
  );

  // animated self-playing demo
  requestAnimationFrame(() => startDemo(canvas, view));
  return view;
}

function feature(ico, title, text) {
  return h('div', { class: 'feature' },
    h('div', { class: 'ico' }, ico),
    h('h3', {}, title),
    h('p', {}, text));
}

function startDemo(canvas, view) {
  const r = new BoardRenderer(canvas);
  r.setConfig({ theme: 'emerald', p0Color: '#36c6ff', p1Color: '#ffd36b' });
  const g = new QuoridorGame({ size: 7, wallsEach: 6 });
  r.setState(g.toState(), { animate: false });

  let stopped = false;
  const obs = new MutationObserver(() => {
    if (!document.body.contains(canvas)) { stopped = true; obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  const step = () => {
    if (stopped) return;
    if (g.winner !== null) {
      setTimeout(() => {
        if (stopped) return;
        const ng = new QuoridorGame({ size: 7, wallsEach: 6 });
        Object.assign(g, ng);
        g.walls = ng.walls;
        r.setState(g.toState(), { animate: false });
        setTimeout(step, 700);
      }, 1400);
      return;
    }
    // simple demo policy: mostly advance toward goal, sometimes wall
    const me = g.turn;
    let acted = false;
    if (g.wallsLeft[me] > 0 && Math.random() < 0.25) {
      const walls = g.allWallPlacements(me);
      if (walls.length) { try { g.apply(me, walls[Math.floor(Math.random() * walls.length)]); acted = true; } catch {} }
    }
    if (!acted) {
      const moves = g.legalMoves(me);
      const goal = g.goalRow[me];
      moves.sort((a, b) => Math.abs(a.r - goal) - Math.abs(b.r - goal));
      try { g.apply(me, { type: 'move', ...moves[0] }); } catch {}
    }
    r.setState(g.toState());
    setTimeout(step, 900);
  };
  setTimeout(step, 800);
}
