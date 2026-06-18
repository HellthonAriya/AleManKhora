/**
 * AleManKhora — Chess AI
 * ----------------------
 * A pragmatic bot for both the 2-player and 4-player variants.
 *
 *  2-player : alpha-beta negamax (depth scales with difficulty) over a
 *             material + mobility + centre evaluation, capture-ordered, with a
 *             node budget so a move never hangs.
 *  4-player : greedy search maximising the bot's net material, with a one-reply
 *             threat estimate on the hardest level. Deep multi-player search is
 *             impractical, so play is heuristic but sensible.
 */
import { ChessGame, PIECE_VALUE } from './chess.js';

const MATE = 100000;
const CENTER_BONUS = 0.06;

function clone(g) { return ChessGame.fromState(g.toState()); }
function toAction(m) { return { type: 'move', from: m.from, to: m.to, promo: m.promo }; }

/** Quick capture value of a move (for ordering & 4p heuristics). */
function captureValue(g, m) {
  const t = g.board[m.to.r][m.to.c];
  let v = t ? PIECE_VALUE[t.t] : 0;
  if (m.ep) v = PIECE_VALUE.p;
  if (m.promo) v += PIECE_VALUE[m.promo] - PIECE_VALUE.p;
  return v;
}

function orderMoves(g, moves) {
  return moves
    .map((m) => ({ m, s: captureValue(g, m) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function centerScore(g, seat) {
  const midR = (g.rows - 1) / 2, midC = (g.cols - 1) / 2;
  let s = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const p = g.board[r][c];
    if (!p) continue;
    const d = Math.abs(r - midR) + Math.abs(c - midC);
    const near = Math.max(0, (g.rows / 2) - d) * CENTER_BONUS;
    if (g.sameTeam(p.seat, seat)) s += near; else s -= near;
  }
  return s;
}

function evalLeaf(g, seat) {
  return g.materialBalance(seat) + centerScore(g, seat);
}

/* ------------------------------ 2-player ---------------------------------- */

function negamax(g, depth, alpha, beta, ply, budget) {
  if (g.gameOver) {
    if (g.draw) return 0;
    // Side to move has been mated (the previous mover won).
    return -(MATE - ply);
  }
  if (depth === 0 || budget.n <= 0) return evalLeaf(g, g.turn);
  let best = -Infinity;
  const moves = orderMoves(g, g.legalMoves(g.turn));
  if (!moves.length) return evalLeaf(g, g.turn);
  for (const m of moves) {
    budget.n--;
    const c = clone(g);
    try { c.apply(c.turn, toAction(m)); } catch { continue; }
    const score = -negamax(c, depth - 1, -beta, -alpha, ply + 1, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (budget.n <= 0) break;
  }
  return best;
}

function choose2p(game, seat, difficulty) {
  const depth = difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2;
  const moves = orderMoves(game, game.legalMoves(seat));
  if (!moves.length) return null;
  const budget = { n: 70000 };
  let best = null, bestScore = -Infinity;
  const noise = difficulty === 'easy' ? 1.2 : difficulty === 'normal' ? 0.3 : 0.0;
  for (const m of moves) {
    const c = clone(game);
    try { c.apply(seat, toAction(m)); } catch { continue; }
    let score;
    if (c.gameOver) score = c.draw ? 0 : (c.winner === seat ? MATE : -MATE);
    else score = -negamax(c, depth - 1, -Infinity, Infinity, 1, budget);
    score += (Math.random() - 0.5) * noise;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? toAction(best) : null;
}

/* ------------------------------ 4-player ---------------------------------- */

/** Best material a single enemy could immediately grab after our move. */
function bestEnemyThreat(g, seat) {
  let worst = 0;
  for (let s = 0; s < g.numPlayers; s++) {
    if (g.eliminated[s] || g.sameTeam(s, seat)) continue;
    for (const m of g.legalMoves(s)) {
      const v = captureValue(g, m);
      if (v > worst) worst = v;
    }
  }
  return worst;
}

function choose4p(game, seat, difficulty) {
  const moves = game.legalMoves(seat);
  if (!moves.length) return null;
  const noise = difficulty === 'easy' ? 2.5 : difficulty === 'normal' ? 0.8 : 0.2;
  const lookThreat = difficulty === 'hard';
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const c = clone(game);
    try { c.apply(seat, toAction(m)); } catch { continue; }
    let score;
    if (c.gameOver) score = (c.winner !== null && c.sameTeam(c.winner, seat)) ? MATE : (c.draw ? 0 : -MATE);
    else {
      score = c.materialBalance(seat) + centerScore(c, seat) * 0.5;
      score += captureValue(game, m) * 0.4;       // reward grabbing material now
      if (lookThreat) score -= bestEnemyThreat(c, seat) * 0.7; // dodge obvious recaptures
    }
    score += (Math.random() - 0.5) * noise;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? toAction(best) : null;
}

/* -------------------------------- Entry ----------------------------------- */

export function chooseChessAction(game, seat, difficulty = 'normal') {
  if (game.eliminated[seat] || game.gameOver || game.turn !== seat) return null;
  return game.numPlayers === 2 ? choose2p(game, seat, difficulty) : choose4p(game, seat, difficulty);
}
