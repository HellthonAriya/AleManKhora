/**
 * AleManKhora — Tic-tac-toe (دوز) Engine
 * ======================================
 * Server-authoritative N-in-a-row on an S×S board for 2–4 players. Pure ES
 * module shared by server and browser. Seats 0..numPlayers-1 take turns; the
 * first to line up `winLength` of their marks (any direction) wins.
 *
 * Board model: `board` is a flat array of length size*size; each cell is
 * null | seat. Cell (r,c) is at index r*size + c.
 *
 * Options: { size: 3..6, players: 2..4, winLength, firstTurn: int|'random' }.
 * Defaults to classic 3×3, 2 players, 3-in-a-row, seat 0 first.
 */

function pickFirst(firstTurn, players) {
  if (firstTurn === 'random') return Math.floor(Math.random() * players);
  const n = Number(firstTurn);
  return Number.isInteger(n) && n >= 0 && n < players ? n : 0;
}

export class TicTacToeGame {
  constructor(opts = {}) {
    this.gameType = 'tictactoe';
    const size = Number(opts.size);
    this.size = [3, 4, 5, 6].includes(size) ? size : 3;
    const players = Number(opts.players);
    this.numPlayers = [2, 3, 4].includes(players) ? players : 2;
    // Marks-in-a-row to win: 3 on a 3×3, otherwise 4 (always achievable).
    const wl = Number(opts.winLength);
    this.winLength = [3, 4, 5].includes(wl) ? Math.min(wl, this.size) : (this.size <= 3 ? 3 : 4);

    this.turn = pickFirst(opts.firstTurn, this.numPlayers);
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = new Array(this.numPlayers).fill(false);

    this.board = new Array(this.size * this.size).fill(null);
    this.line = null; // winning board indices, or null
  }

  /** Longest line of `seat`'s marks through `idx` (>= winLength = a win). */
  _winLineAt(idx, seat) {
    const N = this.size, K = this.winLength;
    const r0 = Math.floor(idx / N), c0 = idx % N;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const line = [idx];
      for (let s = 1; s < N; s++) { const r = r0 + dr * s, c = c0 + dc * s; if (r < 0 || r >= N || c < 0 || c >= N || this.board[r * N + c] !== seat) break; line.push(r * N + c); }
      for (let s = 1; s < N; s++) { const r = r0 - dr * s, c = c0 - dc * s; if (r < 0 || r >= N || c < 0 || c >= N || this.board[r * N + c] !== seat) break; line.unshift(r * N + c); }
      if (line.length >= K) return line;
    }
    return null;
  }

  toState() {
    return {
      gameType: 'tictactoe',
      n: this.size,
      size: this.size,
      numPlayers: this.numPlayers,
      winLength: this.winLength,
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
    const g = Object.create(TicTacToeGame.prototype);
    g.gameType = 'tictactoe';
    g.size = state.size || state.n || 3;
    g.numPlayers = state.numPlayers || 2;
    g.winLength = state.winLength || (g.size <= 3 ? 3 : 4);
    g.turn = state.turn ?? 0;
    g.winner = state.winner ?? null;
    g.draw = !!state.draw;
    g.endReason = state.endReason ?? null;
    g.moveCount = state.moveCount ?? 0;
    g.eliminated = Array.isArray(state.eliminated) ? state.eliminated.slice() : new Array(g.numPlayers).fill(false);
    g.board = Array.isArray(state.board) ? state.board.slice() : new Array(g.size * g.size).fill(null);
    g.line = state.line ? state.line.slice() : null;
    return g;
  }

  legalMoves(seat = this.turn) {
    if (this.isOver()) return [];
    const N = this.size, moves = [];
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] === null) moves.push({ type: 'place', r: Math.floor(i / N), c: i % N });
    }
    return moves;
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'place') throw new Error('invalid action');

    const N = this.size, { r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) {
      throw new Error('cell out of bounds');
    }
    const idx = r * N + c;
    if (this.board[idx] !== null) throw new Error('cell occupied');

    this.board[idx] = seat;
    this.moveCount++;

    const line = this._winLineAt(idx, seat);
    if (line) {
      this.winner = seat;
      this.line = line;
      this.endReason = 'line';
    } else if (this.board.every((v) => v !== null)) {
      this.draw = true;
      this.endReason = 'draw';
    } else {
      do { this.turn = (this.turn + 1) % this.numPlayers; } while (this.eliminated[this.turn]);
    }

    return { state: this.toState(), winner: this.winner };
  }

  isOver() { return this.winner !== null || this.draw === true; }

  activePlayers() { return this.eliminated.map((e, s) => (e ? -1 : s)).filter((s) => s >= 0); }

  eliminate(seat) {
    if (this.eliminated[seat]) return this.isOver();
    this.eliminated[seat] = true;
    if (this.isOver()) return true;
    const alive = this.activePlayers();
    if (alive.length === 1) { this.winner = alive[0]; this.endReason = 'forfeit'; }
    else if (this.turn === seat) { do { this.turn = (this.turn + 1) % this.numPlayers; } while (this.eliminated[this.turn]); }
    return this.isOver();
  }
}
