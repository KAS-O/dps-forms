import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
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

async function fetchStoragePath(path: string) {
  const bucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    storage?.app?.options?.storageBucket ||
    null;

  if (!bucket) {
    throw new Error("Brak konfiguracji usługi plików.");
  }

  const encodedPath = encodeURIComponent(path);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  const user = auth?.currentUser;
  const attempt = async (forceRefresh: boolean) => {
    const headers: HeadersInit = {};
    if (user) {
      try {
        const token = await user.getIdToken(forceRefresh);
        headers["Authorization"] = `Bearer ${token}`;
      } catch (tokenError) {
        console.warn("Nie udało się pobrać tokenu użytkownika do pobrania pliku archiwum", tokenError);
      }
    }

    const response = await fetch(downloadUrl, { headers, cache: "no-store" });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type");
      return { arrayBuffer, extension: getExtension(contentType, downloadUrl) };
    }

    if ((response.status === 401 || response.status === 403) && user && !forceRefresh) {
      return attempt(true);
    }

    throw new Error(`Nie udało się pobrać pliku (status ${response.status}).`);
  };

  return attempt(false);
}

async function downloadArchiveAsset(source: { url?: string; path?: string | null }) {
  let lastError: unknown = null;

  if (source.url) {
    try {
      const { arrayBuffer, contentType, resolvedUrl } = await fetchAsArrayBuffer(source.url);
      return { arrayBuffer, extension: getExtension(contentType, resolvedUrl) };
    } catch (error) {
      lastError = error;
    }
  }

  if (source.path) {
    const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (storageBucket) {
      try {
        const encodedPath = encodeURIComponent(source.path);
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}?alt=media`;
        const headers: HeadersInit = {};
        const user = auth?.currentUser;
        if (user) {
          try {
            const token = await user.getIdToken();
            headers["Authorization"] = `Bearer ${token}`;
          } catch (tokenError) {
            console.warn("Nie udało się pobrać tokenu użytkownika do pobrania pliku archiwum", tokenError);
          }
        }

        const response = await fetch(downloadUrl, { headers });
        if (!response.ok) {
          throw new Error(`Nie udało się pobrać pliku (status ${response.status}).`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get("content-type");
        return { arrayBuffer, extension: getExtension(contentType, downloadUrl) };
      } catch (restError) {
        lastError = restError;
      }
    }

    try {
      return await fetchStoragePath(source.path);
    } catch (restError) {
      lastError = restError;
    }

    try {
      const { ref, getDownloadURL, getBytes, getMetadata } = await import("firebase/storage");
      if (!storage) {
        throw new Error("Usługa plików nie jest dostępna.");
      }
      const storageRef = ref(storage, source.path);

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

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function formatDateTime(date: Date | null | undefined) {
  if (!date) return "—";
  try {
    return date.toLocaleString("pl-PL");
  } catch (error) {
    console.warn("Nie udało się sformatować daty", error);
    return date.toISOString();
  }
}

type PdfImageFormat = "PNG" | "JPEG";

async function toSupportedImageData(arrayBuffer: ArrayBuffer, extension?: string | null): Promise<{
  dataUrl: string;
  format: PdfImageFormat;
}> {
  const normalized = (extension || "").toLowerCase();
  if (normalized === "png" || normalized === "jpg" || normalized === "jpeg") {
    const mime = normalized === "png" ? "png" : "jpeg";
    return {
      dataUrl: `data:image/${mime};base64,${arrayBufferToBase64(arrayBuffer)}`,
      format: mime === "jpeg" ? "JPEG" : "PNG",
    };
  }

  const blobType = normalized ? `image/${normalized}` : "image/png";
  const blob = new Blob([arrayBuffer], { type: blobType });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Nie udało się odczytać danych obrazu."));
      }
    };
    reader.onerror = () => reject(new Error("Nie udało się odczytać danych obrazu."));
    reader.readAsDataURL(blob);
  });

  if (!dataUrl) {
    throw new Error("Nie udało się przetworzyć obrazu.");
  }

  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/);
  const mime = match?.[1]?.toLowerCase() || "png";
  const format: PdfImageFormat = mime.includes("jpg") || mime.includes("jpeg") ? "JPEG" : "PNG";
  return { dataUrl, format };
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
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
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
    setReportSuccess(null);
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


  const createReport = useCallback(async () => {
    if (!selectionMode || selectedIds.length === 0) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      setReportSuccess(null);

      const selectedItems = items.filter((item) => selectedIds.includes(item.id));
      if (selectedItems.length === 0) {
        throw new Error("Nie wybrano żadnych dokumentów.");
      }

      const generationDate = new Date();
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const margin = 15;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let cursorY = margin;

      const counts = new Map<string, number>();
      selectedItems.forEach((item) => {
        const key = item.templateName || item.templateSlug || "Nieznany dokument";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });

      pdf.setFontSize(18);
      pdf.text("Raport archiwum", margin, cursorY);
      cursorY += 10;

      pdf.setFontSize(12);
      const summaryLines = [
        `Wygenerował: ${login || "—"}`,
        `Data i godzina: ${generationDate.toLocaleString("pl-PL")}`,
        `Liczba dokumentów: ${selectedItems.length}`,
      ];

      summaryLines.forEach((line) => {
        pdf.text(line, margin, cursorY);
        cursorY += 7;
      });

      if (counts.size > 0) {
        pdf.setFontSize(13);
        pdf.text("Zestawienie rodzajów dokumentów:", margin, cursorY);
        cursorY += 8;
        pdf.setFontSize(12);
        const summaryWidth = pageWidth - margin * 2;
        counts.forEach((value, key) => {
          const wrapped = pdf.splitTextToSize(`${value}× ${key}`, summaryWidth);
          wrapped.forEach((segment) => {
            if (cursorY > pageHeight - margin) {
              pdf.addPage();
              cursorY = margin;
            }
            pdf.text(segment, margin, cursorY);
            cursorY += 7;
          });
        });
      }

      const ensureSpace = (requiredHeight: number, continuationLabel?: string) => {
        if (cursorY + requiredHeight <= pageHeight - margin) {
          return false;
        }
        pdf.addPage();
        cursorY = margin;
        if (continuationLabel) {
          pdf.setFontSize(12);
          pdf.text(continuationLabel, margin, cursorY);
          cursorY += 6;
        }
        return true;
      };

      if (selectedItems.length > 0) {
        pdf.addPage();
        cursorY = margin;
      }

      for (let index = 0; index < selectedItems.length; index += 1) {
        if (index > 0) {
          pdf.addPage();
          cursorY = margin;
        }

        const item = selectedItems[index];
        pdf.setFontSize(16);
        pdf.text(item.templateName || "Nieznany dokument", margin, cursorY);
        cursorY += 9;

        pdf.setFontSize(12);
        const createdAt = item.createdAt?.toDate?.() || item.createdAtDate || null;
        const officers = (item.officers || []).join(", ") || "—";
        const infoLines = [
          `Autor (login): ${item.userLogin || "—"}`,
          `Funkcjonariusze: ${officers}`,
          `Data utworzenia: ${formatDateTime(createdAt)}`,
          item.dossierId ? `Powiązana teczka: ${item.dossierId}` : null,
          item.vehicleFolderRegistration
            ? `Powiązany pojazd: ${item.vehicleFolderRegistration}`
            : null,
        ].filter(Boolean) as string[];

        infoLines.forEach((line) => {
          const wrapped = pdf.splitTextToSize(line, pageWidth - margin * 2);
          wrapped.forEach((segment) => {
            const moved = ensureSpace(6);
            if (moved) {
              pdf.setFontSize(12);
            }
            pdf.text(segment, margin, cursorY);
            cursorY += 6;
          });
        });

        const images = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
        const paths = item.imagePaths?.length
          ? item.imagePaths
          : item.imagePath
          ? [item.imagePath]
          : [];

        if (images.length === 0) {
          const moved = ensureSpace(8);
          if (moved) {
            pdf.setFontSize(12);
          }
          pdf.text("Brak załączonych obrazów.", margin, cursorY);
          cursorY += 8;
          continue;
        }

        for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
          const url = images[imageIndex];
          const path = paths[imageIndex] ?? (paths.length === 1 ? paths[0] : undefined);
          const { arrayBuffer, extension } = await downloadArchiveAsset({ url, path });
          const { dataUrl, format } = await toSupportedImageData(arrayBuffer, extension);

          const props = pdf.getImageProperties(dataUrl);
          const maxWidth = pageWidth - margin * 2;
          const maxHeight = pageHeight - margin * 2;
          const ratio = Math.min(maxWidth / props.width, maxHeight / props.height, 1);
          const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
          const displayWidth = props.width * safeRatio;
          const displayHeight = props.height * safeRatio;
          const caption = images.length > 1 ? `Strona ${imageIndex + 1}` : "Załącznik";
          const spaceNeeded = displayHeight + (images.length > 1 ? 11 : 6);
          const moved = ensureSpace(spaceNeeded, `${item.templateName || "Dokument"} — ciąg dalszy`);
          if (moved) {
            pdf.setFontSize(12);
          }

          if (images.length > 1) {
            pdf.setFontSize(11);
            pdf.text(caption, margin, cursorY);
            cursorY += 5;
          }

          pdf.addImage(dataUrl, format, margin, cursorY, displayWidth, displayHeight);
          cursorY += displayHeight + 6;
          pdf.setFontSize(12);
        }
      }

      const pdfArrayBuffer = pdf.output("arraybuffer");
      const pdfBase64 = arrayBufferToBase64(pdfArrayBuffer);
      const fileName = `raport-archiwum-${generationDate.toISOString().replace(/[:.]/g, "-")}.pdf`;

      const countsSummary = Array.from(counts.entries())
        .map(([key, value]) => `${value}× ${key}`)
        .join("\n") || "—";
      const truncatedCountsSummary =
        countsSummary.length > 1000 ? `${countsSummary.slice(0, 1000)}…` : countsSummary;

      const discordResponse = await fetch("/api/send-to-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fileName,
          fileBase64: pdfBase64,
          contentType: "application/pdf",
          embedTitle: "Raport archiwum",
          embedDescription: `Wygenerowano raport archiwum (${selectedItems.length} dokumentów).`,
          embedFields: [
            { name: "Wygenerował", value: login || "—", inline: false },
            { name: "Data i godzina", value: generationDate.toLocaleString("pl-PL"), inline: false },
            { name: "Liczba dokumentów", value: `${selectedItems.length}`, inline: true },
            { name: "Rodzaje dokumentów", value: truncatedCountsSummary, inline: false },
          ],
        }),
      });

      if (!discordResponse.ok) {
        const details = await discordResponse.text();
        throw new Error(details || "Nie udało się wysłać raportu na Discord.");
      }

      const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 2000);

      setReportSuccess("Raport został wygenerowany i wysłany na Discord.");
      setSelectedIds([]);
      setSelectionMode(false);

      if (session) {
        void logActivity({ type: "archive_report_generated", count: selectedItems.length });
      }
    } catch (error: any) {
      console.error("Nie udało się utworzyć raportu archiwum", error);
      setDownloadError(error instanceof Error ? error.message : "Nie udało się utworzyć raportu.");
    } finally {
      setDownloading(false);
    }
  }, [selectionMode, selectedIds, items, login, session, logActivity]);

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
                      onClick={createReport}
                    >
                      {downloading ? "Generowanie..." : `Utwórz raport (${selectedCount})`}
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
                  Zaznacz dokumenty, które mają trafić do raportu PDF. Wszystkie informacje i załączniki
                  znajdą się w jednym pliku.
                </p>
              )}
              {downloadError && <p className="text-sm text-red-300">{downloadError}</p>}
              {reportSuccess && <p className="text-sm text-green-400">{reportSuccess}</p>}
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
