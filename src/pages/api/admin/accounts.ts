import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebaseAdmin";
import {
  isIdentityConfigured,
  lookupIdToken,
  signUpUser,
  updateDisplayName,
} from "@/lib/firebaseIdentity";
import {
  createProfileDocument,
  getProfileDocument,
  listProfilesDocuments,
  updateProfileDocument,
} from "@/lib/firestoreRest";
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

type AccessContext = {
  uid: string;
  role: Role;
  idToken: string;
  usingAdmin: boolean;
};

async function verifyBoardAccess(req: NextApiRequest): Promise<AccessContext> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("Brak tokenu uwierzytelniającego");
  }
  const token = header.slice(7);

  if (adminAuth && adminDb) {
    const decoded = await adminAuth.verifyIdToken(token);
    const profileSnap = await adminDb.collection("profiles").doc(decoded.uid).get();
    const role = normalizeRole(profileSnap.data()?.role);
    if (!hasBoardAccess(role)) {
      throw new Error("FORBIDDEN");
    }
    return { uid: decoded.uid, role, idToken: token, usingAdmin: true };
  }

  if (!isIdentityConfigured()) {
    throw new Error("Brak konfiguracji Firebase Admin");
  }

  const identity = await lookupIdToken(token);
  if (!identity?.uid) {
    throw new Error("Nie udało się zweryfikować tokenu");
  }
  const profile = await getProfileDocument(identity.uid, token);
  const role = normalizeRole(profile?.role);
  if (!hasBoardAccess(role)) {
    throw new Error("FORBIDDEN");
  }
  return { uid: identity.uid, role, idToken: token, usingAdmin: false };
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

async function listAccounts(context: AccessContext): Promise<AccountResponse[]> {
  if (adminDb && context.usingAdmin) {
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

  try {
    const docs = await listProfilesDocuments(context.idToken);
    const profiles = new Map<string, any>();
    docs.forEach((doc) => profiles.set(doc.uid, doc.data));
    return buildAccountsFromProfiles(profiles);
  } catch (error) {
    console.error("Nie udało się pobrać profili użytkowników (REST):", error);
    return [];
  }
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
    case "EMAIL_EXISTS":
      return { status: 400, message: "Login jest już zajęty." };
    case "auth/invalid-email":
    case "INVALID_EMAIL":
      return {
        status: 400,
        message: "Login zawiera niedozwolone znaki. Dozwolone są małe litery, cyfry, kropki, myślniki i podkreślniki.",
      };
    case "auth/invalid-password":
    case "auth/weak-password":
    case "INVALID_PASSWORD":
    case "WEAK_PASSWORD":
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

  let access: AccessContext;
  try {
    access = await verifyBoardAccess(req);
  } catch (e: any) {
    if (e.message === "FORBIDDEN") {
      return res.status(403).json({ error: "Brak uprawnień" });
    }
    return res.status(401).json({ error: e?.message || "Nieautoryzowany" });
  }

  try {
    if (req.method === "GET") {
      const accounts = await listAccounts(access);
      return res.status(200).json({ accounts });
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

      if (!access.usingAdmin || !adminAuth || !adminDb) {
        try {
          const created = await signUpUser(email, password);
          const displayName = fullName || normalizedLogin;
          if (displayName) {
            try {
              await updateDisplayName(created.idToken, displayName);
            } catch (err) {
              console.warn("Nie udało się ustawić displayName dla nowego konta:", err);
            }
          }
          const profilePayload: Record<string, any> = {
            login: normalizedLogin,
            fullName: displayName,
            role: normalizeRole(role),
            badgeNumber: normalizedBadge,
            createdAt: new Date().toISOString(),
          };
          try {
            await createProfileDocument(created.localId, access.idToken, profilePayload);
          } catch (err: any) {
            if (typeof err?.message === "string" && err.message.includes("Already exists")) {
              await updateProfileDocument(created.localId, access.idToken, profilePayload);
            } else {
              throw err;
            }
          }
          return res.status(201).json({ uid: created.localId });
        } catch (error: any) {
          const mapped = mapFirebaseAuthError(error);
          if (mapped) {
            return res.status(mapped.status).json({ error: mapped.message });
          }
          if (error?.message) {
            return res.status(500).json({ error: error.message });
          }
          throw error;
        }
      }

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
      if (!access.usingAdmin || !adminAuth || !adminDb) {
        if (login || password) {
          return res.status(501).json({
            error:
              "Zmiana loginu lub hasła wymaga konfiguracji Firebase Admin na serwerze. Sprawdź README i ustaw dane usługi.",
          });
        }
        const profilePayload: Record<string, any> = {};
        const updates: string[] = [];
        if (fullName) {
          profilePayload.fullName = String(fullName);
          updates.push("fullName");
        }
        if (role) {
          profilePayload.role = normalizeRole(role);
          updates.push("role");
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
        if (!updates.length) {
          return res.status(200).json({ ok: true, updated: [] });
        }
        profilePayload.updatedAt = new Date().toISOString();
        try {
          await updateProfileDocument(uid, access.idToken, profilePayload);
        } catch (error: any) {
          return res.status(500).json({ error: error?.message || "Nie udało się zaktualizować profilu" });
        }
        return res.status(200).json({ ok: true, updated: updates });
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
      if (!access.usingAdmin || !adminAuth || !adminDb) {
        return res.status(501).json({
          error:
            "Usuwanie kont wymaga konfiguracji Firebase Admin na serwerze. Sprawdź README i ustaw dane usługi.",
        });
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
