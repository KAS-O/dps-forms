import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useProfile, can } from "@/hooks/useProfile";
import { db } from "@/lib/firebase";
import { TEMPLATES, Template } from "@/lib/templates";
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

type ArchiveFieldEntry = {
  key: string;
  label: string;
  value: string;
};

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
  values?: Record<string, unknown> | null;
  textPages?: string[];
  textContent?: string;
  formattedFields: ArchiveFieldEntry[];
  searchableText: string;
};

const TEMPLATE_LOOKUP = new Map(TEMPLATES.map((template) => [template.slug, template] as const));

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function humanizeValueKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatArchiveFieldValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    if (trimmed.includes("|")) {
      const parts = trimmed
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        return parts.join(", ");
      }
    }
    return trimmed;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "boolean") {
    return value ? "Tak" : "Nie";
  }
  if (value instanceof Date) {
    return value.toLocaleString("pl-PL");
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => formatArchiveFieldValue(entry))
      .filter((entry) => entry !== "—");
    return parts.length ? parts.join(", ") : "—";
  }
  if (typeof value === "object") {
    const maybeTimestamp = (value as { toDate?: () => Date })?.toDate;
    if (typeof maybeTimestamp === "function") {
      try {
        const dateValue = maybeTimestamp.call(value);
        return formatArchiveFieldValue(dateValue);
      } catch (error) {
        console.warn("Nie udało się zinterpretować wartości pola archiwum jako daty", error);
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildFormattedFields(
  values: Record<string, unknown> | null | undefined,
  template: Template | undefined,
  includeFunkcjonariusze: boolean
): ArchiveFieldEntry[] {
  if (!values || typeof values !== "object") {
    return [];
  }

  const entries: ArchiveFieldEntry[] = [];
  const seen = new Set<string>();

  if (template) {
    template.fields.forEach((field) => {
      const formatted = formatArchiveFieldValue(values[field.key]);
      entries.push({ key: field.key, label: field.label, value: formatted });
      seen.add(field.key);
    });
  }

  Object.keys(values).forEach((key) => {
    if (seen.has(key)) return;
    if (!includeFunkcjonariusze && key === "funkcjonariusze") return;

    const formatted = formatArchiveFieldValue(values[key]);
    const label = humanizeValueKey(key);
    entries.push({ key, label, value: formatted });
  });

  return entries;
}

function buildArchive(snapshot: QueryDocumentSnapshot<DocumentData>): Archive {
  const data = snapshot.data() as Record<string, unknown>;
  const urlsRaw = ensureArray(data.imageUrls);
  const pathsRaw = ensureArray(data.imagePaths);
  const imageUrls = urlsRaw.length ? urlsRaw : ensureArray(data.imageUrl);
  const imagePaths = pathsRaw.length ? pathsRaw : ensureArray(data.imagePath);
  const createdAtDate = (data.createdAt as any)?.toDate?.() || null;

  const templateSlug = (data.templateSlug as string) || undefined;
  const template = templateSlug ? TEMPLATE_LOOKUP.get(templateSlug) : undefined;

  const officers = Array.isArray(data.officers)
    ? (data.officers as unknown[]).filter((value): value is string => typeof value === "string")
    : undefined;

  const values =
    data.values && typeof data.values === "object" && !Array.isArray(data.values)
      ? (data.values as Record<string, unknown>)
      : null;

  const textPagesRaw = Array.isArray(data.textPages)
    ? (data.textPages as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  const textPages = textPagesRaw.map((page) => page.trim()).filter((page) => page.length > 0);

  let textContent = typeof data.textContent === "string" ? data.textContent : null;
  if (!textContent && textPages.length) {
    textContent = textPages.join("\n\n");
  }

  const formattedFields = buildFormattedFields(values, template, !(officers && officers.length > 0));
  const aggregatedFieldsText = formattedFields
    .map((entry) => `${entry.label}: ${entry.value}`)
    .join(" ");

  const searchParts = [
    data.templateName,
    templateSlug,
    data.userLogin,
    officers?.join(" "),
    data.vehicleFolderRegistration,
    data.dossierId,
    aggregatedFieldsText,
    textContent,
  ];

  const searchableText = searchParts
    .map((part) => (typeof part === "string" ? part : ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    id: snapshot.id,
    templateName: (data.templateName as string) || "Bez nazwy",
    templateSlug,
    userLogin: (data.userLogin as string) || undefined,
    officers,
    dossierId: (data.dossierId as string) || null,
    vehicleFolderRegistration: (data.vehicleFolderRegistration as string) || undefined,
    imageUrl: imageUrls[0],
    imageUrls,
    imagePath: imagePaths[0],
    imagePaths,
    createdAt: data.createdAt,
    createdAtDate,
    values,
    textPages: textPages.length ? textPages : undefined,
    textContent: textContent || undefined,
    formattedFields,
    searchableText,
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
  const [creatingReport, setCreatingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
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
      return item.searchableText.includes(needle);
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
    setReportError(null);
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
      setCreatingReport(true);
      setReportError(null);

      const { jsPDF } = await import("jspdf");

      const selectedItems = items.filter((item) => selectedIds.includes(item.id));
      if (selectedItems.length === 0) {
        throw new Error("Nie wybrano żadnych dokumentów.");
      }

      const now = new Date();
      const documentName = `raport-archiwum-${now.toISOString().replace(/[:.]/g, "-")}.pdf`;
      const totalDocuments = selectedItems.length;
      const typeCounts = new Map<string, number>();

      selectedItems.forEach((item) => {
        const key = item.templateName || item.templateSlug || "Nieznany dokument";
        typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
      });

      const typeSummaryLines = Array.from(typeCounts.entries()).map(
        ([type, count]) => `${count}× ${type}`
      );

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 50;
      let cursorY = margin;

      doc.setFontSize(18);
      doc.text("Raport archiwum", margin, cursorY);
      cursorY += 26;

      doc.setFontSize(12);
      doc.text(`Wygenerował: ${login || "—"}`, margin, cursorY);
      cursorY += 18;
      doc.text(`Data wygenerowania: ${now.toLocaleString("pl-PL")}`, margin, cursorY);
      cursorY += 18;
      doc.text(`Liczba dokumentów: ${totalDocuments}`, margin, cursorY);
      cursorY += 20;

      if (typeSummaryLines.length > 0) {
        doc.setFontSize(12);
        doc.text("Zestawienie typów dokumentów:", margin, cursorY);
        cursorY += 18;
        doc.setFontSize(11);
        typeSummaryLines.forEach((line) => {
          doc.text(`• ${line}`, margin + 12, cursorY);
          cursorY += 16;
        });
      }

      cursorY += 10;
      doc.setFontSize(12);
      doc.text("Szczegóły dokumentów:", margin, cursorY);
      cursorY += 24;

      const ensureSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight > pageHeight - margin) {
          doc.addPage();
          cursorY = margin;
        }
      };

      for (const item of selectedItems) {
        const createdAt = item.createdAt?.toDate?.() || item.createdAtDate || null;
        const officers = (item.officers || []).join(", ") || "—";
        const dossier = item.dossierId ? `Teczka: ${item.dossierId}` : null;
        const vehicleRegistration = item.vehicleFolderRegistration
          ? `Folder pojazdu: ${item.vehicleFolderRegistration}`
          : null;

        doc.setFontSize(14);
        ensureSpace(24);
        doc.text(item.templateName || item.templateSlug || "Dokument", margin, cursorY);
        cursorY += 18;

        doc.setFontSize(11);
        const infoLines = [
          `Autor (login): ${item.userLogin || "—"}`,
          `Funkcjonariusze: ${officers}`,
          `Data utworzenia: ${createdAt ? createdAt.toLocaleString("pl-PL") : "—"}`,
        ];
        if (dossier) infoLines.push(dossier);
        if (vehicleRegistration) infoLines.push(vehicleRegistration);

        infoLines.forEach((line) => {
          ensureSpace(16);
          doc.text(line, margin, cursorY);
          cursorY += 14;
        });

        const documentFields = item.formattedFields || [];
        const fallbackText = (item.textContent || "").trim();
        const lineHeight = 14;
        const indent = 12;

        if (documentFields.length > 0) {
          doc.setFontSize(11);
          ensureSpace(lineHeight);
          doc.setFont("helvetica", "bold");
          doc.text("Zawartość dokumentu:", margin, cursorY);
          cursorY += lineHeight + 2;

          documentFields.forEach((field) => {
            const value = field.value || "—";
            const lines = doc.splitTextToSize(value, pageWidth - margin * 2 - indent);
            const blockHeight = lineHeight + lines.length * lineHeight + 4;
            ensureSpace(blockHeight);
            doc.setFont("helvetica", "bold");
            doc.text(`${field.label}:`, margin, cursorY);
            cursorY += lineHeight;
            doc.setFont("helvetica", "normal");
            lines.forEach((line) => {
              doc.text(line, margin + indent, cursorY);
              cursorY += lineHeight;
            });
            cursorY += 4;
          });

          cursorY += 6;
        } else if (fallbackText) {
          const lines = doc.splitTextToSize(fallbackText, pageWidth - margin * 2);
          const blockHeight = lines.length * lineHeight;
          ensureSpace(blockHeight);
          doc.setFont("helvetica", "normal");
          lines.forEach((line) => {
            doc.text(line, margin, cursorY);
            cursorY += lineHeight;
          });
          cursorY += 10;
        } else {
          const images = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
          if (images.length > 0) {
            ensureSpace(lineHeight);
            doc.setFont("helvetica", "italic");
            doc.text("Brak danych tekstowych. Dostępne obrazy:", margin, cursorY);
            cursorY += lineHeight;
            doc.setFont("helvetica", "normal");
            images.forEach((url, index) => {
              const label = `Strona ${index + 1}: ${url}`;
              const linkLines = doc.splitTextToSize(label, pageWidth - margin * 2 - indent);
              const blockHeight = linkLines.length * lineHeight;
              ensureSpace(blockHeight);
              linkLines.forEach((line) => {
                doc.text(line, margin + indent, cursorY);
                cursorY += lineHeight;
              });
            });
            cursorY += 8;
          } else {
            ensureSpace(lineHeight);
            doc.setFont("helvetica", "italic");
            doc.text("(Brak danych tekstowych)", margin, cursorY);
            cursorY += lineHeight + 4;
            doc.setFont("helvetica", "normal");
          }
        }
      }

      const arrayBuffer = doc.output("arraybuffer");
      if (!(arrayBuffer instanceof ArrayBuffer)) {
        throw new Error("Nie udało się wygenerować pliku PDF.");
      }
      const pdfBase64 = arrayBufferToBase64(arrayBuffer);
      const typeSummaryText = typeSummaryLines.length ? typeSummaryLines.join("\n") : "—";

      const response = await fetch("/api/send-archive-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: documentName,
          fileBase64: pdfBase64,
          metadata: {
            generatedBy: login || "—",
            generatedAt: now.toISOString(),
            generatedAtDisplay: now.toLocaleString("pl-PL"),
            totalDocuments,
            typeSummary: typeSummaryText,
          },
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || "Nie udało się wysłać raportu na Discord.");
      }

      await alert({
        title: "Raport wysłany",
        message: "Raport został wygenerowany i przesłany na Discord.",
        tone: "info",
      });

      setSelectedIds([]);
      setSelectionMode(false);
    } catch (error) {
      console.error("Nie udało się wygenerować raportu", error);
      const message = error instanceof Error ? error.message : "Nie udało się wygenerować raportu.";
      setReportError(message);
      await alert({
        title: "Błąd raportu",
        message,
        tone: "danger",
      });
    } finally {
      setCreatingReport(false);
    }
  }, [alert, items, login, selectedIds, selectionMode]);

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
                      disabled={selectedCount === 0 || creatingReport}
                      onClick={createReport}
                    >
                      {creatingReport ? "Generowanie..." : `Utwórz raport (${selectedCount})`}
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
                  Zaznacz dokumenty do raportu. Wszystkie informacje tekstowe trafią do jednego pliku PDF.
                </p>
              )}
              {reportError && <p className="text-sm text-red-300">{reportError}</p>}
            </div>
  
            <div className="grid gap-2">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const createdAt = item.createdAt?.toDate?.() || item.createdAtDate;
                const imageLinks = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
                const fieldEntries = item.formattedFields || [];
                const fallbackText = (item.textContent || "").trim();

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
                      {fieldEntries.length > 0 ? (
                        <div className="mt-3 space-y-3 text-sm">
                          {fieldEntries.map((field) => (
                            <div key={`${item.id}-field-${field.key}`} className="grid gap-1">
                              <div className="font-semibold text-beige-200">{field.label}</div>
                              <div className="whitespace-pre-wrap text-beige-100">{field.value || "—"}</div>
                            </div>
                          ))}
                        </div>
                      ) : fallbackText ? (
                        <div className="mt-3 whitespace-pre-wrap text-sm text-beige-100">{fallbackText}</div>
                      ) : null}
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
