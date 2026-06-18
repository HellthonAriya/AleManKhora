/**
 * AleManKhora — Quoridor Game Engine
 * ----------------------------------
 * Server-authoritative implementation of the Quoridor rules.
 *
 * Board model
 * ===========
 * The board is an N x N grid of cells. `N` is odd (5, 7, 9, 11).
 * A cell is addressed by {r, c} with r,c in [0, N-1].
 *
 * Pawns:
 *  - Player 0 starts on the bottom row (r = N-1, mid column) and must reach r = 0.
 *  - Player 1 starts on the top row    (r = 0,   mid column) and must reach r = N-1.
 *
 * Walls:
 *  A wall sits in the lattice between cells. It is identified by an
 *  intersection point {r, c} with r,c in [0, N-2] and an orientation:
 *    - 'h' (horizontal): blocks vertical movement between rows r and r+1,
 *      spanning columns c and c+1.
 *    - 'v' (vertical): blocks horizontal movement between columns c and c+1,
 *      spanning rows r and r+1.
 *
 * Two walls conflict when:
 *    - they occupy the exact same intersection+orientation,
 *    - an 'h' and a 'v' wall share the same intersection (they would cross),
 *    - two 'h' walls overlap along a row  (|c1 - c2| < 2 at the same r),
 *    - two 'v' walls overlap along a column (|r1 - r2| < 2 at the same c).
 *
 * A wall may only be placed if BOTH players still retain at least one path
 * to their goal row afterwards (validated with a breadth-first search).
 */

const ORIENT = { H: 'h', V: 'v' };

function wallKey(r, c, o) {
  return `${o}:${r}:${c}`;
}

export class QuoridorGame {
  /**
   * @param {object} opts
   * @param {number} opts.size       board dimension N (odd, default 9)
   * @param {number} opts.wallsEach  walls allocated to each player
   */
  constructor(opts = {}) {
    const size = opts.size ?? 9;
    if (size % 2 === 0 || size < 5 || size > 13) {
      throw new Error('Board size must be an odd number between 5 and 13');
    }
    this.size = size;
    const defaultWalls = Math.max(4, Math.round((size * size) / 8));
    this.wallsEach = opts.wallsEach ?? defaultWalls;

    const mid = (size - 1) / 2;
    this.pawns = [
      { r: size - 1, c: mid }, // player 0 — moves up toward r = 0
      { r: 0, c: mid },        // player 1 — moves down toward r = N-1
    ];
    this.goalRow = [0, size - 1];
    this.wallsLeft = [this.wallsEach, this.wallsEach];

    /** @type {Map<string,{r:number,c:number,o:string}>} */
    this.walls = new Map();
    this.turn = 0;            // index of player to move
    this.moveCount = 0;
    this.winner = null;       // null | 0 | 1
    /** @type {Array} history of applied actions */
    this.history = [];
  }

  /* ----------------------------- Serialization ----------------------------- */

  toState() {
    return {
      size: this.size,
      wallsEach: this.wallsEach,
      pawns: this.pawns.map((p) => ({ ...p })),
      goalRow: [...this.goalRow],
      wallsLeft: [...this.wallsLeft],
      walls: [...this.walls.values()].map((w) => ({ ...w })),
      turn: this.turn,
      moveCount: this.moveCount,
      winner: this.winner,
    };
  }

  static fromState(state) {
    const g = new QuoridorGame({ size: state.size, wallsEach: state.wallsEach });
    g.pawns = state.pawns.map((p) => ({ ...p }));
    g.goalRow = [...state.goalRow];
    g.wallsLeft = [...state.wallsLeft];
    g.walls = new Map();
    for (const w of state.walls) g.walls.set(wallKey(w.r, w.c, w.o), { ...w });
    g.turn = state.turn;
    g.moveCount = state.moveCount;
    g.winner = state.winner;
    return g;
  }

  /* ------------------------------ Wall geometry ----------------------------- */

  hasWall(r, c, o) {
    return this.walls.has(wallKey(r, c, o));
  }

  /** Is movement from (r1,c1) to an orthogonally-adjacent (r2,c2) blocked by a wall? */
  isBlocked(r1, c1, r2, c2) {
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return true; // not orthogonal-adjacent

    if (dr === -1) {
      // moving up: a horizontal wall sits on the boundary above (r1-1)
      const wr = r1 - 1;
      return this.hasWall(wr, c1, ORIENT.H) || this.hasWall(wr, c1 - 1, ORIENT.H);
    }
    if (dr === 1) {
      // moving down: horizontal wall on boundary below (r1)
      const wr = r1;
      return this.hasWall(wr, c1, ORIENT.H) || this.hasWall(wr, c1 - 1, ORIENT.H);
    }
    if (dc === -1) {
      // moving left: vertical wall on boundary to the left (c1-1)
      const wc = c1 - 1;
      return this.hasWall(r1, wc, ORIENT.V) || this.hasWall(r1 - 1, wc, ORIENT.V);
    }
    // dc === 1, moving right
    const wc = c1;
    return this.hasWall(r1, wc, ORIENT.V) || this.hasWall(r1 - 1, wc, ORIENT.V);
  }

  inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.size && c < this.size;
  }

  /* ----------------------------- Pawn movement ------------------------------ */

  /**
   * All legal destination cells for the given player's pawn, accounting for
   * walls, opponent jumps and diagonal jumps.
   * @returns {{r:number,c:number}[]}
   */
  legalMoves(player = this.turn) {
    const me = this.pawns[player];
    const opp = this.pawns[1 - player];
    const dests = [];
    const dirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      const nr = me.r + dr;
      const nc = me.c + dc;
      if (!this.inBounds(nr, nc)) continue;
      if (this.isBlocked(me.r, me.c, nr, nc)) continue;

      if (opp.r === nr && opp.c === nc) {
        // Opponent occupies the target. Try to jump straight over.
        const jr = nr + dr;
        const jc = nc + dc;
        const straightOk =
          this.inBounds(jr, jc) && !this.isBlocked(nr, nc, jr, jc);
        if (straightOk) {
          dests.push({ r: jr, c: jc });
        } else {
          // Blocked behind opponent -> diagonal jumps allowed.
          const perps = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [pr, pc] of perps) {
            const dr2 = nr + pr;
            const dc2 = nc + pc;
            if (!this.inBounds(dr2, dc2)) continue;
            if (this.isBlocked(nr, nc, dr2, dc2)) continue;
            dests.push({ r: dr2, c: dc2 });
          }
        }
      } else {
        dests.push({ r: nr, c: nc });
      }
    }
    // Deduplicate
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

  /** Geometric legality only (bounds + overlap), ignoring path constraint. */
  canPlaceWallGeometry(r, c, o) {
    if (r < 0 || c < 0 || r > this.size - 2 || c > this.size - 2) return false;
    if (this.hasWall(r, c, ORIENT.H) || this.hasWall(r, c, ORIENT.V)) return false; // crossing / same slot
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

  /** Full legality: geometry + both players retain a path to goal. */
  canPlaceWall(player, r, c, o) {
    if (this.wallsLeft[player] <= 0) return false;
    if (!this.canPlaceWallGeometry(r, c, o)) return false;
    // Tentatively add and check connectivity for both players.
    const key = wallKey(r, c, o);
    this.walls.set(key, { r, c, o });
    const ok = this.pathExists(0) && this.pathExists(1);
    this.walls.delete(key);
    return ok;
  }

  /** BFS: does `player` still have any path from current cell to their goal row? */
  pathExists(player) {
    const start = this.pawns[player];
    const goal = this.goalRow[player];
    const visited = new Uint8Array(this.size * this.size);
    const idx = (r, c) => r * this.size + c;
    const queue = [start];
    visited[idx(start.r, start.c)] = 1;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.r === goal) return true;
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

  /** Length of the shortest path to goal (BFS), or Infinity if unreachable. */
  shortestPath(player) {
    const start = this.pawns[player];
    const goal = this.goalRow[player];
    const dist = new Int32Array(this.size * this.size).fill(-1);
    const idx = (r, c) => r * this.size + c;
    const queue = [start];
    dist[idx(start.r, start.c)] = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist[idx(cur.r, cur.c)];
      if (cur.r === goal) return d;
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

  /* -------------------------------- Actions --------------------------------- */

  /**
   * Apply an action by `player`. Throws on illegal action.
   * @param {number} player
   * @param {object} action  {type:'move', r, c} | {type:'wall', r, c, o}
   * @returns {object} result describing the applied action
   */
  apply(player, action) {
    if (this.winner !== null) throw new Error('Game already finished');
    if (player !== this.turn) throw new Error('Not your turn');

    if (action.type === 'move') {
      const { r, c } = action;
      if (!this.isLegalMove(player, r, c)) throw new Error('Illegal move');
      this.pawns[player] = { r, c };
      if (r === this.goalRow[player]) this.winner = player;
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
    if (this.winner === null) this.turn = 1 - player;
    return { state: this.toState(), winner: this.winner };
  }

  /** Convenience: list every legal action for a player (for AI / hints). */
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

export { ORIENT, wallKey };
