import { jsPDF } from "jspdf";
import { ensureReportFonts } from "@/lib/reportFonts";

export type PwcAction = {
  time: string;
  description: string;
};

export type PwcReportInput = {
  pwcName: string;
  pwcBadge: string;
  apwcName: string;
  apwcBadge: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  durationDisplay: string;
  actions: PwcAction[];
  generatedBy?: string | null;
  generatedAt?: string;
};

const palette = {
  primary: { r: 10, g: 82, b: 122 },
  accent: { r: 14, g: 165, b: 233 },
  panelBg: { r: 245, g: 249, b: 255 },
  border: { r: 202, g: 217, b: 235 },
  text: { r: 18, g: 35, b: 56 },
  muted: { r: 91, g: 108, b: 130 },
  actionBg: { r: 231, g: 245, b: 255 },
};

export function calculateDurationMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  const diffMs = end - start;
  return Math.max(0, Math.round(diffMs / 60000));
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h 0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

const lineHeight = (fontSize: number) => Number((fontSize * 0.62).toFixed(2));

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const response = await fetch("/logo.png");
    if (!response.ok) return null;
    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
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
    console.error("Nie udało się wczytać logo do raportu PWC", error);
    return null;
  }
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

export function buildPwcPdf(report: PwcReportInput) {
export async function buildPwcPdf(report: PwcReportInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  ensureReportFonts(doc);
  doc.setLineHeightFactor(1.3);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const marginY = 16;
  const contentWidth = pageWidth - marginX * 2;
  const headerHeight = 26;
  const sectionSpacing = 10;
  const startY = marginY + headerHeight + 4;
  let cursorY = startY;

  const logoDataUrl = await loadLogoDataUrl();

  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginY) {
      doc.addPage();
      ensureReportFonts(doc);
      drawPageHeader();
      cursorY = startY;
    }
  };

  const drawPageHeader = () => {
    doc.setFillColor(palette.primary.r, palette.primary.g, palette.primary.b);
    doc.rect(0, 0, pageWidth, headerHeight + 6, "F");
    doc.setFillColor(palette.accent.r, palette.accent.g, palette.accent.b);
    doc.rect(0, headerHeight + 2, pageWidth, 3, "F");

    const titleX = logoDataUrl ? marginX + 20 : marginX;
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text("Raport Patrol Watch Commander", titleX, headerHeight / 2 + 8);

    doc.setFontSize(10);
    doc.setTextColor(224, 231, 255);
    doc.text("Zestawienie czynności i czasu służby", titleX, headerHeight / 2 + 14);

    if (logoDataUrl) {
      const logoSize = 16;
      doc.addImage(logoDataUrl, "PNG", marginX, headerHeight / 2 - logoSize / 2 + 4, logoSize, logoSize);
    }
  };

  const normalizeValue = (value: string | null | undefined, fallback = "—") => {
    const trimmed = (value || "").trim();
    return trimmed.length ? trimmed : fallback;
  };

  const splitValue = (value: string, width: number) => {
    doc.setFontSize(11);
    return doc.splitTextToSize(value, width);
  };

  const measureKeyValue = (label: string, value: string, width: number) => {
    const lines = splitValue(value, width);
    const height = lineHeight(9) + lines.length * lineHeight(11) + 4;
    return { lines, height };
  };

  const drawKeyValue = (
    label: string,
    valueLines: string[],
    x: number,
    y: number,
  ) => {
    doc.setFontSize(9);
    doc.setTextColor(palette.muted.r, palette.muted.g, palette.muted.b);
    doc.text(label, x, y + lineHeight(9));
    doc.setFontSize(11);
    doc.setTextColor(palette.text.r, palette.text.g, palette.text.b);
    doc.text(valueLines, x, y + lineHeight(9) + 2 + lineHeight(11));
  };

  const drawSection = (
    title: string,
    buildContent: (innerWidth: number, drawCtx?: { x: number; y: number }) => number,
    options: { paddingX?: number; paddingY?: number } = {},
  ) => {
    const paddingX = options.paddingX ?? 12;
    const paddingY = options.paddingY ?? 10;
    const innerWidth = contentWidth - paddingX * 2;
    const titleHeight = lineHeight(13) + 2;
    const contentHeight = buildContent(innerWidth);
    const sectionHeight = paddingY * 2 + titleHeight + contentHeight;

    ensureSpace(sectionHeight);

    doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
    doc.setFillColor(palette.panelBg.r, palette.panelBg.g, palette.panelBg.b);
    doc.roundedRect(marginX, cursorY, contentWidth, sectionHeight, 6, 6, "FD");

    doc.setFontSize(13);
    doc.setTextColor(palette.text.r, palette.text.g, palette.text.b);
    doc.text(title, marginX + paddingX, cursorY + paddingY + lineHeight(13));

    buildContent(innerWidth, { x: marginX + paddingX, y: cursorY + paddingY + titleHeight });

    cursorY += sectionHeight + sectionSpacing;
  };

  drawPageHeader();

  drawSection("Obsada", (innerWidth, ctx) => {
    const colWidth = (innerWidth - 8) / 2;
    const pwcValue = `${normalizeValue(report.pwcName)} (${normalizeValue(report.pwcBadge, "brak")})`;
    const apwcValue = `${normalizeValue(report.apwcName)} (${normalizeValue(report.apwcBadge, "brak")})`;
    const pwcMeasure = measureKeyValue("PWC", pwcValue, colWidth);
    const apwcMeasure = measureKeyValue("APWC", apwcValue, colWidth);
    const rowHeight = Math.max(pwcMeasure.height, apwcMeasure.height) + 4;

    if (ctx) {
      drawKeyValue("PWC", pwcMeasure.lines, ctx.x, ctx.y);
      drawKeyValue("APWC", apwcMeasure.lines, ctx.x + colWidth + 8, ctx.y);
    }

    return rowHeight;
  });

  drawSection("Czas służby", (innerWidth, ctx) => {
    const colWidth = (innerWidth - 8) / 2;
    const startDisplay = report.startTime ? new Date(report.startTime).toLocaleString("pl-PL") : "—";
    const endDisplay = report.endTime ? new Date(report.endTime).toLocaleString("pl-PL") : "—";
    const durationDisplay = normalizeValue(report.durationDisplay || formatDuration(report.durationMinutes));

    const startMeasure = measureKeyValue("Godzina przejęcia", startDisplay, colWidth);
    const endMeasure = measureKeyValue("Godzina zakończenia", endDisplay, colWidth);
    const durationMeasure = measureKeyValue("Łączny czas jako PWC", durationDisplay, innerWidth);

    const firstRowHeight = Math.max(startMeasure.height, endMeasure.height) + 4;
    const totalHeight = firstRowHeight + durationMeasure.height + 6;

    if (ctx) {
      drawKeyValue("Godzina przejęcia", startMeasure.lines, ctx.x, ctx.y);
      drawKeyValue("Godzina zakończenia", endMeasure.lines, ctx.x + colWidth + 8, ctx.y);
      drawKeyValue("Łączny czas jako PWC", durationMeasure.lines, ctx.x, ctx.y + firstRowHeight + 2);
    }

    return totalHeight;
  });

  const visibleActions = (report.actions || []).filter(
    (action) => normalizeValue(action.description || "").length > 0 || normalizeValue(action.time || "").length > 0,
  );

  const measuredActions = visibleActions.map((action, index) => {
    const label = `${String(index + 1).padStart(2, "0")}. ${normalizeValue(action.time, "—")}`;
    const width = contentWidth - 24 - 12;
    const description = normalizeValue(action.description, "—");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(description, width - 20);
    const height = lineHeight(9) + lines.length * lineHeight(11) + 10;
    return { label, lines, height };
  });

  const drawActionsChunk = (startIndex: number) => {
    const paddingX = 12;
    const paddingY = 10;
    const innerWidth = contentWidth - paddingX * 2;
    const titleHeight = lineHeight(13) + 2;
    const actionSpacing = 6;

    if (!measuredActions.length) {
      const emptyHeight = paddingY * 2 + titleHeight + lineHeight(11) + 6;
      ensureSpace(emptyHeight);

      doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
      doc.setFillColor(palette.panelBg.r, palette.panelBg.g, palette.panelBg.b);
      doc.roundedRect(marginX, cursorY, contentWidth, emptyHeight, 6, 6, "FD");
      doc.setFontSize(13);
      doc.setTextColor(palette.text.r, palette.text.g, palette.text.b);
      doc.text("Czynności", marginX + paddingX, cursorY + paddingY + lineHeight(13));
      doc.setFontSize(11);
      doc.setTextColor(palette.muted.r, palette.muted.g, palette.muted.b);
      doc.text("Brak zapisanych czynności.", marginX + paddingX, cursorY + paddingY + titleHeight + lineHeight(11));

      cursorY += emptyHeight + sectionSpacing;
      return measuredActions.length;
    }

    const availableHeight = pageHeight - marginY - cursorY;
    let consumed = 0;
    let endIndex = startIndex;

    while (endIndex < measuredActions.length) {
      const nextHeight = measuredActions[endIndex].height + (consumed > 0 ? actionSpacing : 0);
      if (paddingY * 2 + titleHeight + consumed + nextHeight > availableHeight && consumed > 0) break;
      consumed += nextHeight;
      endIndex += 1;
      if (paddingY * 2 + titleHeight + consumed > availableHeight && consumed > 0) break;
    }

    if (endIndex === startIndex) {
      consumed = measuredActions[startIndex].height;
      endIndex = startIndex + 1;
    }

    const sectionHeight = paddingY * 2 + titleHeight + consumed;
    ensureSpace(sectionHeight);

    doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
    doc.setFillColor(palette.panelBg.r, palette.panelBg.g, palette.panelBg.b);
    doc.roundedRect(marginX, cursorY, contentWidth, sectionHeight, 6, 6, "FD");

    doc.setFontSize(13);
    doc.setTextColor(palette.text.r, palette.text.g, palette.text.b);
    doc.text("Czynności", marginX + paddingX, cursorY + paddingY + lineHeight(13));

    let y = cursorY + paddingY + titleHeight;
    measuredActions.slice(startIndex, endIndex).forEach((action, localIndex) => {
      if (localIndex > 0) {
        y += actionSpacing;
      }

      doc.setFillColor(palette.actionBg.r, palette.actionBg.g, palette.actionBg.b);
      doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
      doc.roundedRect(marginX + paddingX, y, innerWidth, action.height, 4, 4, "FD");

      doc.setFontSize(9);
      doc.setTextColor(palette.accent.r, palette.accent.g, palette.accent.b);
      doc.text(action.label, marginX + paddingX + 6, y + lineHeight(9));

      doc.setFontSize(11);
      doc.setTextColor(palette.text.r, palette.text.g, palette.text.b);
      doc.text(action.lines, marginX + paddingX + 6, y + lineHeight(9) + 4 + lineHeight(11));

      y += action.height;
    });

    cursorY += sectionHeight + sectionSpacing;
    return endIndex;
  };

  let actionIndex = 0;
  while (actionIndex < measuredActions.length || (!measuredActions.length && actionIndex === 0)) {
    const nextIndex = drawActionsChunk(actionIndex);
    if (nextIndex === actionIndex) break;
    actionIndex = nextIndex;
  }

  drawSection("Metadane", (innerWidth, ctx) => {
    const generatedAt = report.generatedAt ? new Date(report.generatedAt) : new Date();
    const generatedBy = normalizeValue(report.generatedBy);
    const generatedAtValue = generatedAt.toLocaleString("pl-PL");
    const colWidth = (innerWidth - 8) / 2;

    const generatedByMeasure = measureKeyValue("Wygenerowano przez", generatedBy, colWidth);
    const generatedAtMeasure = measureKeyValue("Data wygenerowania", generatedAtValue, colWidth);
    const rowHeight = Math.max(generatedByMeasure.height, generatedAtMeasure.height);

    if (ctx) {
      drawKeyValue("Wygenerowano przez", generatedByMeasure.lines, ctx.x, ctx.y);
      drawKeyValue("Data wygenerowania", generatedAtMeasure.lines, ctx.x + colWidth + 8, ctx.y);
    }

    return rowHeight + 4;
  });

  const arrayBuffer = doc.output("arraybuffer");
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Nie udało się wygenerować pliku PDF PWC.");
  }

  const pdfBase64 = arrayBufferToBase64(arrayBuffer);
  const sanitizedName = report.pwcName?.trim().replace(/\s+/g, "_") || "PWC";
  const fileName = `Raport-PWC-${sanitizedName}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;

  return { pdfBase64, fileName };
}
