import { Room, Client } from "@colyseus/core";
import { BattleState, PlayerSchema, UnitSchema } from "../schemas/BattleState";
import { ServerCostSystem } from "../systems/ServerCostSystem";
import { ServerCombatSystem } from "../systems/ServerCombatSystem";
import { getUnitDefinition, isValidUnit } from "../data/units";

// ============================================
// BattleRoom - リアルタイム1vs1対戦ルーム
// ============================================

// レアリティ別デフォルトスポーンクールダウン
const DEFAULT_SPAWN_COOLDOWNS: Record<string, number> = {
  'N': 2000,
  'R': 4000,
  'SR': 6000,
  'SSR': 8000,
  'UR': 10000
};

interface JoinOptions {
  odeyoId?: string;
  displayName?: string;
  deck?: string[];
  quickMatch?: boolean;  // true: クイックマッチ（自動マッチング）, false: ロビー待機
}

interface SummonMessage {
  unitId: string;
}

export class BattleRoom extends Room<BattleState> {
  private combatSystem!: ServerCombatSystem;
  private gameLoop: ReturnType<typeof setInterval> | null = null;
  private lastUpdateTime: number = 0;
  private spawnCooldowns: Map<string, Map<string, number>> = new Map(); // sessionId -> (unitId -> remaining)

  // ゲーム設定
  private readonly TICK_RATE = 20; // 20 updates per second (50ms per tick)
  private readonly COUNTDOWN_SECONDS = 3;
  private readonly STAGE_LENGTH = 1200;
  private readonly CASTLE_HP = 5000;

  onCreate(): void {
    console.log("[BattleRoom] Room created");
    this.setState(new BattleState());
    this.state.stageLength = this.STAGE_LENGTH;

    this.combatSystem = new ServerCombatSystem(this.state);

    // 初期メタデータ設定（ロビー表示用）
    this.setMetadata({
      status: 'waiting',
      hostName: '',
      hostDeckPreview: [],
      createdAt: Date.now()
    });

    // メッセージハンドラ登録
    this.onMessage("ready", this.handleReady.bind(this));
    this.onMessage("summon", this.handleSummon.bind(this));
    this.onMessage("upgrade_cost", this.handleUpgradeCost.bind(this));
  }

  onJoin(client: Client, options: JoinOptions): void {
    console.log(`[BattleRoom] Player joined: ${client.sessionId}`);

    // 2人目が来たらルームをロック
    if (this.state.players.size >= 2) {
      client.leave();
      return;
    }

    // プレイヤー作成
    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    player.odeyoId = options.odeyoId || client.sessionId;
    player.displayName = options.displayName || `Player ${this.state.players.size + 1}`;
    player.castleHp = this.CASTLE_HP;
    player.maxCastleHp = this.CASTLE_HP;

    // デッキ設定（バリデーション）
    const receivedDeck = options.deck || [];
    const validDeck = receivedDeck.filter(id => isValidUnit(id)).slice(0, 5);
    console.log(`[BattleRoom] Player deck - received: [${receivedDeck.join(', ')}], valid: [${validDeck.join(', ')}]`);
    player.deck.push(...validDeck);

    // コスト初期化
    ServerCostSystem.initialize(player);

    this.state.players.set(client.sessionId, player);

    // スポーンクールダウン初期化
    this.spawnCooldowns.set(client.sessionId, new Map());

    // 1人目の場合、メタデータ更新（ロビー表示用）
    if (this.state.players.size === 1) {
      // デッキの半分を公開（切り上げ）、残りはシークレット
      const visibleCount = Math.ceil(validDeck.length / 2);
      const deckPreview = validDeck.slice(0, visibleCount);

      this.setMetadata({
        status: 'waiting',
        hostName: player.displayName,
        hostDeckPreview: deckPreview,
        createdAt: Date.now()
      });
      console.log(`[BattleRoom] Lobby metadata set - host: ${player.displayName}, deck preview: [${deckPreview.join(', ')}]`);
    }

    // プレイヤー参加をブロードキャスト
    this.broadcast("player_joined", {
      sessionId: client.sessionId,
      odeyoId: player.odeyoId,
      displayName: player.displayName,
      cost: player.cost,
      maxCost: player.maxCost,
      costLevel: player.costLevel,
      castleHp: player.castleHp,
      maxCastleHp: player.maxCastleHp,
      ready: player.ready,
      deck: [...player.deck]
    });

    // 現在の全プレイヤー情報も送信（新規参加者向け）
    const allPlayers: any[] = [];
    this.state.players.forEach((p, sid) => {
      allPlayers.push({
        sessionId: sid,
        odeyoId: p.odeyoId,
        displayName: p.displayName,
        cost: p.cost,
        maxCost: p.maxCost,
        costLevel: p.costLevel,
        castleHp: p.castleHp,
        maxCastleHp: p.maxCastleHp,
        ready: p.ready,
        deck: [...p.deck]
      });
    });
    client.send("all_players", { players: allPlayers });

    // 2人揃ったらルームをロック
    if (this.state.players.size === 2) {
      this.lock();
      console.log("[BattleRoom] Room locked - 2 players joined");
    }
  }

  onLeave(client: Client, consented: boolean): void {
    console.log(`[BattleRoom] Player left: ${client.sessionId}, consented: ${consented}`);

    // ゲーム中なら切断側の敗北
    if (this.state.phase === 'playing' || this.state.phase === 'countdown') {
      const leavingPlayer = this.state.players.get(client.sessionId);
      if (leavingPlayer) {
        // 残ったプレイヤーの勝利
        this.state.players.forEach((player, sessionId) => {
          if (sessionId !== client.sessionId) {
            this.state.winnerId = sessionId;
            this.state.winReason = 'opponent_disconnected';
          }
        });
        this.state.phase = 'finished';
        this.stopGameLoop();
      }
    }

    this.state.players.delete(client.sessionId);
    this.spawnCooldowns.delete(client.sessionId);
  }

  onDispose(): void {
    console.log("[BattleRoom] Room disposed");
    this.stopGameLoop();
  }

  // ============================================
  // Message Handlers
  // ============================================

  private handleReady(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.ready = true;
    console.log(`[BattleRoom] Player ready: ${client.sessionId}`);

    // 両者準備完了でカウントダウン開始
    let allReady = true;
    this.state.players.forEach(p => {
      if (!p.ready) allReady = false;
    });

    if (allReady && this.state.players.size === 2 && this.state.phase === 'waiting') {
      this.startCountdown();
    }
  }

  private handleSummon(client: Client, message: SummonMessage): void {
    if (this.state.phase !== 'playing') {
      this.sendError(client, 'GAME_NOT_PLAYING', 'Game is not in playing phase');
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const { unitId } = message;

    // ユニット存在チェック
    const definition = getUnitDefinition(unitId);
    if (!definition) {
      this.sendError(client, 'INVALID_UNIT', `Unknown unit: ${unitId}`);
      return;
    }

    // デッキにあるかチェック
    if (!player.deck.includes(unitId)) {
      this.sendError(client, 'UNIT_NOT_IN_DECK', `Unit not in deck: ${unitId}`);
      return;
    }

    // スポーンクールダウンチェック
    const cooldowns = this.spawnCooldowns.get(client.sessionId);
    if (cooldowns) {
      const remaining = cooldowns.get(unitId) || 0;
      if (remaining > 0) {
        this.sendError(client, 'COOLDOWN', `Spawn cooldown remaining: ${remaining}ms`);
        return;
      }
    }

    // コストチェック
    if (!ServerCostSystem.canAfford(player, definition.cost)) {
      this.sendError(client, 'INSUFFICIENT_COST', `Not enough cost: ${player.cost} < ${definition.cost}`);
      return;
    }

    // コスト消費
    ServerCostSystem.spend(player, definition.cost);

    // ユニット召喚
    const instanceId = this.combatSystem.spawnUnit(player, unitId);
    if (!instanceId) {
      this.sendError(client, 'SPAWN_FAILED', 'Failed to spawn unit');
      return;
    }

    // スポーンクールダウン設定
    if (cooldowns) {
      const cooldownMs = definition.spawnCooldownMs || DEFAULT_SPAWN_COOLDOWNS[definition.rarity] || 3000;
      cooldowns.set(unitId, cooldownMs);
    }

    // ユニット召喚をブロードキャスト
    const unit = this.state.units.get(instanceId);
    if (unit) {
      this.broadcast("unit_spawned", {
        instanceId: unit.instanceId,
        definitionId: unit.definitionId,
        side: unit.side,
        x: unit.x,
        hp: unit.hp,
        maxHp: unit.maxHp,
        state: unit.state,
        stateTimer: unit.stateTimer,
        targetId: unit.targetId
      });
    }

    console.log(`[BattleRoom] Unit spawned: ${unitId} by ${client.sessionId}`);
  }

  private handleUpgradeCost(client: Client): void {
    if (this.state.phase !== 'playing') {
      this.sendError(client, 'GAME_NOT_PLAYING', 'Game is not in playing phase');
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (!ServerCostSystem.canUpgrade(player)) {
      const upgradeCost = ServerCostSystem.getUpgradeCost(player);
      this.sendError(client, 'CANNOT_UPGRADE', `Cannot upgrade: cost=${player.cost}, needed=${upgradeCost}`);
      return;
    }

    if (ServerCostSystem.upgradeMax(player)) {
      console.log(`[BattleRoom] Cost upgraded: ${client.sessionId} -> level ${player.costLevel}`);
    }
  }

  // ============================================
  // Game Loop
  // ============================================

  private startCountdown(): void {
    console.log("[BattleRoom] Countdown started");
    this.state.phase = 'countdown';
    this.state.countdown = this.COUNTDOWN_SECONDS;

    // フェーズ変更をブロードキャスト
    this.broadcast("phase_change", { phase: 'countdown', countdown: this.COUNTDOWN_SECONDS });

    const countdownInterval = setInterval(() => {
      this.state.countdown--;
      console.log(`[BattleRoom] Countdown: ${this.state.countdown}`);

      // カウントダウン更新をブロードキャスト
      this.broadcast("countdown_update", { countdown: this.state.countdown });

      if (this.state.countdown <= 0) {
        clearInterval(countdownInterval);
        this.startGame();
      }
    }, 1000);
  }

  private startGame(): void {
    console.log("[BattleRoom] Game started");
    this.state.phase = 'playing';
    this.state.gameTime = 0;
    this.lastUpdateTime = Date.now();

    // メタデータ更新（ロビーから非表示に）
    this.setMetadata({ status: 'playing' });

    // フェーズ変更をブロードキャスト
    this.broadcast("phase_change", { phase: 'playing' });

    this.gameLoop = setInterval(() => {
      this.tick();
    }, 1000 / this.TICK_RATE);
  }

  private tick(): void {
    const now = Date.now();
    const deltaMs = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    this.state.gameTime += deltaMs;

    // コスト回復
    this.state.players.forEach(player => {
      ServerCostSystem.update(player, deltaMs);
    });

    // スポーンクールダウン更新
    this.spawnCooldowns.forEach(cooldowns => {
      cooldowns.forEach((remaining, unitId) => {
        const newRemaining = Math.max(0, remaining - deltaMs);
        cooldowns.set(unitId, newRemaining);
      });
    });

    // 戦闘更新
    this.combatSystem.update(deltaMs);

    // ユニット状態をブロードキャスト（毎ティック）
    const unitsArray: any[] = [];
    this.state.units.forEach((unit) => {
      unitsArray.push({
        instanceId: unit.instanceId,
        definitionId: unit.definitionId,
        side: unit.side,
        x: unit.x,
        hp: unit.hp,
        maxHp: unit.maxHp,
        state: unit.state,
        stateTimer: unit.stateTimer,
        targetId: unit.targetId
      });
    });
    this.broadcast("units_sync", { units: unitsArray });

    // プレイヤー状態をブロードキャスト（コスト更新など）
    const playersArray: any[] = [];
    this.state.players.forEach((player, sid) => {
      playersArray.push({
        sessionId: sid,
        cost: player.cost,
        maxCost: player.maxCost,
        costLevel: player.costLevel,
        castleHp: player.castleHp,
        maxCastleHp: player.maxCastleHp
      });
    });
    this.broadcast("players_sync", { players: playersArray });

    // ゲーム終了チェック
    if (this.state.phase === 'finished') {
      this.stopGameLoop();
      console.log(`[BattleRoom] Game finished - Winner: ${this.state.winnerId}, Reason: ${this.state.winReason}`);
      // ゲーム終了をブロードキャスト
      this.broadcast("phase_change", {
        phase: 'finished',
        winnerId: this.state.winnerId,
        winReason: this.state.winReason
      });
    }
  }

  private stopGameLoop(): void {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private sendError(client: Client, code: string, message: string): void {
    client.send("error", { code, message });
  }
}
