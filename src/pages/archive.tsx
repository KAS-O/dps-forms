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
  textContent?: string | null;
  textPages?: string[];
  values?: Record<string, unknown> | null;
};

type ArchiveTextSection = {
  title?: string;
  lines: string[];
};

const VALUE_SKIP_KEYS = new Set(["funkcjonariusze", "liczbaStron"]);

const EXTRA_VALUE_LABELS: Record<string, string> = {
  teczkaPojazdu: "Teczka pojazdu",
};

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
    for (let j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

async function loadAssetAsBase64(path: string): Promise<string | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    return arrayBufferToBase64(buffer);
  } catch (error) {
    console.warn("Nie udało się pobrać zasobu raportu", error);
    return null;
  }
}

function sanitizePdfLine(raw: string): string {
  if (!raw) return "";
  const normalized = raw.replace(/\u00a0/g, " ").replace(/\r/g, "").normalize("NFC");
  const letterGroup = "[\\p{L}\\p{M}\\d]+";
  const stretchedSequence = new RegExp(`((?:${letterGroup}\\s){2,}${letterGroup})`, "gu");
  let cleaned = normalized.replace(stretchedSequence, (sequence) => sequence.replace(/\s+/g, ""));
  cleaned = cleaned.replace(/\s+([.,!?;:%])/g, "$1");
  cleaned = cleaned.replace(/([„(])\s+/g, "$1");
  cleaned = cleaned.replace(/\s+(”)/g, "$1");
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  return cleaned.trim();
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd());
}

function extractFromTextContent(content?: string | null) {
  if (!content) {
    return { metaLines: [] as string[], contentLines: [] as string[] };
  }
  const lines = splitLines(content);
  const metaLines: string[] = [];
  const contentLines: string[] = [];
  let readingMeta = true;

  lines.forEach((line) => {
    if (readingMeta) {
      if (line.trim() === "") {
        readingMeta = false;
        return;
      }
      metaLines.push(line);
    } else {
      contentLines.push(line);
    }
  });

  return { metaLines, contentLines };
}

function resolveTemplate(item: { templateSlug?: string; templateName?: string }): Template | undefined {
  if (item.templateSlug) {
    const bySlug = TEMPLATES.find((template) => template.slug === item.templateSlug);
    if (bySlug) return bySlug;
  }
  if (item.templateName) {
    const normalized = item.templateName.toLowerCase();
    const byName = TEMPLATES.find((template) => template.name.toLowerCase() === normalized);
    if (byName) return byName;
  }
  return undefined;
}

function formatFieldValue(raw: unknown): string {
  if (raw == null) return "—";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
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
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw.toString() : "—";
  }
  if (raw instanceof Date) {
    return raw.toLocaleString("pl-PL");
  }
  if (typeof raw === "object" && raw) {
    const maybeTimestamp = raw as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const date = maybeTimestamp.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.toLocaleString("pl-PL");
      }
    }
  }
  return String(raw);
}

function buildFieldLinesFromValues(
  values: Record<string, unknown> | null | undefined,
  template?: Template
): string[] {
  if (!values) return [];
  const lines: string[] = [];
  const usedKeys = new Set<string>();
  if (template) {
    template.fields.forEach((field) => {
      const value = values[field.key];
      lines.push(`${field.label}: ${formatFieldValue(value)}`);
      usedKeys.add(field.key);
    });
  }

  Object.entries(values).forEach(([key, value]) => {
    if (usedKeys.has(key)) return;
    if (VALUE_SKIP_KEYS.has(key)) return;
    const label = EXTRA_VALUE_LABELS[key] || key;
    lines.push(`${label}: ${formatFieldValue(value)}`);
  });

  return lines;
}

function buildFallbackMetaLines(item: Archive): string[] {
  const lines: string[] = [];
  lines.push(`Dokument: ${item.templateName || "—"}`);
  lines.push(`Autor (login): ${item.userLogin || "—"}`);
  const officersText = (item.officers || []).join(", ");
  lines.push(`Funkcjonariusze: ${officersText || "—"}`);
  if (item.vehicleFolderRegistration) {
    lines.push(`Teczka pojazdu: ${item.vehicleFolderRegistration}`);
  }
  if (item.dossierId) {
    lines.push(`Powiązana teczka: ${item.dossierId}`);
  }
  return lines;
}

function buildArchiveTextSections(item: Archive): ArchiveTextSection[] {
  const sections: ArchiveTextSection[] = [];
  const template = resolveTemplate(item);
  const { metaLines: rawMetaLines, contentLines: rawContentLines } = extractFromTextContent(item.textContent);

  let metaLines = rawMetaLines.filter((line) => line.trim().length > 0);
  if (!metaLines.length) {
    metaLines = buildFallbackMetaLines(item).filter((line) => line.trim().length > 0);
  }
  if (metaLines.length) {
    sections.push({ title: "Metryka", lines: metaLines });
  }

  if (item.textPages && item.textPages.length) {
    item.textPages.forEach((pageText, index) => {
      const pageLines = splitLines(pageText);
      if (pageLines.some((line) => line.trim().length > 0)) {
        sections.push({
          title: item.textPages && item.textPages.length > 1 ? `Strona ${index + 1}` : "Treść",
          lines: pageLines,
        });
      }
    });
    return sections;
  }

  const contentLines = rawContentLines.filter((line) => line.trim().length > 0);
  if (contentLines.length) {
    sections.push({ title: "Treść", lines: contentLines });
    return sections;
  }

  const fallbackFieldLines = buildFieldLinesFromValues(item.values ?? null, template).filter(
    (line) => line.trim().length > 0
  );
  if (fallbackFieldLines.length) {
    sections.push({ title: "Treść", lines: fallbackFieldLines });
  }

  return sections;
}

function buildArchiveSearchText(item: Archive): string {
  const parts: string[] = [
    item.templateName || "",
    item.templateSlug || "",
    item.userLogin || "",
    (item.officers || []).join(" "),
    item.vehicleFolderRegistration || "",
    item.dossierId || "",
    item.textContent || "",
  ];
  if (item.textPages?.length) {
    parts.push(item.textPages.join(" \n"));
  }
  if (item.values) {
    parts.push(
      Object.entries(item.values)
        .map(([key, value]) => `${key}: ${formatFieldValue(value)}`)
        .join(" ")
    );
  }
  return parts.join(" ").toLowerCase();
}

function buildArchive(snapshot: QueryDocumentSnapshot<DocumentData>): Archive {
  const data = snapshot.data() as Record<string, unknown>;
  const urlsRaw = ensureArray(data.imageUrls);
  const pathsRaw = ensureArray(data.imagePaths);
  const imageUrls = urlsRaw.length ? urlsRaw : ensureArray(data.imageUrl);
  const imagePaths = pathsRaw.length ? pathsRaw : ensureArray(data.imagePath);
  const createdAtDate = (data.createdAt as any)?.toDate?.() || null;
  const textPages = ensureArray(data.textPages);
  const textContent = typeof data.textContent === "string" ? data.textContent : null;
  const values =
    data.values && typeof data.values === "object" && !Array.isArray(data.values)
      ? (data.values as Record<string, unknown>)
      : null;

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
    textContent,
    textPages,
    values,
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
      const haystack = buildArchiveSearchText(item);
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

      const [logoBase64] = await Promise.all([loadAssetAsBase64("/logo.png")]);

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 60;
      const bottomMargin = 70;
      const contentTop = 160;
      const contentBottom = pageHeight - bottomMargin;
      const contentWidth = pageWidth - marginX * 2;

      const setBodyFont = () => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(55, 65, 81);
        doc.setLineHeightFactor(1.4);
      };

      const applyPageChrome = () => {
        doc.setFillColor(245, 247, 250);
        doc.rect(0, 0, pageWidth, pageHeight, "F");

        const cardTop = 120;
        const cardHeight = pageHeight - cardTop - bottomMargin;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.8);
        doc.roundedRect(marginX - 20, cardTop, contentWidth + 40, cardHeight, 14, 14, "FD");

        if (logoBase64) {
          doc.addImage(`data:image/png;base64,${logoBase64}`, "PNG", marginX, 50, 56, 56);
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.setTextColor(23, 37, 84);
        doc.text("Raport archiwum", marginX + 70, 82);

        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(1.2);
        doc.line(marginX, 112, pageWidth - marginX, 112);

        setBodyFont();
      };

      applyPageChrome();
      let cursorY = contentTop;

      const ensureSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight > contentBottom) {
          doc.addPage();
          applyPageChrome();
          cursorY = contentTop;
        }
      };

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.text("Podsumowanie", marginX, cursorY);
      cursorY += 22;

      setBodyFont();
      const summaryLines = [
        `Wygenerował: ${login || "—"}`,
        `Data wygenerowania: ${now.toLocaleString("pl-PL")}`,
        `Liczba dokumentów: ${totalDocuments}`,
      ];

      summaryLines.forEach((line) => {
        const sanitized = sanitizePdfLine(line);
        if (!sanitized) return;
        ensureSpace(18);
        doc.text(sanitized, marginX, cursorY);
        cursorY += 16;
      });

      if (typeSummaryLines.length > 0) {
        ensureSpace(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        doc.text("Zestawienie typów dokumentów:", marginX, cursorY);
        cursorY += 18;

        setBodyFont();
        typeSummaryLines.forEach((line) => {
          const sanitized = sanitizePdfLine(line);
          if (!sanitized) return;
          ensureSpace(16);
          doc.text(`• ${sanitized}`, marginX + 12, cursorY);
          cursorY += 14;
        });
      }

      cursorY += 12;
      ensureSpace(24);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.text("Szczegóły dokumentów", marginX, cursorY);
      cursorY += 26;

      setBodyFont();

      for (const item of selectedItems) {
        const createdAt = item.createdAt?.toDate?.() || item.createdAtDate || null;
        const officers = (item.officers || []).join(", ") || "—";
        const dossier = item.dossierId ? `Teczka: ${item.dossierId}` : null;
        const vehicleRegistration = item.vehicleFolderRegistration
          ? `Folder pojazdu: ${item.vehicleFolderRegistration}`
          : null;

        ensureSpace(32);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(23, 37, 84);
        const documentTitle = sanitizePdfLine(item.templateName || item.templateSlug || "Dokument");
        doc.text(documentTitle, marginX, cursorY);
        cursorY += 20;

        setBodyFont();
        const infoLines = [
          `Autor (login): ${item.userLogin || "—"}`,
          `Funkcjonariusze: ${officers}`,
          `Data utworzenia: ${createdAt ? createdAt.toLocaleString("pl-PL") : "—"}`,
        ];
        if (dossier) infoLines.push(dossier);
        if (vehicleRegistration) infoLines.push(vehicleRegistration);

        infoLines.forEach((line) => {
          const sanitized = sanitizePdfLine(line);
          if (!sanitized) return;
          ensureSpace(16);
          doc.text(sanitized, marginX, cursorY);
          cursorY += 14;
        });

        const sections = buildArchiveTextSections(item);
        if (!sections.length) {
          ensureSpace(16);
          doc.text("(Brak danych tekstowych w archiwum)", marginX, cursorY);
          cursorY += 30;
          continue;
        }

        sections.forEach((section) => {
          if (section.title) {
            ensureSpace(20);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(30, 41, 59);
            const sanitizedTitle = sanitizePdfLine(section.title);
            if (sanitizedTitle) {
              doc.text(sanitizedTitle, marginX, cursorY);
              cursorY += 16;
            }
            setBodyFont();
          }

          section.lines.forEach((line) => {
            const sanitizedContent = sanitizePdfLine(line ?? "");
            if (!sanitizedContent) {
              ensureSpace(12);
              cursorY += 12;
              return;
            }
            const wrapped = doc.splitTextToSize(sanitizedContent, contentWidth - 24);
            wrapped.forEach((wrappedLine) => {
              const sanitizedWrapped = sanitizePdfLine(wrappedLine);
              if (!sanitizedWrapped) return;
              ensureSpace(14);
              doc.text(sanitizedWrapped, marginX + 16, cursorY);
              cursorY += 14;
            });
          });

          cursorY += 12;
        });

        cursorY += 12;
      }

      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`Strona ${page} z ${totalPages}`, pageWidth - marginX, pageHeight - bottomMargin / 2, {
          align: "right",
        });
      }

      doc.setPage(1);

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
                const textSections = buildArchiveTextSections(item);

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
                      {textSections.length > 0 && (
                        <div className="mt-3 space-y-3 text-sm">
                          {textSections.map((section, sectionIndex) => (
                            <div
                              key={`${item.id}-section-${sectionIndex}`}
                              className="rounded-xl border border-white/10 bg-black/20 p-3 whitespace-pre-wrap leading-5"
                            >
                              {section.title && (
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-beige-500">
                                  {section.title}
                                </div>
                              )}
                              {section.lines.join("\n")}
                            </div>
                          ))}
                        </div>
                      )}
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
