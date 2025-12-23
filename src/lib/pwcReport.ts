import { jsPDF } from "jspdf";
import { ensureReportFonts } from "@/lib/reportFonts";

export type PwcAction = {
  time?: string;
  actionType?: string;
  location?: string;
  followUps?: string[];
  description?: string;
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

let logoDataUrlPromise: Promise<string | null> | null = null;

async function loadLogoDataUrl(): Promise<string | null> {
  if (logoDataUrlPromise) return logoDataUrlPromise;

  logoDataUrlPromise = (async () => {
    if (typeof window === "undefined" || typeof fetch !== "function") return null;

    try {
      const response = await fetch("/logo.png");
      if (!response.ok) return null;
      const blob = await response.blob();

      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn("Nie udało się pobrać logo do raportu PWC", err);
      return null;
    }
  })();

  return logoDataUrlPromise;
}

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

export async function buildPwcPdf(report: PwcReportInput) {
  const doc = new jsPDF();
  ensureReportFonts(doc);

  const logoDataUrl = await loadLogoDataUrl();

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const marginY = 16;
  const contentWidth = pageWidth - marginX * 2;
  const lineHeight = 5.6;
  const labelHeight = 4.2;
  const sectionSpacing = 8;
  const palette = {
    accent: { r: 66, g: 162, b: 255 },
    accentMuted: { r: 35, g: 97, b: 186 },
    background: { r: 6, g: 14, b: 38 },
    surface: { r: 12, g: 26, b: 62 },
    card: { r: 16, g: 34, b: 78 },
    border: { r: 58, g: 88, b: 140 },
    text: { main: { r: 232, g: 244, b: 255 }, muted: { r: 186, g: 204, b: 233 } },
  };
  const { text } = palette;

  let cursorY = marginY;

  const paintBackground = () => {
    doc.setFillColor(palette.background.r, palette.background.g, palette.background.b);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(palette.surface.r, palette.surface.g, palette.surface.b);
    doc.roundedRect(marginX / 2, marginY / 2, pageWidth - marginX, pageHeight - marginY, 8, 8, "F");
    doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
    doc.setLineWidth(0.7);
    doc.roundedRect(marginX / 2, marginY / 2, pageWidth - marginX, pageHeight - marginY, 8, 8, "S");
    doc.setLineWidth(0.2);
  };

  const drawHeader = () => {
    const headerHeight = 28;
    doc.setFillColor(palette.card.r, palette.card.g, palette.card.b);
    doc.roundedRect(marginX, cursorY, contentWidth, headerHeight, 8, 8, "F");
    doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
    doc.roundedRect(marginX, cursorY, contentWidth, headerHeight, 8, 8, "S");
    doc.setFillColor(palette.accent.r, palette.accent.g, palette.accent.b);
    doc.roundedRect(marginX, cursorY, contentWidth, 5, 8, 8, "F");

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", marginX + 6, cursorY + 5, 18, 18);
    }

    doc.setFontSize(14);
    doc.setTextColor(text.main.r, text.main.g, text.main.b);
    doc.text("Raport Patrol Watch Commander (PWC)", marginX + 30, cursorY + 11);
    doc.setFontSize(9.5);
    doc.setTextColor(text.muted.r, text.muted.g, text.muted.b);
    doc.text("Zestawienie czynności PWC z generatora raportu", marginX + 30, cursorY + 19);
    cursorY += headerHeight + 6;
  };

  const startNewPage = () => {
    doc.addPage();
    ensureReportFonts(doc);
    paintBackground();
    cursorY = marginY;
    drawHeader();
  };

  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginY) {
      startNewPage();
    }
  };

  const wrapText = (value: string, width: number, fontSize = 11) => {
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(value || "—", width);
  };

  const measureKeyValueHeight = (value: string, width: number, fontSize = 11) => {
    const lines = wrapText(value, width, fontSize);
    return labelHeight + lines.length * lineHeight + 2;
  };

  const drawKeyValue = (label: string, value: string, x: number, y: number, width: number, fontSize = 11) => {
    const lines = wrapText(value, width, fontSize);
    doc.setFontSize(8.5);
    doc.setTextColor(text.muted.r, text.muted.g, text.muted.b);
    doc.text(label, x, y);
    doc.setFontSize(fontSize);
    doc.setTextColor(text.main.r, text.main.g, text.main.b);
    doc.text(lines, x, y + labelHeight + 0.5);
    return lines.length * lineHeight + labelHeight;
  };

  const drawSection = (
    title: string,
    measureBody: (innerWidth: number) => number,
    renderBody: (options: { x: number; y: number; innerWidth: number }) => void,
    minHeight = 32
  ) => {
    const padding = 10;
    const titleHeight = 7;
    const innerWidth = contentWidth - padding * 2;
    const bodyHeight = measureBody(innerWidth);
    const boxHeight = Math.max(minHeight, bodyHeight + titleHeight + padding * 2);

    ensureSpace(boxHeight + sectionSpacing);

    doc.setFillColor(palette.card.r, palette.card.g, palette.card.b);
    doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
    doc.roundedRect(marginX, cursorY, contentWidth, boxHeight, 10, 10, "FD");

    doc.setFontSize(12.5);
    doc.setTextColor(text.main.r, text.main.g, text.main.b);
    doc.text(title, marginX + padding, cursorY + padding + titleHeight - 2);

    const bodyStartY = cursorY + padding + titleHeight + 4;
    renderBody({ x: marginX + padding, y: bodyStartY, innerWidth });

    cursorY = cursorY + boxHeight + sectionSpacing;
  };

  paintBackground();
  drawHeader();

  drawSection(
    "Obsada",
    (innerWidth) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      const pwcHeight = measureKeyValueHeight(`${report.pwcName || "—"} (${report.pwcBadge || "brak"})`, colWidth, 12);
      const apwcHeight = measureKeyValueHeight(`${report.apwcName || "—"} (${report.apwcBadge || "brak"})`, colWidth, 12);
      return Math.max(pwcHeight, apwcHeight);
    },
    ({ x, y, innerWidth }) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      drawKeyValue("PWC", `${report.pwcName || "—"} (${report.pwcBadge || "brak"})`, x, y, colWidth, 12);
      drawKeyValue("APWC", `${report.apwcName || "—"} (${report.apwcBadge || "brak"})`, x + colWidth + gap, y, colWidth, 12);
    },
    40
  );

  drawSection(
    "Czas służby",
    (innerWidth) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      const startHeight = measureKeyValueHeight(
        report.startTime ? new Date(report.startTime).toLocaleString("pl-PL") : "—",
        colWidth
      );
      const endHeight = measureKeyValueHeight(
        report.endTime ? new Date(report.endTime).toLocaleString("pl-PL") : "—",
        colWidth
      );
      const durationHeight = measureKeyValueHeight(report.durationDisplay || formatDuration(report.durationMinutes), innerWidth * 0.65);
      return Math.max(startHeight, endHeight) + 6 + durationHeight;
    },
    ({ x, y, innerWidth }) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      const firstRowHeight = Math.max(
        drawKeyValue("Godzina przejęcia", report.startTime ? new Date(report.startTime).toLocaleString("pl-PL") : "—", x, y, colWidth),
        drawKeyValue("Godzina zakończenia", report.endTime ? new Date(report.endTime).toLocaleString("pl-PL") : "—", x + colWidth + gap, y, colWidth)
      );
      drawKeyValue(
        "Łączny czas jako PWC",
        report.durationDisplay || formatDuration(report.durationMinutes),
        x,
        y + firstRowHeight + 6,
        innerWidth * 0.65
      );
    },
    48
  );

  const actionRows = (report.actions || [])
    .map((action, index) => {
      const time = (action.time || "").trim();
      const actionType = (action.actionType || action.description || "").trim();
      const location = (action.location || "").trim();
      const followUps = (action.followUps || []).filter((item) => item?.trim().length).join(", ");
      const hasContent = time.length || actionType.length || location.length || followUps.length;
      return { time, actionType, location, followUps, index, hasContent };
    })
    .filter((action) => action.hasContent);

  const padding = 10;
  const titleHeight = 7;
  const minActionsHeight = 52;

  const measureActionsBodyHeight = (rows: typeof actionRows, innerWidth: number) => {
    if (!rows.length) return lineHeight + 4;
    const descriptionWidth = innerWidth - 34;
    const itemSpacing = 6;

    return rows.reduce((height, action, index) => {
      const typeLines = wrapText(action.actionType || "—", descriptionWidth, 11);
      const locationLines = wrapText(`Lokalizacja: ${action.location || "—"}`, descriptionWidth, 10);
      const followUpsLabel = action.followUps || "—";
      const followUpLines = wrapText(`Działania: ${followUpsLabel}`, descriptionWidth, 10);
      const textHeight = typeLines.length * lineHeight + locationLines.length * lineHeight + followUpLines.length * lineHeight;
      const rowHeight = Math.max(textHeight + 10, 24);
      const spacing = index === rows.length - 1 ? 0 : itemSpacing;
      return height + rowHeight + spacing;
    }, 0);
  };

  const renderActionsBody = (rows: typeof actionRows, options: { x: number; y: number; innerWidth: number }) => {
    const { x, y, innerWidth } = options;

    if (!rows.length) {
      doc.setFontSize(11);
      doc.setTextColor(text.muted.r, text.muted.g, text.muted.b);
      doc.text("Brak zapisanych czynności.", x, y + lineHeight);
      return;
    }

    const descriptionWidth = innerWidth - 34;
    const itemSpacing = 6;
    let currentY = y;

    rows.forEach((action) => {
      const typeLines = wrapText(action.actionType || "—", descriptionWidth, 11);
      const locationLines = wrapText(`Lokalizacja: ${action.location || "—"}`, descriptionWidth, 10);
      const followUpsLabel = action.followUps || "—";
      const followUpLines = wrapText(`Działania: ${followUpsLabel}`, descriptionWidth, 10);
      const textHeight = typeLines.length * lineHeight + locationLines.length * lineHeight + followUpLines.length * lineHeight;
      const rowHeight = Math.max(textHeight + 10, 24);

      doc.setFillColor(palette.surface.r, palette.surface.g, palette.surface.b);
      doc.setDrawColor(palette.border.r, palette.border.g, palette.border.b);
      doc.roundedRect(x, currentY - 2, innerWidth, rowHeight + 2, 6, 6, "FD");

      doc.setFillColor(palette.accent.r, palette.accent.g, palette.accent.b);
      doc.setTextColor(255, 255, 255);
      doc.roundedRect(x + 4, currentY + 2, 22, 8, 3, 3, "F");
      doc.setFontSize(8);
      doc.text(`${String(action.index + 1).padStart(2, "0")}. ${action.time || "—"}`.trim(), x + 6, currentY + 8);

      let textY = currentY + 9;
      doc.setFontSize(11);
      doc.setTextColor(text.main.r, text.main.g, text.main.b);
      doc.text(typeLines, x + 32, textY, { maxWidth: descriptionWidth });

      textY += typeLines.length * lineHeight + 1.5;

      doc.setFontSize(10);
      doc.setTextColor(text.muted.r, text.muted.g, text.muted.b);
      doc.text(locationLines, x + 32, textY, { maxWidth: descriptionWidth });

      textY += locationLines.length * lineHeight + 1.5;

      doc.text(followUpLines, x + 32, textY, { maxWidth: descriptionWidth });

      currentY += rowHeight + itemSpacing;
    });
  };

  if (!actionRows.length) {
    drawSection(
      "Czynności",
      () => lineHeight + 4,
      ({ x, y }) => {
        doc.setFontSize(11);
        doc.setTextColor(text.muted.r, text.muted.g, text.muted.b);
        doc.text("Brak zapisanych czynności.", x, y + lineHeight);
      },
      minActionsHeight
    );
  } else {
    let index = 0;
    while (index < actionRows.length) {
      const availableHeight = pageHeight - marginY - cursorY - sectionSpacing;
      let end = index;
      const innerWidth = contentWidth - padding * 2;

      while (end < actionRows.length) {
        const slice = actionRows.slice(index, end + 1);
        const bodyHeight = measureActionsBodyHeight(slice, innerWidth);
        const estimatedBoxHeight = Math.max(minActionsHeight, bodyHeight + titleHeight + padding * 2);
        if (estimatedBoxHeight <= availableHeight || slice.length === 1) {
          end += 1;
        } else {
          break;
        }
      }

      if (index === end) {
        end = Math.min(actionRows.length, end + 1);
      }

      const slice = actionRows.slice(index, end);
      drawSection(
        `Czynności${actionRows.length > end ? ` (${end}/${actionRows.length})` : ""}`,
        () => measureActionsBodyHeight(slice, innerWidth),
        (opts) => renderActionsBody(slice, opts),
        minActionsHeight
      );

      index = end;
    }
  }

  drawSection(
    "Metadane",
    (innerWidth) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      const generatedAt = report.generatedAt ? new Date(report.generatedAt) : new Date();
      const generatorHeight = measureKeyValueHeight(report.generatedBy || "—", colWidth);
      const dateHeight = measureKeyValueHeight(generatedAt.toLocaleString("pl-PL"), colWidth);
      return Math.max(generatorHeight, dateHeight);
    },
    ({ x, y, innerWidth }) => {
      const gap = 10;
      const colWidth = (innerWidth - gap) / 2;
      const generatedAt = report.generatedAt ? new Date(report.generatedAt) : new Date();
      drawKeyValue("Wygenerowano przez", report.generatedBy || "—", x, y, colWidth);
      drawKeyValue("Data wygenerowania", generatedAt.toLocaleString("pl-PL"), x + colWidth + gap, y, colWidth);
    },
    36
  );

  const arrayBuffer = doc.output("arraybuffer");
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Nie udało się wygenerować pliku PDF PWC.");
  }

  const pdfBase64 = arrayBufferToBase64(arrayBuffer);
  const sanitizedName = report.pwcName?.trim().replace(/\s+/g, "_") || "PWC";
  const fileName = `Raport-PWC-${sanitizedName}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;

  return { pdfBase64, fileName };
}
