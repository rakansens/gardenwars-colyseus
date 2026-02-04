import type { UnitState, ServerUnit } from "../data/types";
import { UnitSchema, PlayerSchema, BattleState } from "../schemas/BattleState";
import { getUnitDefinition } from "../data/units";
import { MapSchema } from "@colyseus/schema";

// ============================================
// ServerCombatSystem - サーバー側戦闘ロジック
// ============================================

// プレイヤーの城位置
const CASTLE_POSITIONS = {
  player1: 80,   // 左側
  player2: 1120  // 右側（stageLength - 80）
};

// ユニット衝突判定用定数
const DEFAULT_UNIT_WIDTH = 60;  // 基本幅
const UNIT_MIN_DISTANCE = 30;   // ユニット間の最小距離

export class ServerCombatSystem {
  private state: BattleState;
  private serverUnits: Map<string, ServerUnit> = new Map();
  private killCounts: Map<string, number> = new Map(); // sessionId -> kills

  constructor(state: BattleState) {
    this.state = state;
  }

  /**
   * Get kill count for a player
   */
  getKillCount(sessionId: string): number {
    return this.killCounts.get(sessionId) || 0;
  }

  /**
   * ユニット召喚
   */
  spawnUnit(player: PlayerSchema, unitId: string): string | null {
    const definition = getUnitDefinition(unitId);
    if (!definition) {
      console.warn(`[CombatSystem] Unknown unit: ${unitId}`);
      return null;
    }

    const side = this.getPlayerSide(player.sessionId);
    if (!side) return null;

    // スポーン位置（城の近く）
    const spawnX = side === 'player1'
      ? CASTLE_POSITIONS.player1 + 50
      : CASTLE_POSITIONS.player2 - 50;

    const instanceId = `${side}_${unitId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // ユニット幅を計算（scaleがあれば適用）
    const scale = (definition as any).scale || 1.0;
    const unitWidth = DEFAULT_UNIT_WIDTH * scale;

    // サーバー内部データ
    const serverUnit: ServerUnit = {
      instanceId,
      definitionId: unitId,
      definition,
      side,
      x: spawnX,
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      state: 'SPAWN',
      stateTimer: 0,
      targetId: null,
      damageAccumulated: 0,
      width: unitWidth
    };
    this.serverUnits.set(instanceId, serverUnit);

    // スキーマに追加（クライアントに同期）
    const unitSchema = new UnitSchema();
    unitSchema.instanceId = instanceId;
    unitSchema.definitionId = unitId;
    unitSchema.side = side;
    unitSchema.x = spawnX;
    unitSchema.hp = definition.maxHp;
    unitSchema.maxHp = definition.maxHp;
    unitSchema.state = 'SPAWN';
    unitSchema.stateTimer = 0;
    unitSchema.targetId = '';
    unitSchema.width = unitWidth;
    this.state.units.set(instanceId, unitSchema);

    return instanceId;
  }

  /**
   * 毎フレーム更新
   */
  update(deltaMs: number): void {
    // 全ユニット更新
    for (const [instanceId, serverUnit] of this.serverUnits) {
      serverUnit.stateTimer += deltaMs;
      if (serverUnit.state !== 'DIE') {
        this.updateUnitState(serverUnit, deltaMs);
      }

      // スキーマ同期
      const schema = this.state.units.get(instanceId);
      if (schema) {
        schema.x = serverUnit.x;
        schema.hp = serverUnit.hp;
        schema.state = serverUnit.state;
        schema.stateTimer = serverUnit.stateTimer;
        schema.targetId = serverUnit.targetId || '';
        schema.width = serverUnit.width;
      }
    }

    // ユニット衝突判定（すり抜け防止）
    this.resolveUnitCollisions();

    // ターゲット割り当て
    this.assignTargets();

    // 死亡ユニット削除
    this.cleanupDeadUnits();

    // 勝敗判定
    this.checkWinCondition();
  }

  /**
   * ユニット状態更新
   */
  private updateUnitState(unit: ServerUnit, deltaMs: number): void {
    switch (unit.state) {
      case 'SPAWN':
        this.handleSpawn(unit);
        break;
      case 'WALK':
        this.handleWalk(unit, deltaMs);
        break;
      case 'ATTACK_WINDUP':
        this.handleAttackWindup(unit);
        break;
      case 'ATTACK_COOLDOWN':
        this.handleAttackCooldown(unit);
        break;
      case 'HITSTUN':
        this.handleHitstun(unit);
        break;
    }
  }

  private handleSpawn(unit: ServerUnit): void {
    if (unit.stateTimer >= 300) {
      this.setUnitState(unit, 'WALK');
    }
  }

  private handleWalk(unit: ServerUnit, deltaMs: number): void {
    const target = unit.targetId ? this.serverUnits.get(unit.targetId) : null;

    // ターゲットが射程内なら攻撃
    if (target && this.isInRange(unit, target)) {
      this.setUnitState(unit, 'ATTACK_WINDUP');
      return;
    }

    // 城が射程内なら攻撃
    if (this.isInRangeOfEnemyCastle(unit)) {
      this.setUnitState(unit, 'ATTACK_WINDUP');
      return;
    }

    // 敵ユニットが前方にいて近すぎる場合は停止
    if (this.isBlockedByEnemy(unit)) {
      return;  // 移動しない
    }

    // 前進
    const speed = unit.definition.speed * (deltaMs / 1000);
    const direction = unit.side === 'player1' ? 1 : -1;
    unit.x += speed * direction;

    // 城との衝突防止
    if (unit.side === 'player1') {
      unit.x = Math.min(unit.x, this.state.stageLength - 30);
    } else {
      unit.x = Math.max(unit.x, 80);
    }
  }

  /**
   * 敵ユニットにブロックされているかチェック
   */
  private isBlockedByEnemy(unit: ServerUnit): boolean {
    const enemySide = unit.side === 'player1' ? 'player2' : 'player1';
    const isMovingRight = unit.side === 'player1';

    for (const [, enemy] of this.serverUnits) {
      if (enemy.side !== enemySide || enemy.state === 'DIE') continue;

      // 前方にいるかチェック
      const isInFront = isMovingRight ? enemy.x > unit.x : enemy.x < unit.x;
      if (!isInFront) continue;

      // エッジベースの距離計算
      const distanceToEdge = this.getEdgeDistance(unit, enemy);
      const minDistance = (unit.width + enemy.width) / 2 * 0.5 + UNIT_MIN_DISTANCE;

      if (distanceToEdge < minDistance) {
        return true;  // ブロックされている
      }
    }

    return false;
  }

  private handleAttackWindup(unit: ServerUnit): void {
    if (unit.stateTimer >= unit.definition.attackWindupMs) {
      this.dealDamage(unit);
      this.setUnitState(unit, 'ATTACK_COOLDOWN');
    }
  }

  private handleAttackCooldown(unit: ServerUnit): void {
    if (unit.stateTimer >= unit.definition.attackCooldownMs) {
      const target = unit.targetId ? this.serverUnits.get(unit.targetId) : null;

      // ターゲットが有効で射程内なら再攻撃
      if (target && target.state !== 'DIE' && this.isInRange(unit, target)) {
        this.setUnitState(unit, 'ATTACK_WINDUP');
      } else if (this.isInRangeOfEnemyCastle(unit)) {
        this.setUnitState(unit, 'ATTACK_WINDUP');
      } else {
        unit.targetId = null;
        this.setUnitState(unit, 'WALK');
      }
    }
  }

  private handleHitstun(unit: ServerUnit): void {
    if (unit.stateTimer >= 200) {
      this.setUnitState(unit, 'WALK');
    }
  }

  private setUnitState(unit: ServerUnit, state: UnitState): void {
    unit.state = state;
    unit.stateTimer = 0;
  }

  /**
   * ダメージ処理
   */
  private dealDamage(attacker: ServerUnit): void {
    const target = attacker.targetId ? this.serverUnits.get(attacker.targetId) : null;

    if (target && target.state !== 'DIE') {
      this.applyDamage(target, attacker.definition.attackDamage, attacker.definition.knockback, attacker.side);
      return;
    }

    // 城への攻撃
    const enemySide = attacker.side === 'player1' ? 'player2' : 'player1';
    const enemyPlayer = this.getPlayerBySide(enemySide);
    if (enemyPlayer && this.isInRangeOfEnemyCastle(attacker)) {
      enemyPlayer.castleHp -= attacker.definition.attackDamage;
      if (enemyPlayer.castleHp < 0) enemyPlayer.castleHp = 0;
    }
  }

  private applyDamage(target: ServerUnit, damage: number, knockback: number, attackerSide?: 'player1' | 'player2'): void {
    target.hp -= damage;
    target.damageAccumulated += damage;

    if (target.hp <= 0) {
      target.hp = 0;
      this.setUnitState(target, 'DIE');

      // Track kill count for the attacker
      if (attackerSide) {
        const attackerSessionId = this.getSessionIdBySide(attackerSide);
        if (attackerSessionId) {
          const currentKills = this.killCounts.get(attackerSessionId) || 0;
          this.killCounts.set(attackerSessionId, currentKills + 1);
        }
      }
      return;
    }

    // ノックバック判定（最大HPの15%を超えたら発生）
    const kbThreshold = target.maxHp * 0.15;
    if (!target.definition.isBoss && target.damageAccumulated >= kbThreshold) {
      target.damageAccumulated = 0;
      const knockbackDir = target.side === 'player1' ? -1 : 1;
      target.x += knockback * knockbackDir;

      // 位置クランプ
      if (target.side === 'player1') {
        target.x = Math.max(target.x, 80);
      } else {
        target.x = Math.min(target.x, this.state.stageLength - 30);
      }

      if (target.state !== 'DIE') {
        this.setUnitState(target, 'HITSTUN');
      }
    }
  }

  /**
   * ターゲット割り当て
   */
  private assignTargets(): void {
    for (const [, unit] of this.serverUnits) {
      if (unit.state === 'DIE') continue;

      // 既存ターゲットが有効なら維持
      const currentTarget = unit.targetId ? this.serverUnits.get(unit.targetId) : null;
      if (currentTarget && currentTarget.state !== 'DIE' && this.isInRange(unit, currentTarget)) {
        continue;
      }

      // 新しいターゲットを探す
      unit.targetId = this.findTarget(unit);
    }
  }

  private findTarget(attacker: ServerUnit): string | null {
    const enemySide = attacker.side === 'player1' ? 'player2' : 'player1';
    let closestInFront: ServerUnit | null = null;
    let minDistanceFront = Infinity;
    let closestAny: ServerUnit | null = null;
    let minDistanceAny = Infinity;

    for (const [, unit] of this.serverUnits) {
      if (unit.side !== enemySide || unit.state === 'DIE') continue;

      // エッジベースの距離計算
      const edgeDistance = this.getEdgeDistance(attacker, unit);

      // 射程チェック（少し余裕を持って探索）
      if (edgeDistance > attacker.definition.attackRange + 20) continue;

      // 前方にいるか
      const isInFront = attacker.side === 'player1'
        ? unit.x > attacker.x
        : unit.x < attacker.x;

      if (isInFront && edgeDistance < minDistanceFront) {
        minDistanceFront = edgeDistance;
        closestInFront = unit;
      }

      // 全方向で最も近い敵も記録（バックアップ）
      if (edgeDistance < minDistanceAny) {
        minDistanceAny = edgeDistance;
        closestAny = unit;
      }
    }

    // 前方優先、なければ最も近い敵
    return closestInFront?.instanceId ?? closestAny?.instanceId ?? null;
  }

  /**
   * エッジベースの距離計算（ユニットの端と端の距離）
   */
  private getEdgeDistance(unitA: ServerUnit, unitB: ServerUnit): number {
    const xA = unitA.x;
    const xB = unitB.x;
    const halfWidthA = unitA.width / 2;
    const halfWidthB = unitB.width / 2;

    if (xA < xB) {
      // Aが左、Bが右：Aの右端とBの左端の距離
      return (xB - halfWidthB) - (xA + halfWidthA);
    } else {
      // Aが右、Bが左：Aの左端とBの右端の距離
      return (xA - halfWidthA) - (xB + halfWidthB);
    }
  }

  /**
   * 射程チェック（エッジベース）
   */
  private isInRange(attacker: ServerUnit, target: ServerUnit): boolean {
    const edgeDistance = this.getEdgeDistance(attacker, target);
    // エッジ距離が射程以下なら射程内
    return edgeDistance <= attacker.definition.attackRange;
  }

  private isInRangeOfEnemyCastle(unit: ServerUnit): boolean {
    const enemyCastleX = unit.side === 'player1'
      ? CASTLE_POSITIONS.player2
      : CASTLE_POSITIONS.player1;
    // ユニットの端から城までの距離
    const halfWidth = unit.width / 2;
    const edgeX = unit.side === 'player1' ? unit.x + halfWidth : unit.x - halfWidth;
    const distance = Math.abs(edgeX - enemyCastleX);
    return distance <= unit.definition.attackRange;
  }

  /**
   * ユニット衝突判定と位置補正
   */
  private resolveUnitCollisions(): void {
    const units = Array.from(this.serverUnits.values()).filter(u => u.state !== 'DIE');

    // 同陣営のユニット同士の衝突（重なり防止）
    for (let i = 0; i < units.length; i++) {
      const unitA = units[i];

      for (let j = i + 1; j < units.length; j++) {
        const unitB = units[j];

        // 同じ陣営同士のみ押し出し
        if (unitA.side !== unitB.side) continue;

        const distance = Math.abs(unitA.x - unitB.x);
        const minDistance = (unitA.width + unitB.width) / 2 * 0.6 + UNIT_MIN_DISTANCE;

        if (distance < minDistance && distance > 0) {
          const overlap = minDistance - distance;
          const pushAmount = overlap * 0.5;

          if (unitA.x < unitB.x) {
            unitA.x -= pushAmount / 2;
            unitB.x += pushAmount / 2;
          } else {
            unitA.x += pushAmount / 2;
            unitB.x -= pushAmount / 2;
          }

          // 境界チェック
          this.clampUnitPosition(unitA);
          this.clampUnitPosition(unitB);
        }
      }
    }
  }

  /**
   * ユニット位置を境界内に制限
   */
  private clampUnitPosition(unit: ServerUnit): void {
    if (unit.side === 'player1') {
      unit.x = Math.max(unit.x, CASTLE_POSITIONS.player1 + 30);
      unit.x = Math.min(unit.x, this.state.stageLength - 30);
    } else {
      unit.x = Math.max(unit.x, 80);
      unit.x = Math.min(unit.x, CASTLE_POSITIONS.player2 - 30);
    }
  }

  /**
   * 死亡ユニット削除
   */
  private cleanupDeadUnits(): void {
    const toRemove: string[] = [];

    for (const [instanceId, unit] of this.serverUnits) {
      if (unit.state === 'DIE' && unit.stateTimer >= 500) {
        toRemove.push(instanceId);
      }
    }

    for (const instanceId of toRemove) {
      this.serverUnits.delete(instanceId);
      this.state.units.delete(instanceId);
    }
  }

  /**
   * 勝敗判定
   */
  private checkWinCondition(): void {
    if (this.state.phase !== 'playing') return;

    let player1: PlayerSchema | undefined;
    let player2: PlayerSchema | undefined;

    this.state.players.forEach((player, sessionId) => {
      const side = this.getPlayerSide(sessionId);
      if (side === 'player1') player1 = player;
      if (side === 'player2') player2 = player;
    });

    if (!player1 || !player2) return;

    if (player1.castleHp <= 0) {
      this.state.phase = 'finished';
      this.state.winnerId = player2.sessionId;
      this.state.winReason = 'castle_destroyed';
    } else if (player2.castleHp <= 0) {
      this.state.phase = 'finished';
      this.state.winnerId = player1.sessionId;
      this.state.winReason = 'castle_destroyed';
    }
  }

  /**
   * ヘルパー
   */
  private getPlayerSide(sessionId: string): 'player1' | 'player2' | null {
    const playerIds = Array.from(this.state.players.keys());
    const index = playerIds.indexOf(sessionId);
    if (index === 0) return 'player1';
    if (index === 1) return 'player2';
    return null;
  }

  private getPlayerBySide(side: 'player1' | 'player2'): PlayerSchema | undefined {
    const playerIds = Array.from(this.state.players.keys());
    const sessionId = side === 'player1' ? playerIds[0] : playerIds[1];
    return sessionId ? this.state.players.get(sessionId) : undefined;
  }

  private getSessionIdBySide(side: 'player1' | 'player2'): string | undefined {
    const playerIds = Array.from(this.state.players.keys());
    return side === 'player1' ? playerIds[0] : playerIds[1];
  }

  /**
   * リセット
   */
  reset(): void {
    this.serverUnits.clear();
    this.state.units.clear();
    this.killCounts.clear();
  }
}
