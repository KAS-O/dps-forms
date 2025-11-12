import type { NextApiRequest, NextApiResponse } from "next";
import { Role, normalizeRole, hasBoardAccess } from "@/lib/roles";
import {
  AUXILIARY_RANK_VALUE_SET,
  DEPARTMENT_VALUE_SET,
  INTERNAL_UNIT_VALUE_SET,
  getAuxiliaryRankUnit,
} from "@/lib/personnel";
import type {
  AuxiliaryRankValue,
  DepartmentValue,
  InternalUnitValue,
} from "@/lib/personnel";

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
  department?: string | null;
  units?: string[];
  auxiliaryRank?: string | null;
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
  if ("nullValue" in value) return null;
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
  if (value === null) {
    return { nullValue: null };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeFirestoreValue(item)).filter((item) => item !== undefined),
      },
    };
  }
  if (value && typeof value === "object") {
    const mapFields: Record<string, any> = {};
    Object.entries(value).forEach(([key, val]) => {
      const encoded = encodeFirestoreValue(val);
      if (encoded !== undefined) {
        mapFields[key] = encoded;
      }
    });
    return { mapValue: { fields: mapFields } };
  }
  if (value === undefined) {
    return undefined;
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
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
      const department =
        typeof payload.department === "string" && DEPARTMENT_VALUE_SET.has(payload.department as any)
          ? (payload.department as string)
          : null;
      const units = Array.isArray(payload.units)
        ? (payload.units as unknown[])
            .map((unit) => (typeof unit === "string" ? unit.trim().toLowerCase() : ""))
            .filter((unit) => unit && INTERNAL_UNIT_VALUE_SET.has(unit as any))
        : [];
      const auxiliaryRank =
        typeof payload.auxiliaryRank === "string" && AUXILIARY_RANK_VALUE_SET.has(payload.auxiliaryRank as any)
          ? (payload.auxiliaryRank as string)
          : null;
      accounts.push({
        uid: uid || login,
        login,
        fullName,
        role,
        email: login ? `${login}@${process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local"}` : "",
        ...(badgeNumber ? { badgeNumber } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(department ? { department } : { department: null }),
        units,
        ...(auxiliaryRank ? { auxiliaryRank } : { auxiliaryRank: null }),
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

function normalizeDepartmentInput(value: any): DepartmentValue | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Nieprawidłowy departament."), { status: 400 });
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!DEPARTMENT_VALUE_SET.has(normalized as any)) {
    throw Object.assign(new Error("Wybrano nieobsługiwany departament."), { status: 400 });
  }
  return normalized as DepartmentValue;
}

function normalizeUnitsInput(value: any): InternalUnitValue[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const result: InternalUnitValue[] = [];
  for (const entry of arr) {
    if (typeof entry !== "string") {
      throw Object.assign(new Error("Nieprawidłowa jednostka."), { status: 400 });
    }
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    if (!INTERNAL_UNIT_VALUE_SET.has(normalized as any)) {
      throw Object.assign(new Error("Wybrano nieobsługiwaną jednostkę."), { status: 400 });
    }
    const typed = normalized as InternalUnitValue;
    if (!result.includes(typed)) {
      result.push(typed);
    }
  }
  return result;
}

function normalizeAuxiliaryRankInput(value: any): AuxiliaryRankValue | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Nieprawidłowy dodatkowy stopień."), { status: 400 });
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!AUXILIARY_RANK_VALUE_SET.has(normalized as any)) {
    throw Object.assign(new Error("Wybrano nieobsługiwany dodatkowy stopień."), { status: 400 });
  }
  return normalized as AuxiliaryRankValue;
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
      const { login, fullName, role, password, badgeNumber, department, units, auxiliaryRank } = req.body || {};
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

      const normalizedDepartment = normalizeDepartmentInput(department) ?? null;
      const normalizedUnits = normalizeUnitsInput(units) ?? [];
      const normalizedAuxiliaryRank = normalizeAuxiliaryRankInput(auxiliaryRank) ?? null;

      let unitsToSave = normalizedUnits.slice();
      if (normalizedAuxiliaryRank) {
        const requiredUnit = getAuxiliaryRankUnit(normalizedAuxiliaryRank);
        if (requiredUnit && !unitsToSave.includes(requiredUnit)) {
          unitsToSave.push(requiredUnit);
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...(normalizedDepartment ? { department: normalizedDepartment } : {}),
          ...(unitsToSave.length ? { units: unitsToSave } : {}),
          ...(normalizedAuxiliaryRank ? { auxiliaryRank: normalizedAuxiliaryRank } : {}),
        },
        idToken
      );

      return res.status(201).json({ uid: created.localId });
    }

    if (req.method === "PATCH") {
      const { uid, fullName, role, badgeNumber, department, units, auxiliaryRank } = req.body || {};
      if (!uid) {
        return res.status(400).json({ error: "Brak UID" });
      }
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
      const normalizedDepartment = normalizeDepartmentInput(department);
      if (normalizedDepartment !== undefined) {
        updates.department = normalizedDepartment;
      }
      let normalizedUnits = normalizeUnitsInput(units);
      const normalizedAuxiliaryRank = normalizeAuxiliaryRankInput(auxiliaryRank);
      if (normalizedAuxiliaryRank !== undefined) {
        updates.auxiliaryRank = normalizedAuxiliaryRank;
      }
      if (normalizedAuxiliaryRank && normalizedUnits !== undefined) {
        const requiredUnit = getAuxiliaryRankUnit(normalizedAuxiliaryRank);
        if (requiredUnit && !normalizedUnits.includes(requiredUnit)) {
          normalizedUnits = [...normalizedUnits, requiredUnit];
        }
      }
      if (normalizedUnits !== undefined) {
        updates.units = normalizedUnits;
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
