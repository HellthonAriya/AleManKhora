/**
 * AleManKhora — Pasur (پاسور) AI
 * ===============================
 * Picks a play for `seat`. To stay fair in this hidden-information game the AI
 * looks ONLY at information a human at the table would also have: the cards on
 * the table, its own hand, and the cards already captured by either side (every
 * capture is made in the open). It NEVER peeks at the opponent's hand or the
 * undealt deck.
 *
 * The `hard` bot additionally counts cards: from everything it has seen it
 * tracks which values are still unseen (in the opponent's hand or the deck) and
 * uses that to (a) avoid laying down a card the opponent is likely to fish, and
 * (b) value grabbing scarce, high-worth cards before they slip away.
 */
import { fishValue } from './pasur.js';

/** Scoring worth of a single card if it ends up in a pile (engine scoring). */
function pointWorth(c) {
  let v = 0;
  if (c.r === 14) v += 1;                 // ace
  if (c.r === 11) v += 1;                 // jack
  if (c.r === 10 && c.s === 2) v += 3;    // 10♦
  if (c.r === 2 && c.s === 3) v += 2;     // 2♣
  return v;
}

function moveValue(game, move) {
  const card = move.card;
  const captured = move.capture || [];
  const placed = captured.length === 0;

  if (!placed) {
    let v = 0;
    const pile = [card, ...captured]; // everything that goes to my pile
    for (const c of pile) v += pointWorth(c);
    v += pile.length * 0.30;                  // most-cards pressure
    v += pile.filter((c) => c.s === 3).length * 0.45; // most-clubs pressure
    // سور — emptying the table scores a bonus, but NOT with a سرباز (Jack).
    if (card.r !== 11 && game.table.length - captured.length === 0) v += 6;
    return v;
  }

  // Laying a card down: mild cost, bigger for valuable cards we'd be exposing.
  let v = -0.5;
  v -= pointWorth(card) * 1.0;                // exposing aces/jacks/10♦/2♣ hurts
  const v2 = fishValue(card);
  if (v2 != null && v2 >= 6) v -= 0.5;        // high cards are riskier to expose
  return v;
}

/** Count, per fishing value (1..10), how many cards are still UNSEEN — i.e. not
 *  in my hand, on the table, or in either capture pile. Fair card counting. */
function buildCount(game, seat) {
  const seen = new Array(15).fill(0);
  const mark = (c) => { if (c && c.r >= 2 && c.r <= 14) seen[c.r]++; };
  (game.hands[seat] || []).forEach(mark);
  (game.table || []).forEach(mark);
  (game.captured?.[0] || []).forEach(mark);
  (game.captured?.[1] || []).forEach(mark);
  const unseenByValue = {};   // fishValue -> remaining count
  let total = 0;
  for (let r = 2; r <= 14; r++) {
    const fv = r === 14 ? 1 : (r >= 2 && r <= 10 ? r : null);
    const u = Math.max(0, 4 - seen[r]);
    if (fv != null) { unseenByValue[fv] = (unseenByValue[fv] || 0) + u; }
    total += u;
  }
  return { unseenByValue, total: Math.max(1, total) };
}

/** Extra evaluation for the card-counting hard bot. */
function hardBonus(game, seat, move, count) {
  const card = move.card;
  const captured = move.capture || [];

  if (captured.length === 0) {
    // Laying down: how easily can the opponent fish the card we just exposed?
    const fv = fishValue(card);
    if (fv == null) return 0;                 // (only number cards lay down here)
    const need = 11 - fv;                     // a lone opponent card of this value takes it
    let risk = 0;
    if (need >= 1 && need <= 10) risk += (count.unseenByValue[need] || 0) / count.total;
    // Pairs already on the table that combine with ours to 11 widen the threat.
    for (const t of game.table) {
      const tv = fishValue(t);
      if (tv == null) continue;
      const need2 = 11 - fv - tv;
      if (need2 >= 1 && need2 <= 10) risk += 0.5 * (count.unseenByValue[need2] || 0) / count.total;
    }
    const worth = pointWorth(card) + (card.s === 3 ? 0.6 : 0) + 0.4; // club + most-cards stake
    return -risk * worth * 3.2;
  }

  // Capturing: deny the opponent scarce, valuable cards a touch more eagerly.
  let bonus = 0;
  for (const c of captured) {
    const w = pointWorth(c);
    if (w > 0) {
      const fv = fishValue(c);
      const scarcity = fv != null ? 1 - (count.unseenByValue[fv] || 0) / count.total : 0.5;
      bonus += w * 0.18 * (0.6 + scarcity);
    }
  }
  // Prefer not to hand back a fresh easy-11 to the opponent on the residual table.
  return bonus;
}

export function choosePasurAction(game, seat, difficulty = 'normal') {
  const moves = game.legalMoves(seat);
  if (!moves.length) return null;

  // Easy bots often just play something reasonable at random.
  if (difficulty === 'easy' && Math.random() < 0.6) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const hard = difficulty === 'hard';
  const count = hard ? buildCount(game, seat) : null;
  const noise = hard ? 0 : difficulty === 'easy' ? 2.5 : 0.8;
  let best = moves[0], bestV = -Infinity;
  for (const m of moves) {
    let v = moveValue(game, m);
    if (hard) v += hardBonus(game, seat, m, count);
    if (noise) v += Math.random() * noise;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
