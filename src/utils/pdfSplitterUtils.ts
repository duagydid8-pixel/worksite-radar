import { PDFDocument, ParseSpeeds } from "pdf-lib";
import JSZip from "jszip";
import type { PdfSection, SplitResult, ThumbEntry } from "@/types/pdfSplitter.types";

export async function renderThumbnails(
  pdfBytes: Uint8Array,
  onPage: (thumb: ThumbEntry) => void
): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
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
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
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
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map((item: any) => item.str).join(" ");
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

export async function splitPdf(
  pdfBytes: Uint8Array,
  sections: PdfSection[],
  onProgress: (done: number, total: number) => void
): Promise<SplitResult[]> {
  const src = await PDFDocument.load(pdfBytes, {
    parseSpeed: ParseSpeeds.Fastest,
    ignoreEncryption: true,
  });

  const results: SplitResult[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const newPdf = await PDFDocument.create();
    const indices = Array.from(
      { length: s.endPage - s.startPage + 1 },
      (_, k) => s.startPage - 1 + k
    );
    const pages = await newPdf.copyPages(src, indices);
    pages.forEach((p) => newPdf.addPage(p));
    const bytes = await newPdf.save({ useObjectStreams: false });
    results.push({
      name: s.name || `계약서_${i + 1}`,
      blob: new Blob([bytes], { type: "application/pdf" }),
      pageCount: indices.length,
    });
    onProgress(i + 1, sections.length);
  }

  return results;
}

export async function downloadAsZip(results: SplitResult[]): Promise<void> {
  const zip = new JSZip();
  for (const r of results) {
    zip.file(`${r.name}.pdf`, r.blob);
  }
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = "근로계약서_분리.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSingle(result: SplitResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
