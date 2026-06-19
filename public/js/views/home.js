/* اَلِ من خورا — Landing / home view (multi-game hub) */
import { h, store } from '../core.js';
import { BoardRenderer } from '../board.js';
import { QuoridorGame } from '../engine.js';
import { ChessBoardRenderer } from '../chessboard.js';
import { ChessGame } from '../chess.js';
import { GridRenderer } from '../gridboard.js';
import { DotsRenderer } from '../dotsboard.js';
import { BackgammonRenderer } from '../backgammonboard.js';
import { TicTacToeGame } from '../tictactoe.js';
import { GomokuGame } from '../gomoku.js';
import { OthelloGame } from '../othello.js';
import { DotsGame } from '../dots.js';
import { BackgammonGame } from '../backgammon.js';

const SIMPLE_COLORS = {
  tictactoe: ['#36c6ff', '#ff6b6b'],
  gomoku: ['#1b1d22', '#f1ece0'],
  othello: ['#1b1d22', '#f1ece0'],
  dots: ['#36c6ff', '#ff6b6b'],
  backgammon: ['#efe9dc', '#21242b'],
};

export function HomeView() {
  const cta = store.me
    ? h('a', { class: 'btn btn-primary btn-lg', href: '#/lobby', 'data-link': true }, '🎮 شروع بازی')
    : h('a', { class: 'btn btn-primary btn-lg', href: '#/play', 'data-link': true }, '🎮 همین حالا بازی کن');

  const chessPrev = h('canvas', { class: 'game-prev-canvas' });
  const chess4Prev = h('canvas', { class: 'game-prev-canvas' });
  const quoridorPrev = h('canvas', { class: 'game-prev-canvas' });
  const backgammonPrev = h('canvas', { class: 'game-prev-canvas' });
  const othelloPrev = h('canvas', { class: 'game-prev-canvas' });
  const gomokuPrev = h('canvas', { class: 'game-prev-canvas' });
  const dotsPrev = h('canvas', { class: 'game-prev-canvas' });
  const tttPrev = h('canvas', { class: 'game-prev-canvas' });

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
        gameCard(backgammonPrev, '🎲', 'تخته‌نرد', 'تاس بریز، مهره‌ها را به خانه ببر و اول از همه خارج‌شان کن.'),
        gameCard(othelloPrev, '⚫', 'اوتلو', 'مهره بگذار، ردیف حریف را محاصره کن و به رنگ خودت برگردان.'),
        gameCard(gomokuPrev, '⬤', 'گوموکو', 'پنج مهره پشت‌سرهم در یک خط بچین تا ببری.'),
        gameCard(dotsPrev, '▦', 'نقطه‌خط', 'خط بکش و مربع ببند؛ هر مربع که بستی دوباره نوبت توست.'),
        gameCard(tttPrev, '✕', 'دوز', 'سه علامت در یک خط — سادهٔ سریع و دوست‌داشتنی.'),
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
    animateSimplePreview(backgammonPrev, 'backgammon');
    animateSimplePreview(othelloPrev, 'othello');
    animateSimplePreview(gomokuPrev, 'gomoku');
    animateSimplePreview(dotsPrev, 'dots');
    animateSimplePreview(tttPrev, 'tictactoe');
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

// Returns true once the canvas is no longer part of the live document.
function isGone(canvas) { return !document.body.contains(canvas); }

/* ---------- Quoridor animated preview ---------- */

function animateQuoridorPreview(canvas) {
  const r = new BoardRenderer(canvas);
  r.setConfig({ theme: 'emerald', p0Color: '#36c6ff', p1Color: '#ffd36b' });

  let g, moves = 0;

  const newGame = () => {
    g = new QuoridorGame({ size: 7, wallsEach: 6 });
    moves = 0;
    r.setState(g.toState(), { animate: false });
  };
  newGame();

  const restart = () => {
    if (isGone(canvas)) return;
    newGame();
    setTimeout(step, 700);
  };

  const step = () => {
    if (isGone(canvas)) return;
    try {
      if (g.winner !== null || moves >= 30) { setTimeout(restart, 1200); return; }
      const me = g.turn;
      let acted = false;
      if (g.wallsLeft[me] > 0 && Math.random() < 0.28) {
        const walls = g.allWallPlacements(me);
        if (walls.length) {
          try { g.apply(me, walls[Math.floor(Math.random() * walls.length)]); acted = true; } catch {}
        }
      }
      if (!acted) {
        const ms = g.legalMoves(me);
        const goal = g.goals[me].value;
        ms.sort((a, b) => Math.abs(a.r - goal) - Math.abs(b.r - goal));
        try { g.apply(me, { type: 'move', ...ms[0] }); } catch {}
      }
      moves++;
      r.setState(g.toState());
    } catch {}
    setTimeout(step, 950);
  };
  setTimeout(step, 800);
}

/* ---------- Chess animated preview ---------- */

// Scripted openings for visual interest in 2p preview
const OPENINGS_2P = [
  // Italian: e4 e5 Nf3 Nc6 Bc4
  [
    [0, { r: 6, c: 4 }, { r: 4, c: 4 }],
    [1, { r: 1, c: 4 }, { r: 3, c: 4 }],
    [0, { r: 7, c: 6 }, { r: 5, c: 5 }],
    [1, { r: 0, c: 1 }, { r: 2, c: 2 }],
    [0, { r: 7, c: 5 }, { r: 4, c: 2 }],
    [1, { r: 1, c: 2 }, { r: 3, c: 2 }],
    [0, { r: 7, c: 3 }, { r: 5, c: 3 }],  // Qd1-d3
    [1, { r: 0, c: 6 }, { r: 2, c: 5 }],  // Nf6
  ],
  // Queen's Gambit: d4 d5 c4 e6 Nf3 Nf6
  [
    [0, { r: 6, c: 3 }, { r: 4, c: 3 }],
    [1, { r: 1, c: 3 }, { r: 3, c: 3 }],
    [0, { r: 6, c: 2 }, { r: 4, c: 2 }],
    [1, { r: 1, c: 4 }, { r: 2, c: 4 }],
    [0, { r: 7, c: 6 }, { r: 5, c: 5 }],
    [1, { r: 0, c: 6 }, { r: 2, c: 5 }],
    [0, { r: 7, c: 1 }, { r: 5, c: 2 }],
    [1, { r: 0, c: 1 }, { r: 2, c: 2 }],
  ],
];

function animateChessPreview(canvas, variant) {
  const is4 = variant === '4' || variant === '4team';
  const r = new ChessBoardRenderer(canvas);
  r.setConfig({
    boardTheme: is4 ? 'midnight' : 'green',
    colors: is4 ? ['#e7503a', '#3d7fe0', '#e8b730', '#3bb15f'] : ['#f3f1ea', '#2b2b30'],
  });

  let g, moves = 0, openIdx = 0, openStep = 0;
  const RESTART_AFTER = is4 ? 20 : 28;

  const newGame = () => {
    g = new ChessGame({ variant });
    moves = 0;
    openIdx = Math.floor(Math.random() * OPENINGS_2P.length);
    openStep = 0;
    r.setState(g.toState(), { animate: false });
  };
  newGame();

  const playRandom = (seat) => {
    try {
      const ms = g.legalMoves(seat);
      if (!ms.length) return;
      const caps = ms.filter((m) => g.board[m.to.r]?.[m.to.c] || m.ep);
      const pick = caps.length && Math.random() < 0.55
        ? caps[Math.floor(Math.random() * caps.length)]
        : ms[Math.floor(Math.random() * ms.length)];
      g.apply(seat, { type: 'move', from: pick.from, to: pick.to, promo: pick.promo });
    } catch {}
  };

  const restart = () => {
    if (isGone(canvas)) return;
    newGame();
    setTimeout(step, 700);
  };

  const step = () => {
    if (isGone(canvas)) return;
    try {
      if (g.gameOver || moves >= RESTART_AFTER) { setTimeout(restart, 1400); return; }
      const seat = g.turn;
      if (!is4 && openStep < OPENINGS_2P[openIdx].length) {
        const [s, from, to] = OPENINGS_2P[openIdx][openStep];
        openStep++;
        if (s === seat) {
          try { g.apply(seat, { type: 'move', from, to }); }
          catch { playRandom(seat); }
        } else {
          playRandom(seat);
        }
      } else {
        playRandom(seat);
      }
      moves++;
      r.setState(g.toState());
    } catch {}
    setTimeout(step, is4 ? 750 : 900);
  };
  setTimeout(step, 900);
}

/* ---------- Simple board-game animated previews ---------- */

function buildSimpleEngine(gameType) {
  if (gameType === 'gomoku') return new GomokuGame({ size: 11 });
  if (gameType === 'othello') return new OthelloGame();
  if (gameType === 'tictactoe') return new TicTacToeGame();
  if (gameType === 'dots') return new DotsGame({ rows: 5, cols: 5 });
  return new BackgammonGame();
}
function buildSimpleRenderer(canvas, gameType) {
  if (gameType === 'dots') return new DotsRenderer(canvas);
  if (gameType === 'backgammon') return new BackgammonRenderer(canvas);
  return new GridRenderer(canvas);
}

function animateSimplePreview(canvas, gameType) {
  const r = buildSimpleRenderer(canvas, gameType);
  r.setConfig({ colors: SIMPLE_COLORS[gameType] || ['#36c6ff', '#ff6b6b'] });
  r.setMySeat(0);

  let g, moves = 0;
  const cap = gameType === 'tictactoe' ? 9 : gameType === 'gomoku' ? 45
    : gameType === 'dots' ? 70 : gameType === 'othello' ? 64 : 60;

  const newGame = () => { g = buildSimpleEngine(gameType); moves = 0; r.setState(g.toState(), { animate: false }); };
  newGame();

  const restart = () => { if (isGone(canvas)) return; newGame(); setTimeout(step, 800); };

  const step = () => {
    if (isGone(canvas)) return;
    try {
      if (g.isOver() || moves >= cap) { setTimeout(restart, 1600); return; }
      const ms = g.legalMoves(g.turn);
      if (!ms.length) { setTimeout(restart, 1600); return; }
      g.apply(g.turn, ms[Math.floor(Math.random() * ms.length)]);
      moves++;
      r.setState(g.toState());
    } catch {}
    setTimeout(step, gameType === 'backgammon' ? 700 : 850);
  };
  setTimeout(step, 700);
}
