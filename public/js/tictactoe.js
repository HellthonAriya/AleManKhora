/**
 * AleManKhora — Tic-tac-toe Engine
 * ================================
 * Server-authoritative 3×3 tic-tac-toe rules shared by the server and the
 * browser. Pure ES module (no Node deps). Two players, seats 0 and 1.
 *
 * Board model
 * -----------
 * `board` is a flat array of length 9; each cell is null | 0 | 1.
 * Index of cell at row r, column c is `r * 3 + c` (r, c in 0..2).
 *
 * Implements the universal engine interface used by the GameManager:
 *   toState, static fromState, legalMoves, apply, isOver, activePlayers,
 *   eliminate, plus numPlayers/turn/winner/draw/endReason/moveCount/eliminated.
 */

const N = 3;

/** All 8 winning lines as triples of board indices. */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];

export class TicTacToeGame {
  constructor(opts = {}) {
    this.numPlayers = 2;
    this.turn = 0;
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = [false, false];

    this.board = new Array(N * N).fill(null);
    this.line = null; // winning board indices, or null
  }

  /** Return the seat that owns a completed line, or null. Sets this.line. */
  _checkWin() {
    for (const [a, b, c] of LINES) {
      const v = this.board[a];
      if (v !== null && this.board[b] === v && this.board[c] === v) {
        return { seat: v, line: [a, b, c] };
      }
    }
    return null;
  }

  toState() {
    return {
      gameType: 'tictactoe',
      n: N,
      board: this.board.slice(),
      turn: this.turn,
      winner: this.winner,
      draw: this.draw,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
      line: this.line ? this.line.slice() : null,
    };
  }

  static fromState(state) {
    const g = new TicTacToeGame();
    g.numPlayers = 2;
    g.turn = state.turn;
    g.winner = state.winner;
    g.draw = !!state.draw;
    g.endReason = state.endReason ?? null;
    g.moveCount = state.moveCount ?? 0;
    g.eliminated = Array.isArray(state.eliminated)
      ? state.eliminated.slice()
      : [false, false];
    g.board = Array.isArray(state.board) ? state.board.slice() : new Array(N * N).fill(null);
    g.line = state.line ? state.line.slice() : null;
    return g;
  }

  legalMoves(seat = this.turn) {
    if (this.isOver()) return [];
    const moves = [];
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] === null) {
        moves.push({ type: 'place', r: Math.floor(i / N), c: i % N });
      }
    }
    return moves;
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'place') throw new Error('invalid action');

    const { r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) {
      throw new Error('cell out of bounds');
    }
    const idx = r * N + c;
    if (this.board[idx] !== null) throw new Error('cell occupied');

    this.board[idx] = seat;
    this.moveCount++;

    const win = this._checkWin();
    if (win) {
      this.winner = win.seat;
      this.line = win.line;
      this.endReason = 'line';
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
