import { Room, Client } from "@colyseus/core";
import { TradeState, TradePlayerSchema } from "../schemas/TradeState";
import { executeTrade } from "../lib/supabase";

interface JoinOptions {
  displayName?: string;
  playerId?: string;
  quickMatch?: boolean;
}

interface OfferPayload {
  units?: Record<string, number>;
  coins?: number;
}

interface ReadyPayload {
  ready?: boolean;
}

interface TradeOffer {
  units: Record<string, number>;
  coins: number;
}

const EMPTY_OFFER: TradeOffer = { units: {}, coins: 0 };

export class TradeRoom extends Room<TradeState> {
  private offers = new Map<string, TradeOffer>();
  private readyStates = new Map<string, boolean>();
  private isSettling = false;

  onCreate(): void {
    console.log("[TradeRoom] Room created");
    this.setState(new TradeState());

    this.setMetadata({
      status: "waiting",
      hostName: "",
      createdAt: Date.now(),
    });

    this.onMessage("offer_update", this.handleOfferUpdate.bind(this));
    this.onMessage("offer_ready", this.handleOfferReady.bind(this));
    this.onMessage("trade_confirm", this.handleTradeConfirm.bind(this));
    this.onMessage("trade_cancel", this.handleTradeCancel.bind(this));
  }

  onJoin(client: Client, options: JoinOptions): void {
    console.log("[TradeRoom] Player joined:", client.sessionId);

    if (this.state.players.size >= 2) {
      client.leave();
      return;
    }

    const player = new TradePlayerSchema();
    player.sessionId = client.sessionId;
    player.displayName = options.displayName || `Player ${this.state.players.size + 1}`;
    player.playerId = options.playerId || "";

    this.state.players.set(client.sessionId, player);
    this.offers.set(client.sessionId, { units: {}, coins: 0 });
    this.readyStates.set(client.sessionId, false);

    if (this.state.players.size === 1) {
      this.state.phase = "waiting";
      this.setMetadata({
        status: "waiting",
        hostName: player.displayName,
        createdAt: Date.now(),
      });
    }

    this.broadcast("player_joined", {
      sessionId: player.sessionId,
      displayName: player.displayName,
      playerId: player.playerId,
    });

    const allPlayers: any[] = [];
    this.state.players.forEach((p) => {
      allPlayers.push({
        sessionId: p.sessionId,
        displayName: p.displayName,
        playerId: p.playerId,
      });
    });
    client.send("all_players", { players: allPlayers });

    this.sendExistingOffers(client);
    this.broadcastReadyStates();

    if (this.state.players.size === 2) {
      this.state.phase = "trading";
      const firstPlayer = Array.from(this.state.players.values())[0];
      this.setMetadata({
        status: "trading",
        hostName: firstPlayer?.displayName || "",
        createdAt: Date.now(),
      });
      this.lock();
    }
  }

  onLeave(client: Client, consented: boolean): void {
    console.log("[TradeRoom] Player left:", client.sessionId, "consented:", consented);

    this.state.players.delete(client.sessionId);
    this.offers.delete(client.sessionId);
    this.readyStates.delete(client.sessionId);

    this.broadcast("player_left", { sessionId: client.sessionId });
    this.broadcast("offer_update", { sessionId: client.sessionId, offer: { ...EMPTY_OFFER } });

    if (this.state.players.size === 1) {
      const remaining = Array.from(this.state.players.values())[0];
      this.resetReadyStates();
      this.state.phase = "waiting";
      this.setMetadata({
        status: "waiting",
        hostName: remaining.displayName,
        createdAt: Date.now(),
      });
      this.unlock();
    }

    if (this.state.players.size === 0) {
      this.state.phase = "waiting";
      this.setMetadata({
        status: "empty",
        hostName: "",
        createdAt: Date.now(),
      });
    }
  }

  onDispose(): void {
    console.log("[TradeRoom] Room disposed");
  }

  private normalizeOffer(payload: OfferPayload): TradeOffer {
    const offer: TradeOffer = { units: {}, coins: 0 };
    const coins = typeof payload?.coins === "number" && Number.isFinite(payload.coins)
      ? Math.max(0, Math.floor(payload.coins))
      : 0;
    offer.coins = coins;

    if (payload?.units && typeof payload.units === "object") {
      Object.entries(payload.units).forEach(([unitId, count]) => {
        if (typeof count !== "number" || !Number.isFinite(count)) return;
        const nextCount = Math.max(0, Math.floor(count));
        if (nextCount > 0) {
          offer.units[unitId] = nextCount;
        }
      });
    }

    return offer;
  }

  private handleOfferUpdate(client: Client, message: OfferPayload): void {
    if (this.state.phase === "finished") return;

    const offer = this.normalizeOffer(message);
    this.offers.set(client.sessionId, offer);
    this.readyStates.set(client.sessionId, false);

    this.broadcast("offer_update", {
      sessionId: client.sessionId,
      offer,
    }, { except: client });

    this.broadcastReadyStates();
  }

  private handleOfferReady(client: Client, message: ReadyPayload): void {
    if (this.state.phase === "finished") return;

    const ready = !!message?.ready;
    this.readyStates.set(client.sessionId, ready);
    this.broadcastReadyStates();
    void this.tryCompleteTrade();
  }

  private handleTradeConfirm(client: Client): void {
    if (this.state.phase === "finished") return;
    this.readyStates.set(client.sessionId, true);
    this.broadcastReadyStates();
    void this.tryCompleteTrade();
  }

  private handleTradeCancel(client: Client, message: { reason?: string }): void {
    const reason = message?.reason || "";
    this.broadcast("trade_cancelled", { reason });

    this.clients.forEach((c) => c.leave());
    this.readyStates.clear();
    this.offers.clear();
    this.state.phase = "waiting";
    this.setMetadata({
      status: "waiting",
      hostName: "",
      createdAt: Date.now(),
    });
  }

  private async tryCompleteTrade(): Promise<void> {
    if (this.state.players.size < 2) return;
    if (this.state.phase === "finished") return;
    if (this.isSettling) return;

    let allReady = true;
    this.readyStates.forEach((ready) => {
      if (!ready) allReady = false;
    });

    if (!allReady) return;

    const players = Array.from(this.state.players.values());
    const playerA = players[0];
    const playerB = players[1];

    if (!playerA?.playerId || !playerB?.playerId) {
      this.broadcast("error", {
        code: "PLAYER_ID_REQUIRED",
        message: "Both players must be authenticated to trade",
      });
      this.resetReadyStates();
      return;
    }

    const offerA = this.offers.get(playerA.sessionId) ?? EMPTY_OFFER;
    const offerB = this.offers.get(playerB.sessionId) ?? EMPTY_OFFER;

    this.isSettling = true;
    const result = await executeTrade(playerA.playerId, playerB.playerId, offerA, offerB);
    this.isSettling = false;

    if (!result.success) {
      this.broadcast("error", {
        code: "TRADE_FAILED",
        message: result.error || "Trade failed",
      });
      this.resetReadyStates();
      return;
    }

    this.state.phase = "finished";
    this.setMetadata({
      status: "finished",
      hostName: this.getHostName(),
      createdAt: Date.now(),
    });

    this.clients.forEach((client) => {
      const player = this.state.players.get(client.sessionId);
      const payloadPlayer =
        player?.playerId === result.player_a?.player_id
          ? result.player_a
          : result.player_b;
      client.send("trade_complete", {
        result: {
          success: true,
          player: payloadPlayer,
          server_time: result.server_time,
        },
      });
    });
  }

  private getHostName(): string {
    const firstPlayer = Array.from(this.state.players.values())[0];
    return firstPlayer?.displayName || "";
  }

  private broadcastReadyStates(): void {
    this.broadcast("ready_update", { readyStates: this.getReadyStatesObject() });
  }

  private getReadyStatesObject(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    this.readyStates.forEach((ready, sessionId) => {
      result[sessionId] = ready;
    });
    return result;
  }

  private resetReadyStates(): void {
    this.readyStates.forEach((_, sessionId) => {
      this.readyStates.set(sessionId, false);
    });
    this.broadcastReadyStates();
  }

  private sendExistingOffers(client: Client): void {
    this.offers.forEach((offer, sessionId) => {
      client.send("offer_update", { sessionId, offer });
    });
  }
}
