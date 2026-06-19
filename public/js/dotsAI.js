/**
 * AleManKhora — Dots-and-Boxes AI
 * ===============================
 * Pure ES module. Picks one legal action for a seat. Never throws; returns
 * null only when there is no legal move. Lookahead is performed on cloned
 * engines via `DotsGame.fromState(game.toState())` so the live game is never
 * mutated.
 *
 * Difficulties
 * ------------
 *   easy   — random legal edge.
 *   normal — take a completing edge if available; else prefer a "safe" edge
 *            that does not leave any box with exactly 3 sides; if only unsafe
 *            edges remain, pick the one giving away the smallest chain.
 *   hard   — normal + chain-aware: open the shortest chain when forced, and
 *            double-cross (leave the last two boxes) when taking a long chain
 *            to keep control, except take everything if it wins outright.
 */

import { DotsGame } from './dots.js';

function clone(game) {
  return DotsGame.fromState(game.toState());
}

/** Count drawn sides of box(r,c) on engine g. */
function boxSides(g, r, c) {
  const C = g.cols;
  let n = 0;
  if (g.hEdges[r * C + c]) n++;
  if (g.hEdges[(r + 1) * C + c]) n++;
  if (g.vEdges[r * (C + 1) + c]) n++;
  if (g.vEdges[r * (C + 1) + (c + 1)]) n++;
  return n;
}

/** Boxes bordering an edge action, as [r,c] pairs. */
function bordersOf(g, m) {
  const R = g.rows;
  const C = g.cols;
  const out = [];
  if (m.o === 'h') {
    if (m.r - 1 >= 0) out.push([m.r - 1, m.c]);
    if (m.r < R) out.push([m.r, m.c]);
  } else {
    if (m.c - 1 >= 0) out.push([m.r, m.c - 1]);
    if (m.c < C) out.push([m.r, m.c]);
  }
  return out;
}

/** Does this edge complete at least one box right now? */
function completesBox(g, m) {
  for (const [r, c] of bordersOf(g, m)) {
    if (g.boxes[r * g.cols + c] === null && boxSides(g, r, c) === 3) return true;
  }
  return false;
}

/**
 * Would drawing this edge leave any (currently <3) bordering box at exactly 3
 * sides? i.e. it hands the opponent a free box. "Unsafe" if so.
 */
function isUnsafe(g, m) {
  for (const [r, c] of bordersOf(g, m)) {
    if (g.boxes[r * g.cols + c] !== null) continue;
    const before = boxSides(g, r, c);
    if (before === 3) continue; // already a 3-box; not made worse by us
    if (before === 2) return true; // we'd make it a 3-box
  }
  return false;
}

/** All currently-completable boxes (3 sided, unowned). */
function completableCount(g) {
  let n = 0;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (g.boxes[r * g.cols + c] === null && boxSides(g, r, c) === 3) n++;
    }
  }
  return n;
}

/** Pick a move that completes a box on g, or null. */
function findCompleting(g, moves) {
  for (const m of moves) if (completesBox(g, m)) return m;
  return null;
}

/**
 * Approximate the size of the "chain" opened by playing unsafe move m:
 * simulate it, then greedily let a taker grab all completable boxes and count
 * how many it can take in a row. Smaller = giving away less.
 */
function chainSizeAfter(game, seat, m) {
  const g = clone(game);
  try {
    g.apply(seat, m);
  } catch {
    return Infinity;
  }
  // Opponent now to move (since unsafe move completes no box). Let them grab.
  let taken = 0;
  let guard = 0;
  const limit = (g.rows + 1) * g.cols + g.rows * (g.cols + 1) + 2;
  while (!g.isOver() && guard++ < limit) {
    const mover = g.turn;
    const ms = g.legalMoves(mover);
    const grab = findCompleting(g, ms);
    if (!grab) break;
    try {
      g.apply(mover, grab);
    } catch {
      break;
    }
    if (mover !== seat) taken++;
  }
  return taken;
}

function pickEasy(moves) {
  return moves[Math.floor(Math.random() * moves.length)];
}

function pickSafeOrLeast(game, seat, moves) {
  const safe = [];
  for (const m of moves) {
    if (!isUnsafe(game, m)) safe.push(m);
  }
  if (safe.length) return safe[Math.floor(Math.random() * safe.length)];

  // Only unsafe edges remain: give away the smallest chain.
  let best = null;
  let bestSize = Infinity;
  for (const m of moves) {
    const size = chainSizeAfter(game, seat, m);
    if (size < bestSize) {
      bestSize = size;
      best = m;
    }
  }
  return best || moves[0];
}

function pickNormal(game, seat, moves) {
  const take = findCompleting(game, moves);
  if (take) return take;
  return pickSafeOrLeast(game, seat, moves);
}

/**
 * Hard: when boxes are available, take them but consider double-crossing —
 * if grabbing this box would leave a long chain we could instead decline the
 * last two boxes to keep control. Approximated greedily and only late game.
 * Otherwise behaves like normal but, when forced, opens the shortest chain.
 */
function pickHard(game, seat, moves) {
  const take = findCompleting(game, moves);
  if (take) {
    // Count how many boxes remain unclaimed; if taking everything ends the
    // game with a win, just take. The engine grants us another turn after a
    // completion, so default greedy taking is safe and the manager re-asks.
    const remaining = game.boxes.filter((o) => o === null).length;
    const completable = completableCount(game);

    // Double-cross: if there are exactly 2 completable boxes forming the tail
    // of a chain and claiming them is NOT a game-ending winning grab, decline
    // by playing the "hard-hearted handback" — a safe-ish edge that leaves
    // those two for the opponent while keeping control. We only do this when
    // it doesn't immediately lose and isn't the winning final grab.
    if (completable === 2 && remaining > 2) {
      const opp = seat === 0 ? 1 : 0;
      const [a, b] = game._scores();
      const myScore = seat === 0 ? a : b;
      const oppScore = seat === 0 ? b : a;
      // If taking the 2 boxes would NOT already clinch the win, double-cross.
      if (myScore + 2 <= oppScore + remaining - 2 + 0) {
        const handback = findDoubleCross(game, seat);
        if (handback) return handback;
      }
      void opp;
    }
    return take;
  }
  return pickSafeOrLeastShortest(game, seat, moves);
}

/**
 * Find a "double-cross" edge: when exactly two boxes are completable as a
 * chain tail, play the single edge that completes neither yet closes the
 * corridor, handing both boxes back to the opponent. Returns null if not
 * cleanly available.
 */
function findDoubleCross(game, seat) {
  // The handback edge is one that turns both remaining completable boxes from
  // 3-sided into... actually leaves them, but completes none and is the shared
  // edge. Heuristic: pick a legal edge that completes no box and, after we
  // play it, the opponent can take at most those 2 boxes then must move again.
  const moves = game.legalMoves(seat);
  let best = null;
  let bestGive = Infinity;
  for (const m of moves) {
    if (completesBox(game, m)) continue;
    const give = chainSizeAfter(game, seat, m);
    // We want a small handback (ideally 2).
    if (give < bestGive) {
      bestGive = give;
      best = m;
    }
  }
  // Only return if it gives away a bounded, small amount (the double-cross 2).
  if (best && bestGive <= 2) return best;
  return null;
}

/** Safe edge, else open the SHORTEST chain (hard variant). */
function pickSafeOrLeastShortest(game, seat, moves) {
  const safe = [];
  for (const m of moves) if (!isUnsafe(game, m)) safe.push(m);
  if (safe.length) return safe[Math.floor(Math.random() * safe.length)];

  let best = null;
  let bestSize = Infinity;
  for (const m of moves) {
    const size = chainSizeAfter(game, seat, m);
    if (size < bestSize) {
      bestSize = size;
      best = m;
    }
  }
  return best || moves[0];
}

/**
 * Choose one legal Dots-and-Boxes action for `seat`, or null if none exist.
 * @param {DotsGame} game
 * @param {0|1} seat
 * @param {'easy'|'normal'|'hard'} difficulty
 */
export function chooseDotsAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    if (difficulty === 'easy') return pickEasy(moves);
    if (difficulty === 'hard') {
      const m = pickHard(game, seat, moves);
      return m || moves[0];
    }
    const m = pickNormal(game, seat, moves);
    return m || moves[0];
  } catch {
    try {
      const moves = game.legalMoves(seat);
      if (moves && moves.length) return moves[0];
    } catch {
      /* ignore */
    }
    return null;
  }
}
