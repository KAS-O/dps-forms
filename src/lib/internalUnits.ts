import { getAdditionalRankOption, getInternalUnitOption, type AdditionalRank, type InternalUnit } from "@/lib/hr";
import { isHighCommand, type Role } from "@/lib/roles";

export type UnitSectionConfig = {
  unit: InternalUnit;
  href: string;
  label: string;
  shortLabel: string;
  navColor: string;
  membershipRank: AdditionalRank;
  managementRanks: AdditionalRank[];
  rankHierarchy: AdditionalRank[];
  icon: string;
};

const BASE_UNIT_CONFIG: Record<InternalUnit, {
  navColor: string;
  membershipRank: AdditionalRank;
  managementRanks: AdditionalRank[];
  iconName: string;
}> = {
  iad: {
    navColor: "#ef4444",
    membershipRank: "iad",
    managementRanks: ["opiekun-iad", "iad-chief-inspector", "iad-deputy-chief-inspector"],
    iconName: "iad.png",
  },
  "swat-sert": {
    navColor: "#64748b",
    membershipRank: "swat-sert",
    managementRanks: ["opiekun-swat-sert", "swat-commander", "swat-deputy-commander"],
    iconName: "swat-sert.png",
  },
  usms: {
    navColor: "#eab308",
    membershipRank: "usms",
    managementRanks: ["opiekun-usms", "us-marshal"],
    iconName: "usms.png",
  },
  dtu: {
    navColor: "#22d3ee",
    membershipRank: "dtu",
    managementRanks: ["opiekun-dtu", "dtu-commander", "dtu-deputy-commander"],
    iconName: "dtu.png",
  },
  gu: {
    navColor: "#10b981",
    membershipRank: "gu",
    managementRanks: ["opiekun-gu", "gu-commander", "gu-deputy-commander"],
    iconName: "gu.png",
  },
  ftd: {
    navColor: "#6366f1",
    membershipRank: "ftd",
    managementRanks: ["opiekun-ftd", "ftd-commander", "ftd-deputy-commander"],
    iconName: "ftd.png",
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
    membershipRank: config.membershipRank,
    managementRanks: config.managementRanks.slice(),
    rankHierarchy: [config.membershipRank, ...config.managementRanks],
    icon: `/unit-logos/${config.iconName}`,
  };
});

const UNIT_CONFIG_MAP = new Map<InternalUnit, UnitSectionConfig>(UNIT_SECTIONS.map((section) => [section.unit, section]));

export function getUnitSection(unit: InternalUnit): UnitSectionConfig | null {
  return UNIT_CONFIG_MAP.get(unit) || null;
}

export function unitHasAccess(
  unit: InternalUnit,
  membershipUnits: InternalUnit[] | null | undefined,
  ranks: AdditionalRank[] | null | undefined,
  role?: Role | null | undefined
): boolean {
  if (isHighCommand(role)) {
    return true;
  }
  const config = UNIT_CONFIG_MAP.get(unit);
  if (!config) {
    return false;
  }
  if (Array.isArray(membershipUnits) && membershipUnits.includes(unit)) {
    return true;
  }
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return false;
  }
  const rankSet = new Set(ranks);
  if (rankSet.has(config.membershipRank)) {
    return true;
  }
  return config.managementRanks.some((rank) => rankSet.has(rank));
}

export type UnitPermission = {
  unit: InternalUnit;
  highestRank: AdditionalRank;
  manageableRanks: AdditionalRank[];
};

export function resolveUnitPermission(
  unit: InternalUnit,
  ranks: AdditionalRank[] | null | undefined
): UnitPermission | null {
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return null;
  }
  const config = UNIT_CONFIG_MAP.get(unit);
  if (!config) {
    return null;
  }
  const rankSet = new Set(ranks);
  for (let index = 0; index < config.managementRanks.length; index += 1) {
    const rank = config.managementRanks[index];
    if (!rankSet.has(rank)) continue;
    return {
      unit,
      highestRank: rank,
      manageableRanks: config.managementRanks.slice(index + 1),
    };
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
