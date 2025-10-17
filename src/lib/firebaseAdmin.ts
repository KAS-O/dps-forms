import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
const privateKey = rawPrivateKey?.replace(/\\n/g, "\n");

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
