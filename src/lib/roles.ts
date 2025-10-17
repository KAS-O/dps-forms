export const ROLE_VALUES = ["director", "chief", "senior", "agent", "rookie"] as const;

export type Role = (typeof ROLE_VALUES)[number];

export function normalizeRole(value: unknown): Role {
  if (typeof value !== "string") {
    return "rookie";
  }
  const normalized = value.toLowerCase();
  return (ROLE_VALUES as readonly string[]).includes(normalized) ? (normalized as Role) : "rookie";
}
