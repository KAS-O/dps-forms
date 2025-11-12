import type { NextApiRequest } from "next";

export const FIREBASE_API_KEY =
  process.env.FIREBASE_REST_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";

export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_REST_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";

const IDENTITY_BASE_URL = "https://identitytoolkit.googleapis.com/v1";

export const FIRESTORE_BASE_URL = FIREBASE_PROJECT_ID
  ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`
  : "";

if (!FIREBASE_API_KEY) {
  console.warn("Brak klucza API Firebase (FIREBASE_REST_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY).");
}

if (!FIREBASE_PROJECT_ID) {
  console.warn(
    "Brak identyfikatora projektu Firebase (FIREBASE_REST_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID)."
  );
}

export type IdentityToolkitUser = {
  localId: string;
  email?: string;
  displayName?: string;
};

export type FirestoreDocument = {
  name?: string;
  fields?: Record<string, any>;
  createTime?: string;
  updateTime?: string;
};

export function extractBearerToken(req: NextApiRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw Object.assign(new Error("Brak tokenu uwierzytelniającego"), { status: 401 });
  }
  return header.slice(7);
}

export async function identityToolkitRequest<T>(path: string, body: unknown): Promise<T> {
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

export function mapIdentityToolkitError(message: string): string {
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

export function decodeFirestoreValue(value: any): any {
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

export function decodeFirestoreDocument(doc: FirestoreDocument): Record<string, any> {
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

export function encodeFirestoreValue(value: any): any {
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

export function encodeFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    const encoded = encodeFirestoreValue(value);
    if (encoded !== undefined) {
      fields[key] = encoded;
    }
  });
  return fields;
}

export async function fetchFirestoreDocument(
  path: string,
  idToken: string
): Promise<FirestoreDocument | null> {
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

export async function createFirestoreProfile(
  uid: string,
  fields: Record<string, any>,
  idToken: string
) {
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

export async function updateFirestoreProfile(
  uid: string,
  fields: Record<string, any>,
  idToken: string
) {
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
