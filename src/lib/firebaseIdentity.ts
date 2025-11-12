const IDENTITY_BASE_URL = "https://identitytoolkit.googleapis.com/v1";

const apiKey =
  process.env.FIREBASE_IDENTITY_API_KEY ||
  process.env.FIREBASE_ADMIN_API_KEY ||
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

if (!apiKey) {
  console.warn("Brak klucza API Firebase Identity. Operacje na kontach będą niedostępne.");
}

type IdentityToolkitError = {
  error?: {
    message?: string;
  };
};

type LookupUserResponse = {
  users?: { localId?: string; email?: string }[];
};

type SignUpResponse = {
  idToken: string;
  localId: string;
};

type UpdateResponse = {
  localId?: string;
};

async function requestIdentity<T>(
  path: string,
  payload: Record<string, any>
): Promise<T> {
  if (!apiKey) {
    throw new Error("Brak konfiguracji klucza API Firebase Identity");
  }

  const res = await fetch(`${IDENTITY_BASE_URL}/${path}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as T | IdentityToolkitError;

  if (!res.ok) {
    const errorCode = (data as IdentityToolkitError)?.error?.message;
    const error = new Error(errorCode || `Firebase Identity error: ${res.status}`);
    (error as any).code = errorCode;
    throw error;
  }

  return data as T;
}

export async function lookupIdToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  if (!idToken || !apiKey) return null;
  const data = await requestIdentity<LookupUserResponse>("accounts:lookup", { idToken });
  const user = data.users?.[0];
  if (!user?.localId) return null;
  return { uid: user.localId, email: user.email };
}

export async function signUpUser(email: string, password: string): Promise<SignUpResponse> {
  return requestIdentity<SignUpResponse>("accounts:signUp", {
    email,
    password,
    returnSecureToken: true,
  });
}

export async function updateDisplayName(idToken: string, displayName: string): Promise<UpdateResponse> {
  return requestIdentity<UpdateResponse>("accounts:update", {
    idToken,
    displayName,
    returnSecureToken: false,
  });
}

export async function deleteAccountByIdToken(idToken: string): Promise<void> {
  await requestIdentity("accounts:delete", { idToken });
}

export function isIdentityConfigured(): boolean {
  return Boolean(apiKey);
}

