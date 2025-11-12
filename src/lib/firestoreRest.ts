type FirestoreValue =
  | { stringValue: string }
  | { timestampValue: string }
  | { integerValue: string }
  | { nullValue: null };

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type RunQueryResponse = {
  document?: FirestoreDocument;
};

type WriteResult = {
  updateTime?: string;
};

const firestoreProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!firestoreProjectId) {
  console.warn("Brak NEXT_PUBLIC_FIREBASE_PROJECT_ID – REST API Firestore nie będzie działało.");
}

function ensureProjectId() {
  if (!firestoreProjectId) {
    throw new Error("Brak konfiguracji projektu Firebase");
  }
  return firestoreProjectId;
}

function toFields(data: Record<string, any>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      fields[key] = { nullValue: null };
      return;
    }
    if (typeof value === "number") {
      fields[key] = { integerValue: String(Math.trunc(value)) };
      return;
    }
    if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
      return;
    }
    if (typeof value === "string") {
      fields[key] = { stringValue: value };
      return;
    }
  });
  return fields;
}

function fromFields(fields?: Record<string, FirestoreValue>): Record<string, any> {
  const result: Record<string, any> = {};
  if (!fields) return result;
  Object.entries(fields).forEach(([key, value]) => {
    if ("stringValue" in value) {
      result[key] = value.stringValue;
    } else if ("timestampValue" in value) {
      result[key] = value.timestampValue;
    } else if ("integerValue" in value) {
      result[key] = value.integerValue;
    } else if ("nullValue" in value) {
      result[key] = null;
    }
  });
  return result;
}

function extractDocumentId(name: string): string {
  const segments = name.split("/");
  return segments[segments.length - 1];
}

async function firestoreRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  idToken: string,
  body?: Record<string, any>
): Promise<T> {
  const projectId = ensureProjectId();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };

  if (!res.ok) {
    const error = new Error(data?.error?.message || `Firestore error: ${res.status}`);
    throw error;
  }

  return data as T;
}

export async function getProfileDocument(uid: string, idToken: string): Promise<Record<string, any> | null> {
  const projectId = ensureProjectId();
  const path = `documents/profiles/${uid}`;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (res.status === 404) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as FirestoreDocument & { error?: { message?: string } };
  if (!res.ok) {
    const error = new Error(data?.error?.message || `Firestore error: ${res.status}`);
    throw error;
  }
  return fromFields(data.fields);
}

export async function listProfilesDocuments(idToken: string): Promise<{ uid: string; data: Record<string, any> }[]> {
  const response = await firestoreRequest<RunQueryResponse[]>(
    "documents:runQuery",
    "POST",
    idToken,
    {
      structuredQuery: {
        from: [{ collectionId: "profiles" }],
        orderBy: [
          { field: { fieldPath: "fullName" }, direction: "ASCENDING" },
          { field: { fieldPath: "login" }, direction: "ASCENDING" },
        ],
      },
    }
  );

  const documents: { uid: string; data: Record<string, any> }[] = [];
  response.forEach((entry) => {
    if (!entry.document?.name) return;
    documents.push({ uid: extractDocumentId(entry.document.name), data: fromFields(entry.document.fields) });
  });
  return documents;
}

export async function createProfileDocument(
  uid: string,
  idToken: string,
  data: Record<string, any>
): Promise<WriteResult> {
  const body = {
    fields: toFields(data),
  };
  return firestoreRequest<WriteResult>(`documents/profiles?documentId=${uid}`, "POST", idToken, body);
}

export async function updateProfileDocument(
  uid: string,
  idToken: string,
  data: Record<string, any>
): Promise<WriteResult> {
  const fields = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
  const path = `documents/profiles/${uid}?${fields}`;
  return firestoreRequest<WriteResult>(path, "PATCH", idToken, {
    fields: toFields(data),
  });
}

