import { Schema, MapSchema, type } from "@colyseus/schema";

export class TradePlayerSchema extends Schema {
  @type("string") sessionId: string = "";
  @type("string") displayName: string = "";
  @type("string") playerId: string = "";
}

export class TradeState extends Schema {
  @type("string") phase: string = "waiting"; // waiting | trading | finished
  @type({ map: TradePlayerSchema }) players = new MapSchema<TradePlayerSchema>();
}
