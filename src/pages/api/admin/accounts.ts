import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebaseAdmin";
import { Role, normalizeRole } from "@/lib/roles";

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
};

async function verifyDirector(req: NextApiRequest) {
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
  if (role !== "director") {
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

function buildAccountsFromProfiles(profiles: Map<string, any>): AccountResponse[] {
  const fallbackAccounts: AccountResponse[] = [];
  profiles.forEach((profile, uid) => {
    const rawLogin = typeof profile?.login === "string" ? profile.login.trim() : "";
    const loginFromEmail = typeof profile?.email === "string" ? profile.email.split("@")[0] : "";
    const login = (rawLogin || loginFromEmail || uid || "").toLowerCase();
    const email = `${login}@${LOGIN_DOMAIN}`;
    const fullName = typeof profile?.fullName === "string" && profile.fullName ? profile.fullName : login;
    const createdAt = profileTimestampToString(profile?.createdAt);

    fallbackAccounts.push({
      uid,
      login,
      fullName,
      role: normalizeRole(profile?.role),
      email,
      ...(createdAt ? { createdAt } : {}),
    });
  });

  fallbackAccounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login));
  return fallbackAccounts;
}

async function listAccounts(): Promise<AccountResponse[]> {
  if (!adminDb) return [];

  const profilesSnap = await adminDb.collection("profiles").get();
  const profiles = new Map<string, any>();
  profilesSnap.forEach((doc) => profiles.set(doc.id, doc.data()));

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
        accounts.push({
          uid: user.uid,
          login: profile.login || user.email?.split("@")[0] || "",
          fullName: profile.fullName || user.displayName || "",
          role: normalizeRole(profile.role),
          email: user.email || "",
          createdAt: user.metadata.creationTime || undefined,
        });
      });
      pageToken = res.pageToken;
    } while (pageToken);
  } catch (error: any) {
    if (error?.code === "auth/insufficient-permission" || error?.code === "auth/admin-restricted-operation") {
     console.warn(
        "Brak uprawnień Firebase Admin do listowania użytkowników, używam danych z kolekcji 'profiles'."
      );
      return buildAccountsFromProfiles(profiles);
    }
    throw error;
  }

  accounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login));
  return accounts;
}

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await verifyDirector(req);
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
      const { login, fullName, role, password } = req.body || {};
      if (!login || !password) {
        return res.status(400).json({ error: "Login i hasło są wymagane" });
      }
      const normalizedLogin = String(login).trim().toLowerCase();
      const email = `${normalizedLogin}@${LOGIN_DOMAIN}`;
      const newUser = await adminAuth.createUser({
        email,
        password,
        displayName: fullName || normalizedLogin,
      });

      const createdAt = adminFieldValue?.serverTimestamp?.();
      await adminDb.collection("profiles").doc(newUser.uid).set({
        login: normalizedLogin,
        fullName: fullName || normalizedLogin,
        role: normalizeRole(role),
        ...(createdAt ? { createdAt } : {}),
      });

      return res.status(201).json({ uid: newUser.uid });
    }

    if (req.method === "PATCH") {
      const { uid, login, fullName, role, password } = req.body || {};
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
      const updates: string[] = [];
      const updatePayload: any = {};
      if (login) {
        const normalizedLogin = String(login).trim().toLowerCase();
        updatePayload.email = `${normalizedLogin}@${LOGIN_DOMAIN}`;
        updatePayload.displayName = fullName || normalizedLogin;
        const updatedAt = adminFieldValue?.serverTimestamp?.();
        await adminDb
          .collection("profiles")
          .doc(uid)
          .set(
            {
              login: normalizedLogin,
              fullName: fullName || normalizedLogin,
              ...(role ? { role: normalizeRole(role) } : {}),
              ...(updatedAt ? { updatedAt } : {}),
            },
            { merge: true }
          );
        updates.push("login");
      } else if (fullName || role) {
        const updatedAt = adminFieldValue?.serverTimestamp?.();
        await adminDb
          .collection("profiles")
          .doc(uid)
          .set(
            {
              ...(fullName ? { fullName } : {}),
              ...(role ? { role: normalizeRole(role) } : {}),
              ...(updatedAt ? { updatedAt } : {}),
            },
            { merge: true }
          );
        if (fullName) updates.push("fullName");
        if (role) updates.push("role");
        if (fullName) {
          updatePayload.displayName = fullName;
        }
      }
      if (password) {
        updatePayload.password = password;
        updates.push("password");
      }
      if (Object.keys(updatePayload).length) {
        await adminAuth.updateUser(uid, updatePayload);
      }
      return res.status(200).json({ ok: true, updated: updates });
    }

    if (req.method === "DELETE") {
      const uid = String(req.query.uid || "");
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
      await adminAuth.deleteUser(uid);
      await adminDb.collection("profiles").doc(uid).delete();
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PATCH,DELETE");
    return res.status(405).end();
  } catch (e: any) {
    console.error(e);

    if (e?.code && typeof e.code === "string" && e.code.startsWith("auth/")) {
      switch (e.code) {
        case "auth/email-already-exists":
        case "auth/uid-already-exists":
          return res.status(409).json({ error: "Login jest już zajęty." });
        case "auth/invalid-password":
        case "auth/weak-password":
          return res.status(400).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
        case "auth/invalid-email":
          return res.status(400).json({ error: "Nieprawidłowy login." });
        default:
          return res.status(400).json({ error: e?.message || "Błąd zapisu konta" });
      }
    }

    return res.status(500).json({ error: e?.message || "Błąd serwera" });
  }
}
