export const ROLE_VALUES = [
  "cadet",
  "solo-cadet",
  "officer-i",
  "officer-ii",
  "officer-iii",
  "officer-iii-plus-i",
  "fib",
  "sergeant-i",
  "sergeant-ii",
  "sergeant-iii",
  "lieutenant-i",
  "lieutenant-ii",
  "captain-i",
  "captain-ii",
  "captain-iii",
  "staff-commander",
  "executive-commander",
  "deputy-chief",
  "assistant-chief",
  "chief-of-police",
  "director",
  "admin",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const DEFAULT_ROLE: Role = ROLE_VALUES[0];

const ROLE_LABEL_MAP: Record<Role, string> = {
  "cadet": "Cadet",
  "solo-cadet": "Solo Cadet",
  "officer-i": "Officer I",
  "officer-ii": "Officer II",
  "officer-iii": "Officer III",
  "officer-iii-plus-i": "Officer III+I",
  "fib": "FIB",
  "sergeant-i": "Sergeant I",
  "sergeant-ii": "Sergeant II",
  "sergeant-iii": "Sergeant III",
  "lieutenant-i": "Lieutenant I",
  "lieutenant-ii": "Lieutenant II",
  "captain-i": "Captain I",
  "captain-ii": "Captain II",
  "captain-iii": "Captain III",
  "staff-commander": "Staff Commander",
  "executive-commander": "Executive Commander",
  "deputy-chief": "Deputy Chief",
  "assistant-chief": "Assistant Chief",
  "chief-of-police": "Chief Of Police",
  "director": "Director",
  "admin": "Admin",
};

export const ROLE_LABELS = ROLE_LABEL_MAP;

export const ROLE_OPTIONS: { value: Role; label: string }[] = ROLE_VALUES.filter(
  (role) => role !== "admin"
).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export const ROLE_ORDER = new Map<Role, number>(ROLE_VALUES.map((role, index) => [role, index]));

export function getRoleRank(role: Role | null | undefined): number {
  if (!role) {
    return -1;
  }
  const rank = ROLE_ORDER.get(role);
  return typeof rank === "number" ? rank : -1;
}

export function isRoleHigher(role: Role | null | undefined, other: Role | null | undefined): boolean {
  return getRoleRank(role) > getRoleRank(other);
}

const ROLE_GROUP_LABEL_MAP: Record<Role, string> = {
  director: "Directors & FIB",
  admin: "Administracja",
  "chief-of-police": "High Command",
  "assistant-chief": "High Command",
  "deputy-chief": "High Command",
  "executive-commander": "High Command",
  "staff-commander": "High Command",
  "captain-iii": "Command",
  "captain-ii": "Command",
  "captain-i": "Command",
  "lieutenant-ii": "Command",
  "lieutenant-i": "Command",
  "sergeant-iii": "Supervisors",
  "sergeant-ii": "Supervisors",
  "sergeant-i": "Supervisors",
  "officer-iii-plus-i": "Officers",
  "officer-iii": "Officers",
  "officer-ii": "Officers",
  "officer-i": "Officers",
  "solo-cadet": "Trainee",
  cadet: "Trainee",
  fib: "Directors & FIB",
};

export function getRoleGroupLabel(role: Role | null | undefined): string | null {
  if (!role) return null;
  return ROLE_GROUP_LABEL_MAP[role] || null;
}

const ROLE_ALIASES: Record<string, Role> = {
  "cadet": "cadet",
  "solo cadet": "solo-cadet",
  "solo-cadet": "solo-cadet",
  "officer i": "officer-i",
  "officer-i": "officer-i",
  "officer ii": "officer-ii",
  "officer-ii": "officer-ii",
  "officer iii": "officer-iii",
  "officer-iii": "officer-iii",
  "officer iii+i": "officer-iii-plus-i",
  "officer iii plus i": "officer-iii-plus-i",
  "officer-iii+i": "officer-iii-plus-i",
  "officer-iii-plus-i": "officer-iii-plus-i",
  "fib": "fib",
  "fib agent": "fib",
  "sergeant i": "sergeant-i",
  "sergeant-i": "sergeant-i",
  "sergeant ii": "sergeant-ii",
  "sergeant-ii": "sergeant-ii",
  "sergeant iii": "sergeant-iii",
  "sergeant-iii": "sergeant-iii",
  "lieutenant i": "lieutenant-i",
  "lieutenant-i": "lieutenant-i",
  "lieutenant ii": "lieutenant-ii",
  "lieutenant-ii": "lieutenant-ii",
  "captain i": "captain-i",
  "captain-i": "captain-i",
  "captain ii": "captain-ii",
  "captain-ii": "captain-ii",
  "captain iii": "captain-iii",
  "captain-iii": "captain-iii",
  "staff commander": "staff-commander",
  "staff-commander": "staff-commander",
  "executive commander": "executive-commander",
  "executive-commander": "executive-commander",
  "deputy chief": "deputy-chief",
  "deputy-chief": "deputy-chief",
  "assistant chief": "assistant-chief",
  "assistant-chief": "assistant-chief",
  "chief of police": "chief-of-police",
  "chief-of-police": "chief-of-police",
  "director": "director",
  "admin": "admin",
  // legacy mappings
  "rookie": "cadet",
  "agent": "officer-i",
  "senior": "sergeant-i",
  "chief": "chief-of-police",
};

export const BOARD_ROLES: Role[] = [
  "staff-commander",
  "executive-commander",
  "deputy-chief",
  "assistant-chief",
  "chief-of-police",
  "director",
  "admin",
];

const BOARD_ROLE_SET = new Set<Role>(BOARD_ROLES);

export function hasBoardAccess(role: Role | null | undefined): role is Role {
  return !!role && BOARD_ROLE_SET.has(role);
}

export function hasOfficerAccess(role: Role | null | undefined): role is Role {
  if (!role) return false;
  return role !== "cadet" && role !== "solo-cadet";
}

export function canAssignAdminPrivileges(role: Role | null | undefined): role is Role {
  if (!role) return false;
  return role === "admin" || role === "director" || role === "chief-of-police";
}

export const HIGH_COMMAND_ROLES: Role[] = [
  "staff-commander",
  "executive-commander",
  "deputy-chief",
  "assistant-chief",
  "chief-of-police",
  "director",
  "admin",
];

const HIGH_COMMAND_ROLE_SET = new Set<Role>(HIGH_COMMAND_ROLES);

export function isHighCommand(role: Role | null | undefined): role is Role {
  return !!role && HIGH_COMMAND_ROLE_SET.has(role);
}

const FALLBACK_ROLE: Role = DEFAULT_ROLE;

export function normalizeRole(value: unknown): Role {
  if (typeof value !== "string") {
    return FALLBACK_ROLE;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return FALLBACK_ROLE;
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  const alias = ROLE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  const slug = normalized
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, "-")
    .replace(/\+/g, "-plus-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if ((ROLE_VALUES as readonly string[]).includes(slug as Role)) {
    return slug as Role;
  }

  return FALLBACK_ROLE;
}
