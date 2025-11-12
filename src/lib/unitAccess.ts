import { getInternalUnitOption, type AdditionalRank, type InternalUnit } from "@/lib/hr";

export type UnitPermissionLevel = 0 | 1 | 2 | 3 | 4;

export type UnitPanelDefinition = {
  unit: InternalUnit;
  slug: InternalUnit;
  title: string;
  abbreviation: string;
  navColor: string;
  caretakerRanks: AdditionalRank[];
  commanderRanks: AdditionalRank[];
  deputyRanks: AdditionalRank[];
};

function createDefinition(
  unit: InternalUnit,
  navColor: string,
  caretakerRanks: AdditionalRank[],
  commanderRanks: AdditionalRank[],
  deputyRanks: AdditionalRank[]
): UnitPanelDefinition {
  const option = getInternalUnitOption(unit);
  return {
    unit,
    slug: unit,
    title: option?.label ?? unit.toUpperCase(),
    abbreviation: option?.abbreviation ?? unit.toUpperCase(),
    navColor,
    caretakerRanks,
    commanderRanks,
    deputyRanks,
  };
}

export const UNIT_PANELS: Record<InternalUnit, UnitPanelDefinition> = {
  iad: createDefinition(
    "iad",
    "#ef4444",
    ["opiekun-iad"],
    ["iad-chief-inspector"],
    ["iad-deputy-chief-inspector"]
  ),
  "swat-sert": createDefinition(
    "swat-sert",
    "#38bdf8",
    ["opiekun-swat-sert"],
    ["swat-commander"],
    ["swat-deputy-commander"]
  ),
  usms: createDefinition(
    "usms",
    "#f59e0b",
    ["opiekun-usms"],
    ["us-marshal"],
    ["us-deputy-marshal"]
  ),
  dtu: createDefinition(
    "dtu",
    "#6366f1",
    ["opiekun-dtu"],
    ["dtu-commander"],
    ["dtu-deputy-commander"]
  ),
  gu: createDefinition(
    "gu",
    "#0ea5e9",
    ["opiekun-gu"],
    ["gu-commander"],
    ["gu-deputy-commander"]
  ),
  ftd: createDefinition(
    "ftd",
    "#c084fc",
    ["opiekun-ftd"],
    ["ftd-commander"],
    ["ftd-deputy-commander"]
  ),
};

export const UNIT_PANEL_LIST: UnitPanelDefinition[] = Object.values(UNIT_PANELS);

export function getUnitPanel(unit: string | null | undefined): UnitPanelDefinition | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase() as InternalUnit;
  return UNIT_PANELS[key] ?? null;
}

export function getUnitPermissionLevel(
  unit: InternalUnit,
  units: InternalUnit[] | null | undefined,
  additionalRanks: AdditionalRank[] | null | undefined
): UnitPermissionLevel {
  const panel = UNIT_PANELS[unit];
  if (!panel) return 0;
  const ownedUnits = new Set((units || []).map((value) => value));
  const ranks = new Set(additionalRanks || []);
  let level: UnitPermissionLevel = ownedUnits.has(unit) ? 1 : 0;
  if (panel.deputyRanks.some((rank) => ranks.has(rank))) {
    level = Math.max(level, 2);
  }
  if (panel.commanderRanks.some((rank) => ranks.has(rank))) {
    level = Math.max(level, 3);
  }
  if (panel.caretakerRanks.some((rank) => ranks.has(rank))) {
    level = Math.max(level, 4);
  }
  return level;
}

export function hasUnitAccess(
  unit: InternalUnit,
  units: InternalUnit[] | null | undefined,
  additionalRanks: AdditionalRank[] | null | undefined
): boolean {
  return getUnitPermissionLevel(unit, units, additionalRanks) > 0;
}

export function getUnitRankCategory(
  unit: InternalUnit,
  rank: AdditionalRank
): "caretaker" | "commander" | "deputy" | null {
  const panel = UNIT_PANELS[unit];
  if (!panel) return null;
  if (panel.caretakerRanks.includes(rank)) return "caretaker";
  if (panel.commanderRanks.includes(rank)) return "commander";
  if (panel.deputyRanks.includes(rank)) return "deputy";
  return null;
}

export function getAllUnitRanks(unit: InternalUnit): AdditionalRank[] {
  const panel = UNIT_PANELS[unit];
  if (!panel) return [];
  return [...panel.caretakerRanks, ...panel.commanderRanks, ...panel.deputyRanks];
}

export function filterRanksForUnit(
  unit: InternalUnit,
  ranks: AdditionalRank[] | null | undefined
): AdditionalRank[] {
  if (!Array.isArray(ranks)) return [];
  const panel = UNIT_PANELS[unit];
  if (!panel) return [];
  const allowed = new Set(getAllUnitRanks(unit));
  return ranks.filter((rank) => allowed.has(rank));
}

export function describePermissionLevel(level: UnitPermissionLevel): string {
  switch (level) {
    case 4:
      return "Opiekun";
    case 3:
      return "Commander";
    case 2:
      return "Deputy";
    case 1:
      return "Członek";
    default:
      return "Brak dostępu";
  }
}
