/**
 * AleManKhora — Othello / Reversi Engine
 * ======================================
 * Server-authoritative Othello rules shared by the server and the browser, in
 * the same spirit as the Chess and Quoridor engines. Pure ES module, no Node
 * dependencies.
 *
 * Board model
 * -----------
 * `board` is a flat array of length 64. Each cell is `null`, `0`, or `1`.
 * The index of cell (r, c) is `r * 8 + c`. Rows increase downward, columns
 * rightward.
 *
 * Seats
 * -----
 *   seat 0 = dark  (moves FIRST)
 *   seat 1 = light
 *
 * The engine exposes the universal interface the GameManager relies on
 * (`apply`, `eliminate`, `toState`, `fromState`, `legalMoves`, `winner`,
 * `turn`, `eliminated`, `numPlayers`, `moveCount`, `activePlayers`, `isOver`).
 */

const N = 8;

// All 8 straight-line directions as [dr, dc].
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export class OthelloGame {
  constructor(opts = {}) {
    this.numPlayers = 2;
    this.turn = 0;
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = [false, false];

    // Flat board of 64 cells.
    this.board = new Array(N * N).fill(null);
    // Initial Othello position.
    this.board[3 * N + 3] = 1;
    this.board[3 * N + 4] = 0;
    this.board[4 * N + 3] = 0;
    this.board[4 * N + 4] = 1;

    this.last = null;

    if (opts.board) {
      // internal use by fromState — overwritten there anyway.
    }
  }

  // ---- helpers ---------------------------------------------------------

  /** Opponent seat. */
  static other(seat) {
    return seat === 0 ? 1 : 0;
  }

  /**
   * Return the list of board indices that would be flipped if `seat` placed a
   * disc at (r, c). Empty array means the move is illegal.
   */
  _flipsFor(seat, r, c) {
    const board = this.board;
    const idx = r * N + c;
    if (board[idx] !== null) return [];
    const opp = OthelloGame.other(seat);
    const flips = [];
    for (const [dr, dc] of DIRS) {
      let rr = r + dr;
      let cc = c + dc;
      const line = [];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === opp) {
        line.push(rr * N + cc);
        rr += dr;
        cc += dc;
      }
      // Must end on our own disc, with at least one opponent disc bracketed.
      if (line.length > 0 && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === seat) {
        for (const i of line) flips.push(i);
      }
    }
    return flips;
  }

  /** Count discs as [darkCount, lightCount]. */
  _scores() {
    let dark = 0;
    let light = 0;
    for (const v of this.board) {
      if (v === 0) dark++;
      else if (v === 1) light++;
    }
    return [dark, light];
  }

  // ---- universal interface --------------------------------------------

  /** All empty cells where `seat` would flip >= 1 disc. */
  legalMoves(seat = this.turn) {
    const out = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.board[r * N + c] !== null) continue;
        if (this._flipsFor(seat, r, c).length > 0) out.push({ type: 'place', r, c });
      }
    }
    return out;
  }

  isOver() {
    return this.winner !== null || this.draw === true;
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

  /** End the game by counting discs. */
  _finishByCount() {
    const [dark, light] = this._scores();
    if (dark > light) {
      this.winner = 0;
      this.draw = false;
    } else if (light > dark) {
      this.winner = 1;
      this.draw = false;
    } else {
      this.winner = null;
      this.draw = true;
    }
    this.endReason = 'count';
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'place') throw new Error('invalid action');
    const { r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) {
      throw new Error('out of bounds');
    }
    const flips = this._flipsFor(seat, r, c);
    if (flips.length === 0) throw new Error('illegal move');

    // Place the disc and flip all flanked discs.
    this.board[r * N + c] = seat;
    for (const i of flips) this.board[i] = seat;
    this.last = { r, c };
    this.moveCount++;

    // Determine the next side to move.
    const opp = OthelloGame.other(seat);
    const oppMoves = this.legalMoves(opp);
    if (oppMoves.length > 0) {
      this.turn = opp;
    } else {
      const myMoves = this.legalMoves(seat);
      if (myMoves.length > 0) {
        // Opponent skipped; mover plays again.
        this.turn = seat;
      } else {
        // Neither side can move — game over by count.
        this._finishByCount();
      }
    }

    return { state: this.toState(), winner: this.winner };
  }

  toState() {
    return {
      gameType: 'othello',
      n: N,
      board: this.board.slice(),
      turn: this.turn,
      winner: this.winner,
      draw: this.draw,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
      scores: this._scores(),
      legal: this.isOver() ? [] : this.legalMoves(this.turn).map((m) => ({ r: m.r, c: m.c })),
      last: this.last ? { r: this.last.r, c: this.last.c } : null,
    };
  }

  static fromState(state) {
    const g = new OthelloGame();
    g.numPlayers = 2;
    g.board = Array.isArray(state.board) ? state.board.slice() : g.board;
    g.turn = state.turn;
    g.winner = state.winner === undefined ? null : state.winner;
    g.draw = state.draw === true;
    g.endReason = state.endReason === undefined ? null : state.endReason;
    g.eliminated = Array.isArray(state.eliminated) ? state.eliminated.slice() : [false, false];
    g.moveCount = state.moveCount || 0;
    g.last = state.last ? { r: state.last.r, c: state.last.c } : null;
    return g;
  }
}
