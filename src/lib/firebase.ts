import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getStorage } from "firebase/storage";

type FirebaseConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

export function normalizeStorageBucket(bucket?: string | null) {
  if (!bucket) return undefined;
  const trimmed = bucket.trim();
  if (!trimmed) return undefined;
  if (/\.firebasestorage\.app$/i.test(trimmed)) {
    return trimmed.replace(/\.firebasestorage\.app$/i, ".appspot.com");
  }
  return trimmed;
}

const rawStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const normalizedStorageBucket = normalizeStorageBucket(rawStorageBucket);

const firebaseConfig: FirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: normalizedStorageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfigKeys: (keyof FirebaseConfig)[] = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];

const hasRequiredConfig = requiredConfigKeys.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value.length > 0;
});

const isBrowser = typeof window !== "undefined";

const firebaseApp = isBrowser && hasRequiredConfig
  ? getApps()[0] ?? initializeApp(firebaseConfig as FirebaseOptions)
  : null;

if (isBrowser && !hasRequiredConfig) {
  console.warn(
    "Firebase client SDK nie został zainicjalizowany. Upewnij się, że wszystkie zmienne środowiskowe NEXT_PUBLIC_FIREBASE_* są ustawione."
  );
}

export const app = firebaseApp;
export const auth = firebaseApp ? getAuth(firebaseApp) : (null as unknown as ReturnType<typeof getAuth>);
export const db = firebaseApp ? getFirestore(firebaseApp) : (null as unknown as ReturnType<typeof getFirestore>);
export const storage = firebaseApp ? getStorage(firebaseApp) : (null as unknown as ReturnType<typeof getStorage>);
export const storageBucket = normalizedStorageBucket;
export { serverTimestamp };
