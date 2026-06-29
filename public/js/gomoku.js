/**
 * AleManKhora — Gomoku (Five-in-a-row) Engine
 * ===========================================
 * Server-authoritative gomoku rules shared by the server and the browser.
 * Pure ES module (no Node deps). Two players, seats 0 and 1.
 *
 * Board model
 * -----------
 * Square board of side `n` (default 15). `board` is a flat array of length
 * n*n; each cell is null | 0 | 1. Index of (r, c) is `r * n + c`.
 *
 * Win: five OR MORE consecutive stones of the same seat along any of the four
 * directions (horizontal, vertical, and both diagonals).
 *
 * Implements the universal engine interface used by the GameManager.
 */

const DIRS = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // diagonal ↘
  [1, -1], // diagonal ↙
];

export class GomokuGame {
  constructor(opts = {}) {
    this.numPlayers = 2;
    this.turn = opts.firstTurn === 'random' ? Math.floor(Math.random() * 2) : (Number(opts.firstTurn) === 1 ? 1 : 0);
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = [false, false];

    this.n = opts.size || 15;
    this.board = new Array(this.n * this.n).fill(null);
    this.last = null;      // {r,c} of the last placed stone, or null
    this.winLine = null;   // array of 5 {r,c} forming the win, or null
  }

  _idx(r, c) {
    return r * this.n + c;
  }

  _inBounds(r, c) {
    return r >= 0 && r < this.n && c >= 0 && c < this.n;
  }

  /**
   * Check whether the stone at (r, c) for `seat` completes a run of >= 5.
   * Returns the 5 winning cells (centered window) or null.
   */
  _winAt(r, c, seat) {
    const n = this.n;
    for (const [dr, dc] of DIRS) {
      // Count consecutive same-seat stones in both directions.
      let count = 1;
      const cells = [{ r, c }];

      let rr = r + dr, cc = c + dc;
      while (this._inBounds(rr, cc) && this.board[this._idx(rr, cc)] === seat) {
        cells.push({ r: rr, c: cc });
        rr += dr; cc += dc; count++;
      }
      const forwardCells = cells.slice(1); // not including center

      rr = r - dr; cc = c - dc;
      const backwardCells = [];
      while (this._inBounds(rr, cc) && this.board[this._idx(rr, cc)] === seat) {
        backwardCells.push({ r: rr, c: cc });
        rr -= dr; cc -= dc; count++;
      }

      if (count >= 5) {
        // Build the ordered line and return any 5 consecutive winning cells.
        const line = backwardCells.reverse()
          .concat([{ r, c }])
          .concat(forwardCells);
        return line.slice(0, 5);
      }
    }
    return null;
  }

  toState() {
    return {
      gameType: 'gomoku',
      n: this.n,
      board: this.board.slice(),
      last: this.last ? { r: this.last.r, c: this.last.c } : null,
      turn: this.turn,
      winner: this.winner,
      draw: this.draw,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
      winLine: this.winLine ? this.winLine.map((p) => ({ r: p.r, c: p.c })) : null,
    };
  }

  static fromState(state) {
    const g = new GomokuGame({ size: state.n });
    g.numPlayers = 2;
    g.n = state.n;
    g.turn = state.turn;
    g.winner = state.winner;
    g.draw = !!state.draw;
    g.endReason = state.endReason ?? null;
    g.moveCount = state.moveCount ?? 0;
    g.eliminated = Array.isArray(state.eliminated)
      ? state.eliminated.slice()
      : [false, false];
    g.board = Array.isArray(state.board)
      ? state.board.slice()
      : new Array(g.n * g.n).fill(null);
    g.last = state.last ? { r: state.last.r, c: state.last.c } : null;
    g.winLine = state.winLine ? state.winLine.map((p) => ({ r: p.r, c: p.c })) : null;
    return g;
  }

  legalMoves(seat = this.turn) {
    if (this.isOver()) return [];
    const moves = [];
    const n = this.n;
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] === null) {
        moves.push({ type: 'place', r: Math.floor(i / n), c: i % n });
      }
    }
    return moves;
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'place') throw new Error('invalid action');

    const { r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !this._inBounds(r, c)) {
      throw new Error('cell out of bounds');
    }
    const idx = this._idx(r, c);
    if (this.board[idx] !== null) throw new Error('cell occupied');

    this.board[idx] = seat;
    this.last = { r, c };
    this.moveCount++;

    const win = this._winAt(r, c, seat);
    if (win) {
      this.winner = seat;
      this.winLine = win;
      this.endReason = 'five';
    } else if (this.board.every((v) => v !== null)) {
      this.draw = true;
      this.endReason = 'draw';
    } else {
      this.turn = this.turn === 0 ? 1 : 0;
    }

    return { state: this.toState(), winner: this.winner };
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
}
