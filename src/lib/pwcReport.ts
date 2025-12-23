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

export function buildPwcPdf(report: PwcReportInput) {
  const doc = new jsPDF();
  ensureReportFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const marginY = 18;
  const contentWidth = pageWidth - marginX * 2;
  const lineHeight = 7;
  const sectionSpacing = 10;
  let cursorY = marginY;

  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginY) {
      doc.addPage();
      ensureReportFonts(doc);
      cursorY = marginY;
    }
  };

  const drawSection = (title: string, body: () => void, minHeight = 0) => {
    const startY = cursorY;
    ensureSpace(minHeight + 12);
    doc.setFillColor(247, 248, 250);
    doc.setDrawColor(222, 226, 230);
    doc.roundedRect(marginX, cursorY, contentWidth, Math.max(minHeight, 30), 6, 6, "FD");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(title, marginX + 8, cursorY + 10);
    cursorY += 16;
    body();
    cursorY = Math.max(cursorY + 4, startY + minHeight + 4);
    cursorY += sectionSpacing;
  };

  const drawKeyValue = (label: string, value: string, x: number, y: number) => {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y);
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(value || "—", x, y + 5.5);
  };

  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text("Raport Patrol Watch Commander (PWC)", marginX, cursorY);
  cursorY += 8;
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text("Zestawienie czynności PWC z generatora raportu", marginX, cursorY);
  cursorY += sectionSpacing + 4;

  drawSection("Obsada", () => {
    drawKeyValue("PWC", `${report.pwcName || "—"} (${report.pwcBadge || "brak"})`, marginX + 8, cursorY);
    drawKeyValue("APWC", `${report.apwcName || "—"} (${report.apwcBadge || "brak"})`, marginX + contentWidth / 2, cursorY);
    cursorY += lineHeight * 2;
  }, 30);

  drawSection("Czas służby", () => {
    drawKeyValue("Godzina przejęcia", report.startTime ? new Date(report.startTime).toLocaleString("pl-PL") : "—", marginX + 8, cursorY);
    drawKeyValue("Godzina zakończenia", report.endTime ? new Date(report.endTime).toLocaleString("pl-PL") : "—", marginX + contentWidth / 2, cursorY);
    cursorY += lineHeight * 2;
    drawKeyValue("Łączny czas jako PWC", report.durationDisplay || formatDuration(report.durationMinutes), marginX + 8, cursorY);
    cursorY += lineHeight * 2;
  }, 38);

  drawSection("Czynności", () => {
    const visibleActions = (report.actions || []).filter(
      (action) => (action.description || "").trim().length > 0 || (action.time || "").trim().length > 0
    );

    if (!visibleActions.length) {
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text("Brak zapisanych czynności.", marginX + 8, cursorY);
      cursorY += lineHeight;
      return;
    }

    visibleActions.forEach((action, index) => {
      const label = `${String(index + 1).padStart(2, "0")}. ${action.time || "—"}`;
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(label, marginX + 8, cursorY);

      const textLeft = marginX + 32;
      const description = action.description?.trim() || "—";
      const wrapped = doc.splitTextToSize(description, contentWidth - 40);
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      ensureSpace(wrapped.length * lineHeight + 4);
      doc.text(wrapped, textLeft, cursorY);
      cursorY += wrapped.length * lineHeight;
      cursorY += 2;
      if (cursorY > pageHeight - marginY - 30) {
        doc.addPage();
        ensureReportFonts(doc);
        cursorY = marginY;
      }
    });
  }, 40);

  drawSection("Metadane", () => {
    const generatedAt = report.generatedAt ? new Date(report.generatedAt) : new Date();
    drawKeyValue("Wygenerowano przez", report.generatedBy || "—", marginX + 8, cursorY);
    drawKeyValue("Data wygenerowania", generatedAt.toLocaleString("pl-PL"), marginX + contentWidth / 2, cursorY);
    cursorY += lineHeight * 2;
  }, 28);

  const arrayBuffer = doc.output("arraybuffer");
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Nie udało się wygenerować pliku PDF PWC.");
  }

  const pdfBase64 = arrayBufferToBase64(arrayBuffer);
  const sanitizedName = report.pwcName?.trim().replace(/\s+/g, "_") || "PWC";
  const fileName = `Raport-PWC-${sanitizedName}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;

  return { pdfBase64, fileName };
}
