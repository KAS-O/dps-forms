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

const ALLOWED_STORAGE_HOSTS = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
];

function normalizeUrlParam(value: unknown): string | null {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!parsed.protocol.startsWith("http")) {
    return null;
  }

  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
  }

  const { hostname } = parsed;
  const allowed =
    ALLOWED_STORAGE_HOSTS.includes(hostname) || hostname.endsWith(".firebasestorage.app");

  if (!allowed) {
    return null;
  }

  return parsed.toString();
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

  const path = normalizePath(req.query.path);
  const url = normalizeUrlParam(req.query.url);

  if (!path && !url) {
    return res.status(400).json({ error: "Brak informacji o pliku" });
  }

  let lastError: unknown = null;

  if (path && adminStorageBucket) {
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
      lastError = error;
    }
  } else if (path && !adminStorageBucket && !url) {
    return res.status(500).json({ error: "Brak konfiguracji usługi plików" });
  }

  if (url) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`Nie udało się pobrać pliku (status ${response.status}).`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const contentDisposition = response.headers.get("content-disposition");

      res.setHeader("Content-Type", contentType);
      if (contentDisposition) {
        res.setHeader("Content-Disposition", contentDisposition);
      }
      res.setHeader("Cache-Control", "private, max-age=60");

      return res.status(200).send(buffer);
    } catch (error: any) {
      console.error("Nie udało się pobrać pliku archiwum z adresu URL", error);
      lastError = lastError || error;
    }
  }

  return res.status(500).json({ error: "Nie udało się pobrać pliku archiwum" });
}
