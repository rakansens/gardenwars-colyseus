import { createClient } from "@supabase/supabase-js";

// Supabase client for server-side operations
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Battle result interface
export interface RealtimeBattleResult {
  player1_id: string;
  player2_id: string;
  player1_name: string;
  player2_name: string;
  player1_deck: string[];
  player2_deck: string[];
  winner_player_num: 1 | 2;
  player1_castle_hp: number;
  player2_castle_hp: number;
  player1_kills: number;
  player2_kills: number;
  battle_duration: number;
  win_reason: string;
}

export interface TradeOfferPayload {
  units: Record<string, number>;
  coins: number;
}

export interface TradeExecutionResult {
  success: boolean;
  error?: string;
  player_a?: {
    player_id: string;
    coins: number;
    unit_inventory: Record<string, number>;
  };
  player_b?: {
    player_id: string;
    coins: number;
    unit_inventory: Record<string, number>;
  };
  server_time?: string;
}

/**
 * Save realtime battle result to database
 */
export async function saveRealtimeBattleResult(result: RealtimeBattleResult): Promise<{ success: boolean; error?: string }> {
  try {
    // Convert to async_battles format with battle_type = 'realtime'
    const { error } = await supabase.from("async_battles").insert({
      attacker_id: result.player1_id,
      defender_id: result.player2_id,
      attacker_deck: result.player1_deck,
      defender_deck: result.player2_deck,
      winner: result.winner_player_num === 1 ? "attacker" : "defender",
      attacker_castle_hp: result.player1_castle_hp,
      defender_castle_hp: result.player2_castle_hp,
      attacker_kills: result.player1_kills,
      defender_kills: result.player2_kills,
      battle_duration: result.battle_duration,
      battle_type: "realtime",
    });

    if (error) {
      console.error("[Supabase] Failed to save realtime battle:", error);
      return { success: false, error: error.message };
    }

    console.log("[Supabase] Realtime battle saved successfully");
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Supabase] Exception saving realtime battle:", err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Execute trade between two players (server-authoritative).
 */
export async function executeTrade(
  playerAId: string,
  playerBId: string,
  offerA: TradeOfferPayload,
  offerB: TradeOfferPayload
): Promise<TradeExecutionResult> {
  try {
    const { data, error } = await supabase.rpc("execute_trade", {
      p_player_a_id: playerAId,
      p_player_b_id: playerBId,
      p_offer_a: offerA,
      p_offer_b: offerB,
    });

    if (error) {
      console.error("[Supabase] Failed to execute trade:", error);
      return { success: false, error: error.message };
    }

    return data as TradeExecutionResult;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Supabase] Exception executing trade:", err);
    return { success: false, error: errorMsg };
  }
}
