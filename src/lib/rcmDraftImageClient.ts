export interface RcmDraftImageItem {
  sheetName: string;
  range: string;
  fileName: string;
  size: number;
  widthPoints: number;
  heightPoints: number;
  imageBase64: string;
}

export interface RcmDraftImageResult {
  engine: string;
  sourceFileName: string;
  count: number;
  items: RcmDraftImageItem[];
}

export interface RcmDraftImageStatus {
  ready: boolean;
  engine: string;
  port: number;
}

const RCM_IMAGE_SERVER_URL = "http://127.0.0.1:8791";

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "RCM 변환 서버 요청에 실패했습니다.";
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchRcmDraftImageStatus(): Promise<RcmDraftImageStatus> {
  const response = await fetch(`${RCM_IMAGE_SERVER_URL}/status`, { cache: "no-store" });
  return readJsonResponse<RcmDraftImageStatus>(response);
}

export async function convertRcmWorkbookToImages(file: File): Promise<RcmDraftImageResult> {
  const base64 = await fileToBase64(file);
  const response = await fetch(`${RCM_IMAGE_SERVER_URL}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, base64 }),
  });
  return readJsonResponse<RcmDraftImageResult>(response);
}

export function getRcmImageDataUrl(item: RcmDraftImageItem): string {
  return `data:image/png;base64,${item.imageBase64}`;
}
