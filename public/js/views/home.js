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
    animateQuoridorPreview(quoridorPrev);
    animateChessPreview(chessPrev, '2');
    animateChessPreview(chess4Prev, '4');
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

function watchCanvas(canvas) {
  let stopped = false;
  const obs = new MutationObserver(() => {
    if (!document.body.contains(canvas)) { stopped = true; obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return { get stopped() { return stopped; } };
}

/* ---------- Quoridor animated preview ---------- */

function animateQuoridorPreview(canvas) {
  const r = new BoardRenderer(canvas);
  r.setConfig({ theme: 'emerald', p0Color: '#36c6ff', p1Color: '#ffd36b' });
  const sentinel = watchCanvas(canvas);

  const newGame = () => new QuoridorGame({ size: 7, wallsEach: 6 });
  let g = newGame();
  r.setState(g.toState(), { animate: false });

  const step = () => {
    if (sentinel.stopped) return;
    if (g.winner !== null) {
      setTimeout(() => {
        if (sentinel.stopped) return;
        g = newGame();
        r.setState(g.toState(), { animate: false });
        setTimeout(step, 700);
      }, 1400);
      return;
    }
    const me = g.turn;
    let acted = false;
    if (g.wallsLeft[me] > 0 && Math.random() < 0.28) {
      const walls = g.allWallPlacements(me);
      if (walls.length) {
        try { g.apply(me, walls[Math.floor(Math.random() * walls.length)]); acted = true; } catch {}
      }
    }
    if (!acted) {
      const moves = g.legalMoves(me);
      const goal = g.goals[me].value;
      moves.sort((a, b) => Math.abs(a.r - goal) - Math.abs(b.r - goal));
      try { g.apply(me, { type: 'move', ...moves[0] }); } catch {}
    }
    r.setState(g.toState());
    setTimeout(step, 950);
  };
  setTimeout(step, 800);
}

/* ---------- Chess animated preview ---------- */

const CHESS_OPENINGS_2P = [
  // e4 e5 Nf3 Nc6 Bc4 (Italian)
  [
    [0, { type: 'move', from: { r: 6, c: 4 }, to: { r: 4, c: 4 } }],
    [1, { type: 'move', from: { r: 1, c: 4 }, to: { r: 3, c: 4 } }],
    [0, { type: 'move', from: { r: 7, c: 6 }, to: { r: 5, c: 5 } }],
    [1, { type: 'move', from: { r: 0, c: 1 }, to: { r: 2, c: 2 } }],
    [0, { type: 'move', from: { r: 7, c: 5 }, to: { r: 4, c: 2 } }],
    [1, { type: 'move', from: { r: 1, c: 2 }, to: { r: 3, c: 2 } }],
  ],
  // d4 d5 c4 e6 (Queen's Gambit)
  [
    [0, { type: 'move', from: { r: 6, c: 3 }, to: { r: 4, c: 3 } }],
    [1, { type: 'move', from: { r: 1, c: 3 }, to: { r: 3, c: 3 } }],
    [0, { type: 'move', from: { r: 6, c: 2 }, to: { r: 4, c: 2 } }],
    [1, { type: 'move', from: { r: 1, c: 4 }, to: { r: 2, c: 4 } }],
    [0, { type: 'move', from: { r: 7, c: 6 }, to: { r: 5, c: 5 } }],
    [1, { type: 'move', from: { r: 0, c: 6 }, to: { r: 2, c: 5 } }],
  ],
];

function animateChessPreview(canvas, variant) {
  const is4 = variant === '4' || variant === '4team';
  const r = new ChessBoardRenderer(canvas);
  r.setConfig({
    boardTheme: is4 ? 'midnight' : 'green',
    colors: is4
      ? ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f']
      : ['#f3f1ea', '#2b2b30'],
  });
  const sentinel = watchCanvas(canvas);

  let g, openingIdx = 0, openingStep = 0;

  const newGame = () => {
    g = new ChessGame({ variant });
    openingIdx = Math.floor(Math.random() * CHESS_OPENINGS_2P.length);
    openingStep = 0;
    r.setState(g.toState(), { animate: false });
  };
  newGame();

  const randomMove = (seat) => {
    const moves = g.legalMoves(seat);
    if (!moves.length) return;
    // prefer captures for visual excitement
    const caps = moves.filter((m) => g.board[m.to.r]?.[m.to.c] || m.ep || m.promo);
    const pick = caps.length && Math.random() < 0.6
      ? caps[Math.floor(Math.random() * caps.length)]
      : moves[Math.floor(Math.random() * moves.length)];
    const action = { type: 'move', from: pick.from, to: pick.to, promo: pick.promo ?? (pick.to.r === 0 || pick.to.r === 7 ? 'q' : undefined) };
    try { g.apply(seat, action); } catch {}
  };

  const step = () => {
    if (sentinel.stopped) return;
    if (g.gameOver) {
      setTimeout(() => { if (!sentinel.stopped) { newGame(); setTimeout(step, 600); } }, 1600);
      return;
    }
    const seat = g.turn;
    if (!is4 && openingStep < CHESS_OPENINGS_2P[openingIdx].length) {
      const [s, action] = CHESS_OPENINGS_2P[openingIdx][openingStep];
      if (s === seat) {
        try { g.apply(seat, action); openingStep++; } catch { openingStep++; randomMove(seat); }
      } else {
        randomMove(seat);
      }
    } else {
      randomMove(seat);
    }
    r.setState(g.toState());
    setTimeout(step, is4 ? 750 : 900);
  };
  setTimeout(step, 900);
}
