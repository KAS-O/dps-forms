export type Department = "lspd" | "lssd" | "saspr";

export type InternalUnit = "iad" | "swat-sert" | "usms" | "dtu" | "gu" | "ftd";

export type AdditionalRank =
  | "opiekun-iad"
  | "iad-chief-inspector"
  | "iad-deputy-chief-inspector"
  | "opiekun-swat-sert"
  | "swat-commander"
  | "swat-deputy-commander"
  | "opiekun-usms"
  | "us-marshal"
  | "opiekun-dtu"
  | "dtu-commander"
  | "dtu-deputy-commander"
  | "opiekun-gu"
  | "gu-commander"
  | "gu-deputy-commander"
  | "opiekun-ftd"
  | "ftd-commander"
  | "ftd-deputy-commander";

export type StyledOption<T extends string> = {
  value: T;
  label: string;
  shortLabel?: string;
  description?: string;
  background: string;
  color: string;
  borderColor: string;
};

export type DepartmentOption = StyledOption<Department> & {
  abbreviation: string;
};

export type InternalUnitOption = StyledOption<InternalUnit> & {
  abbreviation: string;
};

export type AdditionalRankOption = StyledOption<AdditionalRank> & {
  unit: InternalUnit;
};

const DEPARTMENT_OPTIONS: DepartmentOption[] = [
  {
    value: "lspd",
    label: "Los Santos Police Department",
    abbreviation: "LSPD",
    shortLabel: "LSPD",
    background: "linear-gradient(135deg, #1e3a8a, #2563eb)",
    color: "#eff6ff",
    borderColor: "rgba(59, 130, 246, 0.65)",
  },
  {
    value: "lssd",
    label: "Los Santos Sheriff's Department",
    abbreviation: "LSSD",
    shortLabel: "LSSD",
    background: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#1f2937",
    borderColor: "rgba(251, 191, 36, 0.75)",
  },
  {
    value: "saspr",
    label: "San Andreas State Park Rangers",
    abbreviation: "SASPR",
    shortLabel: "SASPR",
    background: "linear-gradient(135deg, #065f46, #064e3b)",
    color: "#ecfdf5",
    borderColor: "rgba(22, 163, 74, 0.7)",
  },
];

const UNIT_STYLES: Record<InternalUnit, { background: string; color: string; borderColor: string }> = {
  iad: {
    background: "linear-gradient(135deg, #4b5563, #92400e, #991b1b)",
    color: "#fef2f2",
    borderColor: "rgba(220, 38, 38, 0.65)",
  },
  "swat-sert": {
    background: "linear-gradient(135deg, #0f172a, #1f2937)",
    color: "#e2e8f0",
    borderColor: "rgba(30, 41, 59, 0.7)",
  },
  usms: {
    background: "linear-gradient(135deg, #fbbf24, #1d4ed8)",
    color: "#111827",
    borderColor: "rgba(59, 130, 246, 0.65)",
  },
  dtu: {
    background: "linear-gradient(135deg, #111827, #4b5563)",
    color: "#f1f5f9",
    borderColor: "rgba(51, 65, 85, 0.7)",
  },
  gu: {
    background: "linear-gradient(135deg, #0b1120, #1f2937)",
    color: "#f8fafc",
    borderColor: "rgba(17, 24, 39, 0.65)",
  },
  ftd: {
    background: "linear-gradient(135deg, #dc2626, #1d4ed8)",
    color: "#f8fafc",
    borderColor: "rgba(220, 38, 38, 0.65)",
  },
};

const INTERNAL_UNIT_OPTIONS: InternalUnitOption[] = [
  {
    value: "iad",
    label: "Internal Affairs Division",
    abbreviation: "IAD",
    shortLabel: "IAD",
    ...UNIT_STYLES.iad,
  },
  {
    value: "swat-sert",
    label: "Special Weapons and Tactics / Special Emergency Response Team",
    abbreviation: "SWAT / SERT",
    shortLabel: "SWAT / SERT",
    ...UNIT_STYLES["swat-sert"],
  },
  {
    value: "usms",
    label: "United States Marshals Service",
    abbreviation: "USMS",
    shortLabel: "USMS",
    ...UNIT_STYLES.usms,
  },
  {
    value: "dtu",
    label: "Detective Task Unit",
    abbreviation: "DTU",
    shortLabel: "DTU",
    ...UNIT_STYLES.dtu,
  },
  {
    value: "gu",
    label: "Gang Unit",
    abbreviation: "GU",
    shortLabel: "GU",
    ...UNIT_STYLES.gu,
  },
  {
    value: "ftd",
    label: "Field Training Division",
    abbreviation: "FTD",
    shortLabel: "FTD",
    ...UNIT_STYLES.ftd,
  },
];

const ADDITIONAL_RANK_OPTIONS: AdditionalRankOption[] = [
  {
    value: "opiekun-iad",
    label: "Opiekun IAD",
    unit: "iad",
    ...UNIT_STYLES.iad,
  },
  {
    value: "iad-chief-inspector",
    label: "IAD Chief Inspector",
    unit: "iad",
    ...UNIT_STYLES.iad,
  },
  {
    value: "iad-deputy-chief-inspector",
    label: "IAD Deputy Chief Inspector",
    unit: "iad",
    ...UNIT_STYLES.iad,
  },
  {
    value: "opiekun-swat-sert",
    label: "Opiekun SWAT/SERT",
    unit: "swat-sert",
    ...UNIT_STYLES["swat-sert"],
  },
  {
    value: "swat-commander",
    label: "S.W.A.T. Commander",
    unit: "swat-sert",
    ...UNIT_STYLES["swat-sert"],
  },
  {
    value: "swat-deputy-commander",
    label: "S.W.A.T. Deputy Commander",
    unit: "swat-sert",
    ...UNIT_STYLES["swat-sert"],
  },
  {
    value: "opiekun-usms",
    label: "Opiekun USMS",
    unit: "usms",
    ...UNIT_STYLES.usms,
  },
  {
    value: "us-marshal",
    label: "U.S. Marshal",
    unit: "usms",
    ...UNIT_STYLES.usms,
  },
  {
    value: "opiekun-dtu",
    label: "Opiekun DTU",
    unit: "dtu",
    ...UNIT_STYLES.dtu,
  },
  {
    value: "dtu-commander",
    label: "DTU Commander",
    unit: "dtu",
    ...UNIT_STYLES.dtu,
  },
  {
    value: "dtu-deputy-commander",
    label: "DTU Deputy Commander",
    unit: "dtu",
    ...UNIT_STYLES.dtu,
  },
  {
    value: "opiekun-gu",
    label: "Opiekun G.U.",
    unit: "gu",
    ...UNIT_STYLES.gu,
  },
  {
    value: "gu-commander",
    label: "G.U. Commander",
    unit: "gu",
    ...UNIT_STYLES.gu,
  },
  {
    value: "gu-deputy-commander",
    label: "G.U. Deputy Commander",
    unit: "gu",
    ...UNIT_STYLES.gu,
  },
  {
    value: "opiekun-ftd",
    label: "Opiekun FTD",
    unit: "ftd",
    ...UNIT_STYLES.ftd,
  },
  {
    value: "ftd-commander",
    label: "FTD Commander",
    unit: "ftd",
    ...UNIT_STYLES.ftd,
  },
  {
    value: "ftd-deputy-commander",
    label: "FTD Deputy Commander",
    unit: "ftd",
    ...UNIT_STYLES.ftd,
  },
];

export const DEPARTMENTS = DEPARTMENT_OPTIONS;
export const INTERNAL_UNITS = INTERNAL_UNIT_OPTIONS;
export const ADDITIONAL_RANKS = ADDITIONAL_RANK_OPTIONS;

const DEPARTMENT_MAP = new Map(DEPARTMENT_OPTIONS.map((option) => [option.value, option]));
const INTERNAL_UNIT_MAP = new Map(INTERNAL_UNIT_OPTIONS.map((option) => [option.value, option]));
const ADDITIONAL_RANK_MAP = new Map(ADDITIONAL_RANK_OPTIONS.map((option) => [option.value, option]));

export function normalizeDepartment(value: unknown): Department | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return (DEPARTMENT_OPTIONS.find((option) => option.value === normalized) || null)?.value ?? null;
}

export function getDepartmentOption(value: Department | string | null | undefined): DepartmentOption | null {
  if (!value) return null;
  const key = typeof value === "string" ? (value.trim().toLowerCase() as Department) : value;
  return DEPARTMENT_MAP.get(key) || null;
}

export function normalizeInternalUnits(value: unknown): InternalUnit[] {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      const option = INTERNAL_UNIT_MAP.get(value.trim().toLowerCase() as InternalUnit);
      return option ? [option.value] : [];
    }
    return [];
  }
  const seen = new Set<InternalUnit>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    const key = item.trim().toLowerCase() as InternalUnit;
    if (INTERNAL_UNIT_MAP.has(key)) {
      seen.add(key);
    }
  });
  return Array.from(seen);
}

export function getInternalUnitOption(value: InternalUnit | string | null | undefined): InternalUnitOption | null {
  if (!value) return null;
  const key = typeof value === "string" ? (value.trim().toLowerCase() as InternalUnit) : value;
  return INTERNAL_UNIT_MAP.get(key) || null;
}

export function normalizeAdditionalRanks(value: unknown): AdditionalRank[] {
  const seen = new Set<AdditionalRank>();

  const addValue = (input: unknown) => {
    if (typeof input !== "string") return;
    const normalized = input.trim().toLowerCase();
    if (!normalized) return;
    const option = ADDITIONAL_RANK_OPTIONS.find((rank) => rank.value === normalized);
    if (option) {
      seen.add(option.value);
    }
  };

  if (Array.isArray(value)) {
    value.forEach(addValue);
  } else {
    addValue(value);
  }

  return Array.from(seen);
}

export function getAdditionalRankOption(
  value: AdditionalRank | string | null | undefined
): AdditionalRankOption | null {
  if (!value) return null;
  const key = typeof value === "string" ? (value.trim().toLowerCase() as AdditionalRank) : value;
  return ADDITIONAL_RANK_MAP.get(key) || null;
}

export const ADDITIONAL_RANK_GROUPS = INTERNAL_UNIT_OPTIONS.map((unit) => ({
  unit: unit.value,
  unitLabel: unit.abbreviation,
  unitDescription: unit.label,
  ranks: ADDITIONAL_RANK_OPTIONS.filter((rank) => rank.unit === unit.value),
})).filter((group) => group.ranks.length > 0);

export function formatPersonLabel(fullName?: string | null, login?: string | null): string {
  const name = (fullName || "").trim();
  const user = (login || "").trim();
  if (name && user && name.toLowerCase() !== user.toLowerCase()) {
    return `${name} (${user})`;
  }
  return name || user || "Nieznany funkcjonariusz";
}
