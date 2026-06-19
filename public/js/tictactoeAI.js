/**
 * AleManKhora — Tic-tac-toe AI
 * ============================
 * `chooseTicTacToeAction(game, seat, difficulty)` returns one legal action
 * object (same shape as legalMoves entries) for `seat`, or null.
 *
 *   hard   — perfect minimax: never loses, always takes a win, always blocks.
 *   normal — minimax, but ~25% of the time picks a random non-optimal move.
 *   easy   — uniformly random legal move.
 *
 * Runs well under 300ms (the game tree is tiny) and never throws.
 */

import { TicTacToeGame } from './tictactoe.js';

function randomMove(moves) {
  return moves[Math.floor(Math.random() * moves.length)];
}

/**
 * Minimax with alpha-beta. Returns score from `me`'s perspective:
 * +10 - depth for a win, depth - 10 for a loss, 0 for a draw.
 */
function minimax(game, me, alpha, beta, depth) {
  if (game.winner !== null) {
    return game.winner === me ? 10 - depth : depth - 10;
  }
  if (game.draw) return 0;

  const seat = game.turn;
  const maximizing = seat === me;
  const moves = game.legalMoves(seat);
  let best = maximizing ? -Infinity : Infinity;

  for (const mv of moves) {
    const child = TicTacToeGame.fromState(game.toState());
    child.apply(seat, mv);
    const score = minimax(child, me, alpha, beta, depth + 1);
    if (maximizing) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** Return { best: move, scored: [{move, score}] } evaluated for `seat`. */
function evaluateMoves(game, seat) {
  const moves = game.legalMoves(seat);
  const scored = [];
  let bestScore = -Infinity;
  let bestMove = null;
  for (const mv of moves) {
    const child = TicTacToeGame.fromState(game.toState());
    child.apply(seat, mv);
    const score = minimax(child, seat, -Infinity, Infinity, 1);
    scored.push({ move: mv, score });
    if (score > bestScore) {
      bestScore = score;
      bestMove = mv;
    }
  }
  return { best: bestMove, bestScore, scored };
}

export function chooseTicTacToeAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;

    if (difficulty === 'easy') {
      return randomMove(moves);
    }

    const { best, bestScore, scored } = evaluateMoves(game, seat);

    if (difficulty === 'normal' && Math.random() < 0.25) {
      // Pick a random non-optimal move when one exists; else the best.
      const nonOptimal = scored.filter((s) => s.score < bestScore);
      if (nonOptimal.length > 0) {
        return nonOptimal[Math.floor(Math.random() * nonOptimal.length)].move;
      }
    }

    return best || randomMove(moves);
  } catch (_e) {
    const moves = game.legalMoves(seat);
    return moves && moves.length ? randomMove(moves) : null;
  }
}
