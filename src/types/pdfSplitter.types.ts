export interface PdfSection {
  id: string;
  startPage: number;
  endPage: number;
  name: string;
  ocrStatus: "idle" | "running" | "done" | "fail";
}

export interface SplitResult {
  name: string;
  fileName: string; // [이름]_p{start}-p{end}
  blob: Blob;
  pageCount: number;
  startPage: number;
  endPage: number;
}

export interface ThumbEntry {
  pageNum: number;
  dataUrl: string;
}
