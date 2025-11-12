export type BadgeTheme = {
  background: string;
  color: string;
  border: string;
  shadow: string;
};

const createTheme = (background: string, color: string, border: string, shadow: string): BadgeTheme => ({
  background,
  color,
  border,
  shadow,
});

export type DepartmentValue = "lspd" | "lssd" | "saspr";
export type DepartmentOption = {
  value: DepartmentValue;
  label: string;
  description: string;
  theme: BadgeTheme;
};

export const DEPARTMENT_OPTIONS: DepartmentOption[] = [
  {
    value: "lspd",
    label: "LSPD",
    description: "Los Santos Police Department",
    theme: createTheme(
      "linear-gradient(135deg, #2563eb, #1e40af)",
      "#e0f2fe",
      "rgba(59, 130, 246, 0.6)",
      "rgba(30, 64, 175, 0.55)"
    ),
  },
  {
    value: "lssd",
    label: "LSSD",
    description: "Los Santos Sheriff Department",
    theme: createTheme(
      "linear-gradient(135deg, #facc15, #f97316)",
      "#1f2937",
      "rgba(250, 204, 21, 0.6)",
      "rgba(251, 191, 36, 0.5)"
    ),
  },
  {
    value: "saspr",
    label: "SASPR",
    description: "San Andreas State Park Rangers",
    theme: createTheme(
      "linear-gradient(135deg, #166534, #064e3b)",
      "#d1fae5",
      "rgba(22, 101, 52, 0.65)",
      "rgba(6, 78, 59, 0.55)"
    ),
  },
];

export const DEPARTMENT_MAP = new Map(DEPARTMENT_OPTIONS.map((opt) => [opt.value, opt] as const));
export const DEPARTMENT_VALUE_SET = new Set<DepartmentValue>(DEPARTMENT_OPTIONS.map((opt) => opt.value));

export type InternalUnitValue = "iad" | "swat-sert" | "usms" | "dtu" | "gu" | "ftd";
export type InternalUnitOption = {
  value: InternalUnitValue;
  label: string;
  description: string;
  theme: BadgeTheme;
};

const UNIT_THEMES: Record<InternalUnitValue, BadgeTheme> = {
  iad: createTheme(
    "linear-gradient(135deg, #4b5563, #9b1c1c, #92400e)",
    "#fef2f2",
    "rgba(148, 163, 184, 0.55)",
    "rgba(185, 28, 28, 0.45)"
  ),
  "swat-sert": createTheme(
    "linear-gradient(135deg, #111827, #1f2937, #0f172a)",
    "#e2e8f0",
    "rgba(71, 85, 105, 0.55)",
    "rgba(15, 23, 42, 0.6)"
  ),
  usms: createTheme(
    "linear-gradient(135deg, #fbbf24, #1d4ed8)",
    "#0b1120",
    "rgba(251, 191, 36, 0.6)",
    "rgba(29, 78, 216, 0.45)"
  ),
  dtu: createTheme(
    "linear-gradient(135deg, #1f2937, #111827, #0b1120)",
    "#e5e7eb",
    "rgba(75, 85, 99, 0.6)",
    "rgba(15, 23, 42, 0.55)"
  ),
  gu: createTheme(
    "linear-gradient(135deg, #0f172a, #111827, #1f2937)",
    "#f1f5f9",
    "rgba(148, 163, 184, 0.5)",
    "rgba(15, 23, 42, 0.55)"
  ),
  ftd: createTheme(
    "linear-gradient(135deg, #b91c1c, #1d4ed8)",
    "#f8fafc",
    "rgba(239, 68, 68, 0.55)",
    "rgba(29, 78, 216, 0.45)"
  ),
};

export const INTERNAL_UNIT_OPTIONS: InternalUnitOption[] = [
  {
    value: "iad",
    label: "IAD",
    description: "Internal Affairs Division",
    theme: UNIT_THEMES.iad,
  },
  {
    value: "swat-sert",
    label: "SWAT / SERT",
    description: "Special Weapons and Tactics / Special Emergency Response Team",
    theme: UNIT_THEMES["swat-sert"],
  },
  {
    value: "usms",
    label: "USMS",
    description: "United States Marshals Service",
    theme: UNIT_THEMES.usms,
  },
  {
    value: "dtu",
    label: "DTU",
    description: "Detective Training Unit",
    theme: UNIT_THEMES.dtu,
  },
  {
    value: "gu",
    label: "GU",
    description: "Gang Unit",
    theme: UNIT_THEMES.gu,
  },
  {
    value: "ftd",
    label: "FTD",
    description: "Field Training Division",
    theme: UNIT_THEMES.ftd,
  },
];

export const INTERNAL_UNIT_MAP = new Map(INTERNAL_UNIT_OPTIONS.map((opt) => [opt.value, opt] as const));
export const INTERNAL_UNIT_VALUE_SET = new Set<InternalUnitValue>(
  INTERNAL_UNIT_OPTIONS.map((opt) => opt.value)
);

export type AuxiliaryRankValue =
  | "iad-guardian"
  | "iad-chief-inspector"
  | "iad-deputy-chief-inspector"
  | "swat-guardian"
  | "swat-commander"
  | "swat-deputy-commander"
  | "usms-guardian"
  | "usms-commander"
  | "dtu-guardian"
  | "dtu-commander"
  | "dtu-deputy-commander"
  | "gu-guardian"
  | "gu-commander"
  | "gu-deputy-commander"
  | "ftd-guardian"
  | "ftd-commander"
  | "ftd-deputy-commander";

export type AuxiliaryRankOption = {
  value: AuxiliaryRankValue;
  label: string;
  unit: InternalUnitValue;
  theme: BadgeTheme;
};

export const AUXILIARY_RANK_OPTIONS: AuxiliaryRankOption[] = [
  { value: "iad-guardian", label: "Opiekun IAD", unit: "iad", theme: UNIT_THEMES.iad },
  { value: "iad-chief-inspector", label: "IAD Chief Inspector", unit: "iad", theme: UNIT_THEMES.iad },
  { value: "iad-deputy-chief-inspector", label: "IAD Deputy Chief Inspector", unit: "iad", theme: UNIT_THEMES.iad },
  { value: "swat-guardian", label: "Opiekun SWAT/SERT", unit: "swat-sert", theme: UNIT_THEMES["swat-sert"] },
  { value: "swat-commander", label: "S.W.A.T. Commander", unit: "swat-sert", theme: UNIT_THEMES["swat-sert"] },
  { value: "swat-deputy-commander", label: "S.W.A.T. Deputy Commander", unit: "swat-sert", theme: UNIT_THEMES["swat-sert"] },
  { value: "usms-guardian", label: "Opiekun USMS", unit: "usms", theme: UNIT_THEMES.usms },
  { value: "usms-commander", label: "U.S. Marshal", unit: "usms", theme: UNIT_THEMES.usms },
  { value: "dtu-guardian", label: "Opiekun DTU", unit: "dtu", theme: UNIT_THEMES.dtu },
  { value: "dtu-commander", label: "DTU Commander", unit: "dtu", theme: UNIT_THEMES.dtu },
  { value: "dtu-deputy-commander", label: "DTU Deputy Commander", unit: "dtu", theme: UNIT_THEMES.dtu },
  { value: "gu-guardian", label: "Opiekun G.U.", unit: "gu", theme: UNIT_THEMES.gu },
  { value: "gu-commander", label: "G.U. Commander", unit: "gu", theme: UNIT_THEMES.gu },
  { value: "gu-deputy-commander", label: "G.U. Deputy Commander", unit: "gu", theme: UNIT_THEMES.gu },
  { value: "ftd-guardian", label: "Opiekun FTD", unit: "ftd", theme: UNIT_THEMES.ftd },
  { value: "ftd-commander", label: "FTD Commander", unit: "ftd", theme: UNIT_THEMES.ftd },
  { value: "ftd-deputy-commander", label: "FTD Deputy Commander", unit: "ftd", theme: UNIT_THEMES.ftd },
];

export const AUXILIARY_RANK_MAP = new Map(AUXILIARY_RANK_OPTIONS.map((opt) => [opt.value, opt] as const));
export const AUXILIARY_RANK_VALUE_SET = new Set<AuxiliaryRankValue>(
  AUXILIARY_RANK_OPTIONS.map((opt) => opt.value)
);

export const AUXILIARY_RANKS_BY_UNIT: Record<InternalUnitValue, AuxiliaryRankOption[]> = {
  iad: AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "iad"),
  "swat-sert": AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "swat-sert"),
  usms: AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "usms"),
  dtu: AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "dtu"),
  gu: AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "gu"),
  ftd: AUXILIARY_RANK_OPTIONS.filter((opt) => opt.unit === "ftd"),
};

export function getAuxiliaryRankUnit(value: AuxiliaryRankValue | null | undefined): InternalUnitValue | null {
  if (!value) return null;
  const entry = AUXILIARY_RANK_MAP.get(value);
  return entry ? entry.unit : null;
}

export { UNIT_THEMES as INTERNAL_UNIT_THEMES };
