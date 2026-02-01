import type { CostConfig } from "../data/types";
import type { PlayerSchema } from "../schemas/BattleState";

// ============================================
// ServerCostSystem - サーバー側コスト管理
// ============================================

// コストシステム設定（BattleSceneと同じ値）
const COST_CONFIG: CostConfig = {
  maxLevels: [1000, 2500, 4500, 7000, 10000, 15000, 25000, 99999],
  upgradeCosts: [500, 1200, 2500, 4500, 8000, 12000, 20000],
  regenRates: [100, 150, 250, 400, 600, 900, 1500, 2500]  // per second
};

// 初期コスト値
const INITIAL_COST = 200;

export class ServerCostSystem {

  /**
   * コスト回復（毎フレーム呼び出し）
   */
  static update(player: PlayerSchema, deltaMs: number): void {
    const levelIndex = player.costLevel - 1;
    const regenRate = COST_CONFIG.regenRates[levelIndex] ?? COST_CONFIG.regenRates[0];
    const regen = regenRate * (deltaMs / 1000);
    player.cost = Math.min(player.cost + regen, player.maxCost);
  }

  /**
   * コスト消費
   */
  static spend(player: PlayerSchema, amount: number): boolean {
    if (player.cost >= amount) {
      player.cost -= amount;
      return true;
    }
    return false;
  }

  /**
   * コストが足りるかチェック
   */
  static canAfford(player: PlayerSchema, amount: number): boolean {
    return player.cost >= amount;
  }

  /**
   * コスト上限アップグレード
   */
  static upgradeMax(player: PlayerSchema): boolean {
    const levelIndex = player.costLevel - 1;

    // 最大レベルチェック
    if (levelIndex >= COST_CONFIG.maxLevels.length - 1) {
      return false;
    }

    // アップグレードコスト取得
    const upgradeCost = COST_CONFIG.upgradeCosts[levelIndex];
    if (upgradeCost === undefined) {
      return false;
    }

    // コスト足りるかチェック
    if (player.cost < upgradeCost) {
      return false;
    }

    // アップグレード実行
    player.cost -= upgradeCost;
    player.costLevel += 1;
    player.maxCost = COST_CONFIG.maxLevels[player.costLevel - 1];

    return true;
  }

  /**
   * アップグレード可能かチェック
   */
  static canUpgrade(player: PlayerSchema): boolean {
    const levelIndex = player.costLevel - 1;
    if (levelIndex >= COST_CONFIG.maxLevels.length - 1) {
      return false;
    }
    const upgradeCost = COST_CONFIG.upgradeCosts[levelIndex];
    return upgradeCost !== undefined && player.cost >= upgradeCost;
  }

  /**
   * 次のアップグレードコストを取得
   */
  static getUpgradeCost(player: PlayerSchema): number | null {
    const levelIndex = player.costLevel - 1;
    if (levelIndex >= COST_CONFIG.upgradeCosts.length) {
      return null;
    }
    return COST_CONFIG.upgradeCosts[levelIndex] ?? null;
  }

  /**
   * プレイヤーのコスト状態を初期化
   */
  static initialize(player: PlayerSchema): void {
    player.cost = INITIAL_COST;
    player.maxCost = COST_CONFIG.maxLevels[0];
    player.costLevel = 1;
  }
}
