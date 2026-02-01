import { Schema, MapSchema, type } from "@colyseus/schema";

// ============================================
// Unit Schema - 各ユニットの状態
// ============================================
export class UnitSchema extends Schema {
    @type("string") instanceId: string = "";
    @type("string") definitionId: string = "";
    @type("string") side: string = "";  // "player1" | "player2"
    @type("number") x: number = 0;
    @type("number") hp: number = 0;
    @type("number") maxHp: number = 0;
    @type("string") state: string = "SPAWN";  // SPAWN | WALK | ATTACK_WINDUP | ATTACK_COOLDOWN | HITSTUN | DIE
    @type("number") stateTimer: number = 0;
    @type("string") targetId: string = "";  // ターゲットのinstanceId
}

// ============================================
// Player Schema - 各プレイヤーの状態
// ============================================
export class PlayerSchema extends Schema {
    @type("string") odeyoId: string = "";      // ゲーム内ID
    @type("string") sessionId: string = "";    // Colyseusセッション
    @type("string") displayName: string = "";  // 表示名
    @type("number") cost: number = 200;        // 現在コスト（初期値200）
    @type("number") maxCost: number = 1000;    // 最大コスト（レベル1=1000）
    @type("number") costLevel: number = 1;     // コストレベル（1-8）
    @type("number") castleHp: number = 5000;   // 城HP
    @type("number") maxCastleHp: number = 5000;
    @type("boolean") ready: boolean = false;   // 準備完了フラグ
    @type(["string"]) deck: string[] = [];     // デッキ（ユニットID配列）
}

// ============================================
// Battle State - ルーム全体の状態
// ============================================
export class BattleState extends Schema {
    @type("string") phase: string = "waiting";  // waiting | countdown | playing | finished
    @type("number") gameTime: number = 0;       // ゲーム経過時間（ms）
    @type("number") countdown: number = 3;      // カウントダウン残り秒数
    @type("number") stageLength: number = 1200; // ステージ長（px）
    @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
    @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();
    @type("string") winnerId: string = "";      // 勝者のsessionId
    @type("string") winReason: string = "";     // 勝利理由
}
