export type ChessColor = "w" | "b";
export type ChessPieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface ChessPiece {
  type: ChessPieceType;
  color: ChessColor;
}

export interface ChessPosition {
  x: number;
  y: number;
}

export interface ChessMove {
  from: ChessPosition;
  to: ChessPosition;
  piece: ChessPiece;
  capture?: ChessPiece;
  promotion?: ChessPieceType;
  castle?: "K" | "Q";
  enPassant?: boolean;
  doublePawn?: boolean;
}

export interface ChessStatus {
  inCheck: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

type Board = (ChessPiece | null)[][];

const BACK_RANK: ChessPieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];

const inBounds = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;

const cloneBoard = (board: Board): Board =>
  board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));

const opposite = (color: ChessColor): ChessColor => (color === "w" ? "b" : "w");

const createInitialBoard = (): Board => {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));

  for (let x = 0; x < 8; x += 1) {
    board[0][x] = { type: BACK_RANK[x], color: "b" };
    board[1][x] = { type: "p", color: "b" };
    board[6][x] = { type: "p", color: "w" };
    board[7][x] = { type: BACK_RANK[x], color: "w" };
  }

  return board;
};

interface GameState {
  board: Board;
  turn: ChessColor;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassant: ChessPosition | null;
}

export class ChessGame {
  private board: Board = createInitialBoard();
  private turn: ChessColor = "w";
  private castling = { wK: true, wQ: true, bK: true, bQ: true };
  private enPassant: ChessPosition | null = null;
  private history: ChessMove[] = [];
  private stateHistory: GameState[] = [];

  reset() {
    this.board = createInitialBoard();
    this.turn = "w";
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;
    this.history = [];
    this.stateHistory = [];
  }

  canUndo(): boolean {
    return this.stateHistory.length > 0;
  }

  undo(): boolean {
    if (this.stateHistory.length === 0) return false;
    const prevState = this.stateHistory.pop()!;
    this.board = prevState.board;
    this.turn = prevState.turn;
    this.castling = prevState.castling;
    this.enPassant = prevState.enPassant;
    this.history.pop();
    return true;
  }

  getHistory(): ChessMove[] {
    return this.history;
  }

  getBoard() {
    return this.board;
  }

  getTurn() {
    return this.turn;
  }

  clone(): ChessGame {
    const game = new ChessGame();
    game.board = cloneBoard(this.board);
    game.turn = this.turn;
    game.castling = { ...this.castling };
    game.enPassant = this.enPassant ? { ...this.enPassant } : null;
    game.history = this.history.map((move) => ({ ...move }));
    return game;
  }

  getAllLegalMoves(color: ChessColor): ChessMove[] {
    const moves: ChessMove[] = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = this.board[y][x];
        if (!piece || piece.color !== color) continue;
        moves.push(...this.getLegalMovesFrom(x, y, color));
      }
    }
    return moves;
  }

  getLastMove(): ChessMove | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  getStatus(): ChessStatus {
    const inCheck = this.isInCheck(this.turn, this.board);
    const hasMoves = this.hasAnyLegalMoves(this.turn);
    return {
      inCheck,
      checkmate: inCheck && !hasMoves,
      stalemate: !inCheck && !hasMoves,
    };
  }

  getLegalMovesFrom(x: number, y: number, colorOverride?: ChessColor): ChessMove[] {
    const piece = this.board[y]?.[x];
    const color = colorOverride ?? this.turn;
    if (!piece || piece.color !== color) return [];

    const pseudoMoves = this.generatePseudoMoves(x, y, piece, this.board);
    return pseudoMoves.filter((move) => {
      const nextBoard = this.applyMoveToBoard(this.board, move);
      return !this.isInCheck(piece.color, nextBoard);
    });
  }

  move(fromX: number, fromY: number, toX: number, toY: number, promotion: ChessPieceType = "q") {
    const legalMoves = this.getLegalMovesFrom(fromX, fromY);
    const selected = legalMoves.find((m) => m.to.x === toX && m.to.y === toY);
    if (!selected) {
      return { ok: false as const };
    }

    // Save state for undo
    this.stateHistory.push({
      board: cloneBoard(this.board),
      turn: this.turn,
      castling: { ...this.castling },
      enPassant: this.enPassant ? { ...this.enPassant } : null,
    });

    const move: ChessMove = { ...selected };
    if (move.promotion) {
      move.promotion = promotion;
    }

    this.board = this.applyMoveToBoard(this.board, move);
    this.updateCastlingRights(move);
    this.updateEnPassant(move);
    this.turn = opposite(this.turn);
    this.history.push(move);

    return { ok: true as const, move };
  }

  private hasAnyLegalMoves(color: ChessColor): boolean {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = this.board[y][x];
        if (!piece || piece.color !== color) continue;
        if (this.getLegalMovesFrom(x, y, color).length > 0) return true;
      }
    }
    return false;
  }

  private applyMoveToBoard(board: Board, move: ChessMove): Board {
    const next = cloneBoard(board);
    const piece = { ...move.piece };

    next[move.from.y][move.from.x] = null;

    if (move.enPassant) {
      const captureY = move.piece.color === "w" ? move.to.y + 1 : move.to.y - 1;
      next[captureY][move.to.x] = null;
    }

    if (move.castle) {
      if (move.castle === "K") {
        const rookFromX = 7;
        const rookToX = 5;
        const row = move.piece.color === "w" ? 7 : 0;
        next[row][rookToX] = next[row][rookFromX];
        next[row][rookFromX] = null;
      } else {
        const rookFromX = 0;
        const rookToX = 3;
        const row = move.piece.color === "w" ? 7 : 0;
        next[row][rookToX] = next[row][rookFromX];
        next[row][rookFromX] = null;
      }
    }

    if (move.promotion) {
      piece.type = move.promotion;
    }
    next[move.to.y][move.to.x] = piece;
    return next;
  }

  private updateCastlingRights(move: ChessMove) {
    if (move.piece.type === "k") {
      if (move.piece.color === "w") {
        this.castling.wK = false;
        this.castling.wQ = false;
      } else {
        this.castling.bK = false;
        this.castling.bQ = false;
      }
    }

    if (move.piece.type === "r") {
      if (move.from.x === 0 && move.from.y === 7) this.castling.wQ = false;
      if (move.from.x === 7 && move.from.y === 7) this.castling.wK = false;
      if (move.from.x === 0 && move.from.y === 0) this.castling.bQ = false;
      if (move.from.x === 7 && move.from.y === 0) this.castling.bK = false;
    }

    if (move.capture?.type === "r") {
      if (move.to.x === 0 && move.to.y === 7) this.castling.wQ = false;
      if (move.to.x === 7 && move.to.y === 7) this.castling.wK = false;
      if (move.to.x === 0 && move.to.y === 0) this.castling.bQ = false;
      if (move.to.x === 7 && move.to.y === 0) this.castling.bK = false;
    }
  }

  private updateEnPassant(move: ChessMove) {
    if (move.piece.type === "p" && move.doublePawn) {
      this.enPassant = {
        x: move.from.x,
        y: (move.from.y + move.to.y) / 2,
      };
    } else {
      this.enPassant = null;
    }
  }

  private generatePseudoMoves(x: number, y: number, piece: ChessPiece, board: Board): ChessMove[] {
    switch (piece.type) {
      case "p":
        return this.generatePawnMoves(x, y, piece, board);
      case "n":
        return this.generateKnightMoves(x, y, piece, board);
      case "b":
        return this.generateSlidingMoves(x, y, piece, board, [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]);
      case "r":
        return this.generateSlidingMoves(x, y, piece, board, [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]);
      case "q":
        return this.generateSlidingMoves(x, y, piece, board, [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]);
      case "k":
        return this.generateKingMoves(x, y, piece, board);
      default:
        return [];
    }
  }

  private generatePawnMoves(x: number, y: number, piece: ChessPiece, board: Board): ChessMove[] {
    const moves: ChessMove[] = [];
    const dir = piece.color === "w" ? -1 : 1;
    const startRow = piece.color === "w" ? 6 : 1;
    const promotionRow = piece.color === "w" ? 0 : 7;

    const oneForward = y + dir;
    if (inBounds(x, oneForward) && !board[oneForward][x]) {
      moves.push({
        from: { x, y },
        to: { x, y: oneForward },
        piece,
        promotion: oneForward === promotionRow ? "q" : undefined,
      });

      const twoForward = y + dir * 2;
      if (y === startRow && !board[twoForward][x]) {
        moves.push({
          from: { x, y },
          to: { x, y: twoForward },
          piece,
          doublePawn: true,
        });
      }
    }

    for (const dx of [-1, 1]) {
      const captureX = x + dx;
      const captureY = y + dir;
      if (!inBounds(captureX, captureY)) continue;
      const target = board[captureY][captureX];
      if (target && target.color !== piece.color) {
        moves.push({
          from: { x, y },
          to: { x: captureX, y: captureY },
          piece,
          capture: target,
          promotion: captureY === promotionRow ? "q" : undefined,
        });
      }

      if (this.enPassant && this.enPassant.x === captureX && this.enPassant.y === captureY) {
        moves.push({
          from: { x, y },
          to: { x: captureX, y: captureY },
          piece,
          enPassant: true,
        });
      }
    }

    return moves;
  }

  private generateKnightMoves(x: number, y: number, piece: ChessPiece, board: Board): ChessMove[] {
    const moves: ChessMove[] = [];
    const offsets = [
      [1, 2],
      [2, 1],
      [-1, 2],
      [-2, 1],
      [1, -2],
      [2, -1],
      [-1, -2],
      [-2, -1],
    ];

    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const target = board[ny][nx];
      if (!target || target.color !== piece.color) {
        moves.push({
          from: { x, y },
          to: { x: nx, y: ny },
          piece,
          capture: target ?? undefined,
        });
      }
    }
    return moves;
  }

  private generateSlidingMoves(
    x: number,
    y: number,
    piece: ChessPiece,
    board: Board,
    directions: number[][]
  ): ChessMove[] {
    const moves: ChessMove[] = [];
    for (const [dx, dy] of directions) {
      let nx = x + dx;
      let ny = y + dy;
      while (inBounds(nx, ny)) {
        const target = board[ny][nx];
        if (!target) {
          moves.push({ from: { x, y }, to: { x: nx, y: ny }, piece });
        } else {
          if (target.color !== piece.color) {
            moves.push({
              from: { x, y },
              to: { x: nx, y: ny },
              piece,
              capture: target,
            });
          }
          break;
        }
        nx += dx;
        ny += dy;
      }
    }
    return moves;
  }

  private generateKingMoves(x: number, y: number, piece: ChessPiece, board: Board): ChessMove[] {
    const moves: ChessMove[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const target = board[ny][nx];
        if (!target || target.color !== piece.color) {
          moves.push({
            from: { x, y },
            to: { x: nx, y: ny },
            piece,
            capture: target ?? undefined,
          });
        }
      }
    }

    const row = piece.color === "w" ? 7 : 0;
    const kingSideClear = board[row][5] === null && board[row][6] === null;
    const queenSideClear = board[row][1] === null && board[row][2] === null && board[row][3] === null;

    if (piece.color === "w" && this.castling.wK && kingSideClear) {
      if (
        !this.isSquareAttacked(4, row, "b", board) &&
        !this.isSquareAttacked(5, row, "b", board) &&
        !this.isSquareAttacked(6, row, "b", board)
      ) {
        moves.push({
          from: { x, y },
          to: { x: 6, y: row },
          piece,
          castle: "K",
        });
      }
    }

    if (piece.color === "w" && this.castling.wQ && queenSideClear) {
      if (
        !this.isSquareAttacked(4, row, "b", board) &&
        !this.isSquareAttacked(3, row, "b", board) &&
        !this.isSquareAttacked(2, row, "b", board)
      ) {
        moves.push({
          from: { x, y },
          to: { x: 2, y: row },
          piece,
          castle: "Q",
        });
      }
    }

    if (piece.color === "b" && this.castling.bK && kingSideClear) {
      if (
        !this.isSquareAttacked(4, row, "w", board) &&
        !this.isSquareAttacked(5, row, "w", board) &&
        !this.isSquareAttacked(6, row, "w", board)
      ) {
        moves.push({
          from: { x, y },
          to: { x: 6, y: row },
          piece,
          castle: "K",
        });
      }
    }

    if (piece.color === "b" && this.castling.bQ && queenSideClear) {
      if (
        !this.isSquareAttacked(4, row, "w", board) &&
        !this.isSquareAttacked(3, row, "w", board) &&
        !this.isSquareAttacked(2, row, "w", board)
      ) {
        moves.push({
          from: { x, y },
          to: { x: 2, y: row },
          piece,
          castle: "Q",
        });
      }
    }

    return moves;
  }

  private isInCheck(color: ChessColor, board: Board): boolean {
    let kingPos: ChessPosition | null = null;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = board[y][x];
        if (piece && piece.type === "k" && piece.color === color) {
          kingPos = { x, y };
          break;
        }
      }
      if (kingPos) break;
    }
    if (!kingPos) return false;
    return this.isSquareAttacked(kingPos.x, kingPos.y, opposite(color), board);
  }

  private isSquareAttacked(x: number, y: number, byColor: ChessColor, board: Board): boolean {
    const pawnDir = byColor === "w" ? -1 : 1;
    for (const dx of [-1, 1]) {
      const px = x + dx;
      const py = y - pawnDir;
      if (inBounds(px, py)) {
        const piece = board[py][px];
        if (piece && piece.color === byColor && piece.type === "p") return true;
      }
    }

    const knightOffsets = [
      [1, 2],
      [2, 1],
      [-1, 2],
      [-2, 1],
      [1, -2],
      [2, -1],
      [-1, -2],
      [-2, -1],
    ];
    for (const [dx, dy] of knightOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const piece = board[ny][nx];
      if (piece && piece.color === byColor && piece.type === "n") return true;
    }

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const piece = board[ny][nx];
        if (piece && piece.color === byColor && piece.type === "k") return true;
      }
    }

    const rookDirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of rookDirs) {
      let nx = x + dx;
      let ny = y + dy;
      while (inBounds(nx, ny)) {
        const piece = board[ny][nx];
        if (piece) {
          if (piece.color === byColor && (piece.type === "r" || piece.type === "q")) return true;
          break;
        }
        nx += dx;
        ny += dy;
      }
    }

    const bishopDirs = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of bishopDirs) {
      let nx = x + dx;
      let ny = y + dy;
      while (inBounds(nx, ny)) {
        const piece = board[ny][nx];
        if (piece) {
          if (piece.color === byColor && (piece.type === "b" || piece.type === "q")) return true;
          break;
        }
        nx += dx;
        ny += dy;
      }
    }

    return false;
  }
}
