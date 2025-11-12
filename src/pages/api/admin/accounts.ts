import type { NextApiRequest, NextApiResponse } from "next";
import { Role, normalizeRole, hasBoardAccess } from "@/lib/roles";
import {
  type Department,
  type InternalUnit,
  type AdditionalRank,
  normalizeDepartment,
  normalizeInternalUnits,
  normalizeAdditionalRank,
  getAdditionalRankOption,
  getInternalUnitOption,
} from "@/lib/hr";

const FIREBASE_API_KEY = process.env.FIREBASE_REST_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_REST_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";

const IDENTITY_BASE_URL = "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE_BASE_URL = FIREBASE_PROJECT_ID
  ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`
  : "";

if (!FIREBASE_API_KEY) {
  console.warn("Brak klucza API Firebase (FIREBASE_REST_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY).");
}

if (!FIREBASE_PROJECT_ID) {
  console.warn("Brak identyfikatora projektu Firebase (FIREBASE_REST_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID).");
}

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
  additionalRank?: AdditionalRank | null;
};

type IdentityToolkitUser = {
  localId: string;
  email?: string;
  displayName?: string;
};

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, any>;
  createTime?: string;
  updateTime?: string;
};

function extractBearerToken(req: NextApiRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw Object.assign(new Error("Brak tokenu uwierzytelniającego"), { status: 401 });
  }
  return header.slice(7);
}

async function identityToolkitRequest<T>(path: string, body: unknown): Promise<T> {
  if (!FIREBASE_API_KEY) {
    throw Object.assign(new Error("Brak konfiguracji Firebase API key"), { status: 500 });
  }
  const url = `${IDENTITY_BASE_URL}${path}?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || "Błąd komunikacji z Firebase Identity Toolkit";
    throw Object.assign(new Error(mapIdentityToolkitError(message)), { status: res.status });
  }
  return data as T;
}

function mapIdentityToolkitError(message: string): string {
  switch (message) {
    case "EMAIL_EXISTS":
      return "Login jest już zajęty.";
    case "INVALID_EMAIL":
    case "INVALID_ID_TOKEN":
      return "Nieprawidłowe dane logowania lub token.";
    case "WEAK_PASSWORD : Password should be at least 6 characters":
    case "WEAK_PASSWORD":
    case "INVALID_PASSWORD":
      return "Hasło musi mieć co najmniej 6 znaków.";
    default:
      return "Błąd usługi Firebase: " + message;
  }
}

function decodeFirestoreValue(value: any): any {
  if (value == null || typeof value !== "object") return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const arr = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return arr.map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields = value.mapValue?.fields || {};
    const result: Record<string, any> = {};
    Object.entries(fields).forEach(([k, v]) => {
      result[k] = decodeFirestoreValue(v);
    });
    return result;
  }
  return undefined;
}

function decodeFirestoreDocument(doc: FirestoreDocument): Record<string, any> {
  const result: Record<string, any> = {};
  if (!doc?.fields) return result;
  Object.entries(doc.fields).forEach(([key, value]) => {
    result[key] = decodeFirestoreValue(value);
  });
  if (doc.createTime) {
    result.createdAt = result.createdAt || doc.createTime;
  }
  if (doc.updateTime) {
    result.updatedAt = doc.updateTime;
  }
  return result;
}

function encodeFirestoreValue(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    const values = value
      .map((item) => encodeFirestoreValue(item))
      .filter((item) => item !== undefined);
    return { arrayValue: { values } };
  }
  if (typeof value === "object") {
    const fields: Record<string, any> = {};
    Object.entries(value).forEach(([key, val]) => {
      const encoded = encodeFirestoreValue(val);
      if (encoded !== undefined) {
        fields[key] = encoded;
      }
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    const encoded = encodeFirestoreValue(value);
    if (encoded !== undefined) {
      fields[key] = encoded;
    }
  });
  return fields;
}

async function fetchFirestoreDocument(path: string, idToken: string): Promise<FirestoreDocument | null> {
  if (!FIRESTORE_BASE_URL) {
    throw Object.assign(new Error("Brak konfiguracji projektu Firestore"), { status: 500 });
  }
  const url = `${FIRESTORE_BASE_URL}/documents/${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (res.status === 404) {
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || "Błąd pobierania dokumentu Firestore";
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data as FirestoreDocument;
}

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
      const additionalRank = normalizeAdditionalRank(payload.additionalRank);
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
        additionalRank: additionalRank ?? null,
      });
    });
    pageToken = data?.nextPageToken;
  } while (pageToken);

  accounts.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login, "pl", { sensitivity: "base" }));
  return accounts;
}

async function createFirestoreProfile(uid: string, fields: Record<string, any>, idToken: string) {
  if (!FIRESTORE_BASE_URL) {
    throw Object.assign(new Error("Brak konfiguracji projektu Firestore"), { status: 500 });
  }
  const url = `${FIRESTORE_BASE_URL}/documents/profiles?documentId=${encodeURIComponent(uid)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: encodeFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data?.error?.message || "Nie udało się zapisać profilu użytkownika.";
    throw Object.assign(new Error(message), { status: res.status });
  }
}

async function updateFirestoreProfile(uid: string, fields: Record<string, any>, idToken: string) {
  if (!FIRESTORE_BASE_URL) {
    throw Object.assign(new Error("Brak konfiguracji projektu Firestore"), { status: 500 });
  }
  const url = new URL(`${FIRESTORE_BASE_URL}/documents/profiles/${encodeURIComponent(uid)}`);
  Object.keys(fields).forEach((key) => {
    url.searchParams.append("updateMask.fieldPaths", key);
  });
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: encodeFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data?.error?.message || "Nie udało się zaktualizować profilu użytkownika.";
    throw Object.assign(new Error(message), { status: res.status });
  }
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
      const { login, fullName, role, password, badgeNumber, department, units, additionalRank } = req.body || {};
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
      const normalizedAdditionalRank = normalizeAdditionalRank(additionalRank);
      if (normalizedAdditionalRank) {
        const rankOption = getAdditionalRankOption(normalizedAdditionalRank);
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
          additionalRank: normalizedAdditionalRank ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        idToken
      );

      return res.status(201).json({ uid: created.localId });
    }

    if (req.method === "PATCH") {
      const { uid, fullName, role, badgeNumber, department, units, additionalRank } = req.body || {};
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

      if (additionalRank !== undefined) {
        const normalizedAdditionalRank = normalizeAdditionalRank(additionalRank);
        if (normalizedAdditionalRank) {
          const rankOption = getAdditionalRankOption(normalizedAdditionalRank);
          if (rankOption && !normalizedUnits.includes(rankOption.unit)) {
            const unitOption = getInternalUnitOption(rankOption.unit);
            const unitLabel = unitOption?.abbreviation || rankOption.unit.toUpperCase();
            return res
              .status(400)
              .json({ error: `Aby przypisać stopień ${rankOption.label}, dodaj jednostkę ${unitLabel}.` });
          }
          updates.additionalRank = normalizedAdditionalRank;
        } else {
          updates.additionalRank = null;
        }
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
