/**
 * AleManKhora — Pasur (پاسور) AI
 * ===============================
 * Picks a play for `seat`. To stay fair in this hidden-information game the AI
 * looks ONLY at the table and its own hand (never the opponent's cards). It
 * scores each legal move by the points it captures, pressure toward the
 * most-cards / most-clubs bonuses, and سور opportunities — and is penalised for
 * gifting valuable cards (aces, jacks, 10♦, 2♣) when laying a card down.
 */
import { fishValue } from './pasur.js';

function moveValue(game, move) {
  const card = move.card;
  const captured = move.capture || [];
  const placed = captured.length === 0;

  if (!placed) {
    let v = 0;
    const pile = [card, ...captured]; // everything that goes to my pile
    for (const c of pile) {
      if (c.r === 14) v += 1;                 // ace
      if (c.r === 11) v += 1;                 // jack
      if (c.r === 10 && c.s === 2) v += 3;    // 10♦
      if (c.r === 2 && c.s === 3) v += 2;     // 2♣
    }
    v += pile.length * 0.30;                  // most-cards pressure
    v += pile.filter((c) => c.s === 3).length * 0.45; // most-clubs pressure
    // سور — emptying the table scores a bonus, but NOT with a سرباز (Jack)
    // and NOT in the final round (deck exhausted).
    if (card.r !== 11 && game.table.length - captured.length === 0 && (game.deck?.length ?? 0) > 0) v += 6;
    return v;
  }

  // Laying a card down: mild cost, bigger for valuable cards we'd be exposing.
  let v = -0.5;
  if (card.r === 14) v -= 1.6;                // ace
  if (card.r === 11) v -= 1.6;                // jack
  if (card.r === 10 && card.s === 2) v -= 3;  // 10♦
  if (card.r === 2 && card.s === 3) v -= 2;   // 2♣
  // Avoid leaving a small total that the opponent can easily make 11 with.
  const v2 = fishValue(card);
  if (v2 != null && v2 >= 6) v -= 0.5;        // high cards are riskier to expose
  return v;
}

export function choosePasurAction(game, seat, difficulty = 'normal') {
  const moves = game.legalMoves(seat);
  if (!moves.length) return null;

  // Easy bots often just play something reasonable at random.
  if (difficulty === 'easy' && Math.random() < 0.6) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const noise = difficulty === 'hard' ? 0 : difficulty === 'easy' ? 2.5 : 0.8;
  let best = moves[0], bestV = -Infinity;
  for (const m of moves) {
    const v = moveValue(game, m) + (noise ? Math.random() * noise : 0);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
