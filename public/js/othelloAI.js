/**
 * AleManKhora — Othello AI
 * ========================
 * Pure ES module. Picks one legal action for a seat. Never throws; returns
 * null only when there is no legal move. Lookahead is performed on cloned
 * engines via `OthelloGame.fromState(game.toState())` so the live game is
 * never mutated.
 */

import { OthelloGame } from './othello.js';

const N = 8;

// Standard positional weight matrix: corners very high, X / C squares
// (adjacent to corners) penalised, edges favoured.
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

const TIME_BUDGET_MS = 250;

function clone(game) {
  return OthelloGame.fromState(game.toState());
}

/** Positional + mobility evaluation from the perspective of `seat`. */
function evaluate(g, seat) {
  const opp = seat === 0 ? 1 : 0;
  let posScore = 0;
  for (let i = 0; i < 64; i++) {
    const v = g.board[i];
    if (v === seat) posScore += WEIGHTS[i];
    else if (v === opp) posScore -= WEIGHTS[i];
  }
  const myMob = g.legalMoves(seat).length;
  const oppMob = g.legalMoves(opp).length;
  let mobScore = 0;
  if (myMob + oppMob !== 0) {
    mobScore = (100 * (myMob - oppMob)) / (myMob + oppMob);
  }
  return posScore + mobScore;
}

/** Disc-count differential from `seat`'s perspective (endgame objective). */
function discDiff(g, seat) {
  const [dark, light] = g._scores();
  const my = seat === 0 ? dark : light;
  const op = seat === 0 ? light : dark;
  return my - op;
}

function isEndgame(g) {
  let empties = 0;
  for (let i = 0; i < 64; i++) if (g.board[i] === null) empties++;
  return empties <= 12;
}

/**
 * Alpha-beta negamax over the cloned engine. `endgame` flips the leaf
 * objective to raw disc differential. `deadline` is a wall-clock cutoff.
 */
function alphaBeta(g, seat, depth, alpha, beta, endgame, deadline) {
  if (g.isOver() || depth === 0 || Date.now() > deadline) {
    return endgame ? discDiff(g, seat) : evaluate(g, seat);
  }
  const toMove = g.turn;
  const moves = g.legalMoves(toMove);
  if (moves.length === 0) {
    // No move available here (engine would auto-handle), treat as leaf.
    return endgame ? discDiff(g, seat) : evaluate(g, seat);
  }
  // Negamax: value is always from the perspective of the side to move,
  // negated as we descend, then we report relative to `seat`.
  const sign = toMove === seat ? 1 : -1;
  let best = -Infinity;
  for (const m of moves) {
    const child = clone(g);
    try {
      child.apply(toMove, m);
    } catch {
      continue;
    }
    const val = sign * alphaBeta(child, seat, depth - 1, alpha, beta, endgame, deadline);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (best === -Infinity) {
    return endgame ? discDiff(g, seat) : evaluate(g, seat);
  }
  return sign * best;
}

function pickGreedy(game, seat, moves) {
  // 1-ply on weights + mobility + flip count.
  let bestMove = null;
  let bestVal = -Infinity;
  for (const m of moves) {
    const child = clone(game);
    const flips = child._flipsFor(seat, m.r, m.c).length;
    try {
      child.apply(seat, m);
    } catch {
      continue;
    }
    const val = evaluate(child, seat) + flips;
    if (val > bestVal) {
      bestVal = val;
      bestMove = m;
    }
  }
  return bestMove;
}

function pickHard(game, seat, moves) {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const endgame = isEndgame(game);
  // Iterative deepening, 1..4 ply, keep best from the last fully evaluated depth.
  let chosen = moves[0];
  for (let depth = 1; depth <= 4; depth++) {
    let bestMove = null;
    let bestVal = -Infinity;
    let completed = true;
    let alpha = -Infinity;
    const beta = Infinity;
    for (const m of moves) {
      if (Date.now() > deadline) {
        completed = false;
        break;
      }
      const child = clone(game);
      try {
        child.apply(seat, m);
      } catch {
        continue;
      }
      // After our move, recurse; child is from opponent (or our) perspective.
      const val = alphaBeta(child, seat, depth - 1, alpha, beta, endgame, deadline);
      if (val > bestVal) {
        bestVal = val;
        bestMove = m;
      }
      if (val > alpha) alpha = val;
    }
    if (bestMove) chosen = bestMove;
    if (!completed) break;
  }
  return chosen;
}

/**
 * Choose one legal Othello action for `seat`, or null if none exist.
 * @param {OthelloGame} game
 * @param {0|1} seat
 * @param {'easy'|'normal'|'hard'} difficulty
 */
export function chooseOthelloAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    if (difficulty === 'easy') {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    if (difficulty === 'hard') {
      const m = pickHard(game, seat, moves);
      return m || moves[0];
    }
    // normal
    const m = pickGreedy(game, seat, moves);
    return m || moves[0];
  } catch {
    // Never throw: fall back to any legal move if available.
    try {
      const moves = game.legalMoves(seat);
      if (moves && moves.length) return moves[0];
    } catch {
      /* ignore */
    }
    return null;
  }
}
