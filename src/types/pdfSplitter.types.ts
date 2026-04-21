export interface PdfSection {
  id: string;
  startPage: number;
  endPage: number;
  name: string;
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
