import type { NextApiRequest, NextApiResponse } from "next";

import { adminApp } from "@/lib/firebaseAdmin";
import { getStorage } from "firebase-admin/storage";

let storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;

try {
  if (!storageBucket && adminApp) {
    const storage = getStorage(adminApp);
    storageBucket = storage.bucket().name;
  }
} catch (error) {
  console.warn("Nie udało się ustalić nazwy koszyka Firebase Storage:", error);
}

type ResponsePayload = {
  base64: string;
  contentType: string | null;
};

type RequestBody = {
  path?: string | null;
  url?: string | null;
};

async function downloadFromUrl(url: string): Promise<ResponsePayload | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type");
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return { base64, contentType };
  } catch (error) {
    console.warn("Nie udało się pobrać pliku archiwum z URL", error);
    return null;
  }
}

async function downloadFromStorage(path: string): Promise<ResponsePayload | null> {
  if (!adminApp) {
    console.warn("Firebase Admin nie jest skonfigurowany.");
    return null;
  }

  try {
    const storage = getStorage(adminApp);
    const bucket = storage.bucket(storageBucket);
    const file = bucket.file(path);

    const [fileBuffer] = await file.download();
    let contentType: string | null = null;

    try {
      const [metadata] = await file.getMetadata();
      contentType = metadata?.contentType || null;
    } catch (metadataError) {
      console.warn("Nie udało się pobrać metadanych pliku archiwum", metadataError);
    }

    return { base64: fileBuffer.toString("base64"), contentType };
  } catch (error) {
    console.warn("Nie udało się pobrać pliku archiwum z Firebase Storage", error);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body: RequestBody = req.body || {};
  const path = typeof body.path === "string" && body.path ? body.path : null;
  const url = typeof body.url === "string" && body.url ? body.url : null;

  if (!path && !url) {
    return res.status(400).json({ error: "Missing path or url" });
  }

  if (url) {
    const direct = await downloadFromUrl(url);
    if (direct) {
      return res.status(200).json(direct);
    }
  }

  if (path) {
    const storageResult = await downloadFromStorage(path);
    if (storageResult) {
      return res.status(200).json(storageResult);
    }
  }

  return res.status(502).json({ error: "Failed to fetch archive asset" });
}
