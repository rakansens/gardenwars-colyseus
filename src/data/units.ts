import type { UnitDefinition } from "./types";
import alliesData from "./allies.json";

// ============================================
// Unit Definitions for Realtime Battle
// ============================================
// Synced from client: src/data/units/allies.json

export const allies = alliesData as UnitDefinition[];

// All units map for quick lookup
const unitsMap = new Map<string, UnitDefinition>();
allies.forEach(unit => unitsMap.set(unit.id, unit));

export function getUnitDefinition(unitId: string): UnitDefinition | undefined {
  return unitsMap.get(unitId);
}

export function isValidUnit(unitId: string): boolean {
  return unitsMap.has(unitId);
}
