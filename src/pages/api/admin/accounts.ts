import type { NextApiRequest, NextApiResponse } from "next";
import { Role, normalizeRole, hasBoardAccess } from "@/lib/roles";
import {
  type Department,
  type InternalUnit,
  type AdditionalRank,
  normalizeDepartment,
  normalizeInternalUnits,
  normalizeAdditionalRanks,
  getAdditionalRankOption,
  getInternalUnitOption,
} from "@/lib/hr";
import {
  FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID,
  FIRESTORE_BASE_URL,
  extractBearerToken,
  identityToolkitRequest,
  mapIdentityToolkitError,
  decodeFirestoreDocument,
  encodeFirestoreFields,
  fetchFirestoreDocument,
  createFirestoreProfile,
  updateFirestoreProfile,
  type IdentityToolkitUser,
  type FirestoreDocument,
} from "@/lib/server/firebaseRest";

type AccountResponse = {
  uid: string;
  login: string;
  fullName?: string;
  role: Role;
  email: string;
  createdAt?: string;
  badgeNumber?: string;
  department?: Department | null;
  units?: InternalUnit[];
  additionalRanks?: AdditionalRank[];
  additionalRank?: AdditionalRank | null;
};

async function listFirestoreProfiles(idToken: string): Promise<AccountResponse[]> {
  if (!FIRESTORE_BASE_URL) {
    throw Object.assign(new Error("Brak konfiguracji projektu Firestore"), { status: 500 });
  }
  const accounts: AccountResponse[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${FIRESTORE_BASE_URL}/documents/profiles`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error?.message || "Nie udało się pobrać profili użytkowników.";
      throw Object.assign(new Error(message), { status: res.status });
    }
    const documents: FirestoreDocument[] = Array.isArray(data?.documents) ? data.documents : [];
    documents.forEach((doc) => {
      const payload = decodeFirestoreDocument(doc);
      const uid = doc.name?.split("/").pop() || payload.uid;
      const loginRaw = typeof payload.login === "string" ? payload.login.trim() : "";
      const login = loginRaw || (payload.email ? String(payload.email).split("@")[0] : "") || uid || "";
      const role = normalizeRole(payload.role);
      const badgeNumber = typeof payload.badgeNumber === "string" ? payload.badgeNumber.trim() : undefined;
      const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : undefined;
      const fullName = typeof payload.fullName === "string" ? payload.fullName : undefined;
      const department = normalizeDepartment(payload.department);
      const units = normalizeInternalUnits(payload.units);
      const additionalRanks = normalizeAdditionalRanks(payload.additionalRanks ?? payload.additionalRank);
      accounts.push({
        uid: uid || login,
        login,
        fullName,
        role,
        email: login ? `${login}@${process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local"}` : "",
        ...(badgeNumber ? { badgeNumber } : {}),
        ...(createdAt ? { createdAt } : {}),
        department: department ?? null,
        units,
        additionalRanks,
        additionalRank: additionalRanks[0] ?? null,
      });
    });
    pageToken = data?.nextPageToken;
  } while (pageToken);

  accounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login, "pl", { sensitivity: "base" }));
  return accounts;
}

async function ensureBoardAccess(req: NextApiRequest) {
  const idToken = extractBearerToken(req);
  const lookup = await identityToolkitRequest<{ users: IdentityToolkitUser[] }>("/accounts:lookup", {
    idToken,
  });
  const user = lookup?.users?.[0];
  if (!user?.localId) {
    throw Object.assign(new Error("Nieautoryzowany"), { status: 401 });
  }
  const profileDoc = await fetchFirestoreDocument(`profiles/${user.localId}`, idToken);
  const profileData = decodeFirestoreDocument(profileDoc || {});
  const role = normalizeRole(profileData.role);
  if (!hasBoardAccess(role)) {
    throw Object.assign(new Error("Brak uprawnień"), { status: 403 });
  }
  return { idToken, uid: user.localId };
}

function validateLogin(login: string) {
  const pattern = /^[a-z0-9._-]+$/;
  if (!pattern.test(login)) {
    throw Object.assign(
      new Error("Login może zawierać jedynie małe litery, cyfry, kropki, myślniki i podkreślniki."),
      { status: 400 }
    );
  }
}

function validateBadge(badge: string) {
  const pattern = /^[0-9]{1,6}$/;
  if (!pattern.test(badge)) {
    throw Object.assign(new Error("Numer odznaki powinien zawierać od 1 do 6 cyfr."), { status: 400 });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,POST,PATCH,OPTIONS");
    return res.status(204).end();
  }

  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
    return res.status(500).json({
      error: "Brak konfiguracji Firebase REST. Ustaw zmienne FIREBASE_REST_API_KEY/NEXT_PUBLIC_FIREBASE_API_KEY i FIREBASE_REST_PROJECT_ID/NEXT_PUBLIC_FIREBASE_PROJECT_ID.",
    });
  }

  try {
    const { idToken } = await ensureBoardAccess(req);

    if (req.method === "GET") {
      const accounts = await listFirestoreProfiles(idToken);
      return res.status(200).json({ accounts });
    }

    if (req.method === "POST") {
      const { login, fullName, role, password, badgeNumber, department, units, additionalRanks, additionalRank } = req.body || {};
      if (!login || !password) {
        return res.status(400).json({ error: "Login i hasło są wymagane" });
      }
      const normalizedLogin = String(login).trim().toLowerCase();
      validateLogin(normalizedLogin);
      if (String(password).length < 6) {
        return res.status(400).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
      }
      const normalizedBadge = typeof badgeNumber === "string" ? badgeNumber.trim() : "";
      if (!normalizedBadge) {
        return res.status(400).json({ error: "Numer odznaki jest wymagany." });
      }
      validateBadge(normalizedBadge);

      const normalizedDepartment = normalizeDepartment(department);
      if (!normalizedDepartment) {
        return res.status(400).json({ error: "Wybierz poprawny departament." });
      }

      const normalizedUnits = normalizeInternalUnits(units);
      const normalizedAdditionalRanks = normalizeAdditionalRanks(additionalRanks ?? additionalRank);
      for (const rank of normalizedAdditionalRanks) {
        const rankOption = getAdditionalRankOption(rank);
        if (rankOption && !normalizedUnits.includes(rankOption.unit)) {
          const unitOption = getInternalUnitOption(rankOption.unit);
          const unitLabel = unitOption?.abbreviation || rankOption.unit.toUpperCase();
          return res
            .status(400)
            .json({ error: `Aby przypisać stopień ${rankOption.label}, dodaj jednostkę ${unitLabel}.` });
        }
      }

      const email = `${normalizedLogin}@${process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local"}`;
      const displayName = fullName ? String(fullName).trim() : normalizedLogin;

      const created = await identityToolkitRequest<{ localId: string }>("/accounts:signUp", {
        email,
        password,
        displayName,
        returnSecureToken: false,
      });

      if (!created?.localId) {
        throw new Error("Firebase nie zwrócił identyfikatora użytkownika.");
      }

      await createFirestoreProfile(
        created.localId,
        {
          login: normalizedLogin,
          fullName: displayName,
          role: normalizeRole(role),
          badgeNumber: normalizedBadge,
          department: normalizedDepartment,
          units: normalizedUnits,
          additionalRanks: normalizedAdditionalRanks,
          additionalRank: normalizedAdditionalRanks[0] ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        idToken
      );

      return res.status(201).json({ uid: created.localId });
    }

    if (req.method === "PATCH") {
      const { uid, fullName, role, badgeNumber, department, units, additionalRanks, additionalRank } = req.body || {};
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
      const profileDoc = await fetchFirestoreDocument(`profiles/${encodeURIComponent(uid)}`, idToken);
      if (!profileDoc) {
        return res.status(404).json({ error: "Nie znaleziono konta." });
      }
      const profileData = decodeFirestoreDocument(profileDoc);
      const updates: Record<string, any> = {};
      if (typeof fullName === "string") {
        const trimmed = fullName.trim();
        if (trimmed) {
          updates.fullName = trimmed;
        }
      }
      if (role) {
        updates.role = normalizeRole(role);
      }
      if (badgeNumber !== undefined) {
        const normalizedBadge = String(badgeNumber).trim();
        if (!normalizedBadge) {
          return res.status(400).json({ error: "Numer odznaki jest wymagany." });
        }
        validateBadge(normalizedBadge);
        updates.badgeNumber = normalizedBadge;
      }
      if (department !== undefined) {
        const normalizedDepartment = normalizeDepartment(department);
        if (department && !normalizedDepartment) {
          return res.status(400).json({ error: "Nieprawidłowy departament." });
        }
        updates.department = normalizedDepartment ?? null;
      }

      let normalizedUnits: InternalUnit[] = normalizeInternalUnits(profileData.units);
      if (units !== undefined) {
        normalizedUnits = normalizeInternalUnits(units);
        updates.units = normalizedUnits;
      }

      if (additionalRanks !== undefined || additionalRank !== undefined) {
        const source = additionalRanks !== undefined ? additionalRanks : additionalRank;
        const normalizedAdditionalRanks = normalizeAdditionalRanks(source);
        for (const rank of normalizedAdditionalRanks) {
          const rankOption = getAdditionalRankOption(rank);
          if (rankOption && !normalizedUnits.includes(rankOption.unit)) {
            const unitOption = getInternalUnitOption(rankOption.unit);
            const unitLabel = unitOption?.abbreviation || rankOption.unit.toUpperCase();
            return res
              .status(400)
              .json({ error: `Aby przypisać stopień ${rankOption.label}, dodaj jednostkę ${unitLabel}.` });
          }
        }
        updates.additionalRanks = normalizedAdditionalRanks;
        updates.additionalRank = normalizedAdditionalRanks[0] ?? null;
      }
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: "Brak zmian do zapisania." });
      }
      updates.updatedAt = new Date().toISOString();
      await updateFirestoreProfile(uid, updates, idToken);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PATCH,OPTIONS");
    return res.status(405).end();
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 500;
    const message = error?.message || "Błąd serwera";
    if (status >= 500) {
      console.error("HR accounts API error:", error);
    }
    return res.status(status).json({ error: message });
  }
}
