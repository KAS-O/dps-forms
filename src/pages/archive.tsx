import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useProfile, can } from "@/hooks/useProfile";
import { auth, db, storage } from "@/lib/firebase";
import { TEMPLATES } from "@/lib/templates";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

type Archive = {
  id: string;
  templateName: string;
  templateSlug?: string;
  userLogin?: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePath?: string;
  imagePaths?: string[];
  dossierId?: string | null;
  createdAt?: any;
  createdAtDate?: Date | null;
  officers?: string[];
  vehicleFolderRegistration?: string;
};

function sanitizeFileFragment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dokument"
  );
}

const HTTP_PROTOCOL_REGEX = /^http:\/\//i;

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
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

async function fetchAsArrayBuffer(url: string) {
  const normalized = normalizeUrl(url);
  const response = await fetch(normalized, { mode: "cors", referrerPolicy: "no-referrer" });
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać obrazu (${response.status}).`);
  }
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  return { arrayBuffer, contentType: response.headers.get("content-type"), resolvedUrl: response.url || normalized };
}

async function resolveAuthToken(forceRefresh = false) {
  if (!auth) return null;

  const directUser = auth.currentUser;
  if (directUser) {
    try {
      return await directUser.getIdToken(forceRefresh);
    } catch (error) {
      console.warn("Nie udało się pobrać tokenu użytkownika (bezpośrednio)", error);
    }
  }

  return new Promise<string | null>((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) {
        resolve(null);
        return;
      }
      try {
        resolve(await user.getIdToken(forceRefresh));
      } catch (error) {
        console.warn("Nie udało się pobrać tokenu użytkownika (po zmianie stanu)", error);
        resolve(null);
      }
    });
  });
}

type StorageAssetLocation = {
  downloadUrl?: string;
  bucket?: string;
  objectPath?: string;
};

function resolveStorageLocation(source: { url?: string; path?: string | null }): StorageAssetLocation {
  if (source.url) {
    return { downloadUrl: normalizeUrl(source.url) };
  }

  if (!source.path) {
    return {};
  }

  const path = source.path.trim();
  if (!path) {
    return {};
  }

  if (/^https?:\/\//i.test(path)) {
    return { downloadUrl: normalizeUrl(path) };
  }

  if (path.startsWith("gs://")) {
    try {
      const { host, pathname } = new URL(path);
      return { bucket: host, objectPath: pathname.replace(/^\//, "") };
    } catch (error) {
      console.warn("Nie udało się sparsować ścieżki gs://", error);
    }
  }

  const bucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (storage?.app?.options?.storageBucket as string | undefined) ||
    undefined;

  return { bucket, objectPath: path };
}

async function downloadViaRest({ bucket, objectPath }: { bucket: string; objectPath: string }) {
  const encodedPath = encodeURIComponent(objectPath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  const headers: HeadersInit = {};

  let token = await resolveAuthToken(false);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const performFetch = async (): Promise<{ arrayBuffer: ArrayBuffer; extension: string }> => {
    const response = await fetch(downloadUrl, { headers, mode: "cors" });
    if (response.status === 401 || response.status === 403) {
      const refreshedToken = await resolveAuthToken(true);
      if (refreshedToken && refreshedToken !== token) {
        token = refreshedToken;
        headers["Authorization"] = `Bearer ${token}`;
        return performFetch();
      }
      if (!token && refreshedToken) {
        token = refreshedToken;
        headers["Authorization"] = `Bearer ${token}`;
        return performFetch();
      }
      throw new Error("Brak uprawnień do pobrania pliku archiwum.");
    }

    if (!response.ok) {
      throw new Error(`Nie udało się pobrać pliku (status ${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type");
    return { arrayBuffer, extension: getExtension(contentType, downloadUrl) };
  };

  return performFetch();
}

async function downloadArchiveAsset(source: { url?: string; path?: string | null }) {
  let lastError: unknown = null;

  const location = resolveStorageLocation(source);

  if (location.downloadUrl) {
    try {
      const { arrayBuffer, contentType, resolvedUrl } = await fetchAsArrayBuffer(location.downloadUrl);
      return { arrayBuffer, extension: getExtension(contentType, resolvedUrl) };
    } catch (error) {
      lastError = error;
    }
  }

  if (location.bucket && location.objectPath) {
    try {
      return await downloadViaRest({ bucket: location.bucket, objectPath: location.objectPath });
    } catch (error) {
      lastError = error;
    }
  }

  if (source.path) {
    try {
      const { ref, refFromURL, getDownloadURL, getBytes, getMetadata } = await import("firebase/storage");
      if (!storage) {
        throw new Error("Usługa plików nie jest dostępna.");
      }

      const storageRef = /^https?:\/\//i.test(source.path)
        ? refFromURL(source.path)
        : /^gs:\/\//i.test(source.path)
        ? refFromURL(source.path)
        : ref(storage, source.path);

      try {
        const downloadUrl = await getDownloadURL(storageRef);
        const { arrayBuffer, contentType, resolvedUrl } = await fetchAsArrayBuffer(downloadUrl);
        return { arrayBuffer, extension: getExtension(contentType, resolvedUrl) };
      } catch (downloadUrlError) {
        lastError = downloadUrlError;
      }

      const bytes = await getBytes(storageRef);
      let contentType: string | null = null;
      try {
        const metadata = await getMetadata(storageRef);
        contentType = metadata.contentType || null;
      } catch (metadataError) {
        console.warn("Nie udało się pobrać metadanych pliku archiwum", metadataError);
      }

      const extensionFromPath = getExtensionFromPath(source.path);
      const fallbackUrl = source.url || source.path || "";
      const extension = extensionFromPath || getExtension(contentType, fallbackUrl);
      const uint8Array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const arrayBuffer = uint8Array.buffer.slice(
        uint8Array.byteOffset,
        uint8Array.byteOffset + uint8Array.byteLength
      );
      return { arrayBuffer, extension };
    } catch (storageError) {
      lastError = storageError;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Nie udało się pobrać pliku archiwum.");
}

function buildArchive(snapshot: QueryDocumentSnapshot<DocumentData>): Archive {
  const data = snapshot.data() as Record<string, unknown>;
  const urlsRaw = ensureArray(data.imageUrls);
  const pathsRaw = ensureArray(data.imagePaths);
  const imageUrls = urlsRaw.length ? urlsRaw : ensureArray(data.imageUrl);
  const imagePaths = pathsRaw.length ? pathsRaw : ensureArray(data.imagePath);
  const createdAtDate = (data.createdAt as any)?.toDate?.() || null;

  return {
    id: snapshot.id,
    templateName: (data.templateName as string) || "Bez nazwy",
    templateSlug: (data.templateSlug as string) || undefined,
    userLogin: (data.userLogin as string) || undefined,
    officers: Array.isArray(data.officers)
      ? (data.officers as unknown[]).filter((value): value is string => typeof value === "string")
      : undefined,
    dossierId: (data.dossierId as string) || null,
    vehicleFolderRegistration: (data.vehicleFolderRegistration as string) || undefined,
    imageUrl: imageUrls[0],
    imageUrls,
    imagePath: imagePaths[0],
    imagePaths,
    createdAt: data.createdAt,
    createdAtDate,
  };
}

export default function ArchivePage() {
  const { role, login } = useProfile();
  const { alert, confirm } = useDialog();
  const { logActivity, session } = useSessionActivity();
  const [items, setItems] = useState<Archive[]>([]);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);


  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const archiveQuery = query(collection(db, "archives"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(archiveQuery);
        if (!mounted) return;
        setItems(snapshot.docs.map(buildArchive));
      } catch (error) {
        console.error("Nie udało się pobrać archiwum", error);
        if (!mounted) return;
        await alert({
          title: "Błąd archiwum",
          message: "Brak uprawnień lub błąd wczytania archiwum.",
          tone: "danger",
        });
      }
    })();
    
    return () => {
      mounted = false;
    };
  }, [alert]);

  useEffect(() => {
    if (!session) return;
    void logActivity({ type: "archive_view" });
  }, [logActivity, session]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  const availableTypes = useMemo(() => {
    const entries = new Map<string, string>();

    TEMPLATES.forEach((template) => {
      entries.set(template.slug, template.name);
    });

    items.forEach((item) => {
      const key = item.templateSlug || item.templateName || item.id;
      const label = item.templateName || key;
      if (!entries.has(key)) {
        entries.set(key, label);
      }
    });

    return Array.from(entries.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pl"));
  }, [items]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const fromValue = fromDate ? new Date(fromDate) : null;
    const toValue = toDate ? new Date(toDate) : null;
    const typeSet = new Set(selectedTypes);

    return items.filter((item) => {
      const createdAtDate = item.createdAt?.toDate?.() || item.createdAtDate || null;
      if (fromValue && (!createdAtDate || createdAtDate < fromValue)) return false;
      if (toValue && (!createdAtDate || createdAtDate > toValue)) return false;
      if (typeSet.size) {
        const key = item.templateSlug || item.templateName || "unknown";
        if (!typeSet.has(key)) return false;
      }
      if (!needle) return true;
      const haystack = [
        item.templateName || "",
        item.templateSlug || "",
        item.userLogin || "",
        (item.officers || []).join(", "),
        item.vehicleFolderRegistration || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [fromDate, items, search, selectedTypes, toDate]);

  const resetFilters = () => {
    setSearch("");
    setFromDate("");
    setToDate("");
    setSelectedTypes([]);
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds([]);
      }
      return !prev;
    });
    setDownloadError(null);
  };

  const toggleType = (value: string) => {
    setSelectedTypes((prev) => (prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  const remove = async (id: string) => {
    if (!can.deleteArchive(role)) {
      await alert({
        title: "Brak uprawnień",
        message: "Tylko Director może usuwać wpisy z archiwum.",
        tone: "info",
      });
      return;
    }

    const confirmed = await confirm({
      title: "Usuń wpis",
      message: "Czy na pewno chcesz usunąć wybrany wpis z archiwum?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!confirmed) return;
    
    await deleteDoc(doc(db, "archives", id));
    await addDoc(collection(db, "logs"), { type: "archive_delete", id, by: login, ts: serverTimestamp() });
    setItems((prev) => prev.filter((entry) => entry.id !== id));
    setSelectedIds((prev) => prev.filter((entry) => entry !== id));
  };

  const clearAll = async () => {
    if (!can.deleteArchive(role)) {
      await alert({
        title: "Brak uprawnień",
        message: "Tylko Director może czyścić archiwum.",
        tone: "info",
      });
      return;
    }

    const confirmed = await confirm({
      title: "Wyczyść archiwum",
      message: "Czy na pewno chcesz trwale usunąć całe archiwum?",
      confirmLabel: "Wyczyść",
      tone: "danger",
    });
    if (!confirmed) return;
    
    try {
      setClearing(true);
      const snapshot = await getDocs(collection(db, "archives"));
      let batch = writeBatch(db);
      let counter = 0;
      const commits: Promise<void>[] = [];

      snapshot.docs.forEach((docSnap, index) => {
        batch.delete(docSnap.ref);
        counter += 1;
        if (counter === 400 || index === snapshot.docs.length - 1) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          counter = 0;
        }
      });
      
      await Promise.all(commits);
      await addDoc(collection(db, "logs"), {
        type: "archive_clear",
        by: login,
        removed: snapshot.size,
        ts: serverTimestamp(),
      });
      
      setItems([]);
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (error) {
      console.error("Nie udało się wyczyścić archiwum", error);
      await alert({
        title: "Błąd",
        message: "Nie udało się wyczyścić archiwum.",
        tone: "danger",
      });
    } finally {
      setClearing(false);
    }
  };


  const downloadSelected = useCallback(async () => {
    if (!selectionMode || selectedIds.length === 0) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const selectedItems = items.filter((item) => selectedIds.includes(item.id));
      const tasks: {
        run: () => Promise<{ arrayBuffer: ArrayBuffer; extension: string }>;
        makeFileName: (extension: string) => string;
        context: string;
      }[] = [];

      selectedItems.forEach((item) => {
        const images = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
        const paths = item.imagePaths?.length
          ? item.imagePaths
          : item.imagePath
          ? [item.imagePath]
          : [];
        if (images.length === 0) return;

        const baseNameParts = [item.templateSlug || item.templateName || item.id, item.userLogin || "anon"];
        const createdAt = item.createdAt?.toDate?.() || item.createdAtDate;
        if (createdAt) {
          baseNameParts.push(createdAt.toISOString().replace(/[:.]/g, "-"));
        }
        const baseName = sanitizeFileFragment(baseNameParts.filter(Boolean).join("-"));

        images.forEach((url, index) => {
          const path = paths[index] ?? (paths.length === 1 ? paths[0] : undefined);
          const pageLabel = images.length > 1 ? ` (strona ${index + 1})` : "";
          tasks.push({
            run: () => downloadArchiveAsset({ url, path }),
            makeFileName: (extension) => `${baseName}${images.length > 1 ? `-strona-${index + 1}` : ""}.${extension}`,
            context: `${item.templateName || item.templateSlug || item.id}${pageLabel}`,
          });
        });
      });

      if (tasks.length === 0) {
        throw new Error("Brak obrazów w zaznaczonych dokumentach.");
      }

      const results: { fileName: string; arrayBuffer: ArrayBuffer }[] = new Array(tasks.length);
      let pointer = 0;
      const concurrency = Math.min(4, tasks.length);

      const workers = Array.from({ length: concurrency }).map(async () => {
        while (true) {
          const currentIndex = pointer;
          pointer += 1;
          if (currentIndex >= tasks.length) break;
          const task = tasks[currentIndex];
          try {
            const { arrayBuffer, extension } = await task.run();
            const fileName = task.makeFileName(extension);
            results[currentIndex] = { fileName, arrayBuffer };
          } catch (error) {
            console.error("Błąd pobierania obrazu archiwum", error);
            const message =
              error instanceof Error && error.message
                ? error.message
                : "Nieznany błąd pobierania.";
            throw new Error(`Nie udało się pobrać dokumentu "${task.context}": ${message}`);
          }
        }
      });

      await Promise.all(workers);

      let addedFiles = 0;
      results.forEach((result) => {
        if (!result) return;
        zip.file(result.fileName, result.arrayBuffer);
        addedFiles += 1;
      });

      const content = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `archiwum-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (error: any) {
      console.error("Nie udało się pobrać zaznaczonych dokumentów", error);
      setDownloadError(error instanceof Error ? error.message : "Nie udało się pobrać dokumentów.");
    } finally {
      setDownloading(false);
    }
  }, [items, selectedIds, selectionMode]);

  const selectedCount = selectedIds.length;

  if (!can.seeArchive(role)) {
    return (
      <AuthGate>
        <>
          <Head>
            <title>LSPD 77RP — Archiwum</title>
          </Head>
          <Nav />
          <div className="max-w-4xl mx-auto px-4 py-10">
            <div className="card p-6 text-center">Brak dostępu do archiwum.</div>
          </div>
        </>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Archiwum</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-4">
            <div className="card p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">Archiwum</h1>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    className="input w-[200px] sm:w-[240px]"
                    placeholder="Szukaj..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button className="btn" onClick={resetFilters} type="button">
                    Resetuj filtry
                  </button>
                  <button
                    className={`btn ${selectionMode ? "bg-blue-800 text-white" : ""}`}
                    type="button"
                    onClick={toggleSelectionMode}
                  >
                    {selectionMode ? "Anuluj wybór" : "Wybierz"}
                  </button>
                  {selectionMode && (
                    <button
                      className="btn bg-green-600 text-white"
                      type="button"
                      disabled={selectedCount === 0 || downloading}
                      onClick={downloadSelected}
                    >
                      {downloading ? "Pakowanie..." : `Pobierz (${selectedCount})`}
                    </button>
                  )}
                  {can.deleteArchive(role) && (
                    <button className="btn bg-red-700 text-white" onClick={clearAll} disabled={clearing} type="button">
                      {clearing ? "Czyszczenie..." : "Wyczyść archiwum"}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid gap-3 md:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <label className="label">Data od</label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="label">Data do</label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="label">Rodzaje dokumentów</label>
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 p-2 bg-black/20">
                    {availableTypes.length === 0 && <p className="text-xs text-beige-700">Brak danych.</p>}
                    {availableTypes.map((type) => {
                      const checked = selectedTypes.includes(type.value);
                      return (
                        <label key={type.value} className="flex items-center gap-2 text-sm py-1">
                          <input type="checkbox" checked={checked} onChange={() => toggleType(type.value)} />
                          <span>{type.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {selectionMode && (
                <p className="text-xs text-beige-700">
                  Zaznacz dokumenty do pobrania. Każdy obraz zostanie zapisany w jednym pliku ZIP.
                </p>
              )}
              {downloadError && <p className="text-sm text-red-300">{downloadError}</p>}
            </div>
  
            <div className="grid gap-2">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const createdAt = item.createdAt?.toDate?.() || item.createdAtDate;
                const imageLinks = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];

                return (
                  <div
                    key={item.id}
                    className={`card relative p-4 grid md:grid-cols-[1fr_auto] gap-3 transition-all ${
                      isSelected ? "ring-2 ring-blue-400/80" : ""
                    }`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        onClick={() => toggleSelected(item.id)}
                        className={`absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full border border-white/40 transition ${
                          isSelected ? "bg-blue-500/80 border-blue-200" : "bg-black/30"
                        }`}
                        aria-pressed={isSelected}
                      >
                        {isSelected && <span className="text-xs font-bold text-white">✓</span>}
                      </button>
                    )}
                    
                    <div className="pr-6">
                      <div className="font-semibold">{item.templateName}</div>
                      <div className="text-sm text-beige-700">
                        Autor (login): {item.userLogin || "—"} • Funkcjonariusze: {(item.officers || []).join(", ") || "—"}
                      </div>
                      <div className="text-sm text-beige-700">
                        {createdAt ? createdAt.toLocaleString() : "—"}
                        {item.dossierId && (
                          <>
                            {" "}•{" "}
                            <a className="underline" href={`/dossiers/${item.dossierId}`}>
                              Zobacz teczkę
                            </a>
                          </>
                        )}
                      </div>
                      {imageLinks.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2 text-sm">
                          {imageLinks.map((url, index) => (
                            <a
                              key={`${item.id}-image-${index}`}
                              className="text-blue-700 underline"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => {
                                if (!session) return;
                                void logActivity({ type: "archive_image_open", archiveId: item.id });
                              }}
                            >
                              Strona {index + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-end gap-2">
                      {can.deleteArchive(role) && !selectionMode && (
                        <button className="btn bg-red-700 text-white" onClick={() => remove(item.id)}>
                          Usuń
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredItems.length === 0 && <p>Brak wpisów spełniających kryteria.</p>}
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
