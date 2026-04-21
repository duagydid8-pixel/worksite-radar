export interface PdfSection {
  id: string;
  startPage: number;
  endPage: number;
  name: string;
  ocrStatus: "idle" | "running" | "done" | "fail";
}

export interface SplitResult {
  name: string;
  blob: Blob;
  pageCount: number;
}

export interface ThumbEntry {
  pageNum: number;
  dataUrl: string;
}
