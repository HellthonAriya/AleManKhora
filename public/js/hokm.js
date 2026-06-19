/**
 * AleManKhora — Hokm (حکم) Engine
 * ===============================
 * Persian trick-taking card game. Pure ES module, no Node dependencies, shared
 * by the server and the browser like the other engines.
 *
 * `apply` runs ONLY on the server, so it MAY use Math.random for shuffling and
 * dealing. `fromState` NEVER re-shuffles or re-deals — it restores state.
 *
 * HIDDEN INFORMATION: each player must only see their own cards. `toState()`
 * returns the full state (server-internal / persistence). `toStateFor(viewer)`
 * redacts every hand except the viewer's own.
 *
 * Card model
 * ----------
 * A card is { s, r }: suit s ∈ 0..3 (0=♠, 1=♥, 2=♦, 3=♣), rank r ∈ 2..14
 * (J=11, Q=12, K=13, A=14).
 *
 * Variants
 * --------
 *   '2' → 2 players, 26 cards each, individual, winThreshold 14.
 *   '3' → 3 players, 17 cards each (2♣ removed), individual, winThreshold 9.
 *   '4' → 4 players (default), 13 cards each, teams (0&2 vs 1&3),
 *         winThreshold 7.
 */

function range(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/** Build a standard 52-card deck (optionally removing 2♣ for the 3p variant). */
function buildDeck(remove2Clubs) {
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) {
      if (remove2Clubs && s === 3 && r === 2) continue;
      deck.push({ s, r });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle in place (server-only path; uses Math.random). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function sameCard(a, b) {
  return a && b && a.s === b.s && a.r === b.r;
}

export class HokmGame {
  constructor(opts = {}) {
    const variant = opts && opts.variant != null ? String(opts.variant) : '4';
    this.variant = (variant === '2' || variant === '3' || variant === '4') ? variant : '4';
    this.gameType = 'hokm';
    this.numPlayers = Number(this.variant);
    this.teams = this.variant === '4';

    // Deck & deal.
    const deck = shuffle(buildDeck(this.variant === '3'));
    const perHand = this.variant === '4' ? 13 : this.variant === '3' ? 17 : 26;
    this.hands = range(this.numPlayers).map(() => []);
    let idx = 0;
    for (let n = 0; n < perHand; n++) {
      for (let p = 0; p < this.numPlayers; p++) {
        this.hands[p].push(deck[idx++]);
      }
    }

    this.hakem = Math.floor(Math.random() * this.numPlayers);
    this.phase = 'choose-trump';
    this.turn = this.hakem;
    this.trump = null;

    this.tricksWon = range(this.numPlayers).map(() => 0);
    this.teamTricks = this.teams ? [0, 0] : null;

    this.trick = [];
    this.ledSuit = null;
    this.leader = this.hakem;

    // Last completed trick — kept so clients can replay it (hold the cards on
    // the table for a couple of seconds and highlight who won) even though the
    // live `trick` is cleared the instant a trick resolves. `trickNumber`
    // increments on every resolved trick so the client can reliably detect a
    // freshly completed trick.
    this.lastTrick = [];
    this.lastTrickWinner = null;
    this.lastTrickLed = null;
    this.trickNumber = 0;

    this.winThreshold = this.variant === '4' ? 7 : this.variant === '3' ? 9 : 14;

    this.winner = null;
    this.winningTeam = null;
    this.draw = false;
    this.endReason = null;
    this.eliminated = range(this.numPlayers).map(() => false);
    this.moveCount = 0;
    this.hidden = true;
  }

  // ---------------------------------------------------------------- state

  toState() {
    return {
      gameType: 'hokm',
      variant: this.variant,
      numPlayers: this.numPlayers,
      teams: this.teams,
      phase: this.phase,
      hakem: this.hakem,
      trump: this.trump,
      turn: this.turn,
      leader: this.leader,
      ledSuit: this.ledSuit,
      trick: this.trick.map((t) => ({ seat: t.seat, card: { s: t.card.s, r: t.card.r } })),
      lastTrick: this.lastTrick.map((t) => ({ seat: t.seat, card: { s: t.card.s, r: t.card.r } })),
      lastTrickWinner: this.lastTrickWinner,
      lastTrickLed: this.lastTrickLed,
      trickNumber: this.trickNumber,
      hands: this.hands.map((h) => (h == null ? null : h.map((c) => ({ s: c.s, r: c.r })))),
      handCounts: this.hands.map((h) => (h == null ? 0 : h.length)),
      tricksWon: this.tricksWon.slice(),
      teamTricks: this.teamTricks ? this.teamTricks.slice() : null,
      winThreshold: this.winThreshold,
      winner: this.winner,
      winningTeam: this.winningTeam,
      draw: this.draw,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
    };
  }

  /** Same as toState() but redacts every hand except `viewer`'s. */
  toStateFor(viewer) {
    const st = this.toState();
    const valid = Number.isInteger(viewer) && viewer >= 0 && viewer < this.numPlayers;
    st.hands = this.hands.map((h, i) => {
      if (valid && i === viewer && h != null) return h.map((c) => ({ s: c.s, r: c.r }));
      return null;
    });
    // handCounts stays full and correct (already set by toState()).
    return st;
  }

  static fromState(state) {
    const g = Object.create(HokmGame.prototype);
    g.gameType = 'hokm';
    g.variant = String(state.variant);
    g.numPlayers = state.numPlayers;
    g.teams = state.teams;
    g.phase = state.phase;
    g.hakem = state.hakem;
    g.trump = state.trump;
    g.turn = state.turn;
    g.leader = state.leader;
    g.ledSuit = state.ledSuit;
    g.trick = (state.trick || []).map((t) => ({ seat: t.seat, card: { s: t.card.s, r: t.card.r } }));
    g.lastTrick = (state.lastTrick || []).map((t) => ({ seat: t.seat, card: { s: t.card.s, r: t.card.r } }));
    g.lastTrickWinner = state.lastTrickWinner ?? null;
    g.lastTrickLed = state.lastTrickLed ?? null;
    g.trickNumber = state.trickNumber || 0;
    g.hands = (state.hands || []).map((h) =>
      h == null ? null : h.map((c) => ({ s: c.s, r: c.r })));
    g.tricksWon = (state.tricksWon || []).slice();
    g.teamTricks = state.teamTricks ? state.teamTricks.slice() : null;
    g.winThreshold = state.winThreshold;
    g.winner = state.winner;
    g.winningTeam = state.winningTeam;
    g.draw = state.draw;
    g.endReason = state.endReason;
    g.eliminated = (state.eliminated || []).slice();
    g.moveCount = state.moveCount;
    g.hidden = true;
    return g;
  }

  // --------------------------------------------------------------- queries

  isOver() {
    return this.winner !== null;
  }

  activePlayers() {
    return range(this.numPlayers).filter((s) => !this.eliminated[s]);
  }

  legalMoves(seat = this.turn) {
    if (this.phase === 'choose-trump') {
      if (seat !== this.hakem) return [];
      return [
        { type: 'trump', suit: 0 },
        { type: 'trump', suit: 1 },
        { type: 'trump', suit: 2 },
        { type: 'trump', suit: 3 },
      ];
    }
    if (this.phase === 'play') {
      if (seat !== this.turn) return [];
      const hand = this.hands[seat];
      if (hand == null) return [];
      if (this.ledSuit != null) {
        const ofLed = hand.filter((c) => c.s === this.ledSuit);
        if (ofLed.length > 0) {
          return ofLed.map((c) => ({ type: 'play', card: { s: c.s, r: c.r } }));
        }
      }
      return hand.map((c) => ({ type: 'play', card: { s: c.s, r: c.r } }));
    }
    return [];
  }

  // ---------------------------------------------------------------- mutate

  apply(seat, action) {
    if (this.winner !== null) throw new Error('game is over');
    if (!action || typeof action !== 'object') throw new Error('invalid action');

    if (action.type === 'trump') {
      if (this.phase !== 'choose-trump') throw new Error('not trump phase');
      if (seat !== this.hakem) throw new Error('only hakem chooses trump');
      const suit = action.suit;
      if (!Number.isInteger(suit) || suit < 0 || suit > 3) throw new Error('invalid suit');
      this.trump = suit;
      this.phase = 'play';
      this.turn = this.hakem;
      this.leader = this.hakem;
      this.moveCount++;
      return { state: this.toState(), winner: this.winner };
    }

    if (action.type === 'play') {
      if (this.phase !== 'play') throw new Error('not play phase');
      if (seat !== this.turn) throw new Error('not your turn');
      const hand = this.hands[seat];
      if (hand == null) throw new Error('no hand');
      const card = action.card;
      if (!card || !Number.isInteger(card.s) || !Number.isInteger(card.r)) {
        throw new Error('invalid card');
      }
      const handIdx = hand.findIndex((c) => sameCard(c, card));
      if (handIdx < 0) throw new Error('card not in hand');
      // Follow-suit enforcement.
      if (this.ledSuit != null && card.s !== this.ledSuit) {
        const hasLed = hand.some((c) => c.s === this.ledSuit);
        if (hasLed) throw new Error('must follow suit');
      }

      const played = hand.splice(handIdx, 1)[0];
      if (this.trick.length === 0) this.ledSuit = played.s;
      this.trick.push({ seat, card: { s: played.s, r: played.r } });

      if (this.trick.length < this.numPlayers) {
        this.turn = (this.turn + 1) % this.numPlayers;
        this.moveCount++;
        return { state: this.toState(), winner: this.winner };
      }

      // Trick complete — resolve.
      const winnerSeat = this.resolveTrick();
      // Snapshot the completed trick for client-side replay/highlight.
      this.lastTrick = this.trick.map((t) => ({ seat: t.seat, card: { s: t.card.s, r: t.card.r } }));
      this.lastTrickWinner = winnerSeat;
      this.lastTrickLed = this.ledSuit;
      this.trickNumber++;
      this.tricksWon[winnerSeat]++;
      if (this.teams) this.teamTricks[winnerSeat % 2]++;

      let over = false;
      if (this.teams) {
        const tm = winnerSeat % 2;
        if (this.teamTricks[tm] >= this.winThreshold) {
          this.winningTeam = tm;
          this.winner = winnerSeat; // winnerSeat % 2 === tm by construction
          this.endReason = 'tricks';
          over = true;
        }
      } else if (this.tricksWon[winnerSeat] >= this.winThreshold) {
        this.winner = winnerSeat;
        this.endReason = 'tricks';
        over = true;
      }

      if (!over) {
        this.leader = winnerSeat;
        this.turn = winnerSeat;
        this.trick = [];
        this.ledSuit = null;

        // All hands empty without hitting threshold → award most tricks.
        const allEmpty = this.hands.every((h) => h != null && h.length === 0);
        if (allEmpty) {
          this.endByCount();
        }
      }

      this.moveCount++;
      return { state: this.toState(), winner: this.winner };
    }

    throw new Error('unknown action type');
  }

  /** Determine the seat that wins the current (complete) trick. */
  resolveTrick() {
    let best = this.trick[0];
    for (let i = 1; i < this.trick.length; i++) {
      const cur = this.trick[i];
      best = this.beats(cur.card, best.card) ? cur : best;
    }
    return best.seat;
  }

  /** Does card `a` beat the current-best card `b`, given trump/ledSuit? */
  beats(a, b) {
    const aTrump = this.trump != null && a.s === this.trump;
    const bTrump = this.trump != null && b.s === this.trump;
    if (aTrump && !bTrump) return true;
    if (!aTrump && bTrump) return false;
    if (aTrump && bTrump) return a.r > b.r;
    // Neither trump: only ledSuit cards can win.
    const aLed = a.s === this.ledSuit;
    const bLed = b.s === this.ledSuit;
    if (aLed && !bLed) return true;
    if (!aLed && bLed) return false;
    if (aLed && bLed) return a.r > b.r;
    return false;
  }

  /** End the game by trick count (no threshold reached, hands exhausted). */
  endByCount() {
    if (this.teams) {
      const tm = this.teamTricks[0] >= this.teamTricks[1] ? 0 : 1;
      this.winningTeam = tm;
      this.winner = tm; // seat tm has tm % 2 === tm for tm ∈ {0,1}
      this.endReason = 'tricks';
    } else {
      let best = 0;
      for (let s = 1; s < this.numPlayers; s++) {
        if (this.tricksWon[s] > this.tricksWon[best]) best = s;
      }
      this.winner = best;
      this.endReason = 'tricks';
    }
  }

  eliminate(seat) {
    this.eliminated[seat] = true;
    if (this.winner !== null) return true;
    if (this.teams) {
      const tm = (seat % 2) === 0 ? 1 : 0;
      this.winningTeam = tm;
      this.winner = tm; // a seat on the winning team (tm ∈ {0,1})
      this.endReason = 'forfeit';
    } else if (this.numPlayers === 2) {
      this.winner = seat === 0 ? 1 : 0;
      this.endReason = 'forfeit';
    } else {
      // 3p: remaining seat with the most tricks.
      let best = -1;
      for (let s = 0; s < this.numPlayers; s++) {
        if (s === seat) continue;
        if (best < 0 || this.tricksWon[s] > this.tricksWon[best]) best = s;
      }
      this.winner = best;
      this.endReason = 'forfeit';
    }
    return true;
  }
}
