import type { NextApiRequest, NextApiResponse } from "next";

import { adminAuth, adminStorageBucket } from "@/lib/firebaseAdmin";

export const config = {
  api: {
    responseLimit: "50mb",
  },
};

function normalizePath(value: unknown): string | null {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^\/+/, "");
  if (!withoutPrefix || withoutPrefix.includes("..")) {
    return null;
  }
  return withoutPrefix;
}

async function verifyToken(req: NextApiRequest) {
  if (!adminAuth) {
    throw new Error("Brak konfiguracji Firebase Admin");
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("Brak tokenu uwierzytelniającego");
  }
  const token = header.slice(7);
  return adminAuth.verifyIdToken(token);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyToken(req);
  } catch (error: any) {
    const message = error?.message || "Nieautoryzowany";
    const status = message === "Brak konfiguracji Firebase Admin" ? 500 : 401;
    return res.status(status).json({ error: message });
  }

  if (!adminStorageBucket) {
    return res.status(500).json({ error: "Brak konfiguracji usługi plików" });
  }

  const path = normalizePath(req.query.path);
  if (!path) {
    return res.status(400).json({ error: "Nieprawidłowa ścieżka pliku" });
  }

  try {
    const file = adminStorageBucket.file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: "Plik nie istnieje" });
    }

    const [[metadata], contents] = await Promise.all([file.getMetadata(), file.download()]);
    const contentType = metadata?.contentType || "application/octet-stream";
    const contentDisposition = metadata?.contentDisposition;

    res.setHeader("Content-Type", contentType);
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition);
    }
    res.setHeader("Cache-Control", "private, max-age=60");

    return res.status(200).send(contents[0]);
  } catch (error: any) {
    console.error("Nie udało się pobrać pliku archiwum", error);
    return res.status(500).json({ error: "Nie udało się pobrać pliku archiwum" });
  }
}
