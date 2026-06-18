/**
 * AleManKhora — AI opponent
 * -------------------------
 * A heuristic Quoridor bot with three difficulty levels.
 *
 * Core idea: evaluate a position as (opponentDistance - myDistance). The bot
 * compares its best advancing move against the best disruptive wall, and picks
 * whichever yields the better score, with difficulty controlling search depth
 * and randomness.
 */

import { QuoridorGame } from './engine.js';

function evalFor(game, me) {
  const opp = 1 - me;
  const myDist = game.shortestPath(me);
  const oppDist = game.shortestPath(opp);
  if (!isFinite(myDist)) return -1e6;
  if (!isFinite(oppDist)) return 1e6;
  // Want my distance small, opponent distance large.
  return oppDist - myDist;
}

function cloneApply(game, player, action) {
  const g = QuoridorGame.fromState(game.toState());
  try {
    g.apply(player, action);
    return g;
  } catch {
    return null;
  }
}

/**
 * Choose an action for `me`.
 * @param {QuoridorGame} game
 * @param {number} me
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {object} action
 */
export function chooseAction(game, me, difficulty = 'normal') {
  const opp = 1 - me;

  // 1) Best pawn move by resulting evaluation.
  let bestMove = null;
  let bestMoveScore = -Infinity;
  for (const d of game.legalMoves(me)) {
    const g = cloneApply(game, me, { type: 'move', r: d.r, c: d.c });
    if (!g) continue;
    let score = evalFor(g, me);
    if (g.winner === me) score += 1000;
    if (score > bestMoveScore) {
      bestMoveScore = score;
      bestMove = { type: 'move', r: d.r, c: d.c };
    }
  }

  // Easy bot: just advance, rarely place walls.
  if (difficulty === 'easy') {
    if (game.wallsLeft[me] > 0 && Math.random() < 0.15) {
      const walls = game.allWallPlacements(me);
      if (walls.length) return walls[Math.floor(Math.random() * walls.length)];
    }
    return bestMove ?? game.legalMoves(me)[0];
  }

  // 2) Best wall placement — only consider walls that hurt the opponent.
  let bestWall = null;
  let bestWallScore = -Infinity;
  if (game.wallsLeft[me] > 0) {
    const baseOppDist = game.shortestPath(opp);
    const candidates = game.allWallPlacements(me);
    // For performance on big boards, evaluate a capped, prioritized subset.
    const limit = difficulty === 'hard' ? 9999 : 60;
    let evaluated = 0;
    for (const w of candidates) {
      if (evaluated++ > limit) break;
      const g = cloneApply(game, me, w);
      if (!g) continue;
      const newOppDist = g.shortestPath(opp);
      // Skip walls that do not slow the opponent at all.
      if (newOppDist <= baseOppDist) continue;
      const score = evalFor(g, me) - 0.5; // small cost for spending a wall
      if (score > bestWallScore) {
        bestWallScore = score;
        bestWall = w;
      }
    }
  }

  // 3) Decide between advancing and walling.
  const noise = difficulty === 'hard' ? 0 : (Math.random() - 0.5) * 1.5;
  const moveVal = bestMoveScore + noise;
  const wallVal = bestWallScore;

  if (bestWall && wallVal > moveVal) return bestWall;
  return bestMove ?? game.legalMoves(me)[0] ?? null;
}
