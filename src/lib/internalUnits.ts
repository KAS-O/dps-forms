import { getAdditionalRankOption, getInternalUnitOption, type AdditionalRank, type InternalUnit } from "@/lib/hr";

export type UnitSectionConfig = {
  unit: InternalUnit;
  href: string;
  label: string;
  shortLabel: string;
  navColor: string;
  rankHierarchy: AdditionalRank[];
};

const BASE_UNIT_CONFIG: Record<InternalUnit, { navColor: string; rankHierarchy: AdditionalRank[] }> = {
  iad: {
    navColor: "#ef4444",
    rankHierarchy: ["opiekun-iad", "iad-chief-inspector", "iad-deputy-chief-inspector"],
  },
  "swat-sert": {
    navColor: "#64748b",
    rankHierarchy: ["opiekun-swat-sert", "swat-commander", "swat-deputy-commander"],
  },
  usms: {
    navColor: "#eab308",
    rankHierarchy: ["opiekun-usms", "us-marshal"],
  },
  dtu: {
    navColor: "#22d3ee",
    rankHierarchy: ["opiekun-dtu", "dtu-commander", "dtu-deputy-commander"],
  },
  gu: {
    navColor: "#10b981",
    rankHierarchy: ["opiekun-gu", "gu-commander", "gu-deputy-commander"],
  },
  ftd: {
    navColor: "#6366f1",
    rankHierarchy: ["opiekun-ftd", "ftd-commander", "ftd-deputy-commander"],
  },
};

export const UNIT_SECTIONS: UnitSectionConfig[] = (Object.keys(BASE_UNIT_CONFIG) as InternalUnit[]).map((unit) => {
  const option = getInternalUnitOption(unit);
  const config = BASE_UNIT_CONFIG[unit];
  return {
    unit,
    href: `/units/${unit}`,
    label: option?.label || option?.abbreviation || unit.toUpperCase(),
    shortLabel: option?.shortLabel || option?.abbreviation || unit.toUpperCase(),
    navColor: config.navColor,
    rankHierarchy: config.rankHierarchy.slice(),
  };
});

const UNIT_CONFIG_MAP = new Map<InternalUnit, UnitSectionConfig>(UNIT_SECTIONS.map((section) => [section.unit, section]));

export function getUnitSection(unit: InternalUnit): UnitSectionConfig | null {
  return UNIT_CONFIG_MAP.get(unit) || null;
}

export function unitHasAccess(unit: InternalUnit, ranks: AdditionalRank[] | null | undefined): boolean {
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return false;
  }
  const config = UNIT_CONFIG_MAP.get(unit);
  if (!config) {
    return false;
  }
  const rankSet = new Set(ranks);
  return config.rankHierarchy.some((rank) => rankSet.has(rank));
}

export type UnitPermission = {
  unit: InternalUnit;
  highestRank: AdditionalRank;
  manageableRanks: AdditionalRank[];
};

export function resolveUnitPermission(unit: InternalUnit, ranks: AdditionalRank[] | null | undefined): UnitPermission | null {
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return null;
  }
  const config = UNIT_CONFIG_MAP.get(unit);
  if (!config) {
    return null;
  }
  const rankSet = new Set(ranks);
  for (let index = 0; index < config.rankHierarchy.length; index += 1) {
    const rank = config.rankHierarchy[index];
    if (rankSet.has(rank)) {
      return {
        unit,
        highestRank: rank,
        manageableRanks: config.rankHierarchy.slice(index + 1),
      };
    }
  }
  return null;
}

export function formatManageableRankList(ranks: AdditionalRank[]): string {
  if (!ranks.length) {
    return "";
  }
  const labels = ranks
    .map((rank) => getAdditionalRankOption(rank)?.label)
    .filter((label): label is string => !!label);
  if (!labels.length) {
    return "";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return `${labels.slice(0, -1).join(", ")} i ${labels[labels.length - 1]}`;
}
