/**
 * AleManKhora — Pasur (پاسور / چهاربرگ) Engine
 * =============================================
 * A 2-player Persian fishing card game, also called «چهاربرگ» (four cards) and
 * locally «هفت و چهار». Pure ES module shared by server and browser like the
 * other engines. `apply` runs ONLY on the server and may use Math.random for
 * the shuffle/deal; `fromState` NEVER re-shuffles — it just restores state.
 *
 * HIDDEN INFORMATION: a player sees only their own hand (and never the deck).
 * `toState()` is the full state (server-internal / persistence); `toStateFor`
 * redacts the opponent's hand and the undealt deck.
 *
 * Card model: { s, r }  — suit s ∈ 0..3 (0=♠, 1=♥, 2=♦, 3=♣),
 *                          rank r ∈ 2..14 (J=11, Q=12, K=13, A=14).
 *
 * Rules implemented
 * -----------------
 *  • Deal 4 cards to each player and 4 face-up on the table. The opening table
 *    never starts with a Jack (re-dealt if so).
 *  • The «magic number» is 11. On your turn you play one card:
 *      – Number card (A=1 … 10): you may capture any set of table NUMBER cards
 *        whose values + your card = 11 (e.g. a 7 captures a 4, or a 3+A). You
 *        may also choose to just lay the card on the table.
 *      – Jack (سرباز): sweeps EVERY table card except Queens and Kings.
 *      – Queen / King (بی‌بی / شاه): captures table cards of the same rank only.
 *    A card that captures nothing is laid on the table.
 *  • «سور» (sweep): emptying the table with a capture scores a bonus.
 *  • When both hands empty and cards remain, deal 4 more to each. At the very
 *    end the last player to capture takes any cards left on the table.
 *
 * Scoring (points)
 * ----------------
 *    each Ace …… 1      each Jack …… 1
 *    10♦ …… 3          2♣ …… 2
 *    each سور …… 5
 *    most cards (>26) …… 7      most clubs (≥7) …… 7
 *  Higher total wins; equal totals are a draw.
 */

const SUR_POINTS = 5;
const MOST_CARDS_POINTS = 7;
const MOST_CLUBS_POINTS = 7;

/** Fishing value for the sum-to-11 rule, or null for picture cards (J/Q/K). */
export function fishValue(card) {
  if (card.r === 14) return 1;                 // Ace counts as 1
  if (card.r >= 2 && card.r <= 10) return card.r;
  return null;                                 // J / Q / K
}

/** All non-empty subsets of `cards` whose fishValue sum equals `target`. */
export function subsetsSummingTo(cards, target) {
  const res = [];
  const n = cards.length;
  const rec = (i, acc, sum) => {
    if (sum === target) { if (acc.length) res.push(acc.slice()); return; }
    if (sum > target || i >= n) return;
    acc.push(cards[i]); rec(i + 1, acc, sum + fishValue(cards[i])); acc.pop();
    rec(i + 1, acc, sum);
  };
  rec(0, [], 0);
  return res;
}

function buildDeck() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ s, r });
  return deck;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
const clone = (c) => ({ s: c.s, r: c.r });
const sameCard = (a, b) => a.s === b.s && a.r === b.r;

export class PasurGame {
  constructor() {
    this.gameType = 'pasur';
    this.numPlayers = 2;
    this.teams = false;

    // Deal, ensuring the opening table has no Jack (would be an instant sweep).
    let deck, hands, table, attempts = 0;
    do {
      deck = shuffle(buildDeck());
      hands = [deck.splice(0, 4), deck.splice(0, 4)];
      table = deck.splice(0, 4);
      attempts++;
    } while (table.some((c) => c.r === 11) && attempts < 30);

    this.deck = deck;          // 40 undealt cards
    this.hands = hands;        // [ [4], [4] ]
    this.table = table;        // 4 face-up
    this.captured = [[], []];  // each player's won pile
    this.surs = [0, 0];

    this.turn = 0;
    this.lastCapturer = null;
    this.phase = 'play';

    this.scores = null;
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.winningTeam = null;
    this.eliminated = [false, false];
    this.moveCount = 0;
    this.hidden = true;
  }

  // ----------------------------------------------------------------- state

  toState() {
    return {
      gameType: 'pasur',
      numPlayers: 2,
      teams: false,
      magic: 11,
      phase: this.phase,
      turn: this.turn,
      hands: this.hands.map((h) => (h == null ? null : h.map(clone))),
      handCounts: this.hands.map((h) => (h == null ? 0 : h.length)),
      table: this.table.map(clone),
      capturedCounts: this.captured.map((p) => p.length),
      clubCounts: this.captured.map((p) => p.filter((c) => c.s === 3).length),
      surs: this.surs.slice(),
      deck: this.deck.map(clone),   // hidden — redacted by toStateFor
      deckCount: this.deck.length,
      lastCapturer: this.lastCapturer,
      scores: this.scores ? this.scores.slice() : null,
      winner: this.winner,
      draw: this.draw,
      endReason: this.endReason,
      winningTeam: null,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
    };
  }

  /** Full state but with the opponent's hand and the undealt deck hidden. */
  toStateFor(viewer) {
    const st = this.toState();
    st.deck = null;
    const valid = viewer === 0 || viewer === 1;
    st.hands = this.hands.map((h, i) =>
      (valid && i === viewer && h != null) ? h.map(clone) : null);
    return st;
  }

  static fromState(state) {
    const g = Object.create(PasurGame.prototype);
    g.gameType = 'pasur';
    g.numPlayers = 2;
    g.teams = false;
    g.phase = state.phase;
    g.turn = state.turn;
    g.hands = (state.hands || []).map((h) => (h == null ? null : h.map(clone)));
    g.table = (state.table || []).map(clone);
    g.captured = [[], []];                  // contents unknown client-side
    g.capturedCounts = state.capturedCounts;
    g.clubCounts = state.clubCounts;
    g.surs = (state.surs || [0, 0]).slice();
    g.deck = (state.deck || []).map(clone);
    g.deckCount = state.deckCount;
    g.lastCapturer = state.lastCapturer;
    g.scores = state.scores ? state.scores.slice() : null;
    g.winner = state.winner;
    g.draw = state.draw;
    g.endReason = state.endReason;
    g.winningTeam = null;
    g.eliminated = (state.eliminated || [false, false]).slice();
    g.moveCount = state.moveCount;
    g.hidden = true;
    return g;
  }

  // --------------------------------------------------------------- queries

  isOver() { return this.winner !== null || this.draw === true; }

  activePlayers() { return [0, 1].filter((s) => !this.eliminated[s]); }

  /** Captures forced by a picture card (J/Q/K), or null for number cards. */
  _forcedCapture(card) {
    if (card.r === 11) return this.table.filter((c) => c.r !== 12 && c.r !== 13);
    if (card.r === 12 || card.r === 13) return this.table.filter((c) => c.r === card.r);
    return null;
  }

  legalMoves(seat = this.turn) {
    if (this.isOver() || seat !== this.turn) return [];
    const hand = this.hands[seat];
    if (!hand) return [];
    const out = [];
    for (const card of hand) {
      const forced = this._forcedCapture(card);
      if (forced) {
        // Picture card: capture is computed authoritatively (may be empty = lay down).
        out.push({ type: 'play', card: clone(card), capture: forced.map(clone) });
      } else {
        const target = 11 - fishValue(card);
        const nums = this.table.filter((c) => fishValue(c) != null);
        const subs = subsetsSummingTo(nums, target);
        if (subs.length) {
          // Capture is MANDATORY when the card can take — no lay-down option.
          for (const sub of subs) out.push({ type: 'play', card: clone(card), capture: sub.map(clone) });
        } else {
          out.push({ type: 'play', card: clone(card), capture: [] }); // lay down (nothing to take)
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- mutate

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'play') throw new Error('invalid action');

    const card = action.card;
    if (!card || !Number.isInteger(card.s) || !Number.isInteger(card.r)) throw new Error('invalid card');
    const hand = this.hands[seat];
    if (!hand) throw new Error('no hand');
    const hi = hand.findIndex((c) => sameCard(c, card));
    if (hi < 0) throw new Error('card not in hand');

    let captured = [];
    const forced = this._forcedCapture(card);
    if (forced) {
      captured = forced.map(clone);             // J/Q/K computed authoritatively
    } else {
      const target = 11 - fishValue(card);
      const sel = Array.isArray(action.capture) ? action.capture : [];
      if (sel.length) {
        const tbl = this.table.slice();
        for (const sc of sel) {
          const idx = tbl.findIndex((c) => sameCard(c, sc));
          if (idx < 0) throw new Error('کارت انتخابی روی میز نیست');
          if (fishValue(tbl[idx]) == null) throw new Error('با عدد نمی‌توان سرباز/بی‌بی/شاه برداشت');
          captured.push(clone(tbl[idx]));
          tbl.splice(idx, 1);
        }
        const sum = captured.reduce((a, c) => a + fishValue(c), 0);
        if (sum !== target) throw new Error('برداشت نامعتبر — مجموع باید ۱۱ شود');
      } else {
        // Mandatory capture: a card that COULD take may not be laid down.
        const nums = this.table.filter((c) => fishValue(c) != null);
        if (subsetsSummingTo(nums, target).length) {
          throw new Error('این کارت می‌تواند برگ بردارد — برداشت اجباری است');
        }
      }
    }

    const placed = captured.length === 0;
    hand.splice(hi, 1);

    if (placed) {
      this.table.push(clone(card));
    } else {
      const capSet = new Set(captured.map((c) => c.s * 100 + c.r));
      this.table = this.table.filter((c) => !capSet.has(c.s * 100 + c.r));
      this.captured[seat].push(clone(card), ...captured);
      this.lastCapturer = seat;
      // سور: clearing the table scores a bonus — but NOT with a سرباز (Jack).
      if (this.table.length === 0 && card.r !== 11) this.surs[seat]++;
    }

    this.moveCount++;
    this.turn = 1 - seat;

    // Re-deal a fresh round, or finish if the deck is exhausted.
    if (this.hands[0].length === 0 && this.hands[1].length === 0) {
      if (this.deck.length >= 8) {
        this.hands[0] = this.deck.splice(0, 4);
        this.hands[1] = this.deck.splice(0, 4);
      } else {
        this._endGame();
      }
    }

    return { state: this.toState(), winner: this.winner };
  }

  _endGame() {
    // Whoever captured last sweeps the remaining table (no سور bonus).
    if (this.table.length && this.lastCapturer != null) {
      this.captured[this.lastCapturer].push(...this.table.map(clone));
      this.table = [];
    }
    const sc = [0, 0];
    for (let s = 0; s < 2; s++) {
      for (const c of this.captured[s]) {
        if (c.r === 14) sc[s] += 1;                 // Ace
        else if (c.r === 11) sc[s] += 1;            // Jack
        if (c.r === 10 && c.s === 2) sc[s] += 3;    // 10 of Diamonds
        if (c.r === 2 && c.s === 3) sc[s] += 2;     // 2 of Clubs
      }
      sc[s] += this.surs[s] * SUR_POINTS;
    }
    const n0 = this.captured[0].length, n1 = this.captured[1].length;
    if (n0 > n1) sc[0] += MOST_CARDS_POINTS; else if (n1 > n0) sc[1] += MOST_CARDS_POINTS;
    const clubs = (s) => this.captured[s].filter((c) => c.s === 3).length;
    const c0 = clubs(0), c1 = clubs(1);
    if (c0 > c1) sc[0] += MOST_CLUBS_POINTS; else if (c1 > c0) sc[1] += MOST_CLUBS_POINTS;

    this.scores = sc;
    this.phase = 'ended';
    this.endReason = 'points';
    if (sc[0] > sc[1]) this.winner = 0;
    else if (sc[1] > sc[0]) this.winner = 1;
    else { this.draw = true; this.winner = null; }
  }

  eliminate(seat) {
    this.eliminated[seat] = true;
    if (this.isOver()) return true;
    this.winner = 1 - seat;
    this.endReason = 'forfeit';
    if (!this.scores) this.scores = [0, 0];
    return true;
  }

  agreeDraw() {
    if (this.winner === null && !this.draw) {
      this.draw = true;
      this.endReason = 'draw-agreed';
      this.scores = this.scores || [0, 0];
    }
  }
}
