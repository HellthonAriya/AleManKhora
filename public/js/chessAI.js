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

/** A move that changes material — captures, en passant and promotions. */
function isTactical(g, m) {
  return !!g.board[m.to.r][m.to.c] || !!m.ep || !!m.promo;
}

const TIMEOUT = Symbol('timeout');
const QUIESCE_CAP = 8; // max plies of forced captures to follow at a leaf

/**
 * Iterative-deepening alpha-beta with a quiescence search and a hard wall-clock
 * deadline. The deadline matters because the AI runs synchronously on the
 * server: a slow move would block every other game. Iterative deepening means
 * we always have a complete result from the last finished depth even if the
 * next depth is cut off.
 *
 * Quiescence search is the key to not "falling for simple tactics": rather than
 * evaluating in the middle of a capture sequence (the horizon effect), it keeps
 * searching forced captures until the position is quiet, so hanging pieces and
 * simple fork / skewer / pin tactics are seen.
 */
function choose2p(game, seat, difficulty) {
  const maxDepth = difficulty === 'easy' ? 2 : difficulty === 'hard' ? 4 : 3;
  const timeMs = difficulty === 'easy' ? 120 : difficulty === 'hard' ? 500 : 280;
  const quiet = difficulty !== 'easy';
  const noise = difficulty === 'easy' ? 1.4 : difficulty === 'normal' ? 0.12 : 0.0;
  const deadline = Date.now() + timeMs;
  let nodes = 0;
  const tick = () => { if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT; };

  function quiesce(g, alpha, beta, qd) {
    if (g.gameOver) return g.draw ? 0 : -MATE;
    let stand = evalLeaf(g, g.turn);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return alpha;
    const caps = orderMoves(g, g.legalMoves(g.turn).filter((m) => isTactical(g, m)));
    for (const m of caps) {
      tick();
      const c = clone(g);
      try { c.apply(c.turn, toAction(m)); } catch { continue; }
      const score = -quiesce(c, -beta, -alpha, qd - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(g, d, alpha, beta, ply) {
    if (g.gameOver) return g.draw ? 0 : -(MATE - ply); // side to move was mated
    if (d <= 0) return quiet ? quiesce(g, alpha, beta, QUIESCE_CAP) : evalLeaf(g, g.turn);
    const moves = orderMoves(g, g.legalMoves(g.turn));
    if (!moves.length) return evalLeaf(g, g.turn);
    let best = -Infinity;
    for (const m of moves) {
      tick();
      const c = clone(g);
      try { c.apply(c.turn, toAction(m)); } catch { continue; }
      const score = -negamax(c, d - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const rootMoves = orderMoves(game, game.legalMoves(seat));
  if (!rootMoves.length) return null;
  let best = rootMoves[0];

  // Iterative deepening: keep the best move from the deepest fully-searched ply.
  for (let depth = 1; depth <= maxDepth; depth++) {
    let bestScore = -Infinity, bestThisDepth = null, aborted = false;
    try {
      for (const m of rootMoves) {
        const c = clone(game);
        try { c.apply(seat, toAction(m)); } catch { continue; }
        let score;
        if (c.gameOver) score = c.draw ? 0 : (c.winner === seat ? MATE : -MATE);
        else score = -negamax(c, depth - 1, -Infinity, Infinity, 1);
        score += (Math.random() - 0.5) * noise;
        if (score > bestScore) { bestScore = score; bestThisDepth = m; }
      }
    } catch (e) { if (e === TIMEOUT) aborted = true; else throw e; }
    if (bestThisDepth && !aborted) best = bestThisDepth;
    if (aborted || Date.now() > deadline) break;
  }
  return toAction(best);
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
  const moves = orderMoves(game, game.legalMoves(seat));
  if (!moves.length) return null;
  const noise = difficulty === 'easy' ? 2.5 : difficulty === 'normal' ? 0.8 : 0.2;
  const lookThreat = difficulty === 'hard';
  // The AI runs synchronously on the server, so cap thinking time. Moves are
  // capture-ordered, so the strongest candidates are evaluated first.
  const deadline = Date.now() + 450;
  let best = moves[0], bestScore = -Infinity;
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
    if (Date.now() > deadline) break;
  }
  return toAction(best);
}

/* -------------------------------- Entry ----------------------------------- */

export function chooseChessAction(game, seat, difficulty = 'normal') {
  if (game.eliminated[seat] || game.gameOver || game.turn !== seat) return null;
  return game.numPlayers === 2 ? choose2p(game, seat, difficulty) : choose4p(game, seat, difficulty);
}
