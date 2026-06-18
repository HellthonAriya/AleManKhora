/* اَلِ من خورا — Landing / home view (multi-game hub) */
import { h, store } from '../core.js';
import { BoardRenderer } from '../board.js';
import { QuoridorGame } from '../engine.js';
import { ChessBoardRenderer } from '../chessboard.js';
import { ChessGame } from '../chess.js';

export function HomeView() {
  const cta = store.me
    ? h('a', { class: 'btn btn-primary btn-lg', href: '#/lobby', 'data-link': true }, '🎮 شروع بازی')
    : h('a', { class: 'btn btn-primary btn-lg', href: '#/play', 'data-link': true }, '🎮 همین حالا بازی کن');

  const canvas = h('canvas', { id: 'demo-board' });

  // mini static previews for the games showcase
  const chessPrev = h('canvas', { class: 'game-prev-canvas' });
  const chess4Prev = h('canvas', { class: 'game-prev-canvas' });
  const quoridorPrev = h('canvas', { class: 'game-prev-canvas' });

  const view = h('div', { class: 'fade-in' },
    h('section', { class: 'hero' },
      h('div', {},
        h('span', { class: 'hero-tag' }, '◆ پلتفرم بازی‌های فکری آنلاین'),
        h('h1', {}, 'چند بازی، ', h('span', { class: 'grad' }, 'یک میدان نبرد')),
        h('p', { class: 'lead' },
          'اَلِ من خورا حالا خانهٔ چند بازی استراتژیک است: «اَلِ من خورا» (حرکت کن یا دیوار بساز)، شطرنج کلاسیک دو نفره و شطرنج هیجان‌انگیز ۴ نفره. آنلاین، بلادرنگ و با گرافیک حرفه‌ای.'),
        h('div', { class: 'hero-actions' },
          cta,
          h('a', { class: 'btn btn-ghost btn-lg', href: '#/leaderboard', 'data-link': true }, '🏆 جدول رتبه‌بندی'),
        ),
      ),
      h('div', { class: 'hero-art' }, canvas),
    ),

    h('section', {},
      h('h2', { class: 'section-title center', style: 'margin-top:10px' }, 'بازی‌های موجود'),
      h('div', { class: 'games-showcase' },
        gameCard(quoridorPrev, '🧱', 'اَلِ من خورا', 'در هر نوبت یا مهره‌ات را جلو ببر یا با دیوار راه حریف را ببند.'),
        gameCard(chessPrev, '♛', 'شطرنج', 'نبرد کلاسیک دو نفره با تمام قوانین: قلعه، آن‌پاسان و ارتقا.'),
        gameCard(chess4Prev, '♞', 'شطرنج ۴ نفره', 'تخته صلیبی ۱۴×۱۴، چهار ارتش — انفرادی یا تیمی ۲ در ۲.'),
      ),
    ),

    h('div', { class: 'feature-grid' },
      feature('🤝', 'بازی با دوستان', 'یک لینک دعوت بساز و دوستانت را به میز بازی بیاور.'),
      feature('🎲', 'حریف تصادفی', 'با یک کلیک با بازیکنی هم‌سطح از سراسر دنیا روبه‌رو شو.'),
      feature('🤖', 'تمرین با هوش مصنوعی', 'هر بازی سه سطح سختی برای تمرین و یادگیری دارد.'),
      feature('🎨', 'کاملاً سفارشی', 'تم تخته، رنگ مهره‌ها، زمان و حالت بازی را خودت بچین.'),
      feature('🏆', 'رتبه‌بندی ELO', 'برد ببر، امتیاز جمع کن و در صدر جدول بایست.'),
      feature('⚡', 'بلادرنگ', 'هر حرکت در یک لحظه برای حریفت ارسال می‌شود.'),
    ),
  );

  requestAnimationFrame(() => {
    startDemo(canvas, view);
    drawChessPreview(chessPrev, '2');
    drawChessPreview(chess4Prev, '4');
    drawQuoridorPreview(quoridorPrev);
  });
  return view;
}

function gameCard(canvas, ico, title, text) {
  return h('div', { class: 'game-showcase-card' },
    h('div', { class: 'game-prev' }, canvas),
    h('div', { class: 'gs-body' },
      h('div', { class: 'gs-title' }, h('span', { class: 'gs-ico' }, ico), title),
      h('p', {}, text)));
}

function feature(ico, title, text) {
  return h('div', { class: 'feature' }, h('div', { class: 'ico' }, ico), h('h3', {}, title), h('p', {}, text));
}

function drawChessPreview(canvas, variant) {
  const r = new ChessBoardRenderer(canvas);
  r.setConfig({ boardTheme: variant === '4' ? 'midnight' : 'green',
    colors: variant === '4' ? ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'] : ['#f3f1ea', '#2b2b30'] });
  const g = new ChessGame({ variant });
  // play a couple of opening moves for visual interest
  try {
    if (variant === '2') {
      g.apply(0, { type: 'move', from: { r: 6, c: 4 }, to: { r: 4, c: 4 } });
      g.apply(1, { type: 'move', from: { r: 1, c: 2 }, to: { r: 3, c: 2 } });
    }
  } catch { /* ignore */ }
  r.setState(g.toState(), { animate: false });
}

function drawQuoridorPreview(canvas) {
  const r = new BoardRenderer(canvas);
  r.setConfig({ theme: 'emerald', p0Color: '#36c6ff', p1Color: '#ffd36b' });
  const g = new QuoridorGame({ size: 9, wallsEach: 10 });
  try { g.apply(0, { type: 'wall', r: 4, c: 3, o: 'h' }); g.apply(1, { type: 'wall', r: 2, c: 5, o: 'v' }); g.turn = 0; } catch { /* ignore */ }
  r.setState(g.toState(), { animate: false });
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
    const me = g.turn;
    let acted = false;
    if (g.wallsLeft[me] > 0 && Math.random() < 0.25) {
      const walls = g.allWallPlacements(me);
      if (walls.length) { try { g.apply(me, walls[Math.floor(Math.random() * walls.length)]); acted = true; } catch {} }
    }
    if (!acted) {
      const moves = g.legalMoves(me);
      const goal = g.goals[me].value;
      moves.sort((a, b) => Math.abs(a.r - goal) - Math.abs(b.r - goal));
      try { g.apply(me, { type: 'move', ...moves[0] }); } catch {}
    }
    r.setState(g.toState());
    setTimeout(step, 900);
  };
  setTimeout(step, 800);
}
