import { ensureReportFonts } from "@/lib/reportFonts";
import type { jsPDF } from "jspdf";

export type PwcAction = {
  time: string;
  description: string;
};

export type PwcReportPayload = {
  pwcName: string;
  pwcBadge: string;
  apwcName: string;
  apwcBadge: string;
  takeoverTime: string;
  handoverTime: string;
  totalMinutes: number;
  reportDate: string;
  actions: PwcAction[];
};

export type PwcReportPdfMeta = {
  generatedBy?: string | null;
  generatedAt?: Date;
};

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23) return null;
  return hours * 60 + minutes;
}

export function computeDurationMinutes(takeover: string, handover: string): number | null {
  const start = parseTimeToMinutes(takeover);
  const end = parseTimeToMinutes(handover);
  if (start == null || end == null) return null;
  let diff = end - start;
  if (diff < 0) diff += 24 * 60; // przejście przez północ
  return diff;
}

export function formatDuration(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || Number.isNaN(totalMinutes)) return "—";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [] as string[];
  if (hours > 0) parts.push(`${hours} h`);
  parts.push(`${minutes} min`);
  return parts.join(" ");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const response = await fetch("/logo.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Nie udało się przygotować logo."));
      };
      reader.onerror = () => reject(new Error("Nie udało się odczytać logo."));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("Nie udało się wczytać logo do raportu PWC", error);
    return null;
  }
}

export async function generatePwcReportPdf(
  payload: PwcReportPayload,
  meta: PwcReportPdfMeta = {}
): Promise<{ filename: string; base64: string; doc: jsPDF }> {
  const { jsPDF } = await import("jspdf");
  const generatedAt = meta.generatedAt || new Date();
  const filename = `raport-pwc-${generatedAt.toISOString().replace(/[:.]/g, "-")}.pdf`;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  ensureReportFonts(doc);
  const logoDataUrl = await loadLogoDataUrl();

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 56;
  const marginBottom = 56;
  const contentWidth = pageWidth - marginX * 2;

  const computeLineHeight = (fontSize: number) => Math.round(fontSize * 1.35);
  const lineHeights = {
    caption: computeLineHeight(10),
    body: computeLineHeight(11),
    detail: computeLineHeight(12),
    section: computeLineHeight(14),
    heading: computeLineHeight(18),
  } as const;

  const drawHeader = (isFirstPage: boolean) => {
    const headerHeight = 96;
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, headerHeight, "F");

    const logoSize = 52;
    const logoY = headerHeight / 2 - logoSize / 2;
    const textLeft = logoDataUrl ? marginX + logoSize + 16 : marginX;
    const textTop = logoY + 12;

    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", marginX, logoY, logoSize, logoSize, undefined, "FAST");
      } catch (error) {
        console.warn("Nie udało się dodać logo do raportu PWC", error);
      }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text("Los Santos Police Department", textLeft, textTop);
    doc.setFontSize(10);
    doc.text(generatedAt.toLocaleString("pl-PL"), pageWidth - marginX, textTop, { align: "right" });

    doc.setFontSize(isFirstPage ? 20 : 14);
    doc.text(
      "Raport PWC — Patrol Watch Commander",
      textLeft,
      textTop + (isFirstPage ? 26 : 18)
    );

    return headerHeight + (isFirstPage ? 40 : 28);
  };

  let cursorY = drawHeader(true);
  doc.setTextColor(17, 24, 39);

  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginBottom) {
      doc.addPage();
      cursorY = drawHeader(false);
    }
  };

  // sekcja podsumowania
  const summaryPadding = 18;
  const summaryInnerWidth = contentWidth - summaryPadding * 2;
  const summaryLines = [
    `PWC: ${payload.pwcName || "—"}${payload.pwcBadge ? ` (${payload.pwcBadge})` : ""}`,
    `APWC: ${payload.apwcName || "—"}${payload.apwcBadge ? ` (${payload.apwcBadge})` : ""}`,
    `Godziny: ${payload.takeoverTime || "—"} – ${payload.handoverTime || "—"}`,
    `Łączny czas: ${formatDuration(payload.totalMinutes)}`,
    `Data służby: ${payload.reportDate || "—"}`,
    `Wygenerował: ${meta.generatedBy || "—"}`,
  ];

  const summaryLineHeight = lineHeights.body;
  const summaryHeight = summaryLines.length * summaryLineHeight + summaryPadding * 2;
  ensureSpace(summaryHeight + 24);
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(marginX, cursorY, contentWidth, summaryHeight, 10, 10, "F");
  doc.setFontSize(12);
  doc.text("Podsumowanie", marginX + summaryPadding, cursorY + summaryPadding - 6);
  doc.setFontSize(11);
  summaryLines.forEach((line, idx) => {
    doc.text(line, marginX + summaryPadding, cursorY + summaryPadding + summaryLineHeight * idx);
  });
  cursorY += summaryHeight + 24;

  // sekcja czynności
  doc.setFontSize(14);
  doc.text("Czynności PWC", marginX, cursorY);
  cursorY += lineHeights.section;
  doc.setFontSize(11);

  const activityWidth = summaryInnerWidth;
  const activityTextLeft = marginX + 10;

  if (!payload.actions.length) {
    ensureSpace(lineHeights.body + 6);
    doc.text("Brak zapisanych czynności.", activityTextLeft, cursorY);
    cursorY += lineHeights.body + 10;
  } else {
    payload.actions.forEach((action) => {
      const header = `${action.time || "—"} — ${action.description || "(brak opisu)"}`;
      const wrapped = doc.splitTextToSize(header, activityWidth);
      const blockHeight = wrapped.length * lineHeights.body + 6;
      ensureSpace(blockHeight);
      wrapped.forEach((line) => {
        doc.text(line, activityTextLeft, cursorY);
        cursorY += lineHeights.body;
      });
      cursorY += 6;
    });
  }

  const arrayBuffer = doc.output("arraybuffer");
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Nie udało się wygenerować pliku PDF raportu PWC.");
  }

  const base64 = arrayBufferToBase64(arrayBuffer);
  return { filename, base64, doc };
}
