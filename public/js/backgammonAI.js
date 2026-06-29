/**
 * AleManKhora — Backgammon AI
 * ===========================
 * Pure ES module. Picks ONE legal single-die action for a seat under the
 * current dice. Never throws; returns null only when there is no legal move.
 *
 * The manager applies one die-move per call and re-invokes for the same seat
 * until the turn ends, so each call chooses exactly ONE move. Evaluation is
 * performed on cloned engines via `BackgammonGame.fromState(game.toState())`
 * so the live game is never mutated.
 *
 * Heuristic priority (fast, < 300ms):
 *   1. If on the bar, must enter (prefer entries that hit).
 *   2. Prefer moves that HIT an opponent blot.
 *   3. Prefer moves that MAKE a point (land where you already have >= 1).
 *   4. Bear off when possible.
 *   5. Otherwise improve pip count while minimizing own blot exposure.
 *      `hard` penalizes blot exposure more strongly than `normal`.
 */

import { BackgammonGame } from './backgammon.js';

function other(seat) {
  return seat === 0 ? 1 : 0;
}

function clone(game) {
  return BackgammonGame.fromState(game.toState());
}

/** Total pip count for `seat` (lower is better). */
function pipCount(g, seat) {
  let pips = 0;
  for (let i = 0; i < 24; i++) {
    const p = g.points[i];
    if (p.seat === seat) {
      // Distance to bear off: seat 0 → i+1, seat 1 → 24-i.
      const dist = seat === 0 ? i + 1 : 24 - i;
      pips += dist * p.count;
    }
  }
  // Bar checkers are maximally far (25 pips each).
  pips += g.bar[seat] * 25;
  return pips;
}

/** Number of own blots (lone checkers) exposed for `seat`. */
function blotCount(g, seat) {
  let n = 0;
  for (let i = 0; i < 24; i++) {
    const p = g.points[i];
    if (p.seat === seat && p.count === 1) n++;
  }
  return n;
}

/** Does this move hit an opponent blot in `game`'s pre-move state? */
function isHit(game, seat, move) {
  if (move.to === 'off') return false;
  const tp = game.points[move.to];
  return tp.seat !== null && tp.seat !== seat && tp.count === 1;
}

/** Does this move make/extend a point (land where seat already has >= 1)? */
function makesPoint(game, seat, move) {
  if (move.to === 'off') return false;
  const tp = game.points[move.to];
  return tp.seat === seat && tp.count >= 1;
}

/**
 * Score a single candidate move. Higher is better. `blotWeight` controls how
 * strongly resulting own-blot exposure is penalized.
 */
function scoreMove(game, seat, move, blotWeight) {
  const child = clone(game);
  try {
    child.apply(seat, move);
  } catch {
    return -Infinity;
  }

  let score = 0;

  if (isHit(game, seat, move)) score += 60;
  if (move.from === 'bar') score += 25; // entering is valuable
  if (move.to === 'off') score += 40; // bearing off
  if (makesPoint(game, seat, move)) score += 30;

  // Pip improvement: distance moved this die.
  if (move.to === 'off') {
    score += 6;
  } else if (move.from === 'bar') {
    score += 6;
  } else {
    score += Math.abs(move.to - move.from);
  }

  // Penalize resulting own blot exposure.
  const blots = blotCount(child, seat);
  score -= blots * blotWeight;

  // Slight bonus for advancing checkers in the opponent's home / back points
  // toward safety: reward lower overall pip count.
  score -= pipCount(child, seat) * 0.01;

  return score;
}

/**
 * Choose one legal Backgammon action for `seat`, or null if none exist.
 * @param {BackgammonGame} game
 * @param {0|1} seat
 * @param {'easy'|'normal'|'hard'} difficulty
 */
export function chooseBackgammonAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    // No playable move — pass the turn (the manager paces this so the human
    // sees the bot's dice for a beat first).
    if (!moves || moves.length === 0) return { type: 'pass' };
    if (moves.length === 1) return moves[0];

    if (difficulty === 'easy') {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    const blotWeight = difficulty === 'hard' ? 18 : 8;

    let best = null;
    let bestVal = -Infinity;
    for (const m of moves) {
      const v = scoreMove(game, seat, m, blotWeight);
      if (v > bestVal) {
        bestVal = v;
        best = m;
      }
    }
    return best || moves[0];
  } catch {
    try {
      const moves = game.legalMoves(seat);
      if (moves && moves.length) return moves[0];
      return { type: 'pass' };
    } catch {
      /* ignore */
    }
    return null;
  }
}
