/**
 * AleManKhora — Dots-and-Boxes Engine
 * ===================================
 * Server-authoritative Dots-and-Boxes rules shared by the server and the
 * browser. Pure ES module (no Node deps). Two players, seats 0 and 1.
 *
 * Board model
 * -----------
 * The board is a grid of R rows × C cols of boxes. Dots form an (R+1)×(C+1)
 * lattice. Players draw edges between adjacent dots; completing the 4th edge
 * of a box claims it and grants another turn.
 *
 * Edge arrays (flat, value 0|1 where 1 = drawn):
 *   hEdges — horizontal edges, length (R+1)*C. Index = r*C + c,
 *            with r in 0..R, c in 0..C-1.
 *   vEdges — vertical edges,   length R*(C+1). Index = r*(C+1) + c,
 *            with r in 0..R-1, c in 0..C.
 *
 * Boxes (flat, value null|0|1 = owner), length R*C. Index = r*C + c.
 * Box(r,c) is enclosed by:
 *   top    = hEdges[r*C + c]
 *   bottom = hEdges[(r+1)*C + c]
 *   left   = vEdges[r*(C+1) + c]
 *   right  = vEdges[r*(C+1) + (c+1)]
 *
 * Implements the universal engine interface used by the GameManager:
 *   toState, static fromState, legalMoves, apply, isOver, activePlayers,
 *   eliminate, plus numPlayers/turn/winner/draw/endReason/moveCount/eliminated.
 */

export class DotsGame {
  constructor(opts = {}) {
    this.numPlayers = 2;
    this.turn = 0;
    this.winner = null;
    this.draw = false;
    this.endReason = null;
    this.moveCount = 0;
    this.eliminated = [false, false];

    this.rows = opts.rows || 5;
    this.cols = opts.cols || 5;
    const R = this.rows;
    const C = this.cols;

    this.hEdges = new Array((R + 1) * C).fill(0);
    this.vEdges = new Array(R * (C + 1)).fill(0);
    this.boxes = new Array(R * C).fill(null);
    this.last = null; // { o, r, c } of the last drawn edge, or null
  }

  // ---- index helpers ----------------------------------------------------

  _hIdx(r, c) {
    return r * this.cols + c;
  }

  _vIdx(r, c) {
    return r * (this.cols + 1) + c;
  }

  _boxIdx(r, c) {
    return r * this.cols + c;
  }

  /** Number of drawn edges bordering box(r,c). */
  _boxSides(r, c) {
    const C = this.cols;
    let n = 0;
    if (this.hEdges[r * C + c]) n++;
    if (this.hEdges[(r + 1) * C + c]) n++;
    if (this.vEdges[r * (C + 1) + c]) n++;
    if (this.vEdges[r * (C + 1) + (c + 1)]) n++;
    return n;
  }

  /** True if an edge action is in-range. */
  _inRange(o, r, c) {
    const R = this.rows;
    const C = this.cols;
    if (o === 'h') return r >= 0 && r <= R && c >= 0 && c < C;
    if (o === 'v') return r >= 0 && r < R && c >= 0 && c <= C;
    return false;
  }

  /** Boxes that border the given edge: array of [r,c]. */
  _bordersOf(o, r, c) {
    const R = this.rows;
    const C = this.cols;
    const out = [];
    if (o === 'h') {
      // horizontal edge at lattice row r, col c borders box above (r-1,c)
      // and box below (r,c)
      if (r - 1 >= 0) out.push([r - 1, c]);
      if (r < R) out.push([r, c]);
    } else {
      // vertical edge at row r, lattice col c borders box left (r,c-1)
      // and box right (r,c)
      if (c - 1 >= 0) out.push([r, c - 1]);
      if (c < C) out.push([r, c]);
    }
    return out;
  }

  // ---- universal interface ---------------------------------------------

  toState() {
    return {
      gameType: 'dots',
      rows: this.rows,
      cols: this.cols,
      hEdges: this.hEdges.slice(),
      vEdges: this.vEdges.slice(),
      boxes: this.boxes.slice(),
      turn: this.turn,
      winner: this.winner,
      draw: this.draw,
      endReason: this.endReason,
      eliminated: this.eliminated.slice(),
      moveCount: this.moveCount,
      scores: this._scores(),
      last: this.last ? { o: this.last.o, r: this.last.r, c: this.last.c } : null,
    };
  }

  static fromState(state) {
    const g = new DotsGame({ rows: state.rows, cols: state.cols });
    g.numPlayers = 2;
    g.rows = state.rows;
    g.cols = state.cols;
    g.turn = state.turn;
    g.winner = state.winner;
    g.draw = !!state.draw;
    g.endReason = state.endReason ?? null;
    g.moveCount = state.moveCount ?? 0;
    g.eliminated = Array.isArray(state.eliminated)
      ? state.eliminated.slice()
      : [false, false];
    g.hEdges = Array.isArray(state.hEdges)
      ? state.hEdges.slice()
      : new Array((g.rows + 1) * g.cols).fill(0);
    g.vEdges = Array.isArray(state.vEdges)
      ? state.vEdges.slice()
      : new Array(g.rows * (g.cols + 1)).fill(0);
    g.boxes = Array.isArray(state.boxes)
      ? state.boxes.slice()
      : new Array(g.rows * g.cols).fill(null);
    g.last = state.last ? { o: state.last.o, r: state.last.r, c: state.last.c } : null;
    return g;
  }

  _scores() {
    let a = 0;
    let b = 0;
    for (const owner of this.boxes) {
      if (owner === 0) a++;
      else if (owner === 1) b++;
    }
    return [a, b];
  }

  legalMoves(seat = this.turn) {
    if (this.isOver()) return [];
    const R = this.rows;
    const C = this.cols;
    const moves = [];
    for (let r = 0; r <= R; r++) {
      for (let c = 0; c < C; c++) {
        if (!this.hEdges[r * C + c]) moves.push({ type: 'edge', o: 'h', r, c });
      }
    }
    for (let r = 0; r < R; r++) {
      for (let c = 0; c <= C; c++) {
        if (!this.vEdges[r * (C + 1) + c]) moves.push({ type: 'edge', o: 'v', r, c });
      }
    }
    return moves;
  }

  apply(seat, action) {
    if (this.isOver()) throw new Error('game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!action || action.type !== 'edge' || (action.o !== 'h' && action.o !== 'v')) {
      throw new Error('invalid action');
    }

    const { o, r, c } = action;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !this._inRange(o, r, c)) {
      throw new Error('edge out of bounds');
    }

    const C = this.cols;
    const idx = o === 'h' ? r * C + c : r * (C + 1) + c;
    const arr = o === 'h' ? this.hEdges : this.vEdges;
    if (arr[idx]) throw new Error('edge already drawn');

    arr[idx] = 1;
    this.last = { o, r, c };
    this.moveCount++;

    // Claim any box that just became fully enclosed and is still unowned.
    let completed = 0;
    for (const [br, bc] of this._bordersOf(o, r, c)) {
      const bIdx = this._boxIdx(br, bc);
      if (this.boxes[bIdx] === null && this._boxSides(br, bc) === 4) {
        this.boxes[bIdx] = seat;
        completed++;
      }
    }

    // Game ends when all edges are drawn.
    if (this._allEdgesDrawn()) {
      const [a, b] = this._scores();
      if (a > b) this.winner = 0;
      else if (b > a) this.winner = 1;
      else this.draw = true;
      this.endReason = 'count';
    } else if (completed === 0) {
      // No box completed → turn advances. Otherwise mover goes again.
      this.turn = this.turn === 0 ? 1 : 0;
    }

    return { state: this.toState(), winner: this.winner };
  }

  _allEdgesDrawn() {
    for (let i = 0; i < this.hEdges.length; i++) if (!this.hEdges[i]) return false;
    for (let i = 0; i < this.vEdges.length; i++) if (!this.vEdges[i]) return false;
    return true;
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
