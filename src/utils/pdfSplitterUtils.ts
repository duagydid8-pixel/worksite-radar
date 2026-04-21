import { PDFDocument, ParseSpeeds } from "pdf-lib";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";
import type { PdfSection, SplitResult, ThumbEntry } from "@/types/pdfSplitter.types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

export async function renderThumbnails(
  pdfBytes: Uint8Array,
  onPage: (thumb: ThumbEntry) => void
): Promise<number> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const total = pdf.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.35 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    onPage({ pageNum: i, dataUrl: canvas.toDataURL("image/jpeg", 0.7) });
  }

  return total;
}

export async function renderHiRes(pdfBytes: Uint8Array, pageNum: number): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.9);
}

export async function extractPageText(pdfBytes: Uint8Array, pageNum: number): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? (item as { str: string }).str : "")).join(" ");
}

export function extractNameFromText(text: string): string {
  const patterns = [
    /근로자\s*[（(]?을[)）]?\s*[：:]\s*([가-힣]{2,5})/,
    /성명\s*[：:]\s*([가-힣]{2,5})/,
    /이름\s*[：:]\s*([가-힣]{2,5})/,
    /을\s*[：:]\s*([가-힣]{2,5})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return "";
}

// ── Tesseract 워커 싱글톤 ─────────────────────────────
let _tesseractWorker: TesseractWorker | null = null;

async function getTesseractWorker(): Promise<TesseractWorker> {
  if (!_tesseractWorker) {
    _tesseractWorker = await createWorker("kor");
  }
  return _tesseractWorker;
}

export async function terminateTesseract(): Promise<void> {
  if (_tesseractWorker) {
    await _tesseractWorker.terminate();
    _tesseractWorker = null;
  }
}

/** 스캔 PDF 페이지를 OCR해서 텍스트 반환 */
export async function ocrPage(
  pdfBytes: Uint8Array,
  pageNum: number,
  onProgress?: (pct: number) => void
): Promise<string> {
  // 1. 페이지를 고해상도 캔버스로 렌더
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  onProgress?.(30);

  // 2. Tesseract OCR (kor)
  const worker = await getTesseractWorker();
  onProgress?.(50);
  const { data: { text } } = await worker.recognize(canvas);
  onProgress?.(100);
  return text;
}

export async function splitPdf(
  pdfBytes: Uint8Array,
  sections: PdfSection[],
  onProgress: (done: number, total: number) => void
): Promise<SplitResult[]> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(pdfBytes, {
      parseSpeed: ParseSpeeds.Fastest,
      ignoreEncryption: true,
    });
  } catch (e) {
    console.error("[pdf-lib] PDFDocument.load 실패:", e);
    throw new Error(`PDF 로드 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  const results: SplitResult[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    try {
      const newPdf = await PDFDocument.create();
      const indices = Array.from(
        { length: s.endPage - s.startPage + 1 },
        (_, k) => s.startPage - 1 + k
      );
      const pages = await newPdf.copyPages(src, indices);
      pages.forEach((p) => newPdf.addPage(p));
      const bytes = await newPdf.save({ useObjectStreams: false });
      const baseName = s.name || `계약서_${i + 1}`;
      results.push({
        name: baseName,
        fileName: `[${baseName}]_p${s.startPage}-p${s.endPage}`,
        blob: new Blob([bytes], { type: "application/pdf" }),
        pageCount: indices.length,
        startPage: s.startPage,
        endPage: s.endPage,
      });
    } catch (e) {
      console.error(`[pdf-lib] 구간 ${i + 1} (${s.name}) 분리 실패:`, e);
      throw new Error(`구간 ${i + 1} "${s.name}" 분리 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress(i + 1, sections.length);
  }

  return results;
}

export async function downloadAsZip(results: SplitResult[], baseName = "분리"): Promise<void> {
  const zip = new JSZip();
  for (const r of results) {
    zip.file(`${r.fileName}.pdf`, r.blob);
  }
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `[${baseName}]_분리.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSingle(result: SplitResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.fileName}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
