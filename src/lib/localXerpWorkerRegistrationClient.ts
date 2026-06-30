import type { XerpWorkerRegistrationSite } from "./xerpWorkerRegistration";

export const DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL = "http://127.0.0.1:8791";
export const XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY =
  "worksite-radar:xerp-worker-registration-server-url";

export type LocalXerpWorkerRegistrationStatus = {
  ok: true;
  downloadsDir: string;
  port: number;
  sites: Record<string, { key: string; label: string; xerpSiteName: string }>;
};

export type LocalXerpWorkerRegistrationDownloadResponse = {
  ok: true;
  site: XerpWorkerRegistrationSite;
  siteName: string;
  startedAtMs: number;
  mode: string;
};

export type LocalXerpWorkerRegistrationLatestResponse = {
  ok: true;
  site: XerpWorkerRegistrationSite;
  file: null | {
    fileName: string;
    modifiedAtMs: number;
    size: number;
    base64: string;
  };
};

export function getXerpWorkerRegistrationServerUrl() {
  if (typeof window === "undefined") return DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL;
  return (
    window.localStorage.getItem(XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY) ||
    DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL
  );
}

export function decodeBase64Workbook(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function readJsonOrThrow<T>(response: Response, actionLabel: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${actionLabel} 실패: 로컬 XERP 연동 서버 응답 ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function buildXerpWorkerRegistrationUrl(path: string) {
  return `${getXerpWorkerRegistrationServerUrl()}${path}`;
}

export async function fetchXerpWorkerRegistrationStatus() {
  const response = await fetch(buildXerpWorkerRegistrationUrl("/xerp-worker-registration/status"));
  return readJsonOrThrow<LocalXerpWorkerRegistrationStatus>(response, "XERP 연동 상태 확인");
}

export async function requestXerpWorkerRegistrationDownload(site: XerpWorkerRegistrationSite) {
  const response = await fetch(buildXerpWorkerRegistrationUrl("/xerp-worker-registration/download"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site }),
  });
  return readJsonOrThrow<LocalXerpWorkerRegistrationDownloadResponse>(response, "XERP 다운로드 요청");
}

export async function fetchLatestXerpWorkerRegistrationFile(
  site: XerpWorkerRegistrationSite,
  startedAtMs = 0,
) {
  const query = new URLSearchParams({
    site,
    startedAtMs: String(startedAtMs),
  });
  const response = await fetch(
    buildXerpWorkerRegistrationUrl(`/xerp-worker-registration/latest?${query.toString()}`),
  );
  return readJsonOrThrow<LocalXerpWorkerRegistrationLatestResponse>(response, "XERP 엑셀 조회");
}
