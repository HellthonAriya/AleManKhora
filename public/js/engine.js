/**
 * AleManKhora — Quoridor Game Engine
 * ----------------------------------
 * Server-authoritative implementation of the Quoridor rules, supporting both
 * 2-player and 4-player games. A single canonical copy is shared by the server
 * and the browser client.
 *
 * Board model
 * ===========
 * The board is an N x N grid of cells (N odd: 5, 7, 9, 11). A cell is {r, c}.
 *
 * Pawns & goals:
 *  - Player 0 starts bottom-center (r = N-1) → goal: reach row 0.
 *  - Player 1 starts top-center    (r = 0)   → goal: reach row N-1.
 *  - Player 2 starts left-center    (c = 0)   → goal: reach column N-1.
 *  - Player 3 starts right-center   (c = N-1) → goal: reach column 0.
 *  (2-player games use players 0 & 1; 4-player games use all four.)
 *
 * Walls:
 *  A wall sits in the lattice between cells, identified by intersection {r, c}
 *  (r,c in [0, N-2]) and orientation 'h' or 'v'. Conflict rules and movement
 *  blocking are as in standard Quoridor. A wall may only be placed if EVERY
 *  active player still retains a path to their goal edge (verified by BFS).
 */

const ORIENT = { H: 'h', V: 'v' };

function wallKey(r, c, o) {
  return `${o}:${r}:${c}`;
}

/** Goal definition per seat for a board of dimension `size`. */
function seatGoals(size) {
  return [
    { type: 'row', value: 0 },        // p0 → top
    { type: 'row', value: size - 1 }, // p1 → bottom
    { type: 'col', value: size - 1 }, // p2 → right
    { type: 'col', value: 0 },        // p3 → left
  ];
}
function seatStarts(size) {
  const mid = (size - 1) / 2;
  return [
    { r: size - 1, c: mid },
    { r: 0, c: mid },
    { r: mid, c: 0 },
    { r: mid, c: size - 1 },
  ];
}

export class QuoridorGame {
  /**
   * @param {object} opts
   * @param {number} opts.size       board dimension N (odd, default 9)
   * @param {number} opts.players    number of players: 2 (default) or 4
   * @param {number} opts.wallsEach  walls allocated to each player
   */
  constructor(opts = {}) {
    const size = opts.size ?? 9;
    if (size % 2 === 0 || size < 5 || size > 13) {
      throw new Error('Board size must be an odd number between 5 and 13');
    }
    this.size = size;
    this.numPlayers = opts.players === 4 ? 4 : 2;

    const defaultWalls = this.numPlayers === 4
      ? Math.max(3, Math.round((size * size) / 16))
      : Math.max(4, Math.round((size * size) / 8));
    this.wallsEach = opts.wallsEach ?? defaultWalls;

    const starts = seatStarts(size);
    const goals = seatGoals(size);
    this.pawns = [];
    this.goals = [];
    this.wallsLeft = [];
    this.eliminated = [];
    for (let i = 0; i < this.numPlayers; i++) {
      this.pawns.push({ ...starts[i] });
      this.goals.push(goals[i]);
      this.wallsLeft.push(this.wallsEach);
      this.eliminated.push(false);
    }

    /** @type {Map<string,{r:number,c:number,o:string}>} */
    this.walls = new Map();
    this.turn = 0;
    this.moveCount = 0;
    this.winner = null;       // null | seat index
    this.history = [];
  }

  /* ----------------------------- Serialization ----------------------------- */

  toState() {
    return {
      size: this.size,
      numPlayers: this.numPlayers,
      wallsEach: this.wallsEach,
      pawns: this.pawns.map((p) => (p ? { ...p } : null)),
      goals: this.goals.map((g) => ({ ...g })),
      wallsLeft: [...this.wallsLeft],
      eliminated: [...this.eliminated],
      walls: [...this.walls.values()].map((w) => ({ ...w })),
      turn: this.turn,
      moveCount: this.moveCount,
      winner: this.winner,
    };
  }

  static fromState(state) {
    const g = new QuoridorGame({ size: state.size, wallsEach: state.wallsEach, players: state.numPlayers || 2 });
    g.pawns = state.pawns.map((p) => (p ? { ...p } : null));
    g.goals = (state.goals || seatGoals(state.size).slice(0, g.numPlayers)).map((x) => ({ ...x }));
    g.wallsLeft = [...state.wallsLeft];
    g.eliminated = state.eliminated ? [...state.eliminated] : g.pawns.map(() => false);
    g.walls = new Map();
    for (const w of state.walls) g.walls.set(wallKey(w.r, w.c, w.o), { ...w });
    g.turn = state.turn;
    g.moveCount = state.moveCount;
    g.winner = state.winner;
    return g;
  }

  /* ------------------------------ Helpers ----------------------------------- */

  inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.size && c < this.size;
  }

  /** Seat index occupying (r,c) among active pawns, or -1. */
  pawnAt(r, c) {
    for (let i = 0; i < this.pawns.length; i++) {
      const p = this.pawns[i];
      if (p && !this.eliminated[i] && p.r === r && p.c === c) return i;
    }
    return -1;
  }

  reachedGoal(player, r, c) {
    const g = this.goals[player];
    return g.type === 'row' ? r === g.value : c === g.value;
  }

  activePlayers() {
    const out = [];
    for (let i = 0; i < this.numPlayers; i++) if (!this.eliminated[i]) out.push(i);
    return out;
  }

  /* ------------------------------ Wall geometry ----------------------------- */

  hasWall(r, c, o) {
    return this.walls.has(wallKey(r, c, o));
  }

  /** Is movement from (r1,c1) to an orthogonally-adjacent (r2,c2) blocked by a wall? */
  isBlocked(r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return true;

    if (dr === -1) {
      const wr = r1 - 1;
      return this.hasWall(wr, c1, ORIENT.H) || this.hasWall(wr, c1 - 1, ORIENT.H);
    }
    if (dr === 1) {
      const wr = r1;
      return this.hasWall(wr, c1, ORIENT.H) || this.hasWall(wr, c1 - 1, ORIENT.H);
    }
    if (dc === -1) {
      const wc = c1 - 1;
      return this.hasWall(r1, wc, ORIENT.V) || this.hasWall(r1 - 1, wc, ORIENT.V);
    }
    const wc = c1;
    return this.hasWall(r1, wc, ORIENT.V) || this.hasWall(r1 - 1, wc, ORIENT.V);
  }

  /* ----------------------------- Pawn movement ------------------------------ */

  /**
   * All legal destination cells for the given player's pawn, accounting for
   * walls, pawn jumps and diagonal jumps (works with any number of pawns).
   */
  legalMoves(player = this.turn) {
    const me = this.pawns[player];
    if (!me) return [];
    const dests = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [dr, dc] of dirs) {
      const nr = me.r + dr;
      const nc = me.c + dc;
      if (!this.inBounds(nr, nc)) continue;
      if (this.isBlocked(me.r, me.c, nr, nc)) continue;

      if (this.pawnAt(nr, nc) >= 0) {
        // A pawn occupies the target. Try to jump straight over it.
        const jr = nr + dr;
        const jc = nc + dc;
        const straightOk =
          this.inBounds(jr, jc) && !this.isBlocked(nr, nc, jr, jc) && this.pawnAt(jr, jc) < 0;
        if (straightOk) {
          dests.push({ r: jr, c: jc });
        } else {
          // Straight jump unavailable (wall, edge or another pawn) → diagonals.
          const perps = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [pr, pc] of perps) {
            const dr2 = nr + pr;
            const dc2 = nc + pc;
            if (!this.inBounds(dr2, dc2)) continue;
            if (this.isBlocked(nr, nc, dr2, dc2)) continue;
            if (this.pawnAt(dr2, dc2) >= 0) continue;
            dests.push({ r: dr2, c: dc2 });
          }
        }
      } else {
        dests.push({ r: nr, c: nc });
      }
    }
    const seen = new Set();
    return dests.filter((d) => {
      const k = `${d.r},${d.c}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  isLegalMove(player, r, c) {
    return this.legalMoves(player).some((d) => d.r === r && d.c === c);
  }

  /* ------------------------------ Wall placing ------------------------------ */

  canPlaceWallGeometry(r, c, o) {
    if (r < 0 || c < 0 || r > this.size - 2 || c > this.size - 2) return false;
    if (this.hasWall(r, c, ORIENT.H) || this.hasWall(r, c, ORIENT.V)) return false;
    if (o === ORIENT.H) {
      if (this.hasWall(r, c - 1, ORIENT.H)) return false;
      if (this.hasWall(r, c + 1, ORIENT.H)) return false;
    } else if (o === ORIENT.V) {
      if (this.hasWall(r - 1, c, ORIENT.V)) return false;
      if (this.hasWall(r + 1, c, ORIENT.V)) return false;
    } else {
      return false;
    }
    return true;
  }

  /** Full legality: geometry + every active player retains a path to goal. */
  canPlaceWall(player, r, c, o) {
    if (this.wallsLeft[player] <= 0) return false;
    if (!this.canPlaceWallGeometry(r, c, o)) return false;
    const key = wallKey(r, c, o);
    this.walls.set(key, { r, c, o });
    let ok = true;
    for (const p of this.activePlayers()) {
      if (!this.pathExists(p)) { ok = false; break; }
    }
    this.walls.delete(key);
    return ok;
  }

  /** BFS: does `player` still have any path to their goal edge? */
  pathExists(player) {
    const start = this.pawns[player];
    if (!start) return true;
    const visited = new Uint8Array(this.size * this.size);
    const idx = (r, c) => r * this.size + c;
    const queue = [start];
    visited[idx(start.r, start.c)] = 1;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      if (this.reachedGoal(player, cur.r, cur.c)) return true;
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (!this.inBounds(nr, nc)) continue;
        if (visited[idx(nr, nc)]) continue;
        if (this.isBlocked(cur.r, cur.c, nr, nc)) continue;
        visited[idx(nr, nc)] = 1;
        queue.push({ r: nr, c: nc });
      }
    }
    return false;
  }

  /** Length of the shortest path to the goal edge (BFS), or Infinity. */
  shortestPath(player) {
    const start = this.pawns[player];
    if (!start) return Infinity;
    const dist = new Int32Array(this.size * this.size).fill(-1);
    const idx = (r, c) => r * this.size + c;
    const queue = [start];
    dist[idx(start.r, start.c)] = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist[idx(cur.r, cur.c)];
      if (this.reachedGoal(player, cur.r, cur.c)) return d;
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (!this.inBounds(nr, nc)) continue;
        if (dist[idx(nr, nc)] !== -1) continue;
        if (this.isBlocked(cur.r, cur.c, nr, nc)) continue;
        dist[idx(nr, nc)] = d + 1;
        queue.push({ r: nr, c: nc });
      }
    }
    return Infinity;
  }

  /* -------------------------------- Turn flow ------------------------------- */

  /** Advance `this.turn` to the next active player. */
  advanceTurn(from = this.turn) {
    let next = from;
    for (let i = 0; i < this.numPlayers; i++) {
      next = (next + 1) % this.numPlayers;
      if (!this.eliminated[next]) { this.turn = next; return; }
    }
    this.turn = from;
  }

  /**
   * Eliminate a player (e.g. on clock flag). Their pawn is removed; walls stay.
   * If only one player remains active, they win.
   * @returns {boolean} whether the game is now over
   */
  eliminate(player) {
    if (this.eliminated[player] || this.winner !== null) return this.winner !== null;
    this.eliminated[player] = true;
    this.pawns[player] = null;
    const active = this.activePlayers();
    if (active.length === 1) {
      this.winner = active[0];
      return true;
    }
    if (this.turn === player) this.advanceTurn(player);
    return false;
  }

  /* -------------------------------- Actions --------------------------------- */

  apply(player, action) {
    if (this.winner !== null) throw new Error('Game already finished');
    if (this.eliminated[player]) throw new Error('Player eliminated');
    if (player !== this.turn) throw new Error('Not your turn');

    if (action.type === 'move') {
      const { r, c } = action;
      if (!this.isLegalMove(player, r, c)) throw new Error('Illegal move');
      this.pawns[player] = { r, c };
      if (this.reachedGoal(player, r, c)) this.winner = player;
    } else if (action.type === 'wall') {
      const { r, c, o } = action;
      if (!this.canPlaceWall(player, r, c, o)) throw new Error('Illegal wall');
      this.walls.set(wallKey(r, c, o), { r, c, o });
      this.wallsLeft[player] -= 1;
    } else {
      throw new Error('Unknown action type');
    }

    this.history.push({ player, ...action, n: this.moveCount });
    this.moveCount += 1;
    if (this.winner === null) this.advanceTurn(player);
    return { state: this.toState(), winner: this.winner };
  }

  /** Every legal wall placement for a player (for AI / hints). */
  allWallPlacements(player = this.turn) {
    const out = [];
    if (this.wallsLeft[player] <= 0) return out;
    for (let r = 0; r <= this.size - 2; r++) {
      for (let c = 0; c <= this.size - 2; c++) {
        for (const o of [ORIENT.H, ORIENT.V]) {
          if (this.canPlaceWall(player, r, c, o)) out.push({ type: 'wall', r, c, o });
        }
      }
    }
    return out;
  }
}

export { ORIENT, wallKey, seatGoals, seatStarts };
