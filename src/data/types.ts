// ============================================
// Garden Wars Server - Type Definitions
// ============================================

/**
 * レアリティ
 */
export type Rarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

/**
 * ユニット定義（マスターデータ）
 */
export interface UnitDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  cost: number;
  maxHp: number;
  speed: number;              // pixels per second
  attackDamage: number;
  attackRange: number;        // pixels
  attackCooldownMs: number;   // 攻撃後のクールダウン時間
  attackWindupMs: number;     // ダメージ発生までのモーション時間
  spawnCooldownMs?: number;   // 召喚クールダウン時間
  knockback: number;          // 与えるノックバック距離
  isBoss?: boolean;
  isFlying?: boolean;
}

/**
 * ユニット状態（状態機械）
 */
export type UnitState =
  | 'SPAWN'
  | 'WALK'
  | 'ATTACK_WINDUP'
  | 'ATTACK_COOLDOWN'
  | 'HITSTUN'
  | 'DIE';

/**
 * コストシステム設定
 */
export interface CostConfig {
  maxLevels: number[];        // [5, 6, 7, 8, 9, 10]
  upgradeCosts: number[];     // [1, 2, 3, 4, 5]
  regenRates: number[];       // [0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
}

/**
 * サーバー側ユニットデータ（ランタイム）
 */
export interface ServerUnit {
  instanceId: string;
  definitionId: string;
  definition: UnitDefinition;
  side: 'player1' | 'player2';
  x: number;
  hp: number;
  maxHp: number;
  state: UnitState;
  stateTimer: number;
  targetId: string | null;
  damageAccumulated: number;
}

/**
 * プレイヤーデータ（サーバー側）
 */
export interface ServerPlayer {
  sessionId: string;
  odeyoId: string;
  displayName: string;
  cost: number;
  maxCost: number;
  costLevel: number;
  castleHp: number;
  maxCastleHp: number;
  deck: string[];
  spawnCooldowns: Map<string, number>;  // unitId -> remaining cooldown
}
