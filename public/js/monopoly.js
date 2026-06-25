/**
 * AleManKhora — Monopoly (مونوپولی) Engine
 * =========================================
 * A full-rules Monopoly for 2–4 players, Iranian-city themed. Pure ES module
 * shared by server and browser like the other engines. `apply` runs ONLY on the
 * server and may use Math.random for dice and card shuffles; `fromState` NEVER
 * re-randomises — it just restores state.
 *
 * Implemented: dice + doubles (3 → jail), passing GO salary, buying property,
 * rent (with full-group double, houses/hotels, railroad count, utility ×dice),
 * income/luxury tax, شانس / صندوق cards, jail (pay/card/roll, 3-turn limit),
 * building houses & hotels (even-build rule), mortgage / unmortgage, bankruptcy
 * and elimination, last-player-standing win.
 *
 * Not implemented (house-ruled out): live auctions and player-to-player trading.
 *
 * A turn is several `apply` calls by the SAME seat (roll → buy/manage → end);
 * the turn only passes to the next player on an explicit `endTurn` (or when a
 * roll isn't a double). The generic socket/AI loop drives this naturally.
 */

export const START_CASH = 1500;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const JAIL_POS = 10;
export const GO_TO_JAIL_POS = 30;

const G = { BROWN: 'brown', LBLUE: 'lblue', PINK: 'pink', ORANGE: 'orange',
           RED: 'red', YELLOW: 'yellow', GREEN: 'green', DBLUE: 'dblue' };

/** Palette per colour group (used by the renderer too). */
export const GROUP_COLOR = {
  [G.BROWN]: '#8d5b3f', [G.LBLUE]: '#a9d6ef', [G.PINK]: '#d6469b',
  [G.ORANGE]: '#e8923c', [G.RED]: '#d63b3b', [G.YELLOW]: '#f2cf3b',
  [G.GREEN]: '#2faa55', [G.DBLUE]: '#2f5fd6',
};

// p = prop, r = rail, u = util, plus specials. rent = [base,1,2,3,4,hotel].
const P = (name, group, price, rent, house) => ({ type: 'prop', name, group, price, rent, house, mortgage: price / 2 });
const RAIL = (name) => ({ type: 'rail', name, price: 200, mortgage: 100 });
const UTIL = (name) => ({ type: 'util', name, price: 150, mortgage: 75 });

/** The 40 board tiles, in order (classic layout, Iranian-city theme). */
export const BOARD = [
  { type: 'go', name: 'شروع' },                                             // 0
  P('شهرضا', G.BROWN, 60, [2, 10, 30, 90, 160, 250], 50),                   // 1
  { type: 'chest', name: 'صندوق' },                                          // 2
  P('نجف‌آباد', G.BROWN, 60, [4, 20, 60, 180, 320, 450], 50),               // 3
  { type: 'tax', name: 'مالیات بر درآمد', tax: 200 },                        // 4
  RAIL('راه‌آهن تهران'),                                                     // 5
  P('کاشان', G.LBLUE, 100, [6, 30, 90, 270, 400, 550], 50),                 // 6
  { type: 'chance', name: 'شانس' },                                          // 7
  P('اراک', G.LBLUE, 100, [6, 30, 90, 270, 400, 550], 50),                  // 8
  P('قزوین', G.LBLUE, 120, [8, 40, 100, 300, 450, 600], 50),                // 9
  { type: 'jail', name: 'زندان' },                                           // 10
  P('رشت', G.PINK, 140, [10, 50, 150, 450, 625, 750], 100),                 // 11
  UTIL('اداره برق'),                                                         // 12
  P('ساری', G.PINK, 140, [10, 50, 150, 450, 625, 750], 100),                // 13
  P('گرگان', G.PINK, 160, [12, 60, 180, 500, 700, 900], 100),               // 14
  RAIL('راه‌آهن مشهد'),                                                      // 15
  P('همدان', G.ORANGE, 180, [14, 70, 200, 550, 750, 950], 100),             // 16
  { type: 'chest', name: 'صندوق' },                                          // 17
  P('کرمانشاه', G.ORANGE, 180, [14, 70, 200, 550, 750, 950], 100),          // 18
  P('سنندج', G.ORANGE, 200, [16, 80, 220, 600, 800, 1000], 100),            // 19
  { type: 'parking', name: 'پارکینگ رایگان' },                              // 20
  P('کرمان', G.RED, 220, [18, 90, 250, 700, 875, 1050], 150),               // 21
  { type: 'chance', name: 'شانس' },                                          // 22
  P('یزد', G.RED, 220, [18, 90, 250, 700, 875, 1050], 150),                 // 23
  P('زاهدان', G.RED, 240, [20, 100, 300, 750, 925, 1100], 150),             // 24
  RAIL('راه‌آهن اصفهان'),                                                    // 25
  P('اهواز', G.YELLOW, 260, [22, 110, 330, 800, 975, 1150], 150),           // 26
  P('بندرعباس', G.YELLOW, 260, [22, 110, 330, 800, 975, 1150], 150),        // 27
  UTIL('اداره آب'),                                                          // 28
  P('بوشهر', G.YELLOW, 280, [24, 120, 360, 850, 1025, 1200], 150),          // 29
  { type: 'gotojail', name: 'به زندان برو' },                               // 30
  P('تبریز', G.GREEN, 300, [26, 130, 390, 900, 1100, 1275], 200),           // 31
  P('ارومیه', G.GREEN, 300, [26, 130, 390, 900, 1100, 1275], 200),          // 32
  { type: 'chest', name: 'صندوق' },                                          // 33
  P('اردبیل', G.GREEN, 320, [28, 150, 450, 1000, 1200, 1400], 200),         // 34
  RAIL('راه‌آهن تبریز'),                                                     // 35
  { type: 'chance', name: 'شانس' },                                          // 36
  P('مشهد', G.DBLUE, 350, [35, 175, 500, 1100, 1300, 1500], 200),           // 37
  { type: 'tax', name: 'مالیات تجمل', tax: 100 },                            // 38
  P('تهران', G.DBLUE, 400, [50, 200, 600, 1400, 1700, 2000], 200),          // 39
];

/** Tile indices for each colour group. */
export const GROUPS = (() => {
  const m = {};
  BOARD.forEach((t, i) => { if (t.type === 'prop') (m[t.group] ||= []).push(i); });
  return m;
})();
const RAILS = BOARD.map((t, i) => (t.type === 'rail' ? i : -1)).filter((i) => i >= 0);
const UTILS = BOARD.map((t, i) => (t.type === 'util' ? i : -1)).filter((i) => i >= 0);

// Card effect descriptors. m=money (±), to=move to tile (collect GO if passed),
// by=relative move, jail=go to jail, card=get-out-of-jail, rail/util=nearest+pay,
// repair=[perHouse,perHotel], each=collect/pay from every other player.
const CHANCE = [
  { text: 'به «شروع» برو (۲۰۰ بگیر).', to: 0 },
  { text: 'به تهران برو.', to: 39 },
  { text: 'به راه‌آهن تهران برو.', to: 5 },
  { text: 'به نزدیک‌ترین راه‌آهن برو و دو برابر کرایه بده.', rail: true },
  { text: 'به نزدیک‌ترین اداره برو؛ ۱۰ برابر تاس بده.', util: true },
  { text: 'سود بانکی: ۵۰ بگیر.', m: 50 },
  { text: 'کارت «آزادی از زندان».', card: true },
  { text: 'سه خانه به عقب برو.', by: -3 },
  { text: 'به زندان برو — مستقیم.', jail: true },
  { text: 'تعمیرات: هر خانه ۲۵، هر هتل ۱۰۰.', repair: [25, 100] },
  { text: 'جریمه رانندگی: ۱۵ بده.', m: -15 },
  { text: 'به همدان برو.', to: 16 },
  { text: 'به‌عنوان رئیس هیئت‌مدیره به هر بازیکن ۵۰ بده.', each: -50 },
  { text: 'وام ساختمانی: ۱۵۰ بگیر.', m: 150 },
];
const CHEST = [
  { text: 'به «شروع» برو (۲۰۰ بگیر).', to: 0 },
  { text: 'اشتباه بانک به نفع تو: ۲۰۰ بگیر.', m: 200 },
  { text: 'هزینه دکتر: ۵۰ بده.', m: -50 },
  { text: 'فروش سهام: ۵۰ بگیر.', m: 50 },
  { text: 'کارت «آزادی از زندان».', card: true },
  { text: 'به زندان برو — مستقیم.', jail: true },
  { text: 'جشن خیریه؛ از هر بازیکن ۵۰ بگیر.', each: 50 },
  { text: 'صندوق پس‌انداز: ۱۰۰ بگیر.', m: 100 },
  { text: 'بازگشت مالیات: ۲۰ بگیر.', m: 20 },
  { text: 'بیمه عمر سررسید شد: ۱۰۰ بگیر.', m: 100 },
  { text: 'هزینه بیمارستان: ۱۰۰ بده.', m: -100 },
  { text: 'شهریه مدرسه: ۵۰ بده.', m: -50 },
  { text: 'حق مشاوره: ۲۵ بگیر.', m: 25 },
  { text: 'تعمیر خیابان: هر خانه ۴۰، هر هتل ۱۱۵.', repair: [40, 115] },
  { text: 'برنده مسابقه زیبایی: ۱۰ بگیر.', m: 10 },
  { text: 'ارثیه: ۱۰۰ بگیر.', m: 100 },
];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const d6 = () => 1 + Math.floor(Math.random() * 6);

export class MonopolyGame {
  constructor(opts = {}) {
    this.gameType = 'monopoly';
    const n = [2, 3, 4].includes(Number(opts.players)) ? Number(opts.players) : 2;
    this.numPlayers = n;
    this.teams = false;
    this.hidden = true;            // redact upcoming card order from clients

    this.phase = 'play';
    this.turn = 0;
    // Safety cap so a no-trade game can't run forever: after this many turns the
    // wealthiest player (by net worth) wins. ~100 turns each by default.
    this.maxTurns = Number(opts.maxTurns) > 0 ? Number(opts.maxTurns) : n * 100;
    this.turnsTaken = 0;
    // Optional house rules (all default to the classic behaviour).
    this.startCash = Number(opts.startCash) > 0 ? Number(opts.startCash) : START_CASH;
    this.goSalary = Number(opts.goSalary) > 0 ? Number(opts.goSalary) : GO_SALARY;
    this.freeParkingJackpot = !!opts.freeParkingJackpot; // taxes/fines pile in the centre
    this.goDoubleOnExact = !!opts.goDoubleOnExact;        // exact landing on «شروع» pays ×2
    this.auctions = !!opts.auctions;                     // decline → property goes to auction
    this.pot = 0;                                         // centre pot (Free Parking rule)
    this.auction = null;                                 // active auction, or null
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.winningTeam = null;
    this.eliminated = new Array(n).fill(false);
    this.moveCount = 0;

    // Per-player
    this.money = new Array(n).fill(this.startCash);
    this.pos = new Array(n).fill(0);
    this.inJail = new Array(n).fill(false);
    this.jailTurns = new Array(n).fill(0);
    this.jailCards = new Array(n).fill(0);

    // Per-tile
    this.owner = BOARD.map(() => -1);
    this.houses = BOARD.map(() => 0);
    this.mortgaged = BOARD.map(() => false);

    // Turn state
    this.dice = null;              // [d1,d2] of the last roll this turn
    this.doublesCount = 0;
    this.lastRollWasDouble = false;
    this.mustRoll = true;          // current player must roll (or act on jail)
    this.pending = null;           // {kind:'buy',tile} | {kind:'debt',amount,creditor}
    this.lastCard = null;          // {deck, text} of the last drawn card (for reveal)
    this.log = ['بازی شروع شد — نوبت بازیکن ۱'];

    this.chanceDeck = shuffle(CHANCE.map((_, i) => i));
    this.chestDeck = shuffle(CHEST.map((_, i) => i));
  }

  /* ------------------------------- helpers ------------------------------- */
  activePlayers() { return this.range().filter((s) => !this.eliminated[s]); }
  range() { return Array.from({ length: this.numPlayers }, (_, i) => i); }
  isOver() { return this.winner !== null || this.draw === true; }

  _groupTiles(group) { return GROUPS[group] || []; }
  _ownsAll(seat, tiles) { return tiles.every((i) => this.owner[i] === seat); }
  _ownsFullGroup(seat, group) {
    const t = this._groupTiles(group);
    return t.length > 0 && this._ownsAll(seat, t);
  }
  _railsOwned(seat) { return RAILS.filter((i) => this.owner[i] === seat).length; }
  _utilsOwned(seat) { return UTILS.filter((i) => this.owner[i] === seat).length; }

  /** Rent owed for landing on owned tile `i`, given the dice sum that got here. */
  _rent(i, diceSum) {
    const t = BOARD[i];
    const owner = this.owner[i];
    if (owner < 0 || this.mortgaged[i] || owner === this.turn) return 0;
    if (t.type === 'rail') return 25 * Math.pow(2, this._railsOwned(owner) - 1);
    if (t.type === 'util') return (this._utilsOwned(owner) === 2 ? 10 : 4) * diceSum;
    if (t.type === 'prop') {
      const h = this.houses[i];
      if (h === 0) return this._ownsFullGroup(owner, t.group) ? t.rent[0] * 2 : t.rent[0];
      return t.rent[h];
    }
    return 0;
  }

  /** Cash a player could raise by mortgaging everything + selling buildings. */
  _raisable(seat) {
    let sum = 0;
    BOARD.forEach((t, i) => {
      if (this.owner[i] !== seat) return;
      if (this.houses[i] > 0) sum += this.houses[i] * (t.house / 2);
      else if (!this.mortgaged[i]) sum += t.mortgage;
    });
    return sum;
  }
  _netWorth(seat) {
    let sum = this.money[seat];
    BOARD.forEach((t, i) => {
      if (this.owner[i] !== seat) return;
      sum += this.mortgaged[i] ? t.mortgage : (t.price || 0);
      sum += this.houses[i] * (t.house || 0);
    });
    return sum;
  }

  /* --------------------------------- state ------------------------------- */
  toState() {
    return {
      gameType: 'monopoly', numPlayers: this.numPlayers, teams: false,
      phase: this.phase, turn: this.turn, winner: this.winner, draw: this.draw,
      endReason: this.endReason, winningTeam: null,
      eliminated: this.eliminated.slice(), moveCount: this.moveCount,
      maxTurns: this.maxTurns, turnsTaken: this.turnsTaken,
      money: this.money.slice(), pos: this.pos.slice(),
      inJail: this.inJail.slice(), jailTurns: this.jailTurns.slice(), jailCards: this.jailCards.slice(),
      owner: this.owner.slice(), houses: this.houses.slice(), mortgaged: this.mortgaged.slice(),
      dice: this.dice ? this.dice.slice() : null,
      doublesCount: this.doublesCount, lastRollWasDouble: this.lastRollWasDouble,
      mustRoll: this.mustRoll, pending: this.pending ? { ...this.pending } : null,
      lastCard: this.lastCard ? { ...this.lastCard } : null,
      log: this.log.slice(-6),
      chanceDeck: this.chanceDeck.slice(), chestDeck: this.chestDeck.slice(),
      legal: this.legalMoves(this.turn),
      startCash: this.startCash, goSalary: this.goSalary,
      pot: this.pot, freeParkingJackpot: this.freeParkingJackpot, goDoubleOnExact: this.goDoubleOnExact,
      auctions: this.auctions, auction: this.auction ? { ...this.auction, out: this.auction.out.slice() } : null,
    };
  }
  toStateFor(viewer) {
    const st = this.toState();
    st.chanceDeck = null;   // hide upcoming card order
    st.chestDeck = null;
    return st;
  }
  static fromState(state) {
    const g = Object.create(MonopolyGame.prototype);
    g.gameType = 'monopoly';
    g.numPlayers = state.numPlayers;
    g.teams = false; g.hidden = true;
    g.phase = state.phase; g.turn = state.turn;
    g.winner = state.winner; g.draw = state.draw;
    g.endReason = state.endReason; g.winningTeam = null;
    g.eliminated = (state.eliminated || []).slice();
    g.moveCount = state.moveCount || 0;
    g.maxTurns = state.maxTurns || (g.numPlayers * 100);
    g.turnsTaken = state.turnsTaken || 0;
    g.startCash = state.startCash || START_CASH;
    g.goSalary = state.goSalary || GO_SALARY;
    g.freeParkingJackpot = !!state.freeParkingJackpot;
    g.goDoubleOnExact = !!state.goDoubleOnExact;
    g.auctions = !!state.auctions;
    g.auction = state.auction ? { ...state.auction, out: (state.auction.out || []).slice() } : null;
    g.pot = state.pot || 0;
    g.money = (state.money || []).slice();
    g.pos = (state.pos || []).slice();
    g.inJail = (state.inJail || []).slice();
    g.jailTurns = (state.jailTurns || []).slice();
    g.jailCards = (state.jailCards || []).slice();
    g.owner = (state.owner || []).slice();
    g.houses = (state.houses || []).slice();
    g.mortgaged = (state.mortgaged || []).slice();
    g.dice = state.dice ? state.dice.slice() : null;
    g.doublesCount = state.doublesCount || 0;
    g.lastRollWasDouble = !!state.lastRollWasDouble;
    g.mustRoll = !!state.mustRoll;
    g.pending = state.pending ? { ...state.pending } : null;
    g.lastCard = state.lastCard ? { ...state.lastCard } : null;
    g.log = (state.log || []).slice();
    g.chanceDeck = (state.chanceDeck || []).slice();
    g.chestDeck = (state.chestDeck || []).slice();
    return g;
  }

  /* ------------------------------ legal moves ---------------------------- */
  legalMoves(seat = this.turn) {
    if (this.isOver() || seat !== this.turn || this.eliminated[seat]) return [];
    const out = [];
    const cash = this.money[seat];

    if (this.auction) {
      const min = this.auction.high + 1;
      if (cash >= min) out.push({ type: 'bid', amount: min });
      out.push({ type: 'auctionPass' });
      return out;
    }

    if (this.pending?.kind === 'debt') {
      const amt = this.pending.amount;
      // Raise money: sell houses, then mortgage.
      this._sellableTiles(seat).forEach((i) => out.push({ type: 'sell', tile: i }));
      this._mortgageableTiles(seat).forEach((i) => out.push({ type: 'mortgage', tile: i }));
      if (cash >= amt) out.push({ type: 'pay' });
      out.push({ type: 'bankrupt' });
      return out;
    }
    if (this.pending?.kind === 'buy') {
      const t = BOARD[this.pending.tile];
      if (cash >= t.price) out.push({ type: 'buy' });
      out.push({ type: 'pass' });
      // managing is still allowed during the buy decision
      this._manageMoves(seat, out);
      return out;
    }

    if (this.mustRoll) {
      if (this.inJail[seat]) {
        if (this.jailCards[seat] > 0) out.push({ type: 'jailCard' });
        if (cash >= JAIL_FINE) out.push({ type: 'jailPay' });
        out.push({ type: 'jailRoll' });
      } else {
        out.push({ type: 'roll' });
      }
      this._manageMoves(seat, out);
      return out;
    }

    // Resolved roll, not a double pending → may manage then end the turn.
    this._manageMoves(seat, out);
    out.push({ type: 'endTurn' });
    return out;
  }
  _sellableTiles(seat) {
    return BOARD.map((t, i) => i).filter((i) => {
      const t = BOARD[i];
      if (t.type !== 'prop' || this.owner[i] !== seat || this.houses[i] <= 0) return false;
      const grp = this._groupTiles(t.group);
      return this.houses[i] === Math.max(...grp.map((g) => this.houses[g])); // even sell
    });
  }
  _mortgageableTiles(seat) {
    return BOARD.map((t, i) => i).filter((i) => {
      const t = BOARD[i];
      if (!['prop', 'rail', 'util'].includes(t.type)) return false;
      if (this.owner[i] !== seat || this.mortgaged[i]) return false;
      if (t.type === 'prop' && this._groupTiles(t.group).some((g) => this.houses[g] > 0)) return false;
      return true;
    });
  }
  _buildableTiles(seat) {
    return BOARD.map((t, i) => i).filter((i) => {
      const t = BOARD[i];
      if (t.type !== 'prop' || this.owner[i] !== seat || this.houses[i] >= 5) return false;
      if (!this._ownsFullGroup(seat, t.group)) return false;
      const grp = this._groupTiles(t.group);
      if (grp.some((g) => this.mortgaged[g])) return false;
      if (this.houses[i] !== Math.min(...grp.map((g) => this.houses[g]))) return false; // even build
      return this.money[seat] >= t.house;
    });
  }
  _unmortgageableTiles(seat) {
    return BOARD.map((t, i) => i).filter((i) =>
      this.owner[i] === seat && this.mortgaged[i] && this.money[seat] >= Math.ceil(BOARD[i].mortgage * 1.1));
  }
  _manageMoves(seat, out) {
    this._buildableTiles(seat).forEach((i) => out.push({ type: 'build', tile: i }));
    this._sellableTiles(seat).forEach((i) => out.push({ type: 'sell', tile: i }));
    this._mortgageableTiles(seat).forEach((i) => out.push({ type: 'mortgage', tile: i }));
    this._unmortgageableTiles(seat).forEach((i) => out.push({ type: 'unmortgage', tile: i }));
  }

  /* -------------------------------- mutate ------------------------------- */
  apply(seat, action) {
    if (this.isOver()) throw new Error('بازی تمام شده');
    if (seat !== this.turn) throw new Error('نوبت تو نیست');
    if (this.eliminated[seat]) throw new Error('حذف شده‌ای');
    const type = action?.type;
    if (!type) throw new Error('حرکت نامعتبر');

    this.lastCard = null; // cleared each action; set when a card is drawn

    if (this.auction && type !== 'bid' && type !== 'auctionPass') throw new Error('حراج در جریان است');

    switch (type) {
      case 'bid': this._bid(seat, action.amount); break;
      case 'auctionPass': this._auctionPass(seat); break;
      case 'roll': this._roll(seat, false); break;
      case 'jailRoll': this._roll(seat, true); break;
      case 'jailPay': this._requirePending(false); this._payJail(seat); break;
      case 'jailCard': this._requirePending(false); this._useJailCard(seat); break;
      case 'buy': this._buy(seat); break;
      case 'pass': this._pass(seat); break;
      case 'build': this._build(seat, action.tile); break;
      case 'sell': this._sell(seat, action.tile); break;
      case 'mortgage': this._mortgage(seat, action.tile); break;
      case 'unmortgage': this._unmortgage(seat, action.tile); break;
      case 'pay': this._payDebt(seat); break;
      case 'bankrupt': this._bankrupt(seat); break;
      case 'endTurn': this._endTurn(seat); break;
      default: throw new Error('حرکت ناشناخته');
    }

    this.moveCount++;
    return { state: this.toState(), winner: this.winner };
  }

  _requirePending(v) {
    if (!!this.pending !== v) throw new Error('اکنون مجاز نیست');
  }
  _logMsg(s) { this.log.push(s); if (this.log.length > 30) this.log.shift(); }
  _name(seat) { return `بازیکن ${seat + 1}`; }

  _roll(seat, jailAttempt) {
    if (!this.mustRoll) throw new Error('الان نمی‌توانی تاس بریزی');
    if (this.pending) throw new Error('اول تصمیم فعلی را تمام کن');
    if (jailAttempt && !this.inJail[seat]) throw new Error('در زندان نیستی');
    if (!jailAttempt && this.inJail[seat]) throw new Error('در زندان هستی');

    const d1 = d6(), d2 = d6();
    this.dice = [d1, d2];
    const sum = d1 + d2;
    const isDouble = d1 === d2;
    this.lastRollWasDouble = isDouble;

    if (this.inJail[seat]) {
      // Jail roll attempt.
      if (isDouble) {
        this.inJail[seat] = false; this.jailTurns[seat] = 0;
        this._logMsg(`${this._name(seat)} با جفت (${d1}) از زندان آزاد شد.`);
        this.lastRollWasDouble = false;     // no extra roll after leaving jail this way
        this._advance(seat, sum); return;
      }
      this.jailTurns[seat]++;
      if (this.jailTurns[seat] >= 3) {
        this._logMsg(`${this._name(seat)} سه بار جفت نیاورد — ۵۰ جریمه داد.`);
        this.inJail[seat] = false; this.jailTurns[seat] = 0;
        this._fee(seat, JAIL_FINE);
        if (this.pending) return;           // couldn't pay → debt
        this.lastRollWasDouble = false;
        this._advance(seat, sum); return;
      }
      this._logMsg(`${this._name(seat)} جفت نیاورد (${d1}،${d2}) — در زندان ماند.`);
      this.mustRoll = false;                 // turn will end
      return;
    }

    // Normal roll.
    if (isDouble) {
      this.doublesCount++;
      if (this.doublesCount >= 3) {
        this._logMsg(`${this._name(seat)} سه جفت پیاپی — به زندان رفت!`);
        this._sendToJail(seat);
        this.mustRoll = false;
        return;
      }
    }
    this._advance(seat, sum);
  }

  /** Move `seat` forward `steps`, collecting GO salary if it passes/lands on 0. */
  _advance(seat, steps) {
    const before = this.pos[seat];
    let p = (before + steps) % 40;
    if (before + steps >= 40) {
      let pay = this.goSalary;
      if (this.goDoubleOnExact && p === 0) pay *= 2;   // exact landing on «شروع»
      this.money[seat] += pay;
      this._logMsg(`${this._name(seat)} ${p === 0 && this.goDoubleOnExact ? 'دقیقاً روی «شروع» ایستاد' : 'از «شروع» گذشت'} (+${pay}).`);
    }
    this.pos[seat] = p;
    this._resolve(seat, steps);
  }

  /** Resolve the tile the player landed on. */
  _resolve(seat, diceSum) {
    const i = this.pos[seat];
    const t = BOARD[i];

    if (t.type === 'gotojail') { this._logMsg(`${this._name(seat)} به زندان رفت.`); this._sendToJail(seat); this.mustRoll = false; return; }
    if (t.type === 'parking') {
      if (this.freeParkingJackpot && this.pot > 0) {
        this._logMsg(`${this._name(seat)} جایزهٔ پارکینگ را برد (+${this.pot})!`);
        this.money[seat] += this.pot; this.pot = 0;
      }
      this._afterResolve(seat); return;
    }
    if (t.type === 'go' || t.type === 'jail') { this._afterResolve(seat); return; }
    if (t.type === 'tax') { this._logMsg(`${this._name(seat)} ${t.tax} مالیات داد.`); this._fee(seat, t.tax); if (!this.pending) this._afterResolve(seat); return; }
    if (t.type === 'chance' || t.type === 'chest') { this._drawCard(seat, t.type, diceSum); return; }

    // Property / rail / util
    const owner = this.owner[i];
    if (owner < 0) {
      this.pending = { kind: 'buy', tile: i };
      this._logMsg(`${this._name(seat)} روی ${t.name} ایستاد — برای خرید ${t.price}.`);
      return; // wait for buy/pass
    }
    if (owner === seat || this.mortgaged[i]) { this._afterResolve(seat); return; }
    const rent = this._rent(i, diceSum);
    this._logMsg(`${this._name(seat)} ${rent} کرایه ${t.name} را به ${this._name(owner)} داد.`);
    this._charge(seat, rent, owner);
    if (!this.pending) this._afterResolve(seat);
  }

  _drawCard(seat, deck, diceSum) {
    const isChance = deck === 'chance';
    const cards = isChance ? CHANCE : CHEST;
    let deckArr = isChance ? this.chanceDeck : this.chestDeck;
    if (deckArr.length === 0) {
      deckArr = shuffle(cards.map((_, k) => k));
      if (isChance) this.chanceDeck = deckArr; else this.chestDeck = deckArr;
    }
    const idx = deckArr.shift();
    const card = cards[idx];
    this.lastCard = { deck, text: card.text };
    this._logMsg(`${isChance ? 'شانس' : 'صندوق'}: ${card.text}`);

    // get-out-of-jail cards are simply granted to the player here.
    if (card.card) { this.jailCards[seat]++; this._afterResolve(seat); return; }
    if (card.jail) { this._sendToJail(seat); this.mustRoll = false; return; }
    if (typeof card.m === 'number') {
      if (card.m >= 0) this.money[seat] += card.m; else this._fee(seat, -card.m);
      if (!this.pending) this._afterResolve(seat); return;
    }
    if (typeof card.each === 'number') {
      const others = this.activePlayers().filter((s) => s !== seat);
      const amt = Math.abs(card.each);
      if (card.each >= 0) {
        // collect from each (they can't be bankrupted by someone else's card)
        others.forEach((o) => { const pay = Math.min(amt, this.money[o]); this.money[o] -= pay; this.money[seat] += pay; });
        this._afterResolve(seat);
      } else {
        // pay each: the bank fronts the others; the player owes the total.
        others.forEach((o) => { this.money[o] += amt; });
        this._charge(seat, amt * others.length, -1);
        if (!this.pending) this._afterResolve(seat);
      }
      return;
    }
    if (card.repair) {
      let houses = 0, hotels = 0;
      BOARD.forEach((t, i) => { if (this.owner[i] === seat) { if (this.houses[i] === 5) hotels++; else houses += this.houses[i]; } });
      const cost = houses * card.repair[0] + hotels * card.repair[1];
      this._fee(seat, cost); if (!this.pending) this._afterResolve(seat); return;
    }
    if (typeof card.to === 'number') {
      const steps = (card.to - this.pos[seat] + 40) % 40;
      this._advance(seat, steps === 0 ? 0 : steps);
      if (card.to === 0 && steps === 0) { /* already handled GO in _advance when wrapping */ }
      return;
    }
    if (typeof card.by === 'number') {
      let p = (this.pos[seat] + card.by + 40) % 40; this.pos[seat] = p;
      this._resolve(seat, diceSum); return;
    }
    if (card.rail) { this._toNearest(seat, RAILS, 2); return; }
    if (card.util) { this._toNearest(seat, UTILS, 'util'); return; }
    this._afterResolve(seat);
  }

  /** Advance to the nearest tile in `targets`; pay multiplier rent if owned. */
  _toNearest(seat, targets, mult) {
    const from = this.pos[seat];
    let best = targets[0], bestD = 99;
    for (const t of targets) { const d = (t - from + 40) % 40; if (d > 0 && d < bestD) { bestD = d; best = t; } }
    const passedGo = from + bestD >= 40;
    if (passedGo) { this.money[seat] += GO_SALARY; }
    this.pos[seat] = best;
    const owner = this.owner[best];
    const t = BOARD[best];
    if (owner < 0) { this.pending = { kind: 'buy', tile: best }; this._logMsg(`${this._name(seat)} روی ${t.name} ایستاد — برای خرید ${t.price}.`); return; }
    if (owner === seat || this.mortgaged[best]) { this._afterResolve(seat); return; }
    let rent;
    if (mult === 'util') rent = 10 * (this.dice[0] + this.dice[1]);
    else rent = this._rent(best, this.dice[0] + this.dice[1]) * mult;
    this._logMsg(`${this._name(seat)} ${rent} به ${this._name(owner)} داد.`);
    this._charge(seat, rent, owner);
    if (!this.pending) this._afterResolve(seat);
  }

  _sendToJail(seat) {
    this.pos[seat] = JAIL_POS; this.inJail[seat] = true; this.jailTurns[seat] = 0;
    this.doublesCount = 0; this.lastRollWasDouble = false; this.dice = null;
  }
  _payJail(seat) {
    if (!this.inJail[seat]) throw new Error('در زندان نیستی');
    if (this.money[seat] < JAIL_FINE) throw new Error('پول کافی نداری');
    this.money[seat] -= JAIL_FINE; this.inJail[seat] = false; this.jailTurns[seat] = 0;
    if (this.freeParkingJackpot) this.pot += JAIL_FINE;
    this._logMsg(`${this._name(seat)} ۵۰ داد و از زندان آزاد شد — حالا تاس بریز.`);
    // still must roll & move this turn
  }
  _useJailCard(seat) {
    if (!this.inJail[seat]) throw new Error('در زندان نیستی');
    if (this.jailCards[seat] <= 0) throw new Error('کارت آزادی نداری');
    this.jailCards[seat]--; this.inJail[seat] = false; this.jailTurns[seat] = 0;
    this._logMsg(`${this._name(seat)} با کارت آزادی از زندان بیرون آمد — حالا تاس بریز.`);
  }

  _buy(seat) {
    if (this.pending?.kind !== 'buy') throw new Error('چیزی برای خرید نیست');
    const i = this.pending.tile, t = BOARD[i];
    if (this.money[seat] < t.price) throw new Error('پول کافی نداری');
    this.money[seat] -= t.price; this.owner[i] = seat;
    this._logMsg(`${this._name(seat)} ${t.name} را خرید (${t.price}).`);
    this.pending = null;
    this._afterResolve(seat);
  }
  _pass(seat) {
    if (this.pending?.kind !== 'buy') throw new Error('چیزی برای رد کردن نیست');
    const tile = this.pending.tile;
    this._logMsg(`${this._name(seat)} از خرید ${BOARD[tile].name} گذشت.`);
    this.pending = null;
    if (this.auctions && this.activePlayers().length > 1) { this._startAuction(tile, seat); return; }
    this._afterResolve(seat);
  }

  /* ------------------------------- auction ------------------------------- */
  _startAuction(tile, lander) {
    this.auction = {
      tile, high: 0, bidder: -1, lander,
      out: new Array(this.numPlayers).fill(false),
      cursor: (lander - 1 + this.numPlayers) % this.numPlayers, // so the lander bids first
    };
    this._logMsg(`🔨 حراجِ ${BOARD[tile].name} شروع شد.`);
    this._auctionNext();
  }
  _auctionNext() {
    const a = this.auction;
    const elig = this.range().filter((s) => !this.eliminated[s] && !a.out[s] && s !== a.bidder);
    if (elig.length === 0) { if (a.bidder >= 0) this._auctionWin(); else this._auctionNoSale(); return; }
    let s = a.cursor;
    for (let k = 0; k < this.numPlayers; k++) {
      s = (s + 1) % this.numPlayers;
      if (elig.includes(s)) { a.cursor = s; this.turn = s; return; }
    }
    if (a.bidder >= 0) this._auctionWin(); else this._auctionNoSale();
  }
  _bid(seat, amount) {
    const a = this.auction;
    if (!a) throw new Error('حراجی در جریان نیست');
    if (seat !== this.turn) throw new Error('نوبت پیشنهاد تو نیست');
    amount = Math.floor(Number(amount) || 0);
    if (amount <= a.high) throw new Error('پیشنهاد باید بیشتر باشد');
    if (amount > this.money[seat]) throw new Error('پول کافی نداری');
    a.high = amount; a.bidder = seat; a.cursor = seat;
    this._logMsg(`${this._name(seat)} ${amount} پیشنهاد داد.`);
    this._auctionNext();
  }
  _auctionPass(seat) {
    const a = this.auction;
    if (!a) throw new Error('حراجی در جریان نیست');
    if (seat !== this.turn) throw new Error('نوبت تو نیست');
    a.out[seat] = true; a.cursor = seat;
    this._logMsg(`${this._name(seat)} از حراج کنار کشید.`);
    this._auctionNext();
  }
  _auctionWin() {
    const a = this.auction, t = BOARD[a.tile], lander = a.lander;
    this.money[a.bidder] -= a.high; this.owner[a.tile] = a.bidder;
    this._logMsg(`${this._name(a.bidder)} ${t.name} را در حراج به ${a.high} برد.`);
    this.auction = null; this.turn = lander; this._afterResolve(lander);
  }
  _auctionNoSale() {
    const a = this.auction, lander = a.lander;
    this._logMsg(`حراجِ ${BOARD[a.tile].name} بدون خریدار ماند.`);
    this.auction = null; this.turn = lander; this._afterResolve(lander);
  }

  _build(seat, i) {
    if (!this._buildableTiles(seat).includes(i)) throw new Error('اینجا نمی‌توانی بسازی');
    const t = BOARD[i];
    this.money[seat] -= t.house; this.houses[i]++;
    this._logMsg(`${this._name(seat)} روی ${t.name} ${this.houses[i] === 5 ? 'هتل' : 'خانه'} ساخت.`);
  }
  _sell(seat, i) {
    const t = BOARD[i];
    if (this.owner[i] !== seat || this.houses[i] <= 0) throw new Error('چیزی برای فروش نیست');
    const grp = this._groupTiles(t.group);
    if (this.houses[i] !== Math.max(...grp.map((g) => this.houses[g]))) throw new Error('باید یکنواخت بفروشی');
    this.houses[i]--; this.money[seat] += t.house / 2;
    this._logMsg(`${this._name(seat)} یک بنا از ${t.name} فروخت (+${t.house / 2}).`);
    this._maybeSettle(seat);
  }
  _mortgage(seat, i) {
    const t = BOARD[i];
    if (this.owner[i] !== seat || this.mortgaged[i]) throw new Error('قابل رهن نیست');
    if (t.type === 'prop' && this._groupTiles(t.group).some((g) => this.houses[g] > 0)) throw new Error('اول بناها را بفروش');
    this.mortgaged[i] = true; this.money[seat] += t.mortgage;
    this._logMsg(`${this._name(seat)} ${t.name} را رهن گذاشت (+${t.mortgage}).`);
    this._maybeSettle(seat);
  }
  _unmortgage(seat, i) {
    const t = BOARD[i];
    if (this.owner[i] !== seat || !this.mortgaged[i]) throw new Error('در رهن نیست');
    const cost = Math.ceil(t.mortgage * 1.1);
    if (this.money[seat] < cost) throw new Error('پول کافی نداری');
    this.mortgaged[i] = false; this.money[seat] -= cost;
    this._logMsg(`${this._name(seat)} رهن ${t.name} را آزاد کرد (-${cost}).`);
  }

  /** Charge `amount` from seat to creditor (-1 = bank). If short, open a debt. */
  _charge(seat, amount, creditor) {
    if (amount <= 0) return;
    if (this.money[seat] >= amount) {
      this.money[seat] -= amount;
      if (creditor >= 0) this.money[creditor] += amount;
      return;
    }
    this.pending = { kind: 'debt', amount, creditor };
  }
  /** A fee/fine to the bank — diverted to the centre pot under the Free Parking
   *  house rule. Opens a debt (tagged toPot) if the player is short. */
  _fee(seat, amount) {
    if (amount <= 0) return;
    if (this.money[seat] >= amount) {
      this.money[seat] -= amount;
      if (this.freeParkingJackpot) this.pot += amount;
      return;
    }
    this.pending = { kind: 'debt', amount, creditor: -1, toPot: this.freeParkingJackpot };
  }
  _payDebt(seat) {
    if (this.pending?.kind !== 'debt') throw new Error('بدهی‌ای نیست');
    const { amount, creditor, toPot } = this.pending;
    if (this.money[seat] < amount) throw new Error('هنوز پول کافی نداری');
    this.money[seat] -= amount;
    if (creditor >= 0) this.money[creditor] += amount;
    else if (toPot) this.pot += amount;
    this.pending = null;
    this._afterResolve(seat);
  }
  /** After raising money, auto-clear a debt if it can now be covered. */
  _maybeSettle(seat) {
    if (this.pending?.kind === 'debt' && this.money[seat] >= this.pending.amount) {
      // leave it for an explicit 'pay' so the AI/player confirms; nothing to do
    }
  }

  _bankrupt(seat) {
    const creditor = this.pending?.kind === 'debt' ? this.pending.creditor : -1;
    // Transfer assets.
    BOARD.forEach((t, i) => {
      if (this.owner[i] !== seat) return;
      if (creditor >= 0) {
        this.owner[i] = creditor;
        // creditor keeps mortgaged status; houses are sold to bank for cash.
        if (this.houses[i] > 0) { this.money[creditor] += this.houses[i] * (t.house / 2); this.houses[i] = 0; }
      } else {
        this.owner[i] = -1; this.houses[i] = 0; this.mortgaged[i] = false;
      }
    });
    if (creditor >= 0) { this.money[creditor] += Math.max(0, this.money[seat]); this.jailCards[creditor] += this.jailCards[seat]; }
    this.money[seat] = 0; this.jailCards[seat] = 0;
    this.eliminated[seat] = true; this.pending = null;
    this._logMsg(`${this._name(seat)} ورشکست شد و از بازی خارج شد.`);

    const alive = this.activePlayers();
    if (alive.length <= 1) {
      this.winner = alive[0] ?? null; this.phase = 'over'; this.endReason = 'bankruptcy';
      if (this.winner != null) this._logMsg(`🏆 ${this._name(this.winner)} برنده شد!`);
      return;
    }
    this._nextTurn();
  }

  /** Decide what happens after a landing is fully resolved (no pending). */
  _afterResolve(seat) {
    if (this.pending) return;
    if (this.inJail[seat]) { this.mustRoll = false; return; }
    if (this.lastRollWasDouble && this.doublesCount < 3) { this.mustRoll = true; return; }
    this.mustRoll = false;   // may now manage and end the turn
  }

  _endTurn(seat) {
    if (this.mustRoll) throw new Error('باید تاس بریزی');
    if (this.pending) throw new Error('اول تصمیم فعلی را تمام کن');
    this._nextTurn();
  }
  _nextTurn() {
    this.dice = null; this.doublesCount = 0; this.lastRollWasDouble = false;
    this.pending = null; this.mustRoll = true;
    this.turnsTaken++;
    if (this.turnsTaken >= this.maxTurns) { this._finishByWorth(); return; }
    let s = this.turn;
    for (let k = 0; k < this.numPlayers; k++) {
      s = (s + 1) % this.numPlayers;
      if (!this.eliminated[s]) { this.turn = s; break; }
    }
    this._logMsg(`نوبت ${this._name(this.turn)}.`);
  }

  /** End the game by net worth (turn cap reached). Richest active player wins. */
  _finishByWorth() {
    const alive = this.activePlayers();
    let best = null, bestW = -Infinity, tie = false;
    for (const s of alive) {
      const w = this._netWorth(s);
      if (w > bestW) { bestW = w; best = s; tie = false; }
      else if (w === bestW) tie = true;
    }
    this.phase = 'over'; this.endReason = 'turn-limit';
    if (tie || best == null) { this.draw = true; this.winner = null; this._logMsg('سقف نوبت‌ها — مساوی شد.'); }
    else { this.winner = best; this._logMsg(`سقف نوبت‌ها — 🏆 ثروتمندترین: ${this._name(best)}.`); }
  }

  /** Forfeit / disconnect elimination (used by the manager). */
  eliminate(seat) {
    if (this.eliminated[seat]) return this.isOver();
    this.eliminated[seat] = true;
    BOARD.forEach((t, i) => { if (this.owner[i] === seat) { this.owner[i] = -1; this.houses[i] = 0; this.mortgaged[i] = false; } });
    const alive = this.activePlayers();
    if (alive.length <= 1) { this.winner = alive[0] ?? null; this.phase = 'over'; this.endReason = 'forfeit'; }
    else if (this.turn === seat) this._nextTurn();
    return this.isOver();
  }
}
