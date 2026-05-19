import type { PdfSection } from "@/types/pdfSplitter.types";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const NAME_AFTER_LABEL = /성명\s*[:：]?\s*([가-힣]{2,4})/;

export function extractPayrollEmployeeName(text: string): string | null {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(NAME_AFTER_LABEL);
  return match?.[1] ?? null;
}

function sanitizeFileName(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, "_").trim() || "이름미인식";
}

function uniqueFileName(baseName: string, used: Map<string, number>): string {
  const safeBase = sanitizeFileName(baseName);
  const count = (used.get(safeBase) ?? 0) + 1;
  used.set(safeBase, count);
  return count === 1 ? safeBase : `${safeBase}_${count}`;
}

export function buildPayrollPdfSections(pageTexts: string[]): PdfSection[] {
  const used = new Map<string, number>();
  return pageTexts.map((text, index) => {
    const name = extractPayrollEmployeeName(text) ?? `이름미인식_${index + 1}`;
    const fileName = uniqueFileName(name, used);
    return {
      id: `payroll-page-${index + 1}`,
      startPage: index + 1,
      endPage: index + 1,
      name,
      fileName,
    };
  });
}
