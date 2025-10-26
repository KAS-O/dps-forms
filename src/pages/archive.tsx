import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useProfile, can } from "@/hooks/useProfile";
import { db } from "@/lib/firebase";
import { ensureReportFonts } from "@/lib/reportFonts";
import { REPORT_LOGO_PNG } from "@/lib/reportAssets";
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

const DOCUMENT_LINE_PATTERN = /^dokument\s*:/i;

const FINE_FIELDS_BY_SLUG: Record<string, string[]> = {
  "bloczek-mandatowy": ["kwota"],
  "kontrola-lseb": ["grzywna"],
  "protokol-aresztowania": ["grzywna"],
  "raport-zalozenia-blokady": ["kara"],
  "protokol-zajecia-pojazdu": ["grzywna"],
};

const FINE_FIELDS_BY_NAME: Record<string, string[]> = {
  "bloczek mandatowy": ["kwota"],
  "kontrola lseb": ["grzywna"],
  "protokół aresztowania": ["grzywna"],
  "raport z założenia blokady": ["kara"],
  "protokół zajęcia pojazdu": ["grzywna"],
};

function parseAmount(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const normalized = trimmed
      .replace(/[\s\u00A0]/g, "")
      .replace(/,/g, ".")
      .replace(/[^0-9.+-]/g, "");
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function formatCurrency(value: number): string {
  const formatter = new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
  return formatter
    .format(Math.max(0, value))
    .replace(/\u00A0/g, " ");
}

function collectFineAmount(item: Archive): number {
  const slug = item.templateSlug || "";
  const nameKey = (item.templateName || "").toLowerCase();
  const fieldKeys = new Set<string>([
    ...(FINE_FIELDS_BY_SLUG[slug] ?? []),
    ...(FINE_FIELDS_BY_NAME[nameKey] ?? []),
  ]);
  if (!fieldKeys.size || !item.values) {
    return 0;
  }
  let sum = 0;
  fieldKeys.forEach((field) => {
    sum += parseAmount(item.values?.[field]);
  });
  return sum;
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

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd());
}

function normalizePdfLine(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s([.,;:!?])/g, "$1")
    .trim();
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
    const sanitizedMeta = metaLines.filter((line) => !DOCUMENT_LINE_PATTERN.test(line));
    if (sanitizedMeta.length) {
      sections.push({ title: "Metryka", lines: sanitizedMeta });
    }
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
  const { role, login, fullName } = useProfile();
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

      const requestedDocuments = selectedIds.length;
      const selectedItems = items.filter((item) => selectedIds.includes(item.id));
      if (selectedItems.length === 0) {
        throw new Error("Nie wybrano żadnych dokumentów.");
      }

      const now = new Date();
      const documentName = `raport-czynnosci-sluzbowych-${now
        .toISOString()
        .replace(/[:.]/g, "-")}.pdf`;
      const totalDocuments = selectedItems.length;
      const missingDocuments = Math.max(0, requestedDocuments - totalDocuments);
      const typeCounts = new Map<string, number>();
      let totalFinesAmount = 0;

      selectedItems.forEach((item) => {
        const key = item.templateName || item.templateSlug || "Nieznany dokument";
        typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
        totalFinesAmount += collectFineAmount(item);
      });

      const typeSummaryLines = Array.from(typeCounts.entries()).map(
        ([type, count]) => `${count}× ${type}`
      );


      const doc = new jsPDF({ unit: "pt", format: "a4" });
      ensureReportFonts(doc);
      doc.setLineHeightFactor(1.5);

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 56;
      const contentWidth = pageWidth - margin * 2;
      const headerHeight = 150;
      const firstPageTop = headerHeight + 52;
      const subsequentTop = margin + 32;
      const logoSize = 56;
      const backgroundColor = { r: 247, g: 245, b: 240 };
      const logoDataUri = `data:image/png;base64,${REPORT_LOGO_PNG}`;
      const confidentialityNotice =
        "Raport zawiera informacje poufne. Dokument przeznaczony jest wyłącznie do użytku wewnętrznego Los Santos Police Department.";
      const totalFineDisplay = formatCurrency(totalFinesAmount);
      const processedLine =
        missingDocuments > 0
          ? `Uwzględniono ${totalDocuments} z ${requestedDocuments} dokumentów (brakujących: ${missingDocuments}).`
          : `Uwzględniono ${totalDocuments} z ${requestedDocuments} dokumentów.`;

      type TextColor = { r: number; g: number; b: number };
      type TextEntry = {
        fontSize: number;
        color: TextColor;
        lines: string[];
        spacingBefore?: number;
        spacingAfter?: number;
        indent?: number;
        align?: "left" | "right";
        height: number;
      };

      const colors = {
        title: { r: 15, g: 23, b: 42 },
        heading: { r: 30, g: 41, b: 59 },
        body: { r: 55, g: 65, b: 81 },
        muted: { r: 107, g: 114, b: 128 },
        accent: { r: 6, g: 78, b: 59 },
      } satisfies Record<string, TextColor>;

      const wrapText = (text: string, maxWidth: number, fontSize: number) => {
        doc.setFontSize(fontSize);
        const normalized = normalizePdfLine(text);
        return normalized ? doc.splitTextToSize(normalized, maxWidth) : [];
      };

      const measureEntry = (lines: string[], fontSize: number) => {
        doc.setFontSize(fontSize);
        return doc.getTextDimensions(lines.length ? lines : [""]).h;
      };

      const renderPageDecorations = (isFirstPage: boolean) => {
        doc.setFillColor(backgroundColor.r, backgroundColor.g, backgroundColor.b);
        doc.rect(0, 0, pageWidth, pageHeight, "F");

        doc.setFillColor(17, 24, 39);
        if (isFirstPage) {
          doc.rect(0, 0, pageWidth, headerHeight, "F");

          const headerContentWidth = contentWidth;
          const noticeWidth = Math.min(240, headerContentWidth * 0.45);
          const noticeY = 32;
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          const noticeLines = doc.splitTextToSize(confidentialityNotice, noticeWidth);
          doc.text(noticeLines, margin, noticeY);
          const noticeHeight = doc.getTextDimensions(noticeLines).h;

          const logoY = noticeY + noticeHeight + 18;
          doc.addImage(logoDataUri, "PNG", margin, logoY, logoSize, logoSize);

          const headerRightX = pageWidth - margin;
          const headerInfoWidth = 220;

          doc.setTextColor(255, 255, 255);
          doc.setFontSize(11);
          const titleLines = doc.splitTextToSize("Raport czynności służbowych", headerContentWidth - logoSize - 48);
          const titleX = margin + logoSize + 28;
          const titleY = logoY + 6;
          doc.text(titleLines, titleX, titleY);
          const titleHeight = doc.getTextDimensions(titleLines).h;

          doc.setFontSize(9);
          const generatedLines = doc.splitTextToSize(
            `Wygenerowano: ${now.toLocaleString("pl-PL")}`,
            headerInfoWidth
          );
          const documentsLines = doc.splitTextToSize(
            `Dokumenty w raporcie: ${totalDocuments}`,
            headerInfoWidth
          );
          const finesLines = doc.splitTextToSize(`Suma kar: ${totalFineDisplay}`, headerInfoWidth);

          const infoStartY = titleY + titleHeight + 10;
          doc.text(generatedLines, titleX, infoStartY);
          const generatedHeight = doc.getTextDimensions(generatedLines).h;
          doc.text(documentsLines, titleX, infoStartY + generatedHeight + 4);
          const documentsHeight = doc.getTextDimensions(documentsLines).h;
          doc.text(finesLines, titleX, infoStartY + generatedHeight + documentsHeight + 8);

          doc.setFontSize(9);
          doc.text(now.toLocaleString("pl-PL"), headerRightX, noticeY + 6, { align: "right" });
        } else {
          const barHeight = 60;
          doc.rect(0, 0, pageWidth, barHeight, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(11);
          doc.text("Raport czynności służbowych — kontynuacja", margin, 34);
          doc.setFontSize(9);
          doc.text(now.toLocaleString("pl-PL"), pageWidth - margin, 34, { align: "right" });
        }

        doc.setTextColor(colors.body.r, colors.body.g, colors.body.b);
      };

      const ensureSpace = (requiredHeight: number, currentY: number) => {
        if (currentY + requiredHeight > pageHeight - margin) {
          doc.addPage();
          renderPageDecorations(false);
          return subsequentTop;
        }
        return currentY;
      };

      renderPageDecorations(true);
      let cursorY = firstPageTop;

      const summaryPadding = 28;
      const summaryInnerWidth = contentWidth - summaryPadding * 2;
      const summaryEntries: TextEntry[] = [];

      const addSummaryEntry = (
        text: string,
        fontSize: number,
        color: TextColor,
        options: { spacingBefore?: number; spacingAfter?: number; align?: "left" | "right"; indent?: number } = {}
      ) => {
        const lines = wrapText(text, summaryInnerWidth - (options.indent ?? 0), fontSize);
        const height = measureEntry(lines, fontSize);
        summaryEntries.push({
          fontSize,
          color,
          lines,
          spacingBefore: options.spacingBefore,
          spacingAfter: options.spacingAfter,
          align: options.align,
          indent: options.indent,
          height,
        });
      };

      addSummaryEntry("Podsumowanie", 14, colors.heading);
      addSummaryEntry(`Wygenerował: ${fullName || login || "—"}`, 11, colors.body, { spacingBefore: 10 });
      addSummaryEntry(`Data wygenerowania: ${now.toLocaleString("pl-PL")}`, 11, colors.body, {
        spacingBefore: 4,
      });
      addSummaryEntry(`Łączna liczba dokumentów: ${totalDocuments}`, 11, colors.body, { spacingBefore: 4 });
      addSummaryEntry(`Łączna kwota grzywien/mandatów: ${totalFineDisplay}`, 11, colors.body, {
        spacingBefore: 4,
      });
      addSummaryEntry(processedLine, 11, colors.body, { spacingBefore: 6 });

      if (typeSummaryLines.length) {
        addSummaryEntry("Zestawienie typów dokumentów:", 11, colors.heading, { spacingBefore: 12 });
        typeSummaryLines.forEach((line) => {
          addSummaryEntry(`• ${normalizePdfLine(line)}`, 10, colors.body, {
            spacingBefore: 2,
            indent: 10,
          });
        });
      } else {
        addSummaryEntry("Brak dodatkowego zestawienia typów dokumentów.", 10, colors.muted, {
          spacingBefore: 10,
        });
      }

      const summaryContentHeight = summaryEntries.reduce((acc, entry) => {
        return acc + (entry.spacingBefore ?? 0) + entry.height + (entry.spacingAfter ?? 0);
      }, 0);
      const summaryBoxHeight = summaryContentHeight + summaryPadding * 2;

      let summaryBoxTop = cursorY - 20;
      cursorY = ensureSpace(summaryBoxHeight, cursorY);
      if (cursorY !== summaryBoxTop + 20) {
        summaryBoxTop = cursorY - 20;
      }

      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, summaryBoxTop, contentWidth, summaryBoxHeight, 14, 14, "F");
      doc.setDrawColor(214, 211, 209);
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, summaryBoxTop, contentWidth, summaryBoxHeight, 14, 14, "S");

      let summaryCursorY = summaryBoxTop + summaryPadding;
      summaryEntries.forEach((entry) => {
        summaryCursorY += entry.spacingBefore ?? 0;
        doc.setFontSize(entry.fontSize);
        doc.setTextColor(entry.color.r, entry.color.g, entry.color.b);
        const baseX = margin + summaryPadding + (entry.indent ?? 0);
        if (entry.align === "right") {
          doc.text(entry.lines, margin + contentWidth - summaryPadding, summaryCursorY, {
            align: "right",
          });
        } else {
          doc.text(entry.lines, baseX, summaryCursorY);
        }
        summaryCursorY += entry.height + (entry.spacingAfter ?? 0);
      });

      cursorY = summaryBoxTop + summaryBoxHeight + 32;
      doc.setDrawColor(colors.body.r, colors.body.g, colors.body.b);
      doc.setLineWidth(0.5);
      doc.setFontSize(13);
      doc.setTextColor(colors.heading.r, colors.heading.g, colors.heading.b);
      doc.text("Szczegóły dokumentów", margin, cursorY);
      cursorY += 26;

      const blockPaddingX = 28;
      const blockPaddingY = 24;
      const blockInnerWidth = contentWidth - blockPaddingX * 2;
      const blockTextWidth = blockInnerWidth - 16;
      const blockSpacing = 26;

      type BlockEntry =
        | { kind: "text"; entry: TextEntry }
        | { kind: "spacer"; height: number };

      selectedItems.forEach((item, index) => {
        const createdAt = item.createdAt?.toDate?.() || item.createdAtDate || null;
        const officers = (item.officers || []).join(", ") || "—";
        const dossier = item.dossierId ? `Teczka: ${item.dossierId}` : null;
        const vehicleRegistration = item.vehicleFolderRegistration
          ? `Folder pojazdu: ${item.vehicleFolderRegistration}`
          : null;

        const sections = buildArchiveTextSections(item);
        const metaContainsOfficers = sections.some((section) =>
          section.lines.some((line) => line.toLowerCase().includes("funkcjonariusz"))
        );

        const infoLines = [
          `Data utworzenia: ${createdAt ? createdAt.toLocaleString("pl-PL") : "—"}`,
        ];
        if (!metaContainsOfficers && officers !== "—") {
          infoLines.push(`Funkcjonariusze: ${officers}`);
        }
        if (dossier) infoLines.push(dossier);
        if (vehicleRegistration) infoLines.push(vehicleRegistration);

        const blockEntries: BlockEntry[] = [];
        const addBlockEntry = (
          text: string,
          fontSize: number,
          color: TextColor,
          options: { spacingBefore?: number; spacingAfter?: number; indent?: number } = {}
        ) => {
          const lines = wrapText(text, blockTextWidth - (options.indent ?? 0), fontSize);
          const height = measureEntry(lines, fontSize);
          blockEntries.push({
            kind: "text",
            entry: {
              fontSize,
              color,
              lines,
              spacingBefore: options.spacingBefore,
              spacingAfter: options.spacingAfter,
              indent: options.indent,
              height,
            },
          });
        };
        const addBlockSpacer = (height: number) => {
          blockEntries.push({ kind: "spacer", height });
        };

        addBlockEntry(`Dokument ${index + 1} z ${totalDocuments}`, 9, colors.muted);
        addBlockEntry(item.templateName || item.templateSlug || "Dokument", 14, colors.heading, {
          spacingBefore: 6,
        });

        infoLines.forEach((line, infoIndex) => {
          addBlockEntry(line, 11, colors.body, {
            spacingBefore: infoIndex === 0 ? 8 : 4,
          });
        });

        addBlockSpacer(10);

        const cleanedSections = sections.map((section) => ({
          title: section.title,
          lines: section.lines
            .filter((line) => !DOCUMENT_LINE_PATTERN.test(line ?? ""))
            .map((line) => normalizePdfLine(line ?? "")),
        }));

        if (!cleanedSections.length) {
          addBlockEntry("(Brak danych tekstowych w archiwum)", 11, colors.muted, {
            spacingBefore: 4,
          });
        } else {
          cleanedSections.forEach((section, sectionIndex) => {
            if (sectionIndex > 0) {
              addBlockSpacer(8);
            }

            if (section.title) {
              addBlockEntry(section.title, 12, colors.heading, { spacingBefore: 4 });
            }

            if (!section.lines.length) {
              addBlockEntry("(Brak treści)", 10, colors.muted, {
                spacingBefore: section.title ? 4 : 2,
                indent: 12,
              });
            }

            section.lines.forEach((line) => {
              if (!line) {
                addBlockSpacer(6);
                return;
              }

              addBlockEntry(line, 11, colors.body, {
                spacingBefore: 4,
                indent: 12,
              });
            });
          });
        }

        const blockContentHeight = blockEntries.reduce((acc, entry) => {
          if (entry.kind === "spacer") {
            return acc + entry.height;
          }
          return (
            acc +
            (entry.entry.spacingBefore ?? 0) +
            entry.entry.height +
            (entry.entry.spacingAfter ?? 0)
          );
        }, 0);

        const totalBlockHeight = blockContentHeight + blockPaddingY * 2;
        cursorY = ensureSpace(totalBlockHeight, cursorY);

        const blockTop = cursorY;
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin, blockTop, contentWidth, totalBlockHeight, 12, 12, "F");
        doc.setDrawColor(214, 211, 209);
        doc.setLineWidth(0.8);
        doc.roundedRect(margin, blockTop, contentWidth, totalBlockHeight, 12, 12, "S");

        let blockCursorY = blockTop + blockPaddingY;
        blockEntries.forEach((entry) => {
          if (entry.kind === "spacer") {
            blockCursorY += entry.height;
            return;
          }

          blockCursorY += entry.entry.spacingBefore ?? 0;
          doc.setFontSize(entry.entry.fontSize);
          doc.setTextColor(entry.entry.color.r, entry.entry.color.g, entry.entry.color.b);
          const textX = margin + blockPaddingX + (entry.entry.indent ?? 0);
          doc.text(entry.entry.lines, textX, blockCursorY);
          blockCursorY += entry.entry.height + (entry.entry.spacingAfter ?? 0);
        });

        cursorY = blockTop + totalBlockHeight;
        if (index < selectedItems.length - 1) {
          cursorY += blockSpacing;
          cursorY = ensureSpace(0, cursorY);
        }
      });
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
            generatedBy: fullName || login || "—",
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
  }, [alert, fullName, items, login, selectedIds, selectionMode]);

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
