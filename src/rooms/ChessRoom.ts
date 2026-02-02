import { Room, Client } from "@colyseus/core";
import { ChessState, ChessPlayerSchema } from "../schemas/ChessState";
import { ChessGame, ChessPieceType } from "../logic/chess";

interface JoinOptions {
  displayName?: string;
  quickMatch?: boolean;
}

interface MoveMessage {
  from: { x: number; y: number };
  to: { x: number; y: number };
  promotion?: ChessPieceType;
}

export class ChessRoom extends Room<ChessState> {
  private game = new ChessGame();
  private history: MoveMessage[] = [];

  onCreate(): void {
    console.log("[ChessRoom] Room created");
    this.setState(new ChessState());

    this.setMetadata({
      status: "waiting",
      hostName: "",
      createdAt: Date.now(),
    });

    this.onMessage("move", this.handleMove.bind(this));
    this.onMessage("resign", this.handleResign.bind(this));
    this.onMessage("sync_request", (client) => this.sendSync(client));
  }

  onJoin(client: Client, options: JoinOptions): void {
    console.log(`[ChessRoom] Player joined: ${client.sessionId}`);

    if (this.state.players.size >= 2) {
      client.leave();
      return;
    }

    const player = new ChessPlayerSchema();
    player.sessionId = client.sessionId;
    player.displayName = options.displayName || `Player ${this.state.players.size + 1}`;
    player.side = this.state.players.size === 0 ? "w" : "b";

    this.state.players.set(client.sessionId, player);

    if (this.state.players.size === 1) {
      this.setMetadata({
        status: "waiting",
        hostName: player.displayName,
        createdAt: Date.now(),
      });
    }

    this.broadcast("player_joined", {
      sessionId: player.sessionId,
      displayName: player.displayName,
      side: player.side,
    });

    const allPlayers: any[] = [];
    this.state.players.forEach((p) => {
      allPlayers.push({
        sessionId: p.sessionId,
        displayName: p.displayName,
        side: p.side,
      });
    });

    client.send("all_players", { players: allPlayers });
    client.send("assign", { side: player.side });
    this.sendSync(client);

    if (this.state.players.size === 2) {
      this.state.phase = "playing";
      this.state.turn = this.game.getTurn();
      const firstPlayer = Array.from(this.state.players.values())[0];
      this.setMetadata({
        status: "playing",
        hostName: firstPlayer?.displayName || "",
        createdAt: Date.now(),
      });
      this.lock();
      this.broadcast("game_start", { turn: this.state.turn });
    }
  }

  onLeave(client: Client, consented: boolean): void {
    console.log(`[ChessRoom] Player left: ${client.sessionId}, consented: ${consented}`);
    const leavingPlayer = this.state.players.get(client.sessionId);

    if (this.state.phase === "playing" && leavingPlayer) {
      const remaining = Array.from(this.state.players.values()).find(
        (p) => p.sessionId !== client.sessionId
      );
      if (remaining) {
        this.finishGame(remaining.side, "disconnect");
      }
    }

    this.state.players.delete(client.sessionId);
    this.broadcast("player_left", { sessionId: client.sessionId });

    if (this.state.players.size === 1) {
      const remaining = Array.from(this.state.players.values())[0];
      this.resetGameState();
      this.state.phase = "waiting";
      this.setMetadata({
        status: "waiting",
        hostName: remaining.displayName,
        createdAt: Date.now(),
      });
      this.unlock();
    }

    if (this.state.players.size === 0) {
      this.setMetadata({
        status: "empty",
        hostName: "",
        createdAt: Date.now(),
      });
    }
  }

  onDispose(): void {
    console.log("[ChessRoom] Room disposed");
  }

  private sendSync(client: Client) {
    client.send("sync", {
      moves: this.history,
      phase: this.state.phase,
      turn: this.game.getTurn(),
    });
  }

  private handleMove(client: Client, message: MoveMessage): void {
    if (this.state.phase !== "playing") {
      this.sendError(client, "GAME_NOT_PLAYING", "Game is not in playing phase");
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (player.side !== this.game.getTurn()) {
      this.sendError(client, "NOT_YOUR_TURN", "Not your turn");
      return;
    }

    if (!message?.from || !message?.to) {
      this.sendError(client, "INVALID_MOVE", "Missing move payload");
      return;
    }

    const promotion =
      message.promotion === "q" ||
      message.promotion === "r" ||
      message.promotion === "b" ||
      message.promotion === "n"
        ? message.promotion
        : "q";

    const result = this.game.move(
      message.from.x,
      message.from.y,
      message.to.x,
      message.to.y,
      promotion
    );

    if (!result.ok) {
      this.sendError(client, "INVALID_MOVE", "Illegal move");
      return;
    }

    const payload: MoveMessage = {
      from: message.from,
      to: message.to,
    };
    if (result.move?.promotion) {
      payload.promotion = result.move.promotion;
    }

    this.history.push(payload);
    this.state.turn = this.game.getTurn();
    this.broadcast("move", payload);

    const status = this.game.getStatus();
    if (status.checkmate) {
      this.finishGame(player.side, "checkmate");
    } else if (status.stalemate) {
      this.finishGame(null, "stalemate");
    }
  }

  private handleResign(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const winnerSide = player.side === "w" ? "b" : "w";
    this.finishGame(winnerSide, "resign");
  }

  private resetGameState(): void {
    this.game.reset();
    this.history = [];
    this.state.turn = this.game.getTurn();
    this.state.winnerSide = "";
    this.state.winReason = "";
  }

  private finishGame(winnerSide: string | null, reason: string): void {
    this.state.phase = "finished";
    this.state.winnerSide = winnerSide || "";
    this.state.winReason = reason;
    this.broadcast("game_over", {
      winnerSide: winnerSide || null,
      reason,
    });
  }

  private sendError(client: Client, code: string, message: string) {
    client.send("error", { code, message });
  }
}
