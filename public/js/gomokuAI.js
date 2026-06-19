/**
 * AleManKhora — Gomoku AI
 * =======================
 * `chooseGomokuAction(game, seat, difficulty)` returns one legal action object
 * (same shape as legalMoves entries) for `seat`, or null.
 *
 * To stay fast on a 15×15 board it ONLY considers empty cells within distance
 * 2 of an existing stone (or the center when the board is empty). Each
 * candidate is scored with threat patterns (five, open four, four, open three,
 * three, …) for both attack and defense; the best is chosen.
 *
 *   hard / normal — pick the highest-scoring candidate (complete own five >
 *                   block opponent five > block open four > make own open four >
 *                   …). normal occasionally relaxes among near-best moves.
 *   easy          — random among reasonable (candidate) cells.
 *
 * Always returns in well under 300ms and never throws.
 */

import { GomokuGame } from './gomoku.js';

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// Pattern scores. "Open" = both ends empty (extendable both sides).
const SCORE = {
  FIVE: 10000000,
  OPEN_FOUR: 500000,
  FOUR: 50000,       // closed/simple four (one end blocked)
  OPEN_THREE: 20000,
  THREE: 1000,
  OPEN_TWO: 200,
  TWO: 50,
  ONE: 5,
};

function inBounds(n, r, c) {
  return r >= 0 && r < n && c >= 0 && c < n;
}

/**
 * Evaluate the line value contributed by hypothetically placing `seat` at
 * (r, c) on `board`. Considers all four directions and returns a score
 * reflecting the strongest resulting pattern for that seat.
 */
function lineScoreAt(board, n, r, c, seat) {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    // Count consecutive stones (including the hypothetical one at center).
    let count = 1;

    let openEnds = 0;

    let rr = r + dr, cc = c + dc;
    while (inBounds(n, rr, cc) && board[rr * n + cc] === seat) {
      count++; rr += dr; cc += dc;
    }
    if (inBounds(n, rr, cc) && board[rr * n + cc] === null) openEnds++;

    rr = r - dr; cc = c - dc;
    while (inBounds(n, rr, cc) && board[rr * n + cc] === seat) {
      count++; rr -= dr; cc -= dc;
    }
    if (inBounds(n, rr, cc) && board[rr * n + cc] === null) openEnds++;

    total += patternScore(count, openEnds);
  }
  return total;
}

function patternScore(count, openEnds) {
  if (count >= 5) return SCORE.FIVE;
  if (openEnds === 0) return 0; // fully blocked, useless
  switch (count) {
    case 4:
      return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.FOUR;
    case 3:
      return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.THREE;
    case 2:
      return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.TWO;
    case 1:
      return SCORE.ONE;
    default:
      return 0;
  }
}

/** Empty cells within Chebyshev distance `dist` of any existing stone. */
function candidateCells(game, dist = 2) {
  const n = game.n;
  const board = game.board;
  const seen = new Set();
  const cands = [];
  let hasStone = false;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r * n + c] === null) continue;
      hasStone = true;
      for (let dr = -dist; dr <= dist; dr++) {
        for (let dc = -dist; dc <= dist; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBounds(n, nr, nc)) continue;
          const idx = nr * n + nc;
          if (board[idx] !== null || seen.has(idx)) continue;
          seen.add(idx);
          cands.push({ r: nr, c: nc });
        }
      }
    }
  }

  if (!hasStone) {
    const mid = Math.floor(n / 2);
    return [{ r: mid, c: mid }];
  }
  return cands;
}

export function chooseGomokuAction(game, seat, difficulty = 'normal') {
  try {
    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;

    const n = game.n;
    const board = game.board;
    const opp = seat === 0 ? 1 : 0;
    const cands = candidateCells(game, 2);
    if (cands.length === 0) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    if (difficulty === 'easy') {
      const ch = cands[Math.floor(Math.random() * cands.length)];
      return { type: 'place', r: ch.r, c: ch.c };
    }

    // Score every candidate: own offense + weighted opponent defense.
    let bestScore = -Infinity;
    let best = null;
    const scored = [];
    for (const cell of cands) {
      const atk = lineScoreAt(board, n, cell.r, cell.c, seat);
      const def = lineScoreAt(board, n, cell.r, cell.c, opp);

      // Prefer completing our own win; otherwise weigh blocking the
      // opponent's strongest threat slightly below making the same threat
      // ourselves, so we take our win when both exist.
      let score;
      if (atk >= SCORE.FIVE) {
        score = atk * 10; // immediate win, dominate
      } else {
        score = atk + def * 0.9;
      }
      scored.push({ cell, score });
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }

    if (difficulty === 'normal' && bestScore < SCORE.FIVE) {
      // Occasionally relax among the near-best moves (within 15%).
      if (Math.random() < 0.2) {
        const threshold = bestScore * 0.85;
        const near = scored.filter((s) => s.score >= threshold);
        if (near.length > 0) {
          best = near[Math.floor(Math.random() * near.length)].cell;
        }
      }
    }

    if (!best) {
      best = cands[Math.floor(Math.random() * cands.length)];
    }
    return { type: 'place', r: best.r, c: best.c };
  } catch (_e) {
    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;
    return moves[Math.floor(Math.random() * moves.length)];
  }
}
