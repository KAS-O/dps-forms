export type DepartmentId = "lspd" | "lssd" | "saspr";

export type UnitId = "iad" | "swat" | "usms" | "dtu" | "gu" | "ftd";

export type AdditionalRankId =
  | "iad-caretaker"
  | "iad-chief-inspector"
  | "iad-deputy-chief-inspector"
  | "swat-caretaker"
  | "swat-commander"
  | "swat-deputy-commander"
  | "usms-caretaker"
  | "usms-marshal"
  | "dtu-caretaker"
  | "dtu-commander"
  | "dtu-deputy-commander"
  | "gu-caretaker"
  | "gu-commander"
  | "gu-deputy-commander"
  | "ftd-caretaker"
  | "ftd-commander"
  | "ftd-deputy-commander";

export type DepartmentInfo = {
  id: DepartmentId;
  label: string;
  fullLabel: string;
  description: string;
  colorFrom: string;
  colorTo: string;
  textColor: string;
};

export type UnitInfo = {
  id: UnitId;
  label: string;
  description: string;
  colorFrom: string;
  colorTo: string;
  textColor: string;
};

export type AdditionalRankInfo = {
  id: AdditionalRankId;
  label: string;
  unit: UnitId;
};

export const DEPARTMENTS: DepartmentInfo[] = [
  {
    id: "lspd",
    label: "LSPD",
    fullLabel: "Los Santos Police Department",
    description: "Jednostka miejska odpowiedzialna za bezpieczeństwo na terenie Los Santos.",
    colorFrom: "#1d4ed8",
    colorTo: "#0f172a",
    textColor: "#dbeafe",
  },
  {
    id: "lssd",
    label: "LSSD",
    fullLabel: "Los Santos Sheriff Department",
    description: "Sheriffowie i patrole obszarów podmiejskich oraz wiejskich hrabstwa Los Santos.",
    colorFrom: "#f59e0b",
    colorTo: "#92400e",
    textColor: "#fffbeb",
  },
  {
    id: "saspr",
    label: "SASPR",
    fullLabel: "San Andreas State Park Rangers",
    description: "Jednostka parkowa dbająca o tereny zielone i rezerwaty stanu San Andreas.",
    colorFrom: "#064e3b",
    colorTo: "#022c22",
    textColor: "#d1fae5",
  },
];

export const UNITS: UnitInfo[] = [
  {
    id: "iad",
    label: "IAD",
    description: "Internal Affairs Division — odpowiedzialna za kontrolę wewnętrzną i standardy.",
    colorFrom: "#6b7280",
    colorTo: "#b91c1c",
    textColor: "#fef2f2",
  },
  {
    id: "swat",
    label: "SWAT / SERT",
    description: "Specjalistyczna taktyka i reagowanie na zagrożenia o wysokim ryzyku.",
    colorFrom: "#0f172a",
    colorTo: "#1f2937",
    textColor: "#e2e8f0",
  },
  {
    id: "usms",
    label: "USMS",
    description: "United States Marshal Service — wsparcie federalne i ochrona świadków.",
    colorFrom: "#fbbf24",
    colorTo: "#1e3a8a",
    textColor: "#fef3c7",
  },
  {
    id: "dtu",
    label: "DTU",
    description: "Detective Training Unit — szkolenie detektywów i analizy śledcze.",
    colorFrom: "#111827",
    colorTo: "#374151",
    textColor: "#e5e7eb",
  },
  {
    id: "gu",
    label: "GU",
    description: "Gang Unit — operacje wymierzone w przestępczość zorganizowaną.",
    colorFrom: "#0f172a",
    colorTo: "#1f2937",
    textColor: "#e2e8f0",
  },
  {
    id: "ftd",
    label: "FTD",
    description: "Field Training Division — szkolenie i wprowadzenie funkcjonariuszy w służbę.",
    colorFrom: "#b91c1c",
    colorTo: "#1d4ed8",
    textColor: "#fee2e2",
  },
];

export const ADDITIONAL_RANKS: AdditionalRankInfo[] = [
  { id: "iad-caretaker", label: "Opiekun IAD", unit: "iad" },
  { id: "iad-chief-inspector", label: "IAD Chief Inspector", unit: "iad" },
  { id: "iad-deputy-chief-inspector", label: "IAD Deputy Chief Inspector", unit: "iad" },
  { id: "swat-caretaker", label: "Opiekun SWAT/SERT", unit: "swat" },
  { id: "swat-commander", label: "S.W.A.T. Commander", unit: "swat" },
  { id: "swat-deputy-commander", label: "S.W.A.T. Deputy Commander", unit: "swat" },
  { id: "usms-caretaker", label: "Opiekun USMS", unit: "usms" },
  { id: "usms-marshal", label: "U.S. Marshal", unit: "usms" },
  { id: "dtu-caretaker", label: "Opiekun DTU", unit: "dtu" },
  { id: "dtu-commander", label: "DTU Commander", unit: "dtu" },
  { id: "dtu-deputy-commander", label: "DTU Deputy Commander", unit: "dtu" },
  { id: "gu-caretaker", label: "Opiekun G.U.", unit: "gu" },
  { id: "gu-commander", label: "G.U. Commander", unit: "gu" },
  { id: "gu-deputy-commander", label: "G.U. Deputy Commander", unit: "gu" },
  { id: "ftd-caretaker", label: "Opiekun FTD", unit: "ftd" },
  { id: "ftd-commander", label: "FTD Commander", unit: "ftd" },
  { id: "ftd-deputy-commander", label: "FTD Deputy Commander", unit: "ftd" },
];

const DEPARTMENT_SET = new Set<DepartmentId>(DEPARTMENTS.map((dept) => dept.id));
const UNIT_SET = new Set<UnitId>(UNITS.map((unit) => unit.id));
const ADDITIONAL_RANK_SET = new Set<AdditionalRankId>(ADDITIONAL_RANKS.map((rank) => rank.id));

export function normalizeDepartment(value: unknown): DepartmentId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const match = DEPARTMENTS.find((dept) => dept.id === normalized);
  return match ? match.id : null;
}

export function normalizeUnits(value: unknown): UnitId[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<UnitId>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    const normalized = item.trim().toLowerCase();
    if (UNIT_SET.has(normalized as UnitId)) {
      unique.add(normalized as UnitId);
    }
  });
  return Array.from(unique);
}

export function normalizeAdditionalRank(value: unknown): AdditionalRankId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const match = ADDITIONAL_RANKS.find((rank) => rank.id === normalized);
  return match ? match.id : null;
}

export const DEPARTMENT_MAP = Object.fromEntries(DEPARTMENTS.map((dept) => [dept.id, dept])) as Record<
  DepartmentId,
  DepartmentInfo
>;

export const UNIT_MAP = Object.fromEntries(UNITS.map((unit) => [unit.id, unit])) as Record<UnitId, UnitInfo>;

export const ADDITIONAL_RANK_MAP = Object.fromEntries(
  ADDITIONAL_RANKS.map((rank) => [rank.id, rank])
) as Record<AdditionalRankId, AdditionalRankInfo>;

export const ADDITIONAL_RANKS_BY_UNIT: Record<UnitId, AdditionalRankInfo[]> = UNITS.reduce(
  (acc, unit) => {
    acc[unit.id] = ADDITIONAL_RANKS.filter((rank) => rank.unit === unit.id);
    return acc;
  },
  {} as Record<UnitId, AdditionalRankInfo[]>
);

export function isValidDepartment(value: unknown): value is DepartmentId {
  return typeof value === "string" && DEPARTMENT_SET.has(value as DepartmentId);
}

export function isValidUnit(value: unknown): value is UnitId {
  return typeof value === "string" && UNIT_SET.has(value as UnitId);
}

export function isValidAdditionalRank(value: unknown): value is AdditionalRankId {
  return typeof value === "string" && ADDITIONAL_RANK_SET.has(value as AdditionalRankId);
}
