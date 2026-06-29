/**
 * AleManKhora — Tic-tac-toe (دوز) AI
 * ==================================
 * `chooseTicTacToeAction(game, seat, difficulty)` returns one legal action.
 *
 * Two-player boards use a negamax search with alpha-beta pruning, threat-based
 * (windowed) evaluation, proximity move generation and forcing-move ordering —
 * so it sees deep combinations and double-threats (forks), not just the next
 * move. Bigger boards search shallower but the evaluation stays strong.
 *
 * Multiplayer (3–4) boards can't use a clean minimax, so they use a strong
 * one-ply heuristic: take a win, block any opponent's win, make a fork, block
 * an opponent's fork, otherwise maximise own threats minus the strongest
 * opponent's.  `easy` plays mostly at random.
 */

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const WIN = 1e7;
const INF = 1e9;
// Value of a window holding `count` of one player's marks (rest empty).
const WW = [0, 1, 14, 160, 1800, 20000, 220000];
const wv = (n) => WW[Math.min(n, WW.length - 1)];

const _winCache = {};
function windowsFor(N, K) {
  const key = N + '_' + K;
  if (_winCache[key]) return _winCache[key];
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of DIRS) {
      const cells = []; let ok = true;
      for (let k = 0; k < K; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) { ok = false; break; }
        cells.push(rr * N + cc);
      }
      if (ok) out.push(cells);
    }
  }
  _winCache[key] = out;
  return out;
}

function makeCtx(game) {
  return { N: game.size, K: game.winLength, wins: windowsFor(game.size, game.winLength), nodes: 0, budget: 130000, root: 0 };
}
const toRC = (idx, N) => ({ type: 'place', r: Math.floor(idx / N), c: idx % N });
const rand = (a) => a[Math.floor(Math.random() * a.length)];

/** Did placing `seat` at `idx` make K-in-a-row through it? */
function winsAt(board, ctx, idx, seat) {
  const N = ctx.N, K = ctx.K, r0 = Math.floor(idx / N), c0 = idx % N;
  for (const [dr, dc] of DIRS) {
    let cnt = 1;
    for (let s = 1; s < K; s++) { const r = r0 + dr * s, c = c0 + dc * s; if (r < 0 || r >= N || c < 0 || c >= N || board[r * N + c] !== seat) break; cnt++; }
    for (let s = 1; s < K; s++) { const r = r0 - dr * s, c = c0 - dc * s; if (r < 0 || r >= N || c < 0 || c >= N || board[r * N + c] !== seat) break; cnt++; }
    if (cnt >= K) return true;
  }
  return false;
}

/** Empty cells adjacent (Chebyshev ≤1) to any placed mark; centre if empty. */
function genMoves(board, ctx) {
  const N = ctx.N, out = [], seen = new Set();
  let any = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i] < 0) continue;
    any = true;
    const r = Math.floor(i / N), c = i % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      const j = rr * N + cc;
      if (board[j] < 0 && !seen.has(j)) { seen.add(j); out.push(j); }
    }
  }
  if (!any) return [Math.floor((N * N) / 2)];
  return out;
}

/** Static eval from `side`'s view vs `opp` (windowed threat count). */
function evalSide(board, ctx, side, opp) {
  let score = 0;
  for (const cells of ctx.wins) {
    let cm = 0, co = 0;
    for (const i of cells) { const v = board[i]; if (v === side) cm++; else if (v === opp) co++; }
    if (cm && co) continue;          // contested window → dead
    if (cm) score += wv(cm);
    else if (co) score -= wv(co);
  }
  return score;
}

/** Order moves so forcing ones (win, then block) come first → better pruning. */
function orderMoves(board, ctx, moves, side, opp) {
  const scored = moves.map((idx) => {
    board[idx] = side; const w = winsAt(board, ctx, idx, side); board[idx] = -1;
    let b = false;
    board[idx] = opp; b = winsAt(board, ctx, idx, opp); board[idx] = -1;
    return { idx, p: w ? 2 : (b ? 1 : 0) };
  });
  scored.sort((a, b) => b.p - a.p);
  return scored.map((o) => o.idx);
}

/* ----------------------------- 2-player search --------------------------- */
function negamax(board, ctx, side, opp, depth, alpha, beta) {
  if (depth === 0 || ctx.nodes++ > ctx.budget) return evalSide(board, ctx, side, opp);
  const moves = orderMoves(board, ctx, genMoves(board, ctx), side, opp);
  if (!moves.length) return 0;
  let best = -INF;
  for (const idx of moves) {
    board[idx] = side;
    const won = winsAt(board, ctx, idx, side);
    const val = won ? (WIN - (ctx.root - depth)) : -negamax(board, ctx, opp, side, depth - 1, -beta, -alpha);
    board[idx] = -1;
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchDepth(N, difficulty) {
  const hard = N <= 3 ? 9 : N === 4 ? 7 : N === 5 ? 5 : 4;
  return difficulty === 'hard' ? hard : Math.max(2, hard - 2);
}

function twoPlayerMove(game, seat, difficulty) {
  const ctx = makeCtx(game);
  const opp = seat === 0 ? 1 : 0;
  const board = game.board.map((v) => (v === null ? -1 : v));
  const moves = orderMoves(board, ctx, genMoves(board, ctx), seat, opp);
  const depth = ctx.root = searchDepth(ctx.N, difficulty);

  const scored = [];
  let best = null, bestV = -INF, alpha = -INF;
  for (const idx of moves) {
    board[idx] = seat;
    const won = winsAt(board, ctx, idx, seat);
    const v = won ? WIN : -negamax(board, ctx, opp, seat, depth - 1, -INF, -alpha);
    board[idx] = -1;
    scored.push({ idx, v });
    if (v > bestV) { bestV = v; best = idx; }
    if (bestV > alpha) alpha = bestV;
  }
  // Normal: occasionally pick a near-best (not blundering an obvious win/loss).
  if (difficulty === 'normal' && Math.random() < 0.2) {
    const ok = scored.filter((s) => s.v > -WIN / 2 && s.v < bestV);
    if (ok.length) return toRC(rand(ok).idx, ctx.N);
  }
  return toRC(best ?? moves[0], ctx.N);
}

/* ---------------------------- multiplayer heuristic ---------------------- */
function countWinCells(board, ctx, seat) {
  let n = 0;
  for (const j of genMoves(board, ctx)) { board[j] = seat; if (winsAt(board, ctx, j, seat)) n++; board[j] = -1; }
  return n;
}
function evalMulti(board, ctx, seat, opps) {
  let me = 0, worst = 0;
  for (const cells of ctx.wins) {
    const cnt = new Map();
    let owners = 0, mine = 0;
    for (const i of cells) { const v = board[i]; if (v < 0) continue; cnt.set(v, (cnt.get(v) || 0) + 1); }
    if (cnt.size > 1) continue;        // contested → dead
    if (cnt.size === 0) continue;
    const [owner, c] = [...cnt.entries()][0];
    if (owner === seat) me += wv(c);
    else worst = Math.max(worst, wv(c));
  }
  return me - worst;
}
function multiMove(game, seat, difficulty) {
  const ctx = makeCtx(game);
  const board = game.board.map((v) => (v === null ? -1 : v));
  const opps = game.activePlayers().filter((s) => s !== seat);
  const moves = genMoves(board, ctx);

  // 1) win now
  for (const idx of moves) { board[idx] = seat; const w = winsAt(board, ctx, idx, seat); board[idx] = -1; if (w) return toRC(idx, ctx.N); }
  // 2) block any opponent's immediate win
  for (const op of opps) for (const idx of moves) { board[idx] = op; const w = winsAt(board, ctx, idx, op); board[idx] = -1; if (w) return toRC(idx, ctx.N); }

  // 3) score: own fork, block opponent fork, threat balance
  let best = moves[0], bestS = -INF;
  for (const idx of moves) {
    board[idx] = seat;
    let s = evalMulti(board, ctx, seat, opps);
    if (countWinCells(board, ctx, seat) >= 2) s += 1e6;     // I make a fork
    board[idx] = -1;
    for (const op of opps) {                                 // taking a cell an opponent could fork on
      board[idx] = op; const of = countWinCells(board, ctx, op); board[idx] = -1;
      if (of >= 2) s += 6e5;
    }
    if (difficulty !== 'hard') s += Math.random() * 1200;
    if (s > bestS) { bestS = s; best = idx; }
  }
  return toRC(best, ctx.N);
}

export function chooseTicTacToeAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves.length) return null;
    if (difficulty === 'easy') return rand(moves);
    if (game.numPlayers === 2) return twoPlayerMove(game, seat, difficulty);
    return multiMove(game, seat, difficulty);
  } catch (_e) {
    const moves = game.legalMoves(seat);
    return moves && moves.length ? rand(moves) : null;
  }
}
