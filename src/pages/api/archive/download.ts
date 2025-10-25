import type { NextApiRequest, NextApiResponse } from "next";
import JSZip from "jszip";

import { adminAuth, adminBucket, adminDb } from "@/lib/firebaseAdmin";
import { normalizeRole, type Role } from "@/lib/roles";

const HTTP_PROTOCOL_REGEX = /^http:\/\//i;
const ARCHIVE_ROLES = new Set<Role>(["director", "chief", "senior", "agent"]);

class ArchiveDownloadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ArchiveDownloadRequest = {
  token?: string;
  ids?: string[];
};

type ArchiveDocument = {
  id: string;
  templateName: string;
  templateSlug?: string;
  userLogin?: string;
  createdAt?: any;
  createdAtDate?: Date | null;
  imageUrls: string[];
  imagePaths: string[];
};

type DownloadSource = {
  url?: string;
  path?: string | null;
};

type DownloadResult = {
  buffer: Buffer;
  extension: string;
};

function parseBody(req: NextApiRequest): ArchiveDownloadRequest {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as ArchiveDownloadRequest;
    } catch (error) {
      console.warn("Nie udało się sparsować żądania pobrania archiwum:", error);
      return {};
    }
  }
  return body as ArchiveDownloadRequest;
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function sanitizeFileFragment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dokument"
  );
}

function normalizeUrl(url: string) {
  return url.replace(HTTP_PROTOCOL_REGEX, "https://");
}

function getExtension(contentType: string | null, url: string) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  const match = url.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/);
  return match ? match[1].toLowerCase() : "png";
}

function getExtensionFromPath(path?: string | null) {
  if (!path) return null;
  const match = path.match(/\.([a-zA-Z0-9]{2,4})$/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeStoragePath(path: string) {
  if (!path) return path;
  if (path.startsWith("gs://")) {
    const withoutScheme = path.slice(5);
    const slashIndex = withoutScheme.indexOf("/");
    return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : "";
  }
  return path.replace(/^\/+/, "");
}

async function fetchFromUrl(url: string): Promise<DownloadResult> {
  const normalized = normalizeUrl(url);
  const response = await fetch(normalized);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać obrazu (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const resolvedUrl = response.url || normalized;
  const contentType = response.headers.get("content-type");
  return { buffer, extension: getExtension(contentType, resolvedUrl) };
}

async function fetchFromStorage(path: string): Promise<DownloadResult> {
  if (!adminBucket) {
    throw new ArchiveDownloadError("Magazyn plików jest niedostępny.", 503);
  }
  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath) {
    throw new ArchiveDownloadError("Nieprawidłowa ścieżka pliku archiwum.");
  }
  const file = adminBucket.file(normalizedPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new ArchiveDownloadError("Plik archiwum nie istnieje.", 404);
  }
  const [buffer] = await file.download();
  let contentType: string | null = null;
  try {
    const [metadata] = await file.getMetadata();
    contentType = metadata?.contentType || null;
  } catch (error) {
    console.warn("Nie udało się pobrać metadanych pliku archiwum:", error);
  }
  const extensionFromPath = getExtensionFromPath(normalizedPath);
  const extension = extensionFromPath || getExtension(contentType, normalizedPath);
  return { buffer, extension };
}

async function fetchArchiveAsset(source: DownloadSource): Promise<DownloadResult> {
  let lastError: unknown = null;

  if (source.url) {
    try {
      return await fetchFromUrl(source.url);
    } catch (error) {
      lastError = error;
    }
  }

  if (source.path) {
    try {
      return await fetchFromStorage(source.path);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new ArchiveDownloadError("Nie udało się pobrać pliku archiwum.");
}

function canSeeArchive(role: Role | null) {
  return !!role && ARCHIVE_ROLES.has(role);
}

function buildArchiveDocument(id: string, data: Record<string, unknown>): ArchiveDocument {
  const urlsRaw = ensureArray(data.imageUrls);
  const pathsRaw = ensureArray(data.imagePaths);
  const imageUrls = urlsRaw.length ? urlsRaw : ensureArray(data.imageUrl);
  const imagePaths = pathsRaw.length ? pathsRaw : ensureArray(data.imagePath);
  const createdAtDate = (data.createdAt as any)?.toDate?.() || null;

  return {
    id,
    templateName: (data.templateName as string) || "Bez nazwy",
    templateSlug: (data.templateSlug as string) || undefined,
    userLogin: (data.userLogin as string) || undefined,
    createdAt: data.createdAt,
    createdAtDate,
    imageUrls,
    imagePaths,
  };
}

function pickSources(doc: ArchiveDocument): DownloadSource[] {
  const sources: DownloadSource[] = [];
  const maxLength = Math.max(doc.imageUrls.length, doc.imagePaths.length);
  if (!maxLength) {
    return sources;
  }
  for (let index = 0; index < maxLength; index += 1) {
    const url = doc.imageUrls[index] ?? (doc.imageUrls.length === 1 ? doc.imageUrls[0] : undefined);
    const path = doc.imagePaths[index] ?? (doc.imagePaths.length === 1 ? doc.imagePaths[0] : undefined);
    sources.push({ url, path });
  }
  return sources;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!adminAuth || !adminDb) {
    return res.status(500).json({ error: "Firebase Admin not configured" });
  }

  const { token, ids } = parseBody(req);
  if (!token || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Nieprawidłowe żądanie pobrania archiwum." });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const profileSnapshot = await adminDb.collection("profiles").doc(decoded.uid).get();
    const role = normalizeRole(profileSnapshot.data()?.role);

    if (!canSeeArchive(role)) {
      throw new ArchiveDownloadError("Brak uprawnień do pobrania archiwum.", 403);
    }

    const zip = new JSZip();
    let addedFiles = 0;

    for (const id of ids) {
      const snapshot = await adminDb.collection("archives").doc(id).get();
      if (!snapshot.exists) {
        throw new ArchiveDownloadError(`Dokument o identyfikatorze "${id}" nie istnieje.`, 404);
      }

      const archive = buildArchiveDocument(id, snapshot.data() || {});
      const sources = pickSources(archive);
      if (!sources.length) {
        throw new ArchiveDownloadError(`Dokument "${archive.templateName}" nie zawiera obrazów.`, 400);
      }

      const baseNameParts = [archive.templateSlug || archive.templateName || archive.id, archive.userLogin || "anon"];
      const createdAt = archive.createdAtDate || (archive.createdAt?.toDate?.() ?? null);
      if (createdAt) {
        baseNameParts.push(createdAt.toISOString().replace(/[:.]/g, "-"));
      }
      const baseName = sanitizeFileFragment(baseNameParts.filter(Boolean).join("-"));

      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        const pageLabel = sources.length > 1 ? ` (strona ${index + 1})` : "";
        try {
          const { buffer, extension } = await fetchArchiveAsset(source);
          const suffix = sources.length > 1 ? `-strona-${index + 1}` : "";
          const fileName = `${baseName}${suffix}.${extension}`;
          zip.file(fileName, buffer);
          addedFiles += 1;
        } catch (error: any) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Nieznany błąd pobierania archiwum.";
          throw new ArchiveDownloadError(
            `Nie udało się pobrać dokumentu "${archive.templateName}${pageLabel}": ${message}`,
            error instanceof ArchiveDownloadError ? error.status : 502
          );
        }
      }
    }

    if (addedFiles === 0) {
      throw new ArchiveDownloadError("Brak plików do pobrania.");
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const fileName = `archiwum-${new Date().toISOString().slice(0, 10)}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buffer);
  } catch (error: any) {
    const status = error instanceof ArchiveDownloadError ? error.status : error?.status || 500;
    const message = error instanceof Error ? error.message : "Nie udało się pobrać dokumentów.";
    if (!(error instanceof ArchiveDownloadError)) {
      console.error("Nie udało się przygotować archiwum do pobrania:", error);
    }
    return res.status(status || 500).json({ error: message });
  }
}
