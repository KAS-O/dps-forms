const FALLBACK_DOMAIN = "dps.local";

function resolveLoginDomain(): string {
  if (typeof process !== "undefined") {
    return process.env.NEXT_PUBLIC_LOGIN_DOMAIN || FALLBACK_DOMAIN;
  }
  if (typeof window !== "undefined") {
    return (window as any)?.NEXT_PUBLIC_LOGIN_DOMAIN || FALLBACK_DOMAIN;
  }
  return FALLBACK_DOMAIN;
}

/**
 * Normalizes e-mail address used in Firebase auth to internal login used in the DPS panel.
 * Falls back to the original e-mail when the configured domain suffix is missing.
 */
export function deriveLoginFromEmail(email?: string | null): string {
  if (!email) return "";
  const domain = resolveLoginDomain();
  const suffix = `@${domain}`;
  if (email.toLowerCase().endsWith(suffix.toLowerCase())) {
    return email.slice(0, -suffix.length);
  }
  return email;
}
