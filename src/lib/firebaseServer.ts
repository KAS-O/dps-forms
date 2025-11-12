import crypto from "crypto";

import { JWT } from "google-auth-library";

import {
  adminApp,
  adminAuth,
  adminDb,
  adminFieldValue,
  adminProjectId,
  adminClientEmail,
  adminPrivateKey,
} from "./firebaseAdmin";
import { normalizeRole } from "./roles";
import type { Role } from "./roles";

export type DecodedIdentity = {
  uid: string;
  email?: string;
  displayName?: string;
};

export type ProfileData = {
  login: string;
  fullName: string;
  role: string;
  badgeNumber: string;
  createdAt?: string;
  updatedAt?: string;
};

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

const FIREBASE_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/firebase",
  "https://www.googleapis.com/auth/identitytoolkit",
];

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

let jwtClient: JWT | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function serviceAccountAvailable() {
  return Boolean(adminProjectId && adminClientEmail && adminPrivateKey);
}

async function getJwtClient(): Promise<JWT | null> {
  if (!serviceAccountAvailable()) {
    return null;
  }
  if (jwtClient) {
    return jwtClient;
  }
  jwtClient = new JWT({
    email: adminClientEmail as string,
    key: adminPrivateKey as string,
    scopes: FIREBASE_SCOPES,
  });
  return jwtClient;
}

async function getAccessToken(): Promise<string | null> {
  const client = await getJwtClient();
  if (!client) return null;

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const { token, expiry_date } = await client.authorize();
  if (!token) return null;
  cachedAccessToken = {
    token,
    expiresAt: typeof expiry_date === "number" ? expiry_date : Date.now() + 60 * 60 * 1000,
  };
  return token;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { integerValue: Math.trunc(value).toString() };
  }
  if (value && typeof value === "object") {
    const fields: Record<string, FirestoreValue> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      fields[key] = toFirestoreValue(val);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value ?? "") };
}

function fromFirestoreDocument(doc: any): Record<string, any> {
  if (!doc || !doc.fields) return {};
  const result: Record<string, any> = {};
  Object.entries(doc.fields).forEach(([key, raw]) => {
    const value = raw as any;
    if (value.stringValue !== undefined) {
      result[key] = value.stringValue;
    } else if (value.integerValue !== undefined) {
      result[key] = value.integerValue;
    } else if (value.mapValue?.fields) {
      result[key] = fromFirestoreDocument(value.mapValue);
    }
  });
  return result;
}

async function identityToolkitRequest<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  const token = await getAccessToken();
  if (!token || !adminProjectId) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  const payload = { ...body };
  if (!payload.targetProjectId) {
    payload.targetProjectId = adminProjectId;
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${adminProjectId}/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message = data?.error?.message || res.statusText || "Identity Toolkit request failed";
    const error = new Error(message);
    (error as any).code = data?.error?.message || data?.error?.status || res.status;
    throw error;
  }

  return (await res.json()) as T;
}

async function firestoreRequest<T>(
  method: string,
  path: string,
  body?: Record<string, any>,
  query?: URLSearchParams
): Promise<T> {
  const token = await getAccessToken();
  if (!token || !adminProjectId) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }
  const qs = query ? `?${query.toString()}` : "";
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${adminProjectId}/databases/(default)${path}${qs}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Firestore request failed (${res.status}): ${text}`);
  }
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          return null;
        }
      })
      .filter((entry) => entry !== null);
    return lines as unknown as T;
  }
}

export const firebaseAdminAvailable = Boolean(adminApp && adminAuth && adminDb && adminFieldValue);

export async function verifyIdentityToken(idToken: string): Promise<DecodedIdentity> {
  if (firebaseAdminAvailable && adminAuth) {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || undefined, displayName: decoded.name || undefined };
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("Brak konfiguracji API Key Firebase (NEXT_PUBLIC_FIREBASE_API_KEY)");
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) {
    throw new Error("Nie udało się zweryfikować tokenu użytkownika");
  }
  const data = (await res.json()) as any;
  const user = Array.isArray(data?.users) ? data.users[0] : null;
  if (!user?.localId) {
    throw new Error("Nieprawidłowy token użytkownika");
  }
  return {
    uid: user.localId,
    email: user.email,
    displayName: user.displayName,
  };
}

export async function fetchProfile(uid: string): Promise<Record<string, any> | null> {
  if (firebaseAdminAvailable && adminDb) {
    const snap = await adminDb.collection("profiles").doc(uid).get();
    return snap.exists ? snap.data() || null : null;
  }

  if (!serviceAccountAvailable()) {
    return null;
  }
  try {
    const doc = await firestoreRequest<any>("GET", `/documents/profiles/${uid}`);
    return doc ? fromFirestoreDocument(doc) : null;
  } catch (error: any) {
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.includes("(404)")) {
      return null;
    }
    throw error;
  }
}

export async function ensureBoard(uid: string): Promise<{ profile: Record<string, any>; role: Role }> {
  const profile = await fetchProfile(uid);
  if (!profile) {
    throw new Error("Brak profilu użytkownika");
  }
  const role = normalizeRole(profile.role);
  if (
    !role ||
    ![
      "staff-commander",
      "executive-commander",
      "deputy-chief",
      "assistant-chief",
      "chief-of-police",
      "director",
      "admin",
    ].includes(role)
  ) {
    throw new Error("FORBIDDEN");
  }
  return { profile, role };
}

export async function listAccountsFallback(): Promise<Array<{ uid: string; login: string; fullName: string; email: string; role: string; createdAt?: string; badgeNumber?: string }>> {
  if (firebaseAdminAvailable && adminAuth && adminDb) {
    throw new Error("Fallback shouldn't be used when Firebase Admin is available");
  }
  if (!serviceAccountAvailable()) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  const users: any[] = [];
  let nextPageToken: string | undefined;
  do {
    const data = await identityToolkitRequest<any>("accounts:query", {
      returnUserInfo: true,
      maxResults: 1000,
      nextPageToken,
    });
    if (Array.isArray(data?.userInfo)) {
      users.push(...data.userInfo);
    }
    nextPageToken = data?.nextPageToken;
  } while (nextPageToken);

  const profilesQuery = await firestoreRequest<any[]>("POST", "/documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "profiles" }],
    },
  });

  const profiles = new Map<string, Record<string, any>>();
  profilesQuery.forEach((entry) => {
    const doc = entry?.document;
    if (!doc?.name) return;
    const name: string = doc.name;
    const parts = name.split("/profiles/");
    const uid = parts[1] || parts[0];
    if (!uid) return;
    profiles.set(uid, fromFirestoreDocument(doc));
  });

  return users.map((user) => {
    const profile = profiles.get(user.localId) || {};
    const login = (profile.login || user.email?.split("@")[0] || "").toLowerCase();
    const email = `${login}@${LOGIN_DOMAIN}`;
    const fullName = profile.fullName || user.displayName || login;
    const role = normalizeRole(profile.role);
    const badgeNumber = typeof profile.badgeNumber === "string" ? profile.badgeNumber : undefined;
    return {
      uid: user.localId,
      login,
      fullName,
      email,
      role,
      badgeNumber,
      createdAt: user.createdAt || user.createdAtUtc || undefined,
    };
  });
}

export async function createAccountFallback({
  login,
  fullName,
  role,
  password,
  badgeNumber,
}: {
  login: string;
  fullName: string;
  role: string;
  password: string;
  badgeNumber: string;
}) {
  if (!serviceAccountAvailable()) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  const email = `${login}@${LOGIN_DOMAIN}`;
  const user = await identityToolkitRequest<any>("accounts:signUp", {
    email,
    password,
    displayName: fullName || login,
  });

  const uid = user.localId as string;
  const now = new Date().toISOString();
  await firestoreRequest("POST", "/documents/profiles", {
    fields: {
      login: toFirestoreValue(login),
      fullName: toFirestoreValue(fullName || login),
      role: toFirestoreValue(normalizeRole(role)),
      badgeNumber: toFirestoreValue(badgeNumber),
      createdAt: toFirestoreValue(now),
    },
  }, new URLSearchParams({ documentId: uid }));

  return uid;
}

export async function updateAccountFallback({
  uid,
  login,
  fullName,
  role,
  password,
  badgeNumber,
}: {
  uid: string;
  login?: string;
  fullName?: string;
  role?: string;
  password?: string;
  badgeNumber?: string;
}) {
  if (!serviceAccountAvailable()) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  const payload: Record<string, any> = { localId: uid };
  if (login) {
    payload.email = `${login}@${LOGIN_DOMAIN}`;
  }
  if (fullName) {
    payload.displayName = fullName;
  }
  if (password) {
    payload.password = password;
  }
  await identityToolkitRequest("accounts:update", payload);

  const updateMask: string[] = [];
  const fields: Record<string, FirestoreValue> = {};
  if (login) {
    fields.login = toFirestoreValue(login);
    updateMask.push("login");
  }
  if (fullName) {
    fields.fullName = toFirestoreValue(fullName);
    updateMask.push("fullName");
  }
  if (role) {
    fields.role = toFirestoreValue(normalizeRole(role));
    updateMask.push("role");
  }
  if (badgeNumber !== undefined) {
    fields.badgeNumber = toFirestoreValue(badgeNumber);
    updateMask.push("badgeNumber");
  }

  fields.updatedAt = toFirestoreValue(new Date().toISOString());
  updateMask.push("updatedAt");

  await firestoreRequest(
    "PATCH",
    `/documents/profiles/${uid}`,
    { fields },
    new URLSearchParams(updateMask.map((path) => ["updateMask.fieldPaths", path]))
  );
}

export async function deleteAccountFallback(uid: string) {
  if (!serviceAccountAvailable()) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  await identityToolkitRequest("accounts:delete", { localId: uid });
  await firestoreRequest("DELETE", `/documents/profiles/${uid}`);
}

export async function writeLogsFallback(
  actor: { uid: string; login: string; name: string },
  events: Record<string, any>[]
) {
  if (!serviceAccountAvailable()) {
    throw new Error("Brak konfiguracji poświadczeń Firebase Admin");
  }

  const writes = events.map((event) => {
    const id = crypto.randomUUID();
    return {
      update: {
        name: `projects/${adminProjectId}/databases/(default)/documents/logs/${id}`,
        fields: {
          ...Object.fromEntries(
            Object.entries(event).map(([key, value]) => [key, toFirestoreValue(value)])
          ),
          login: toFirestoreValue(actor.login),
          uid: toFirestoreValue(actor.uid),
          actorUid: toFirestoreValue(actor.uid),
          actorLogin: toFirestoreValue(actor.login),
          actorName: toFirestoreValue(actor.name),
          ts: toFirestoreValue(new Date().toISOString()),
        },
      },
    };
  });

  await firestoreRequest("POST", "/documents:commit", { writes });
}
