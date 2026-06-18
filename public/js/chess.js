/**
 * AleManKhora — Chess Engine (2-player + 4-player)
 * ================================================
 * Server-authoritative chess rules shared by the server and the browser, in the
 * same spirit as the Quoridor engine. One class covers three variants:
 *
 *   variant '2'      — classic 8×8 chess (full rules: castling, en passant,
 *                      promotion, stalemate / 50-move / threefold / insufficient
 *                      material draws).
 *   variant '4'      — 4-player free-for-all on the 14×14 cross board. Last king
 *                      standing wins; checkmated / timed-out players are removed.
 *   variant '4team'  — 4-player 2-vs-2 teams on the same board. Seats 0 & 2 form
 *                      one team, seats 1 & 3 the other. A team wins when both
 *                      opposing players are eliminated.
 *
 * Board model
 * -----------
 * `board[r][c]` holds a piece `{ t, seat }` or null. `t ∈ {p,n,b,r,q,k}`.
 * Rows increase downward, columns rightward. On the 4-player cross board the
 * four 3×3 corners are "blocked" (off the playable cross).
 *
 * Seats / orientation
 * -------------------
 *   2-player:  seat 0 = white (bottom, moves up), seat 1 = black (top, down).
 *   4-player:  seat 0 = red    (bottom, moves up)
 *              seat 1 = blue   (left,   moves right)
 *              seat 2 = yellow (top,    moves down)
 *              seat 3 = green  (right,  moves left)   — clockwise turn order.
 *
 * The engine exposes the same surface the GameManager relies on
 * (`apply`, `eliminate`, `toState`, `winner`, `turn`, `eliminated`,
 * `numPlayers`, `moveCount`, `activePlayers`, `isOver`).
 */

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/** Per-seat pawn movement profile for a given variant. */
function armyProfiles(variant) {
  if (variant === '2') {
    return [
      { fwd: [-1, 0], start: (r) => r === 6, promote: (r) => r === 0 },
      { fwd: [1, 0], start: (r) => r === 1, promote: (r) => r === 7 },
    ];
  }
  // 4-player cross board (14×14)
  return [
    { fwd: [-1, 0], start: (r) => r === 12, promote: (r) => r === 0 },  // red, up
    { fwd: [0, 1], start: (r, c) => c === 1, promote: (r, c) => c === 13 }, // blue, right
    { fwd: [1, 0], start: (r) => r === 1, promote: (r) => r === 13 },  // yellow, down
    { fwd: [0, -1], start: (r, c) => c === 12, promote: (r, c) => c === 0 }, // green, left
  ];
}

export class ChessGame {
  constructor(opts = {}) {
    const variant = opts.variant === '4' ? '4' : opts.variant === '4team' ? '4team' : '2';
    this.variant = variant;
    this.is4 = variant !== '2';
    this.numPlayers = variant === '2' ? 2 : 4;
    this.size = variant === '2' ? 8 : 14;       // square board dimension
    this.rows = this.size;
    this.cols = this.size;
    this.army = armyProfiles(variant === '2' ? '2' : '4');

    // Team mapping: FFA → each seat its own team; teams → seats %2.
    this.teamMode = variant === '4team';
    this.stalemateEliminates = this.is4; // 4-player stalemate removes the player

    this.board = Array.from({ length: this.rows }, () => new Array(this.cols).fill(null));
    this.kings = new Array(this.numPlayers).fill(null);
    this.eliminated = new Array(this.numPlayers).fill(false);
    // Castling rights per seat (only used by the 2-player variant).
    this.castle = Array.from({ length: this.numPlayers }, () => ({ k: true, q: true }));
    this.ep = null;            // en-passant target square {r,c} (2-player only)
    this.turn = 0;
    this.winner = null;        // seat index | null
    this.winningTeam = null;
    this.draw = false;
    this.gameOver = false;
    this.endReason = null;     // checkmate | stalemate | fifty | threefold | insufficient | forfeit | draw-agreed
    this.halfmove = 0;         // halfmove clock for the 50-move rule
    this.moveCount = 0;
    this.lastMove = null;      // {from,to}
    this.history = [];
    this.positionCounts = new Map();

    this._setup();
  }

  /* ------------------------------- Geometry ------------------------------- */

  blocked(r, c) {
    if (!this.is4) return false;
    const lo = 0, hi = this.size - 1;
    const inCorner = (r0, r1, c0, c1) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
    return (
      inCorner(lo, 2, lo, 2) || inCorner(lo, 2, hi - 2, hi) ||
      inCorner(hi - 2, hi, lo, 2) || inCorner(hi - 2, hi, hi - 2, hi)
    );
  }
  inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols && !this.blocked(r, c);
  }
  pieceAt(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    return this.board[r][c];
  }

  teamOf(seat) { return this.teamMode ? seat % 2 : seat; }
  sameTeam(a, b) { return this.teamOf(a) === this.teamOf(b); }
  isEnemyPiece(piece, seat) { return piece && !this.sameTeam(piece.seat, seat); }

  /* ------------------------------- Setup ---------------------------------- */

  _place(r, c, t, seat) {
    this.board[r][c] = { t, seat };
    if (t === 'k') this.kings[seat] = { r, c };
  }

  _setup() {
    if (!this.is4) {
      // 2-player: white bottom (r7 back, r6 pawns), black top (r0 back, r1 pawns).
      for (let c = 0; c < 8; c++) {
        this._place(7, c, BACK_RANK[c], 0);
        this._place(6, c, 'p', 0);
        this._place(0, c, BACK_RANK[c], 1);
        this._place(1, c, 'p', 1);
      }
      return;
    }
    // 4-player cross board. Each army occupies the 8 central files/ranks (3..10).
    const a = 3, b = 10;
    for (let i = a; i <= b; i++) {
      const idx = i - a; // 0..7 → BACK_RANK
      // red (seat 0) bottom
      this._place(13, i, BACK_RANK[idx], 0);
      this._place(12, i, 'p', 0);
      // yellow (seat 2) top
      this._place(0, i, BACK_RANK[idx], 2);
      this._place(1, i, 'p', 2);
      // blue (seat 1) left
      this._place(i, 0, BACK_RANK[idx], 1);
      this._place(i, 1, 'p', 1);
      // green (seat 3) right
      this._place(i, 13, BACK_RANK[idx], 3);
      this._place(i, 12, 'p', 3);
    }
  }

  /* ----------------------------- Serialization ---------------------------- */

  toState() {
    const flat = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.board[r][c];
        flat.push(p ? { t: p.t, seat: p.seat } : null);
      }
    }
    const inCheck = [];
    for (let s = 0; s < this.numPlayers; s++) inCheck.push(!this.eliminated[s] && this.inCheck(s));
    return {
      kind: 'chess',
      variant: this.variant,
      rows: this.rows, cols: this.cols, numPlayers: this.numPlayers,
      teamMode: this.teamMode,
      board: flat,
      kings: this.kings.map((k) => (k ? { ...k } : null)),
      eliminated: [...this.eliminated],
      castle: this.castle.map((x) => ({ ...x })),
      ep: this.ep ? { ...this.ep } : null,
      turn: this.turn,
      winner: this.winner,
      winningTeam: this.winningTeam,
      draw: this.draw,
      gameOver: this.gameOver,
      endReason: this.endReason,
      halfmove: this.halfmove,
      moveCount: this.moveCount,
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      inCheck,
    };
  }

  static fromState(state) {
    const g = new ChessGame({ variant: state.variant });
    // Wipe the default setup and load the serialized board.
    g.board = Array.from({ length: g.rows }, () => new Array(g.cols).fill(null));
    g.kings = new Array(g.numPlayers).fill(null);
    let i = 0;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const p = state.board[i++];
        if (p) { g.board[r][c] = { t: p.t, seat: p.seat }; if (p.t === 'k') g.kings[p.seat] = { r, c }; }
      }
    }
    g.eliminated = [...state.eliminated];
    g.castle = (state.castle || g.castle).map((x) => ({ ...x }));
    g.ep = state.ep ? { ...state.ep } : null;
    g.turn = state.turn;
    g.winner = state.winner ?? null;
    g.winningTeam = state.winningTeam ?? null;
    g.draw = !!state.draw;
    g.gameOver = !!state.gameOver;
    g.endReason = state.endReason ?? null;
    g.halfmove = state.halfmove ?? 0;
    g.moveCount = state.moveCount ?? 0;
    g.lastMove = state.lastMove ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to } } : null;
    return g;
  }

  /* ------------------------------- Queries -------------------------------- */

  activePlayers() {
    const out = [];
    for (let s = 0; s < this.numPlayers; s++) if (!this.eliminated[s]) out.push(s);
    return out;
  }
  activeTeams() { return new Set(this.activePlayers().map((s) => this.teamOf(s))); }
  isOver() { return this.gameOver; }

  /* --------------------------- Attack detection --------------------------- */

  /** Is (r,c) attacked by any enemy of `seat`? */
  _squareAttacked(r, c, seat) {
    // Pawns: an enemy pawn attacks along its capture diagonals.
    for (let s = 0; s < this.numPlayers; s++) {
      if (this.eliminated[s] || this.sameTeam(s, seat)) continue;
      const caps = this._pawnCaps(s);
      for (const [dr, dc] of caps) {
        const pr = r - dr, pc = c - dc;
        const p = this.pieceAt(pr, pc);
        if (p && p.t === 'p' && p.seat === s) return true;
      }
    }
    // Knights
    const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (const [dr, dc] of KN) {
      const p = this.pieceAt(r + dr, c + dc);
      if (p && p.t === 'n' && this.isEnemyPiece(p, seat)) return true;
    }
    // King
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const p = this.pieceAt(r + dr, c + dc);
      if (p && p.t === 'k' && this.isEnemyPiece(p, seat)) return true;
    }
    // Sliders: rooks/queens orthogonally, bishops/queens diagonally.
    const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const scan = (dirs, types) => {
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nc >= 0 && nr < this.rows && nc < this.cols) {
          if (this.blocked(nr, nc)) break;
          const p = this.board[nr][nc];
          if (p) {
            if (this.isEnemyPiece(p, seat) && types.includes(p.t)) return true;
            break;
          }
          nr += dr; nc += dc;
        }
      }
      return false;
    };
    if (scan(ORTHO, ['r', 'q'])) return true;
    if (scan(DIAG, ['b', 'q'])) return true;
    return false;
  }

  _pawnCaps(seat) {
    const [fr, fc] = this.army[seat].fwd;
    // Perpendicular spread of the forward direction gives the two capture diagonals.
    if (fc === 0) return [[fr, -1], [fr, 1]];
    return [[-1, fc], [1, fc]];
  }

  inCheck(seat) {
    const k = this.kings[seat];
    if (!k) return false;
    return this._squareAttacked(k.r, k.c, seat);
  }

  /* ----------------------------- Move generation -------------------------- */

  /** Pseudo-legal moves for `seat` (king-safety filtered separately). */
  _pseudoMoves(seat) {
    const moves = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.board[r][c];
        if (!p || p.seat !== seat) continue;
        this._pieceMoves(r, c, p, seat, moves);
      }
    }
    return moves;
  }

  _pushSlide(r, c, dirs, seat, moves) {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (this.inBounds(nr, nc)) {
        const t = this.board[nr][nc];
        if (!t) moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        else { if (this.isEnemyPiece(t, seat)) moves.push({ from: { r, c }, to: { r: nr, c: nc } }); break; }
        nr += dr; nc += dc;
      }
    }
  }

  _pieceMoves(r, c, p, seat, moves) {
    const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    switch (p.t) {
      case 'p': this._pawnMoves(r, c, seat, moves); break;
      case 'n': {
        const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dr, dc] of KN) {
          const nr = r + dr, nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const t = this.board[nr][nc];
          if (!t || this.isEnemyPiece(t, seat)) moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        }
        break;
      }
      case 'b': this._pushSlide(r, c, DIAG, seat, moves); break;
      case 'r': this._pushSlide(r, c, ORTHO, seat, moves); break;
      case 'q': this._pushSlide(r, c, [...ORTHO, ...DIAG], seat, moves); break;
      case 'k': {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const t = this.board[nr][nc];
          if (!t || this.isEnemyPiece(t, seat)) moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        }
        if (!this.is4) this._castleMoves(r, c, seat, moves);
        break;
      }
    }
  }

  _pawnMoves(r, c, seat, moves) {
    const prof = this.army[seat];
    const [fr, fc] = prof.fwd;
    const nr = r + fr, nc = c + fc;
    const promote = prof.promote(nr, nc);
    // Forward one
    if (this.inBounds(nr, nc) && !this.board[nr][nc]) {
      this._addPawn(r, c, nr, nc, seat, promote, moves, false);
      // Forward two from the start line
      if (prof.start(r, c)) {
        const r2 = r + 2 * fr, c2 = c + 2 * fc;
        if (this.inBounds(r2, c2) && !this.board[r2][c2]) {
          moves.push({ from: { r, c }, to: { r: r2, c: c2 }, dbl: true });
        }
      }
    }
    // Captures (incl. en passant for the 2-player variant)
    for (const [dr, dc] of this._pawnCaps(seat)) {
      const cr = r + dr, cc = c + dc;
      if (!this.inBounds(cr, cc)) continue;
      const t = this.board[cr][cc];
      const prom2 = prof.promote(cr, cc);
      if (t && this.isEnemyPiece(t, seat)) {
        this._addPawn(r, c, cr, cc, seat, prom2, moves, false);
      } else if (!t && !this.is4 && this.ep && this.ep.r === cr && this.ep.c === cc) {
        moves.push({ from: { r, c }, to: { r: cr, c: cc }, ep: true });
      }
    }
  }

  _addPawn(fr, fc, tr, tc, seat, promote, moves, _ep) {
    if (promote) {
      for (const t of ['q', 'r', 'b', 'n']) moves.push({ from: { r: fr, c: fc }, to: { r: tr, c: tc }, promo: t });
    } else {
      moves.push({ from: { r: fr, c: fc }, to: { r: tr, c: tc } });
    }
  }

  _castleMoves(r, c, seat, moves) {
    const rights = this.castle[seat];
    if (!rights || (!rights.k && !rights.q)) return;
    if (this.inCheck(seat)) return;
    const homeRow = seat === 0 ? 7 : 0;
    if (r !== homeRow || c !== 4) return;
    const empty = (cc) => !this.board[homeRow][cc];
    const safe = (cc) => !this._squareAttacked(homeRow, cc, seat);
    // King-side: rook on h-file (c=7)
    if (rights.k) {
      const rook = this.board[homeRow][7];
      if (rook && rook.t === 'r' && rook.seat === seat &&
          empty(5) && empty(6) && safe(5) && safe(6)) {
        moves.push({ from: { r, c }, to: { r: homeRow, c: 6 }, castle: 'k' });
      }
    }
    // Queen-side: rook on a-file (c=0)
    if (rights.q) {
      const rook = this.board[homeRow][0];
      if (rook && rook.t === 'r' && rook.seat === seat &&
          empty(1) && empty(2) && empty(3) && safe(2) && safe(3)) {
        moves.push({ from: { r, c }, to: { r: homeRow, c: 2 }, castle: 'q' });
      }
    }
  }

  /** Would making move `m` leave `seat`'s own king in check? */
  _kingSafeAfter(seat, m) {
    const { from, to } = m;
    const moving = this.board[from.r][from.c];
    let capR = to.r, capC = to.c;
    if (m.ep) { capR = from.r; capC = to.c; }
    const captured = this.board[capR][capC];
    // make
    this.board[to.r][to.c] = moving;
    this.board[from.r][from.c] = null;
    if (m.ep) this.board[capR][capC] = null;
    const kpos = moving.t === 'k' ? { r: to.r, c: to.c } : this.kings[seat];
    const safe = kpos ? !this._squareAttacked(kpos.r, kpos.c, seat) : true;
    // unmake
    this.board[from.r][from.c] = moving;
    if (m.ep) { this.board[to.r][to.c] = null; this.board[capR][capC] = captured; }
    else this.board[to.r][to.c] = captured;
    return safe;
  }

  legalMoves(seat = this.turn) {
    if (this.eliminated[seat]) return [];
    return this._pseudoMoves(seat).filter((m) => this._kingSafeAfter(seat, m));
  }

  /* ------------------------------- Applying ------------------------------- */

  apply(seat, action) {
    if (this.gameOver) throw new Error('بازی تمام شده است');
    if (this.eliminated[seat]) throw new Error('شما حذف شده‌اید');
    if (seat !== this.turn) throw new Error('نوبت شما نیست');
    if (!action || action.type !== 'move') throw new Error('کنش نامعتبر');
    const { from, to } = action;
    if (!from || !to) throw new Error('حرکت نامعتبر');

    const candidates = this.legalMoves(seat).filter(
      (m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c
    );
    if (!candidates.length) throw new Error('حرکت غیرمجاز');
    // For a promotion there are several candidates; pick by requested piece.
    let move = candidates[0];
    if (candidates.length > 1) {
      const want = action.promo && ['q', 'r', 'b', 'n'].includes(action.promo) ? action.promo : 'q';
      move = candidates.find((m) => m.promo === want) || candidates[0];
    }

    this._makeMove(seat, move);
    this.history.push({ seat, ...move, n: this.moveCount });
    this.moveCount += 1;
    this.lastMove = { from: { ...move.from }, to: { ...move.to } };

    this._advanceAndResolve(seat);
    return { state: this.toState(), winner: this.winner, gameOver: this.gameOver };
  }

  _makeMove(seat, m) {
    const { from, to } = m;
    const moving = this.board[from.r][from.c];
    const target = this.board[to.r][to.c];
    const isPawn = moving.t === 'p';
    const isCapture = !!target || !!m.ep;

    // En-passant capture removes the pawn beside the destination.
    if (m.ep) this.board[from.r][to.c] = null;

    // Move the piece.
    this.board[to.r][to.c] = moving;
    this.board[from.r][from.c] = null;

    // Promotion.
    if (m.promo) moving.t = m.promo;

    // King bookkeeping + castling.
    if (moving.t === 'k') {
      this.kings[seat] = { r: to.r, c: to.c };
      if (this.castle[seat]) { this.castle[seat].k = false; this.castle[seat].q = false; }
      if (m.castle) {
        const homeRow = to.r;
        if (m.castle === 'k') { // rook h → f
          this.board[homeRow][5] = this.board[homeRow][7];
          this.board[homeRow][7] = null;
        } else { // queen-side rook a → d
          this.board[homeRow][3] = this.board[homeRow][0];
          this.board[homeRow][0] = null;
        }
      }
    }
    // Moving a rook off its home square forfeits that side's castling.
    if (moving.t === 'r' && !this.is4) {
      const homeRow = seat === 0 ? 7 : 0;
      if (from.r === homeRow && from.c === 0) this.castle[seat].q = false;
      if (from.r === homeRow && from.c === 7) this.castle[seat].k = false;
    }
    // Capturing a rook on its home square forfeits the victim's castling.
    if (target && target.t === 'r' && !this.is4) {
      const vSeat = target.seat;
      const vHome = vSeat === 0 ? 7 : 0;
      if (to.r === vHome && to.c === 0) this.castle[vSeat].q = false;
      if (to.r === vHome && to.c === 7) this.castle[vSeat].k = false;
    }

    // En-passant target (2-player only): the skipped square behind a double step.
    this.ep = null;
    if (m.dbl && !this.is4) {
      const [fr] = this.army[seat].fwd;
      this.ep = { r: from.r + fr, c: from.c };
    }

    // 50-move clock.
    if (isPawn || isCapture) this.halfmove = 0; else this.halfmove += 1;
  }

  /** Advance the turn, eliminating checkmated / stalemated players, and resolve
   *  the end of the game. */
  _advanceAndResolve(mover) {
    let next = mover;
    let guard = 0;
    while (guard++ < this.numPlayers * 4) {
      next = (next + 1) % this.numPlayers;
      if (this.eliminated[next]) continue;
      const moves = this.legalMoves(next);
      if (moves.length === 0) {
        const chk = this.inCheck(next);
        if (!chk && !this.stalemateEliminates) {
          // 2-player stalemate → draw.
          this.draw = true; this.gameOver = true; this.endReason = 'stalemate';
          return;
        }
        this._eliminateSeat(next, chk ? 'checkmate' : 'stalemate');
        if (this._checkTeamWin()) return;
        continue; // keep scanning; cascades are possible
      }
      // `next` has a move — it's their turn.
      this.turn = next;
      if (this.numPlayers === 2) this._checkDrawRules();
      return;
    }
    // Nobody could move.
    this._checkTeamWin();
  }

  _eliminateSeat(seat, reason) {
    if (this.eliminated[seat]) return;
    this.eliminated[seat] = true;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.board[r][c];
        if (p && p.seat === seat) this.board[r][c] = null;
      }
    }
    this.kings[seat] = null;
    if (!this.endReason) this.endReason = reason;
  }

  _checkTeamWin() {
    const active = this.activePlayers();
    const teams = new Set(active.map((s) => this.teamOf(s)));
    if (teams.size <= 1) {
      this.gameOver = true;
      if (active.length === 0) { this.draw = true; this.winner = null; this.winningTeam = null; }
      else { this.winner = active[0]; this.winningTeam = this.teamOf(active[0]); }
      return true;
    }
    return false;
  }

  _checkDrawRules() {
    if (this.halfmove >= 100) { this.draw = true; this.gameOver = true; this.endReason = 'fifty'; return; }
    if (this._insufficientMaterial()) { this.draw = true; this.gameOver = true; this.endReason = 'insufficient'; return; }
    const key = this._positionKey();
    const n = (this.positionCounts.get(key) || 0) + 1;
    this.positionCounts.set(key, n);
    if (n >= 3) { this.draw = true; this.gameOver = true; this.endReason = 'threefold'; }
  }

  _positionKey() {
    let s = '';
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const p = this.board[r][c];
      s += p ? p.seat + p.t : '..';
    }
    s += '|' + this.turn;
    s += '|' + this.castle.map((x) => (x.k ? 'K' : '') + (x.q ? 'Q' : '')).join('');
    s += '|' + (this.ep ? this.ep.r + ',' + this.ep.c : '-');
    return s;
  }

  _insufficientMaterial() {
    if (this.is4) return false;
    const minors = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const p = this.board[r][c];
      if (!p || p.t === 'k') continue;
      if (p.t === 'p' || p.t === 'r' || p.t === 'q') return false; // mating material exists
      minors.push({ t: p.t, color: (r + c) % 2, seat: p.seat });
    }
    if (minors.length <= 1) return true; // K vs K, K+minor vs K
    // K+B vs K+B with same-coloured bishops.
    if (minors.length === 2 && minors.every((m) => m.t === 'b') && minors[0].color === minors[1].color) return true;
    return false;
  }

  /** Eliminate a player from outside (timeout / resignation / abandonment). */
  eliminate(seat, reason = 'forfeit') {
    if (this.eliminated[seat] || this.gameOver) return this.gameOver;
    this._eliminateSeat(seat, reason);
    if (this._checkTeamWin()) return true;
    if (this.turn === seat) this._advanceAndResolve(seat);
    return this.gameOver;
  }

  /** Declare an agreed draw (2-player). */
  agreeDraw() {
    if (this.gameOver) return;
    this.draw = true; this.gameOver = true; this.endReason = 'draw-agreed';
  }

  /** Force a winner from outside (e.g. only bots remain and can't force mate). */
  forceWinner(seat, reason = 'resign') {
    if (this.gameOver) return;
    this.winner = seat;
    this.winningTeam = this.teamOf(seat);
    this.gameOver = true;
    this.endReason = reason;
  }

  /* ------------------------------- Material ------------------------------- */

  /** Net material for a seat (own pieces minus all enemies') — used by the AI. */
  materialBalance(seat) {
    let mine = 0, foes = 0;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const p = this.board[r][c];
      if (!p) continue;
      const v = PIECE_VALUE[p.t];
      if (this.sameTeam(p.seat, seat)) mine += v; else foes += v;
    }
    return mine - foes;
  }
}

export { PIECE_VALUE };
