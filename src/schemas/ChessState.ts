import { Schema, MapSchema, type } from "@colyseus/schema";

// ============================================
// Chess Player Schema
// ============================================
export class ChessPlayerSchema extends Schema {
  @type("string") sessionId: string = "";
  @type("string") displayName: string = "";
  @type("string") side: string = ""; // "w" | "b"
}

// ============================================
// Chess State - ルーム全体の状態
// ============================================
export class ChessState extends Schema {
  @type("string") phase: string = "waiting"; // waiting | playing | finished
  @type("string") turn: string = "w"; // w | b
  @type({ map: ChessPlayerSchema }) players = new MapSchema<ChessPlayerSchema>();
  @type("string") winnerSide: string = "";
  @type("string") winReason: string = "";
}
