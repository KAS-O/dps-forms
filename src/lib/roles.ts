export const ROLE_VALUES = [
  "cadet",
  "solo_cadet",
  "officer_i",
  "officer_ii",
  "officer_iii",
  "officer_iii_plus_i",
  "sergeant_i",
  "sergeant_ii",
  "sergeant_iii",
  "lieutenant_i",
  "lieutenant_ii",
  "captain_i",
  "captain_ii",
  "captain_iii",
  "staff_commander",
  "executive_commander",
  "deputy_chief",
  "assistant_chief",
  "chief_of_police",
  "director",
  "admin",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const DEFAULT_ROLE: Role = "cadet";

export const ROLE_LABELS: Record<Role, string> = {
  cadet: "Cadet",
  solo_cadet: "Solo Cadet",
  officer_i: "OFFICER I",
  officer_ii: "OFFICER II",
  officer_iii: "OFFICER III",
  officer_iii_plus_i: "OFFICER III+I",
  sergeant_i: "Sergeant I",
  sergeant_ii: "Sergeant II",
  sergeant_iii: "Sergeant III",
  lieutenant_i: "Lieutenant I",
  lieutenant_ii: "Lieutenant II",
  captain_i: "Captain I",
  captain_ii: "Captain II",
  captain_iii: "Captain III",
  staff_commander: "Staff Commander",
  executive_commander: "Executive Commander",
  deputy_chief: "Deputy Chief",
  assistant_chief: "Assistant Chief",
  chief_of_police: "Chief Of Police",
  director: "Director",
  admin: "Admin",
};

export const BOARD_ROLES: readonly Role[] = [
  "staff_commander",
  "executive_commander",
  "deputy_chief",
  "assistant_chief",
  "chief_of_police",
  "director",
  "admin",
] as const;

const LEGACY_ROLE_MAP: Record<string, Role> = {
  chief: "chief_of_police",
  chief_agent: "chief_of_police",
  senior: "captain_i",
  senior_agent: "captain_i",
  agent: "officer_i",
  rookie: "cadet",
};

export function hasBoardAccess(role: Role | null | undefined): role is Role {
  return !!role && BOARD_ROLES.includes(role);
}

export function normalizeRole(value: unknown): Role {
  if (typeof value !== "string") {
    return DEFAULT_ROLE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ROLE;
  }

  const normalized = trimmed.toLowerCase();
  if ((ROLE_VALUES as readonly string[]).includes(normalized)) {
    return normalized as Role;
  }

  const slugCandidate = normalized
    .replace(/\+/g, "_plus_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if ((ROLE_VALUES as readonly string[]).includes(slugCandidate)) {
    return slugCandidate as Role;
  }

  const legacy = LEGACY_ROLE_MAP[normalized] || LEGACY_ROLE_MAP[slugCandidate];
  if (legacy) {
    return legacy;
  }

  return DEFAULT_ROLE;
}

export function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role] || role;
}
