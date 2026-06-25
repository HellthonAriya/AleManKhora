/**
 * AleManKhora — Monopoly AI
 * =========================
 * Picks ONE legal action per call; the server loop calls us repeatedly while
 * it stays the bot's turn (roll → buy/manage → end). Three difficulties tune
 * how freely the bot spends and develops.
 *   easy   — buys timidly, rarely builds, keeps a big cushion
 *   normal — buys most things it lands on, builds when it holds a monopoly
 *   hard   — aggressive: buys, completes sets, builds up to a hotel, keeps lean
 */
import { BOARD, GROUPS } from './monopoly.js';

const TIERS = {
  easy:   { buyBuffer: 350, buildBuffer: 500, maxHouses: 2 },
  normal: { buyBuffer: 150, buildBuffer: 250, maxHouses: 4 },
  hard:   { buyBuffer: 60,  buildBuffer: 120, maxHouses: 5 },
};

function ownsFullGroup(g, seat, group) {
  const tiles = GROUPS[group] || [];
  return tiles.length > 0 && tiles.every((i) => g.owner[i] === seat);
}

/** Rough desirability of buying a tile (0..1) — completes/extends a set higher. */
function buyAppeal(g, seat, i) {
  const t = BOARD[i];
  if (t.type === 'rail') return 0.7;
  if (t.type === 'util') return 0.45;
  if (t.type !== 'prop') return 0;
  const tiles = GROUPS[t.group];
  const mine = tiles.filter((k) => g.owner[k] === seat).length;
  const free = tiles.filter((k) => g.owner[k] < 0).length;
  if (mine === tiles.length - 1) return 1;          // completes a monopoly
  if (mine >= 1) return 0.8;                          // extends a set
  if (free === tiles.length) return 0.55;            // fresh set, still open
  return 0.4;                                         // someone else holds part
}

export function chooseMonopolyAction(game, seat, difficulty = 'normal') {
  const moves = game.legalMoves(seat);
  if (!moves.length) return null;
  const tier = TIERS[difficulty] || TIERS.normal;
  const has = (type) => moves.find((m) => m.type === type);
  const cash = game.money[seat];

  // 1) Debt — raise money, then settle, else go bankrupt.
  if (game.pending?.kind === 'debt') {
    if (has('pay')) return { type: 'pay' };
    // sell houses first (least painful), then mortgage the cheapest holdings
    const sells = moves.filter((m) => m.type === 'sell');
    if (sells.length) return sells.sort((a, b) => BOARD[a.tile].house - BOARD[b.tile].house)[0];
    const morts = moves.filter((m) => m.type === 'mortgage');
    if (morts.length) return morts.sort((a, b) => BOARD[a.tile].mortgage - BOARD[b.tile].mortgage)[0];
    return { type: 'bankrupt' };
  }

  // 2) Buy decision.
  if (game.pending?.kind === 'buy') {
    if (has('buy')) {
      const i = game.pending.tile;
      const price = BOARD[i].price;
      const appeal = buyAppeal(game, seat, i);
      const buffer = tier.buyBuffer * (1 - appeal * 0.6); // chase good sets harder
      if (cash - price >= buffer) return { type: 'buy' };
    }
    return { type: 'pass' };
  }

  // 3) Jail.
  if (game.mustRoll && game.inJail[seat]) {
    if (has('jailCard')) return { type: 'jailCard' };
    // Pay out early if we're wealthy and want to be active; else roll for free.
    if (has('jailPay') && cash > 400) return { type: 'jailPay' };
    return { type: 'jailRoll' };
  }

  // 4) Must roll.
  if (game.mustRoll) return { type: 'roll' };

  // 5) Develop: build on monopolies while we keep a healthy cushion.
  const builds = moves.filter((m) => m.type === 'build'
    && ownsFullGroup(game, seat, BOARD[m.tile].group)
    && game.houses[m.tile] < tier.maxHouses);
  if (builds.length && cash >= tier.buildBuffer) {
    // build on the cheapest house first, lowest current development (even rule)
    builds.sort((a, b) => (game.houses[a.tile] - game.houses[b.tile]) || (BOARD[a.tile].house - BOARD[b.tile].house));
    const pick = builds[0];
    if (cash - BOARD[pick.tile].house >= tier.buildBuffer - BOARD[pick.tile].house) return pick;
  }

  // 6) Buy back mortgaged property when flush (hard/normal only).
  if (difficulty !== 'easy') {
    const un = moves.filter((m) => m.type === 'unmortgage');
    if (un.length && cash > tier.buildBuffer + 300) {
      return un.sort((a, b) => BOARD[a.tile].mortgage - BOARD[b.tile].mortgage)[0];
    }
  }

  // 7) Nothing worthwhile — end the turn.
  if (has('endTurn')) return { type: 'endTurn' };
  return moves[0];
}
