import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useProfile, can } from "@/hooks/useProfile";
import { useLogWriter } from "@/hooks/useLogWriter";
import { db } from "@/lib/firebase";
import { ensureReportFonts } from "@/lib/reportFonts";
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
  const { writeLog } = useLogWriter();


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
    
    const entry = items.find((item) => item.id === id);
    await deleteDoc(doc(db, "archives", id));
    await writeLog({
      type: "archive_delete",
      section: "archiwum",
      action: "archive.delete",
      message: `Usunięto wpis archiwum ${entry?.templateName || "(nieznany szablon)"} (ID ${id}).`,
      details: {
        szablon: entry?.templateName || entry?.templateSlug || null,
        autor: entry?.userLogin || null,
      },
      archiveId: id,
    });
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
      await writeLog({
        type: "archive_clear",
        section: "archiwum",
        action: "archive.clear",
        message: `Wyczyszczono archiwum (${snapshot.size} wpisów).`,
        details: {
          usunieteWpisy: snapshot.size,
        },
        removed: snapshot.size,
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

      const loadLogoDataUrl = async (): Promise<string | null> => {
        try {
          const response = await fetch("/logo.png");
          if (!response.ok) {
            throw new Error("Logo response not ok");
          }
          const blob = await response.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result;
              if (typeof result === "string") {
                resolve(result);
              } else {
                reject(new Error("Nie udało się przetworzyć logo."));
              }
            };
            reader.onerror = () => reject(new Error("Nie udało się wczytać logo."));
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          console.error("Nie udało się wczytać logo do raportu PDF", error);
          return null;
        }
      };

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      ensureReportFonts(doc);
      doc.setLineHeightFactor(1.4);

      const logoDataUrl = await loadLogoDataUrl();

      const computeLineHeight = (fontSize: number) => Math.round(fontSize * 1.35);
      const captionLineHeight = computeLineHeight(10);
      const bodyLineHeight = computeLineHeight(11);
      const sectionTitleLineHeight = computeLineHeight(12);
      const detailHeadingLineHeight = computeLineHeight(13);
      const documentTitleLineHeight = computeLineHeight(14);
      const summaryTitleLineHeight = computeLineHeight(15);
      const mainTitleLineHeight = computeLineHeight(18);
      const noteLineHeight = computeLineHeight(9);
      const spacerHeight = Math.round(bodyLineHeight * 0.75);

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 56;
      const marginBottom = 56;
      const contentWidth = pageWidth - marginX * 2;
      const nowDisplay = now.toLocaleString("pl-PL");

      const confidentialityNotice =
        "Dokument stanowi raport z czynności służbowych funkcjonariuszy LSPD, obejmujących okres wskazany w szczegółach dokumentu. Raport jest objęty klauzulą poufności i przeznaczony wyłącznie do użytku wewnętrznego Los Santos Police Department. Udostępnianie lub modyfikowanie bez upoważnienia jest zabronione. Dokument został wygenerowany za pośrednictwem Panelu Dokumentów LSPD.";

      const summaryBoxPaddingX = 24;
      const summaryBoxPaddingY = 22;
      const summaryBulletIndent = 12;
      const summaryTitleSpacing = Math.round(bodyLineHeight * 0.6);
      const summaryContentOffset = summaryTitleSpacing + bodyLineHeight;
      const summaryTextWidth = contentWidth - summaryBoxPaddingX * 2;
      const typeSummaryTextWidth = summaryTextWidth - summaryBulletIndent;

      const wrappedTypeSummaryLines = typeSummaryLines
        .map((line) => normalizePdfLine(line))
        .filter((line) => line.length > 0)
        .map((line) => doc.splitTextToSize(line, typeSummaryTextWidth));
      const totalTypeSummaryLines = wrappedTypeSummaryLines.reduce(
        (sum, lines) => sum + lines.length,
        0
      );
      const hasTypeSummary = totalTypeSummaryLines > 0;
      const totalFineDisplay = formatCurrency(totalFinesAmount);
      const processedLine =
        missingDocuments > 0
          ? `Uwzględnione dokumenty: ${totalDocuments} z ${requestedDocuments} (brakujących: ${missingDocuments})`
          : `Uwzględnione dokumenty: ${totalDocuments} z ${requestedDocuments}`;

      const summaryLines = [
        `Wygenerował: ${fullName || login || "—"}`,
        `Data wygenerowania: ${nowDisplay}`,
        `Łączna liczba dokumentów w raporcie: ${totalDocuments}`,
        `Łączna kwota grzywien/mandatów: ${totalFineDisplay}`,
        processedLine,
      ];

      const summaryLinesHeight = summaryLines.length * bodyLineHeight;
      const typeSummaryHeight = hasTypeSummary
        ? bodyLineHeight + totalTypeSummaryLines * bodyLineHeight
        : bodyLineHeight;
      const summaryInnerHeight =
        summaryTitleLineHeight + summaryContentOffset + summaryLinesHeight + typeSummaryHeight;
      const summaryBoxHeight = summaryInnerHeight + summaryBoxPaddingY * 2;

      const confidentialityBoxPaddingX = 18;
      const confidentialityBoxPaddingY = 14;
      const confidentialityTextWidth = contentWidth - confidentialityBoxPaddingX * 2;
      const confidentialityLines = doc.splitTextToSize(confidentialityNotice, confidentialityTextWidth);
      const confidentialityBoxHeight =
        confidentialityLines.length * noteLineHeight + confidentialityBoxPaddingY * 2;

      const drawPageHeader = (isFirstPage: boolean) => {
        const headerBarHeight = 92;
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, headerBarHeight, "F");

        const logoHeight = 48;
        const logoWidth = 48;
        const logoY = headerBarHeight / 2 - logoHeight / 2;
        const baseTextLeft = logoDataUrl ? marginX + logoWidth + 16 : marginX;
        const baseTextTop = logoY + 12;

        if (logoDataUrl) {
          try {
            doc.addImage(logoDataUrl, "PNG", marginX, logoY, logoWidth, logoHeight, undefined, "FAST");
          } catch (error) {
            console.error("Nie udało się dodać logo do raportu PDF", error);
          }
        }

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.text("Los Santos Police Department", baseTextLeft, baseTextTop);
        doc.setFontSize(10);
        doc.text(nowDisplay, pageWidth - marginX, baseTextTop, { align: "right" });

        if (isFirstPage) {
          doc.setFontSize(20);
          doc.text("Raport Czynności Służbowych", baseTextLeft, baseTextTop + 22);
          doc.setFontSize(12);
          doc.text("Jednostka: LSPD", baseTextLeft, baseTextTop + 40);
        } else {
          doc.setFontSize(13);
          doc.text("Raport Czynności Służbowych", baseTextLeft, baseTextTop + 20);
        }

        doc.setTextColor(30, 41, 59);
        const contentOffset = isFirstPage ? 40 : 32;
        return headerBarHeight + contentOffset;
      };

      let cursorY = drawPageHeader(true);

      const ensureSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight > pageHeight - marginBottom) {
          doc.addPage();
          cursorY = drawPageHeader(false);
        }
      };

      ensureSpace(summaryBoxHeight + confidentialityBoxHeight + bodyLineHeight * 2);

      const summaryBoxTop = cursorY;
      const summaryBoxLeft = marginX;
      const summaryContentLeft = summaryBoxLeft + summaryBoxPaddingX;
      const summaryTitleY = summaryBoxTop + summaryBoxPaddingY + summaryTitleLineHeight;

      doc.setFillColor(226, 232, 240);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.8);
      doc.roundedRect(summaryBoxLeft, summaryBoxTop, contentWidth, summaryBoxHeight, 14, 14, "FD");

      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text("Podsumowanie", summaryContentLeft, summaryTitleY);

      let summaryCursorY = summaryTitleY + summaryContentOffset;
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      summaryLines.forEach((line) => {
        doc.text(line, summaryContentLeft, summaryCursorY);
        summaryCursorY += bodyLineHeight;
      });

      if (hasTypeSummary) {
        doc.text("Zestawienie typów dokumentów:", summaryContentLeft, summaryCursorY);
        summaryCursorY += bodyLineHeight;
        wrappedTypeSummaryLines.forEach((lines) => {
          lines.forEach((wrappedLine, index) => {
            const prefix = index === 0 ? "• " : "  ";
            doc.text(`${prefix}${wrappedLine}`, summaryContentLeft + summaryBulletIndent, summaryCursorY);
            summaryCursorY += bodyLineHeight;
          });
        });
      } else {
        doc.text("Brak dodatkowego zestawienia typów dokumentów.", summaryContentLeft, summaryCursorY);
        summaryCursorY += bodyLineHeight;
      }

      cursorY = summaryBoxTop + summaryBoxHeight + bodyLineHeight;

      const confidentialityBoxTop = cursorY;
      const confidentialityContentLeft = marginX + confidentialityBoxPaddingX;

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.6);
      doc.roundedRect(marginX, confidentialityBoxTop, contentWidth, confidentialityBoxHeight, 12, 12, "FD");

      let noteCursorY = confidentialityBoxTop + confidentialityBoxPaddingY + noteLineHeight;
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      confidentialityLines.forEach((line) => {
        doc.text(line, confidentialityContentLeft, noteCursorY);
        noteCursorY += noteLineHeight;
      });
      doc.setTextColor(30, 41, 59);

      cursorY = confidentialityBoxTop + confidentialityBoxHeight + bodyLineHeight;
      ensureSpace(detailHeadingLineHeight + bodyLineHeight);
      doc.setFontSize(13);
      doc.text("Szczegóły dokumentów", marginX, cursorY);
      cursorY += detailHeadingLineHeight;

      const blockPaddingX = 24;
      const blockPaddingY = 20;
      const blockContentIndent = 14;
      const blockSpacing = 24;
      const blockTextWidth = contentWidth - blockPaddingX * 2 - blockContentIndent;

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

        const preparedSections = sections.map((section) => ({
          title: section.title,
          lines: section.lines
            .filter((line) => !DOCUMENT_LINE_PATTERN.test(line ?? ""))
            .map((line) => {
            const normalized = normalizePdfLine(line ?? "");
            if (!normalized) {
              return { type: "spacer" as const };
            }
            const wrapped = doc.splitTextToSize(normalized, blockTextWidth);
            return { type: "text" as const, lines: wrapped };
          }),
        }));

        const blockContentHeight = (() => {
          let height = 0;
          height += captionLineHeight; // "Dokument X z Y"
          height += documentTitleLineHeight; // Tytuł dokumentu
          height += infoLines.length * bodyLineHeight;
          height += spacerHeight; // odstęp przed sekcjami
          if (!preparedSections.length) {
            height += bodyLineHeight; // informacja o braku danych
          } else {
            preparedSections.forEach((section) => {
              if (section.title) {
                height += sectionTitleLineHeight;
              }
              section.lines.forEach((line) => {
                if (line.type === "spacer") {
                  height += spacerHeight;
                } else {
                  height += line.lines.length * bodyLineHeight;
                }
              });
              height += spacerHeight; // odstęp po sekcji
            });
          }
          return height;
        })();

        const totalBlockHeight = blockContentHeight + blockPaddingY * 2;
        const extraSpacing = index < selectedItems.length - 1 ? blockSpacing : 0;
        ensureSpace(totalBlockHeight + extraSpacing);

        const blockLeft = marginX;
        const blockTop = cursorY;
        const textLeft = blockLeft + blockPaddingX;
        const sectionTextLeft = textLeft + blockContentIndent;

        doc.setFillColor(255, 255, 255);
        doc.roundedRect(blockLeft, blockTop, contentWidth, totalBlockHeight, 12, 12, "F");
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.8);
        doc.roundedRect(blockLeft, blockTop, contentWidth, totalBlockHeight, 12, 12, "S");

        let blockCursorY = blockTop + blockPaddingY;

        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        doc.text(`Dokument ${index + 1} z ${totalDocuments}`, textLeft, blockCursorY);
        blockCursorY += captionLineHeight;

        doc.setFontSize(14);
        doc.setTextColor(31, 41, 55);
        doc.text(item.templateName || item.templateSlug || "Dokument", textLeft, blockCursorY);
        blockCursorY += documentTitleLineHeight;

        doc.setFontSize(11);
        doc.setTextColor(75, 85, 99);
        infoLines.forEach((line) => {
          doc.text(normalizePdfLine(line), textLeft, blockCursorY);
          blockCursorY += bodyLineHeight;
        });

        blockCursorY += spacerHeight;
        doc.setTextColor(55, 65, 81);

        if (!preparedSections.length) {
          doc.text("(Brak danych tekstowych w archiwum)", textLeft, blockCursorY);
          blockCursorY += bodyLineHeight;
        } else {
          preparedSections.forEach((section) => {
            if (section.title) {
              doc.setFontSize(12);
              doc.text(section.title, textLeft, blockCursorY);
              blockCursorY += sectionTitleLineHeight;
              doc.setFontSize(11);
            }

            section.lines.forEach((line) => {
              if (line.type === "spacer") {
                blockCursorY += spacerHeight;
                return;
              }
              line.lines.forEach((wrappedLine) => {
                doc.text(wrappedLine, sectionTextLeft, blockCursorY);
                blockCursorY += bodyLineHeight;
              });
            });

            blockCursorY += spacerHeight;
          });
        }

        cursorY = blockTop + totalBlockHeight;
        if (extraSpacing > 0) {
          cursorY += extraSpacing;
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
            <div className="card p-6 text-center" data-section="archive">Brak dostępu do archiwum.</div>
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
            <div className="card p-6 space-y-5" data-section="archive">
              <div className="flex flex-wrap items-center gap-3">
                <div className="space-y-1">
                  <span className="section-chip">
                    <span className="section-chip__dot" style={{ background: "#f59e0b" }} />
                    Archiwum
                  </span>
                  <h1 className="text-3xl font-semibold tracking-tight">Archiwum dokumentów służbowych</h1>
                </div>
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
