/**
 * AleManKhora — Tic-tac-toe (دوز) AI
 * ==================================
 * `chooseTicTacToeAction(game, seat, difficulty)` returns one legal action.
 *
 * On a classic 3×3 / 2-player board it uses perfect minimax (hard never loses).
 * On larger boards or with 3–4 players the tree is far too big, so it uses a
 * fast heuristic: take an immediate win, block any opponent's immediate win,
 * then favour central cells that best extend its own lines (and deny the
 * opponents'). `easy` plays mostly randomly.
 */

import { TicTacToeGame } from './tictactoe.js';

const rand = (a) => a[Math.floor(Math.random() * a.length)];

/* ───────────────────────── classic 3×3 minimax ─────────────────────────── */
function minimax(game, me, alpha, beta, depth) {
  if (game.winner !== null) return game.winner === me ? 10 - depth : depth - 10;
  if (game.draw) return 0;
  const seat = game.turn;
  const maximizing = seat === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const mv of game.legalMoves(seat)) {
    const child = TicTacToeGame.fromState(game.toState());
    child.apply(seat, mv);
    const score = minimax(child, me, alpha, beta, depth + 1);
    if (maximizing) { if (score > best) best = score; if (best > alpha) alpha = best; }
    else { if (score < best) best = score; if (best < beta) beta = best; }
    if (beta <= alpha) break;
  }
  return best;
}
function minimaxChoice(game, seat, difficulty) {
  const moves = game.legalMoves(seat);
  let bestScore = -Infinity, bestMove = null;
  const scored = [];
  for (const mv of moves) {
    const child = TicTacToeGame.fromState(game.toState());
    child.apply(seat, mv);
    const score = minimax(child, seat, -Infinity, Infinity, 1);
    scored.push({ mv, score });
    if (score > bestScore) { bestScore = score; bestMove = mv; }
  }
  if (difficulty === 'normal' && Math.random() < 0.25) {
    const worse = scored.filter((s) => s.score < bestScore);
    if (worse.length) return rand(worse).mv;
  }
  return bestMove || rand(moves);
}

/* ───────────────────────────── heuristic ───────────────────────────────── */
/** Would placing `seat` at (r,c) complete a winning line? (mutate+restore) */
function completes(game, r, c, seat) {
  const idx = r * game.size + c;
  game.board[idx] = seat;
  const win = game._winLineAt(idx, seat);
  game.board[idx] = null;
  return !!win;
}
/** Longest own run a cell could belong to (open-ended runs weighted higher). */
function runScore(game, r, c, seat) {
  const N = game.size, K = game.winLength;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  let score = 0;
  for (const [dr, dc] of dirs) {
    let run = 1, open = 0;
    for (const sgn of [1, -1]) {
      for (let s = 1; s < K; s++) {
        const rr = r + dr * s * sgn, cc = c + dc * s * sgn;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) break;
        const v = game.board[rr * N + cc];
        if (v === seat) run++;
        else { if (v === null) open++; break; }
      }
    }
    if (run + open >= K) score += run * run + open * 0.25; // only count viable lines
  }
  return score;
}

function heuristicChoice(game, seat, moves, difficulty) {
  const N = game.size;
  // 1) win now
  const wins = moves.filter((m) => completes(game, m.r, m.c, seat));
  if (wins.length) return rand(wins);
  // 2) block any opponent's immediate win
  for (const op of game.activePlayers()) {
    if (op === seat) continue;
    const block = moves.filter((m) => completes(game, m.r, m.c, op));
    if (block.length) return rand(block);
  }
  // 3) positional score: extend mine, deny theirs, prefer the centre
  const cx = (N - 1) / 2;
  const opps = game.activePlayers().filter((s) => s !== seat);
  let best = moves[0], bestS = -Infinity;
  for (const m of moves) {
    let s = runScore(game, m.r, m.c, seat) * 1.0;
    for (const op of opps) s += runScore(game, m.r, m.c, op) * 0.6; // blocking value
    s += -(Math.abs(m.r - cx) + Math.abs(m.c - cx)) * 0.35;          // centrality
    if (difficulty !== 'hard') s += Math.random() * 1.2;
    if (s > bestS) { bestS = s; best = m; }
  }
  return best;
}

export function chooseTicTacToeAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves.length) return null;
    if (difficulty === 'easy') return rand(moves);
    if (game.size <= 3 && game.numPlayers === 2 && game.winLength <= 3) {
      return minimaxChoice(game, seat, difficulty);
    }
    return heuristicChoice(game, seat, moves, difficulty);
  } catch (_e) {
    const moves = game.legalMoves(seat);
    return moves && moves.length ? rand(moves) : null;
  }
}
