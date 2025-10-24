import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { useProfile, can } from "@/hooks/useProfile";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { UnderlightGlow } from "@/components/UnderlightGlow";

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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "dokument";
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

function getExtension(contentType: string | null, url: string): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  const match = url.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/);
  return match ? match[1].toLowerCase() : "png";
}

export default function ArchivePage() {
  const { role, login } = useProfile();
  const [items, setItems] = useState<Archive[]>([]);
  const [qtxt, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const { alert, confirm } = useDialog();
  const { logActivity, session } = useSessionActivity();

  useEffect(() => {
    (async () => {
      try {
        const qa = query(collection(db, "archives"), orderBy("createdAt", "desc"));
        const sa = await getDocs(qa);
        setItems(
          sa.docs.map((d) => {
            const data = d.data() as any;
            const urlsRaw = ensureArray(data.imageUrls);
            const pathsRaw = ensureArray(data.imagePaths);
            const imageUrls = urlsRaw.length ? urlsRaw : ensureArray(data.imageUrl);
            const imagePaths = pathsRaw.length ? pathsRaw : ensureArray(data.imagePath);
            const createdAtDate = data.createdAt?.toDate?.() || null;
            return {
              id: d.id,
              ...data,
              imageUrl: imageUrls[0],
              imageUrls,
              imagePath: imagePaths[0],
              imagePaths,
              createdAtDate,
            } as Archive;
          })
        );
      } catch (e) {
        console.error(e);
        await alert({
          title: "Błąd archiwum",
          message: "Brak uprawnień lub błąd wczytania archiwum.",
          tone: "danger",
        });
      }
    })();
    if (!session) return;
    void logActivity({ type: "archive_view" });
  }, [alert, logActivity, session]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  const availableTypes = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      const key = item.templateSlug || item.templateName || item.id;
      const label = item.templateName || key;
      if (!map.has(key)) {
        map.set(key, label);
      }
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pl"));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = qtxt.trim().toLowerCase();
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
  }, [fromDate, items, qtxt, selectedTypes, toDate]);

  const remove = async (id: string) => {
    if (!can.deleteArchive(role)) {
      await alert({
        title: "Brak uprawnień",
        message: "Tylko Director może usuwać wpisy z archiwum.",
        tone: "info",
      });
      return;
    }
    const ok = await confirm({
      title: "Usuń wpis",
      message: "Czy na pewno chcesz usunąć wybrany wpis z archiwum?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    await deleteDoc(doc(db, "archives", id));
    await addDoc(collection(db, "logs"), { type: "archive_delete", id, by: login, ts: serverTimestamp() });
    setItems((prev) => prev.filter((x) => x.id !== id));
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
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
    const ok = await confirm({
      title: "Wyczyść archiwum",
      message: "Czy na pewno chcesz trwale usunąć całe archiwum?",
      confirmLabel: "Wyczyść",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setClearing(true);
      const snap = await getDocs(collection(db, "archives"));
      let batch = writeBatch(db);
      const commits: Promise<void>[] = [];
      let counter = 0;
      snap.docs.forEach((docSnap, idx) => {
        batch.delete(docSnap.ref);
        counter += 1;
        if (counter === 400 || idx === snap.docs.length - 1) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          counter = 0;
        }
      });
      await Promise.all(commits);
      await addDoc(collection(db, "logs"), {
        type: "archive_clear",
        by: login,
        removed: snap.size,
        ts: serverTimestamp(),
      });
      setItems([]);
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (e) {
      console.error(e);
      await alert({
        title: "Błąd",
        message: "Nie udało się wyczyścić archiwum.",
        tone: "danger",
      });
    } finally {
      setClearing(false);
    }
  };

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

  const resetFilters = () => {
    setQ("");
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
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const downloadSelected = useCallback(async () => {
    if (!selectionMode || selectedIds.length === 0) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let addedFiles = 0;

      for (const docEntry of items) {
        if (!selectedIds.includes(docEntry.id)) continue;
        const images = docEntry.imageUrls?.length
          ? docEntry.imageUrls
          : docEntry.imageUrl
          ? [docEntry.imageUrl]
          : [];
        if (!images.length) continue;

        const baseNameParts = [
          docEntry.templateSlug || docEntry.templateName || docEntry.id,
          docEntry.userLogin || "anon",
        ];
        const createdAt = docEntry.createdAt?.toDate?.() || docEntry.createdAtDate;
        if (createdAt) {
          baseNameParts.push(createdAt.toISOString().replace(/[:.]/g, "-"));
        }
        const baseName = sanitizeFileFragment(baseNameParts.filter(Boolean).join("-"));

        for (let index = 0; index < images.length; index += 1) {
          const url = images[index];
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Nie udało się pobrać obrazu (${response.status}).`);
            }
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const extension = getExtension(response.headers.get("content-type"), url);
            const filename = `${baseName}${images.length > 1 ? `-strona-${index + 1}` : ""}.${extension}`;
            zip.file(filename, arrayBuffer);
            addedFiles += 1;
          } catch (error) {
            console.error("Błąd pobierania obrazu archiwum", error);
            throw error;
          }
        }
      }

      if (addedFiles === 0) {
        throw new Error("Brak obrazów w zaznaczonych dokumentach.");
      }

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
      setDownloadError(error?.message || "Nie udało się pobrać dokumentów.");
    } finally {
      setDownloading(false);
    }
  }, [items, selectedIds, selectionMode]);

  const selectedCount = selectedIds.length;

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Archiwum</title>
        </Head>
        <Nav />
        <UnderlightGlow />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-4">
            <div className="card p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">Archiwum</h1>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    className="input w-[200px] sm:w-[240px]"
                    placeholder="Szukaj..."
                    value={qtxt}
                    onChange={(e) => setQ(e.target.value)}
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
                    <button
                      className="btn bg-red-700 text-white"
                      onClick={clearAll}
                      disabled={clearing}
                      type="button"
                    >
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
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleType(type.value)}
                          />
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
              {filtered.map((it) => {
                const isSelected = selectedIds.includes(it.id);
                const createdAt = it.createdAt?.toDate?.() || it.createdAtDate;
                const imageLinks = it.imageUrls?.length ? it.imageUrls : it.imageUrl ? [it.imageUrl] : [];
                return (
                  <div
                    key={it.id}
                    className={`card relative p-4 grid md:grid-cols-[1fr_auto] gap-3 transition-all ${
                      isSelected ? "ring-2 ring-blue-400/80" : ""
                    }`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        onClick={() => toggleSelected(it.id)}
                        className={`absolute top-3 right-3 w-6 h-6 rounded-full border border-white/40 flex items-center justify-center transition ${
                          isSelected ? "bg-blue-500/80 border-blue-200" : "bg-black/30"
                        }`}
                        aria-pressed={isSelected}
                      >
                        {isSelected && <span className="text-xs font-bold text-white">✓</span>}
                      </button>
                    )}
                    <div className="pr-6">
                      <div className="font-semibold">{it.templateName}</div>
                      <div className="text-sm text-beige-700">
                        Autor (login): {it.userLogin || "—"} • Funkcjonariusze: {(it.officers || []).join(", ") || "—"}
                      </div>
                      <div className="text-sm text-beige-700">
                        {createdAt ? createdAt.toLocaleString() : "—"}
                        {it.dossierId && (
                          <>
                            {" "}•{" "}
                            <a className="underline" href={`/dossiers/${it.dossierId}`}>
                              Zobacz teczkę
                            </a>
                          </>
                        )}
                      </div>
                      {imageLinks.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2 text-sm">
                          {imageLinks.map((url, idx) => (
                            <a
                              key={`${it.id}-image-${idx}`}
                              className="text-blue-700 underline"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => {
                                if (!session) return;
                                void logActivity({ type: "archive_image_open", archiveId: it.id });
                              }}
                            >
                              Strona {idx + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {can.deleteArchive(role) && !selectionMode && (
                        <button className="btn bg-red-700 text-white" onClick={() => remove(it.id)}>
                          Usuń
                        </button>
                      )}
                      
                    </div>
                  </div>
                   );
              })}
              {filtered.length === 0 && <p>Brak wpisów spełniających kryteria.</p>}
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
