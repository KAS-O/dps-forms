let admin: any = null;

if (typeof globalThis !== "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dynamicRequire = eval("require") as NodeJS.Require;
    admin = dynamicRequire("firebase-admin");
  } catch (err) {
    console.warn("Firebase Admin SDK nie jest dostępny:", err);
    admin = null;
  }
}

let app: any = null;

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
const privateKey = rawPrivateKey?.replace(/\\n/g, "\n");

if (admin) {
  if (admin.apps?.length) {
    app = admin.apps[0];
  } else if (projectId && clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

export const adminApp = app;
export const adminAuth = app && admin ? admin.auth(app) : null;
export const adminDb = app && admin ? admin.firestore(app) : null;
export const adminFieldValue = admin?.firestore?.FieldValue ?? null;
export const adminTimestamp = admin?.firestore?.Timestamp ?? null;
