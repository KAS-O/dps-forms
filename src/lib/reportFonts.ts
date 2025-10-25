import type { jsPDF } from "jspdf";
import { REPORT_FONT_DEJAVU_SANS } from "./reportFontData";

const registeredDocs = new WeakSet<jsPDF>();

export function ensureReportFonts(doc: jsPDF): void {
  if (!registeredDocs.has(doc)) {
    doc.addFileToVFS("DejaVuSans.ttf", REPORT_FONT_DEJAVU_SANS);
    doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
    registeredDocs.add(doc);
  }
  doc.setFont("DejaVuSans", "normal");
}
