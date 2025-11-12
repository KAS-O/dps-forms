import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebaseAdmin";
import { Role, normalizeRole, hasBoardAccess } from "@/lib/roles";

if (!adminAuth || !adminDb || !adminFieldValue) {
  console.warn("Firebase Admin SDK is not configured.");
}

type AccountResponse = {
  uid: string;
  login: string;
  fullName?: string;
  role: Role;
  email: string;
  createdAt?: string;
  badgeNumber?: string;
};

async function verifyBoardAccess(req: NextApiRequest) {
  if (!adminAuth || !adminDb) {
    throw new Error("Brak konfiguracji Firebase Admin");
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("Brak tokenu uwierzytelniającego");
  }
  const token = header.slice(7);
  const decoded = await adminAuth.verifyIdToken(token);
  const profileSnap = await adminDb.collection("profiles").doc(decoded.uid).get();
  const role = normalizeRole(profileSnap.data()?.role);
  if (!hasBoardAccess(role)) {
    throw new Error("FORBIDDEN");
  }
  return decoded;
}

function profileTimestampToString(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      if (date instanceof Date) {
        return date.toISOString();
      }
    } catch (err) {
      console.warn("Nie udało się przekształcić znacznika czasu profilu na string:", err);
    }
  }
  return undefined;
}

function normalizeBadgeNumber(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function buildAccountsFromProfiles(profiles: Map<string, any>): AccountResponse[] {
  const fallbackAccounts: AccountResponse[] = [];
  profiles.forEach((profile, uid) => {
    const rawLogin = typeof profile?.login === "string" ? profile.login.trim() : "";
    const loginFromEmail = typeof profile?.email === "string" ? profile.email.split("@")[0] : "";
    const login = (rawLogin || loginFromEmail || uid || "").toLowerCase();
    const email = `${login}@${LOGIN_DOMAIN}`;
    const fullName = typeof profile?.fullName === "string" && profile.fullName ? profile.fullName : login;
    const createdAt = profileTimestampToString(profile?.createdAt);
    const badgeNumber = normalizeBadgeNumber(profile?.badgeNumber);

    fallbackAccounts.push({
      uid,
      login,
      fullName,
      role: normalizeRole(profile?.role),
      email,
      ...(badgeNumber ? { badgeNumber } : {}),
      ...(createdAt ? { createdAt } : {}),
    });
  });

  fallbackAccounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login));
  return fallbackAccounts;
}

async function listAccounts(): Promise<AccountResponse[]> {
  if (!adminDb) return [];

  const profiles = new Map<string, any>();
  try {
    const profilesSnap = await adminDb.collection("profiles").get();
    profilesSnap.forEach((doc) => profiles.set(doc.id, doc.data()));
  } catch (error) {
    console.error("Nie udało się pobrać profili użytkowników:", error);
  }

  if (!adminAuth) {
    return buildAccountsFromProfiles(profiles);
  }

  const accounts: AccountResponse[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const res = await adminAuth.listUsers(1000, pageToken);
      res.users.forEach((user) => {
        const profile = profiles.get(user.uid) || {};
        const badgeNumber = normalizeBadgeNumber(profile?.badgeNumber);
        accounts.push({
          uid: user.uid,
          login: profile.login || user.email?.split("@")[0] || "",
          fullName: profile.fullName || user.displayName || "",
          role: normalizeRole(profile.role),
          email: user.email || "",
          ...(badgeNumber ? { badgeNumber } : {}),
          createdAt: user.metadata.creationTime || undefined,
        });
      });
      pageToken = res.pageToken;
    } while (pageToken);
  } catch (error: any) {
    console.warn(
      "Nie udało się pobrać listy użytkowników z Firebase Auth, używam danych z kolekcji 'profiles'.",
      error
    );
    return buildAccountsFromProfiles(profiles);
  }

  accounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login));
  return accounts;
}

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";
const LOGIN_PATTERN = /^[a-z0-9._-]+$/;
const BADGE_PATTERN = /^[0-9]{1,6}$/;

function mapFirebaseAuthError(error: any): { status: number; message: string } | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = typeof error.code === "string" ? error.code : "";
  switch (code) {
    case "auth/email-already-exists":
      return { status: 400, message: "Login jest już zajęty." };
    case "auth/invalid-email":
      return {
        status: 400,
        message: "Login zawiera niedozwolone znaki. Dozwolone są małe litery, cyfry, kropki, myślniki i podkreślniki.",
      };
    case "auth/invalid-password":
    case "auth/weak-password":
      return { status: 400, message: "Hasło musi mieć co najmniej 6 znaków." };
    default:
      return null;
  }
}

function isAdminPermissionError(error: any): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code =
    (typeof error.code === "string" && error.code) ||
    (typeof error.errorInfo?.code === "string" && error.errorInfo.code) ||
    "";
  return code === "auth/insufficient-permission" || code === "auth/admin-restricted-operation";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,POST,PATCH,DELETE,OPTIONS");
    return res.status(204).end();
  }

  try {
    await verifyBoardAccess(req);
  } catch (e: any) {
    if (e.message === "FORBIDDEN") {
      return res.status(403).json({ error: "Brak uprawnień" });
    }
    return res.status(401).json({ error: e?.message || "Nieautoryzowany" });
  }

  try {
    if (req.method === "GET") {
      const accounts = await listAccounts();
      return res.status(200).json({ accounts });
    }

    if (!adminAuth || !adminDb) {
      return res.status(500).json({ error: "Brak konfiguracji Firebase Admin" });
    }

    if (req.method === "POST") {
      const { login, fullName, role, password, badgeNumber } = req.body || {};
      if (!login || !password) {
        return res.status(400).json({ error: "Login i hasło są wymagane" });
      }
      const normalizedLogin = String(login).trim().toLowerCase();
      if (!LOGIN_PATTERN.test(normalizedLogin)) {
        return res.status(400).json({
          error: "Login może zawierać jedynie małe litery, cyfry, kropki, myślniki i podkreślniki.",
        });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
      }
      const normalizedBadge = typeof badgeNumber === "string" ? badgeNumber.trim() : "";
      if (!normalizedBadge) {
        return res.status(400).json({ error: "Numer odznaki jest wymagany." });
      }
      if (!BADGE_PATTERN.test(normalizedBadge)) {
        return res.status(400).json({ error: "Numer odznaki powinien zawierać od 1 do 6 cyfr." });
      }
      const email = `${normalizedLogin}@${LOGIN_DOMAIN}`;

      let newUser;
      try {
        newUser = await adminAuth.createUser({
          email,
          password,
          displayName: fullName || normalizedLogin,
        });
      } catch (error: any) {
        const mapped = mapFirebaseAuthError(error);
        if (mapped) {
          return res.status(mapped.status).json({ error: mapped.message });
        }
        if (isAdminPermissionError(error)) {
          return res.status(403).json({
            error:
              "Konto Firebase Admin nie ma uprawnień do tworzenia użytkowników. Sprawdź konfigurację poświadczeń w środowisku.",
          });
        }
        throw error;
      }

      const createdAt = adminFieldValue?.serverTimestamp?.();
      await adminDb.collection("profiles").doc(newUser.uid).set({
        login: normalizedLogin,
        fullName: fullName || normalizedLogin,
        role: normalizeRole(role),
        badgeNumber: normalizedBadge,
        ...(createdAt ? { createdAt } : {}),
      });

      return res.status(201).json({ uid: newUser.uid });
    }

    if (req.method === "PATCH") {
      const { uid, login, fullName, role, password, badgeNumber } = req.body || {};
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
      const updates: string[] = [];
      const updatePayload: any = {};
      const profilePayload: any = {};
      if (login) {
        const normalizedLogin = String(login).trim().toLowerCase();
        if (!LOGIN_PATTERN.test(normalizedLogin)) {
          return res.status(400).json({
            error: "Login może zawierać jedynie małe litery, cyfry, kropki, myślniki i podkreślniki.",
          });
        }
        updatePayload.email = `${normalizedLogin}@${LOGIN_DOMAIN}`;
        updatePayload.displayName = fullName || normalizedLogin;
        profilePayload.login = normalizedLogin;
        profilePayload.fullName = fullName || normalizedLogin;
        if (role) {
          profilePayload.role = normalizeRole(role);
          updates.push("role");
        }
        if (fullName) {
          updates.push("fullName");
        }
        updates.push("login");
      } else {
        if (fullName) {
          profilePayload.fullName = fullName;
          updates.push("fullName");
          updatePayload.displayName = fullName;
        }
        if (role) {
          profilePayload.role = normalizeRole(role);
          updates.push("role");
        }
      }
      if (badgeNumber !== undefined) {
        const normalizedBadge = typeof badgeNumber === "string" ? badgeNumber.trim() : "";
        if (!normalizedBadge) {
          return res.status(400).json({ error: "Numer odznaki jest wymagany." });
        }
        if (!BADGE_PATTERN.test(normalizedBadge)) {
          return res.status(400).json({ error: "Numer odznaki powinien zawierać od 1 do 6 cyfr." });
        }
        profilePayload.badgeNumber = normalizedBadge;
        updates.push("badgeNumber");
      }
      if (password) {
        if (String(password).length < 6) {
          return res.status(400).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
        }
        updatePayload.password = password;
        updates.push("password");
      }
      if (Object.keys(profilePayload).length) {
        const updatedAt = adminFieldValue?.serverTimestamp?.();
        if (updatedAt) {
          profilePayload.updatedAt = updatedAt;
        }
        await adminDb.collection("profiles").doc(uid).set(profilePayload, { merge: true });
      }
      if (Object.keys(updatePayload).length) {
        try {
          await adminAuth.updateUser(uid, updatePayload);
        } catch (error: any) {
          const mapped = mapFirebaseAuthError(error);
          if (mapped) {
            return res.status(mapped.status).json({ error: mapped.message });
          }
          if (isAdminPermissionError(error)) {
            return res.status(403).json({
              error:
                "Konto Firebase Admin nie ma uprawnień do edycji użytkowników. Sprawdź konfigurację poświadczeń w środowisku.",
            });
          }
          throw error;
        }
      }
      return res.status(200).json({ ok: true, updated: updates });
    }

    if (req.method === "DELETE") {
      const uid = String(req.query.uid || "");
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
      try {
        await adminAuth.deleteUser(uid);
      } catch (error: any) {
        if (isAdminPermissionError(error)) {
          return res.status(403).json({
            error:
              "Konto Firebase Admin nie ma uprawnień do usuwania użytkowników. Sprawdź konfigurację poświadczeń w środowisku.",
          });
        }
        throw error;
      }
      await adminDb.collection("profiles").doc(uid).delete();
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PATCH,DELETE,OPTIONS");
    return res.status(405).end();
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Błąd serwera" });
  }
}
