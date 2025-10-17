import fs from "fs";
import path from "path";

import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function decodeServiceAccount(raw?: string | null): ServiceAccount | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryParse = (value: string) => {
    try {
      return JSON.parse(value) as ServiceAccount;
    } catch (error) {
      console.warn("Nie udało się sparsować konfiguracji Firebase Admin:", error);
      return null;
    }
  };

  if (trimmed.startsWith("{")) {
    return tryParse(trimmed);
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return tryParse(decoded);
  } catch (error) {
    console.warn("Nie udało się zdekodować konfiguracji Firebase Admin z Base64:", error);
    return null;
  }
}

function readServiceAccountFile(filePath?: string | null): ServiceAccount | null {
  if (!filePath) return null;

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`Firebase Admin service account file not found at: ${resolved}`);
    return null;
  }

  try {
    const content = fs.readFileSync(resolved, "utf8");
    return decodeServiceAccount(content);
  } catch (error) {
    console.warn("Nie udało się odczytać pliku konfiguracji Firebase Admin:", error);
    return null;
  }
}

const serviceAccount =
  decodeServiceAccount(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT) ||
  decodeServiceAccount(process.env.FIREBASE_ADMIN_CREDENTIALS) ||
  readServiceAccountFile(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH) ||
  readServiceAccountFile(process.env.GOOGLE_APPLICATION_CREDENTIALS);

let projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
let clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
let rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

if (serviceAccount) {
  projectId = projectId || serviceAccount.project_id;
  clientEmail = clientEmail || serviceAccount.client_email;
  rawPrivateKey = rawPrivateKey || serviceAccount.private_key;
}

if (!rawPrivateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY_BASE64) {
  try {
    rawPrivateKey = Buffer.from(process.env.FIREBASE_ADMIN_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  } catch (error) {
    console.warn("Nie udało się zdekodować klucza prywatnego Firebase Admin z Base64:", error);
  }
}

const privateKey = rawPrivateKey
  ?.replace(/\\n/g, "\n")
  .replace(/\r?\n/g, "\n");

const globalWithAdmin = globalThis as typeof globalThis & { __FIREBASE_ADMIN_APP__?: App };

function ensureFirebaseAdminApp(): App | null {
  if (globalWithAdmin.__FIREBASE_ADMIN_APP__) {
    return globalWithAdmin.__FIREBASE_ADMIN_APP__;
  }

  if (getApps().length) {
    const existing = getApps()[0];
    globalWithAdmin.__FIREBASE_ADMIN_APP__ = existing;
    return existing;
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("Firebase Admin SDK environment variables are missing.");
    return null;
  }

  try {
    const app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    globalWithAdmin.__FIREBASE_ADMIN_APP__ = app;
    return app;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    return null;
  }
}

const app = ensureFirebaseAdminApp();

export const adminApp = app;
export const adminAuth = app ? getAuth(app) : null;
export const adminDb = app ? getFirestore(app) : null;
export const adminFieldValue: typeof FieldValue | null = app ? FieldValue : null;
export const adminTimestamp: typeof Timestamp | null = app ? Timestamp : null;
