/**
 * AleManKhora — Hokm AI
 * =====================
 * `chooseHokmAction(game, seat, difficulty)` returns ONE legal action or null.
 * Runs in <300ms and NEVER throws.
 *
 * The AI uses ONLY its own hand (`game.hands[seat]`) and public information
 * (trick, ledSuit, trump, tricksWon). It never inspects other players' hands.
 */

function highCount(cards) {
  // Number of A/K/Q in the set.
  let n = 0;
  for (const c of cards) if (c.r >= 12) n++;
  return n;
}

/** Pick the trump suit: most cards, tie-break by most high cards. */
function chooseTrump(hand) {
  const bySuit = [[], [], [], []];
  for (const c of hand) bySuit[c.s].push(c);
  let best = 0;
  for (let s = 1; s < 4; s++) {
    const a = bySuit[s];
    const b = bySuit[best];
    if (a.length > b.length || (a.length === b.length && highCount(a) > highCount(b))) {
      best = s;
    }
  }
  return { type: 'trump', suit: best };
}

function pickRandom(moves) {
  return moves[Math.floor(Math.random() * moves.length)];
}

export function chooseHokmAction(game, seat, difficulty = 'normal') {
  try {
    if (!game) return null;

    if (game.phase === 'choose-trump') {
      if (seat !== game.hakem) return null;
      const hand = game.hands[seat];
      if (!hand) return null;
      return chooseTrump(hand);
    }

    if (game.phase !== 'play') return null;

    const moves = game.legalMoves(seat);
    if (!moves || moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    if (difficulty === 'easy') return pickRandom(moves);

    const trump = game.trump;
    const ledSuit = game.ledSuit;
    const cards = moves.map((m) => m.card);
    const hand = game.hands[seat] || [];

    const isTrump = (c) => trump != null && c.s === trump;

    const byRankAsc = (arr) => arr.slice().sort((x, y) => x.r - y.r);
    const lowest = (arr) => byRankAsc(arr)[0];
    const highest = (arr) => byRankAsc(arr)[arr.length - 1];

    const toAction = (card) =>
      moves.find((m) => m.card.s === card.s && m.card.r === card.r) || moves[0];

    // ---- Leading (empty trick) ----
    if (game.trick.length === 0) {
      const nonTrump = cards.filter((c) => !isTrump(c));
      // Lead an Ace of a non-trump suit if held.
      const aces = nonTrump.filter((c) => c.r === 14);
      if (aces.length) return toAction(highest(aces));
      // Else a high non-trump card.
      if (nonTrump.length) {
        const high = nonTrump.filter((c) => c.r >= 12);
        if (high.length) return toAction(highest(high));
        return toAction(highest(nonTrump));
      }
      // Only trumps left: lead lowest to conserve high trumps.
      return toAction(lowest(cards));
    }

    // ---- Following ----
    // Current best card/seat in the trick.
    let best = game.trick[0];
    for (let i = 1; i < game.trick.length; i++) {
      if (game.beats(game.trick[i].card, best.card)) best = game.trick[i];
    }
    const partnerWinning = game.teams && (best.seat % 2) === (seat % 2) && best.seat !== seat;

    // Which legal cards would beat the current best?
    const winners = cards.filter((c) => game.beats(c, best.card));

    if (partnerWinning) {
      // Don't waste a high card if partner already winning — dump lowest.
      return toAction(discard(cards, lowest, isTrump));
    }

    if (winners.length) {
      if (difficulty === 'hard') {
        // Trump conservation: prefer non-trump winners; among trumps use lowest.
        const nonTrumpWinners = winners.filter((c) => !isTrump(c));
        // If the only way to win is trumping but a small discard would be wiser
        // when partner could still cover — we have no partner info beyond best,
        // so simply win cheaply when worthwhile.
        const pool = nonTrumpWinners.length ? nonTrumpWinners : winners;
        return toAction(lowest(pool));
      }
      // normal: win with the lowest card that beats it.
      return toAction(lowest(winners));
    }

    // Cannot/shouldn't win → discard lowest, preferring shortest non-trump suit.
    return toAction(discard(cards, lowest, isTrump));
  } catch (e) {
    // Never throw: fall back to any legal move.
    try {
      const moves = game.legalMoves(seat);
      if (moves && moves.length) return moves[0];
    } catch (e2) { /* ignore */ }
    return null;
  }
}

/** Choose a discard: lowest card, preferring the shortest non-trump suit. */
function discard(cards, lowest, isTrump) {
  const nonTrump = cards.filter((c) => !isTrump(c));
  const pool = nonTrump.length ? nonTrump : cards;
  // Count suit lengths within the pool.
  const len = {};
  for (const c of pool) len[c.s] = (len[c.s] || 0) + 1;
  // Find shortest suit length.
  let shortLen = Infinity;
  for (const s in len) if (len[s] < shortLen) shortLen = len[s];
  const shortest = pool.filter((c) => len[c.s] === shortLen);
  return lowest(shortest.length ? shortest : pool);
}
