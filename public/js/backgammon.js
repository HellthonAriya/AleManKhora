/**
 * AleManKhora — Backgammon Engine
 * ===============================
 * Server-authoritative Backgammon rules (standard, NO doubling cube) shared by
 * the server and the browser, in the same spirit as the Chess, Othello and
 * Quoridor engines. Pure ES module, no Node dependencies.
 *
 * `apply` runs ONLY on the server, so it MAY use Math.random to roll dice.
 * `fromState` NEVER rolls — it restores dice/turn exactly from the state.
 *
 * Board model
 * -----------
 * 24 points, indices 0..23. `points` is an array of length 24; each entry is
 * `{ seat: 0|1|null, count: int }` (count 0 ⇒ seat null).
 *
 * Directions
 * ----------
 *   seat 0 moves DECREASING index toward 0. Home = indices 0..5. Bears off
 *     "below 0" (to 'off'). Die `d` moves seat 0 from `from` to `from - d`.
 *     Bar entry with die d lands on index `24 - d` (d=1→23 ... d=6→18).
 *   seat 1 moves INCREASING index toward 23. Home = indices 18..23. Bears off
 *     "above 23". Die `d` moves seat 1 from `from` to `from + d`.
 *     Bar entry with die d lands on index `d - 1` (d=1→0 ... d=6→5).
 *
 * A point is blocked for a seat if the opponent has >= 2 checkers there.
 * Landing on a point with exactly 1 opponent checker HITS it: that checker
 * goes to the opponent's bar.
 *
 * Exposes the universal interface the GameManager relies on (`apply`,
 * `eliminate`, `toState`, `fromState`, `legalMoves`, `winner`, `turn`,
 * `eliminated`, `numPlayers`, `moveCount`, `activePlayers`, `isOver`).
 */

const NUM_POINTS = 24;
const CHECKERS = 15;

function other(seat) {
  return seat === 0 ? 1 : 0;
}

/** Roll two dice; doubles produce four entries. */
function rollDice() {
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  const rolled = [a, b];
  const dice = a === b ? [a, a, a, a] : [a, b];
  return { rolled, dice };
}

export class BackgammonGame {
  constructor(opts = {}) {
    this.numPlayers = 2;
    this.turn = 0;
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = [false, false];

    // points[i] = { seat, count }
    this.points = [];
    for (let i = 0; i < NUM_POINTS; i++) this.points.push({ seat: null, count: 0 });

    this.bar = [0, 0];
    this.off = [0, 0];

    this.dice = [];
    this.rolled = [0, 0];

    if (!opts._blank) {
      this._setupStart();
      // Roll for seat 0 to begin.
      const r = rollDice();
      this.rolled = r.rolled;
      this.dice = r.dice;
    }
  }

  _place(index, seat, count) {
    this.points[index] = { seat, count };
  }

  _setupStart() {
    // seat 0: index23=2, index12=5, index7=3, index5=5  (total 15)
    this._place(23, 0, 2);
    this._place(12, 0, 5);
    this._place(7, 0, 3);
    this._place(5, 0, 5);
    // seat 1: index0=2, index11=5, index16=3, index18=5  (total 15)
    this._place(0, 1, 2);
    this._place(11, 1, 5);
    this._place(16, 1, 3);
    this._place(18, 1, 5);
  }

  // ---- helpers ---------------------------------------------------------

  /** Direction of travel for a seat: -1 for seat 0, +1 for seat 1. */
  static dir(seat) {
    return seat === 0 ? -1 : 1;
  }

  /** Bar-entry landing index for a seat given die `d`. */
  static entryIndex(seat, d) {
    return seat === 0 ? 24 - d : d - 1;
  }

  /** True if `index` is inside `seat`'s home board. */
  static inHome(seat, index) {
    return seat === 0 ? index >= 0 && index <= 5 : index >= 18 && index <= 23;
  }

  /** Pip distance to bear a checker off from a home `index` for `seat`. */
  static bearDistance(seat, index) {
    // seat 0 home 0..5: distance = index + 1. seat 1 home 18..23: distance = 24 - index.
    return seat === 0 ? index + 1 : 24 - index;
  }

  /** Can `seat` land on `index` (not blocked by >=2 opponents)? */
  _canLand(seat, index) {
    const p = this.points[index];
    if (p.seat === null || p.seat === seat) return true;
    return p.count < 2; // exactly 1 opponent = blot (hittable); 0 handled above
  }

  /** Are all of `seat`'s checkers in the home board (and none on the bar)? */
  _allHome(seat) {
    if (this.bar[seat] > 0) return false;
    let inHome = 0;
    for (let i = 0; i < NUM_POINTS; i++) {
      const p = this.points[i];
      if (p.seat === seat) {
        if (!BackgammonGame.inHome(seat, i)) return false;
        inHome += p.count;
      }
    }
    return inHome + this.off[seat] === CHECKERS;
  }

  /** Highest-distance occupied home point for seat (used for overshoot). */
  _maxHomeDistanceOccupied(seat) {
    let maxDist = 0;
    const range = seat === 0 ? [0, 5] : [18, 23];
    for (let i = range[0]; i <= range[1]; i++) {
      const p = this.points[i];
      if (p.seat === seat && p.count > 0) {
        const d = BackgammonGame.bearDistance(seat, i);
        if (d > maxDist) maxDist = d;
      }
    }
    return maxDist;
  }

  /**
   * Legal moves for ONE die `d` for `seat`. Returns array of {type,from,to}.
   * Honors bar-first rule.
   */
  _movesForDie(seat, d) {
    const out = [];
    // If checkers on the bar, must enter first.
    if (this.bar[seat] > 0) {
      const idx = BackgammonGame.entryIndex(seat, d);
      if (this._canLand(seat, idx)) {
        out.push({ type: 'move', from: 'bar', to: idx });
      }
      return out;
    }

    const dir = BackgammonGame.dir(seat);
    const canBear = this._allHome(seat);

    for (let i = 0; i < NUM_POINTS; i++) {
      const p = this.points[i];
      if (p.seat !== seat || p.count === 0) continue;
      const to = i + dir * d;

      if (to >= 0 && to < NUM_POINTS) {
        if (this._canLand(seat, to)) out.push({ type: 'move', from: i, to });
        continue;
      }

      // `to` is off the board edge → potential bear-off.
      if (!canBear) continue;
      if (!BackgammonGame.inHome(seat, i)) continue;
      const dist = BackgammonGame.bearDistance(seat, i);
      if (d === dist) {
        out.push({ type: 'move', from: i, to: 'off' });
      } else if (d > dist) {
        // Overshoot only allowed when no checker is on a higher home point.
        if (this._maxHomeDistanceOccupied(seat) <= dist) {
          out.push({ type: 'move', from: i, to: 'off' });
        }
      }
    }
    return out;
  }

  // ---- universal interface --------------------------------------------

  /** All legal single-die moves under the CURRENT dice for `seat`. */
  legalMoves(seat = this.turn) {
    if (this.isOver()) return [];
    if (seat !== this.turn) return [];
    const seen = new Set();
    const out = [];
    const distinctDice = [...new Set(this.dice)];
    for (const d of distinctDice) {
      for (const m of this._movesForDie(seat, d)) {
        const key = `${m.from}|${m.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m);
      }
    }
    return out;
  }

  isOver() {
    return this.winner !== null;
  }

  activePlayers() {
    return [0, 1].filter((s) => !this.eliminated[s]);
  }

  eliminate(seat) {
    this.eliminated[seat] = true;
    if (!this.isOver()) {
      this.winner = seat === 0 ? 1 : 0;
      this.endReason = 'forfeit';
    }
    return true;
  }

  /** Which die value does this concrete move consume? */
  _dieForMove(seat, action) {
    const { from, to } = action;
    if (from === 'bar') {
      // entryIndex(seat, d) === to  → solve for d.
      return seat === 0 ? 24 - to : to + 1;
    }
    if (to === 'off') {
      const dist = BackgammonGame.bearDistance(seat, from);
      // Prefer an exact die; otherwise the smallest die >= dist that is present.
      if (this.dice.includes(dist)) return dist;
      let best = null;
      for (const d of this.dice) {
        if (d > dist && (best === null || d < best)) best = d;
      }
      return best === null ? dist : best;
    }
    return Math.abs(to - from);
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action) throw new Error('invalid action');

    // Pass: only legal when the rolled dice leave no playable move.
    if (action.type === 'pass') {
      if (this.legalMoves(seat).length > 0) throw new Error('you still have a move');
      this.moveCount++;
      this._advanceTurn();
      return { state: this.toState(), winner: this.winner };
    }

    if (action.type !== 'move') throw new Error('invalid action');

    const { from, to } = action;

    // Validate against the legal move list for the current dice.
    const legal = this.legalMoves(seat);
    const match = legal.find((m) => m.from === from && m.to === to);
    if (!match) throw new Error('illegal move');

    const die = this._dieForMove(seat, action);
    const dieIdx = this.dice.indexOf(die);
    if (dieIdx === -1) throw new Error('no matching die');

    // --- perform the move ---
    if (from === 'bar') {
      this.bar[seat]--;
    } else {
      const fp = this.points[from];
      fp.count--;
      if (fp.count === 0) fp.seat = null;
    }

    if (to === 'off') {
      this.off[seat]++;
    } else {
      const tp = this.points[to];
      if (tp.seat !== null && tp.seat !== seat) {
        // Hit a blot → send opponent checker to the bar.
        this.bar[other(seat)] += tp.count; // exactly 1 (legal moves guarantee)
        tp.seat = null;
        tp.count = 0;
      }
      if (tp.seat === null) tp.seat = seat;
      tp.count++;
    }

    // Consume the die.
    this.dice.splice(dieIdx, 1);
    this.moveCount++;

    // Win check.
    if (this.off[seat] === CHECKERS) {
      this.winner = seat;
      this.endReason = this.off[other(seat)] === 0 ? 'gammon' : 'single';
      this.dice = [];
      return { state: this.toState(), winner: this.winner };
    }

    // End-of-turn: no dice left, or no legal move remaining.
    if (this.dice.length === 0 || this.legalMoves(seat).length === 0) {
      this._advanceTurn();
    }

    return { state: this.toState(), winner: this.winner };
  }

  /** Pass turn to the other seat and roll for them. If the rolled dice give the
   *  new player NO legal move, we DON'T silently skip — the state is emitted so
   *  the player (or bot) sees their roll, then they explicitly `pass` (the
   *  client auto-passes after a short pause). */
  _advanceTurn() {
    this.turn = other(this.turn);
    const r = rollDice();
    this.rolled = r.rolled;
    this.dice = r.dice;
  }

  toState() {
    return {
      gameType: 'backgammon',
      points: this.points.map((p) => ({ seat: p.seat, count: p.count })),
      bar: this.bar.slice(),
      off: this.off.slice(),
      dice: this.dice.slice(),
      rolled: this.rolled.slice(),
      turn: this.turn,
      winner: this.winner,
      draw: false,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
    };
  }

  static fromState(state) {
    const g = new BackgammonGame({ _blank: true });
    g.numPlayers = 2;
    if (Array.isArray(state.points)) {
      g.points = state.points.map((p) => ({
        seat: p.seat === undefined ? null : p.seat,
        count: p.count || 0,
      }));
      // Pad/normalize length defensively.
      while (g.points.length < NUM_POINTS) g.points.push({ seat: null, count: 0 });
    }
    g.bar = Array.isArray(state.bar) ? state.bar.slice() : [0, 0];
    g.off = Array.isArray(state.off) ? state.off.slice() : [0, 0];
    g.dice = Array.isArray(state.dice) ? state.dice.slice() : [];
    g.rolled = Array.isArray(state.rolled) ? state.rolled.slice() : [0, 0];
    g.turn = state.turn === undefined ? 0 : state.turn;
    g.winner = state.winner === undefined ? null : state.winner;
    g.draw = false;
    g.endReason = state.endReason === undefined ? null : state.endReason;
    g.eliminated = Array.isArray(state.eliminated) ? state.eliminated.slice() : [false, false];
    g.moveCount = state.moveCount || 0;
    return g;
  }
}
