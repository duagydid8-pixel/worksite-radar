export const LOCAL_ATTENDANCE_WATCH_BASE_URL = "http://127.0.0.1:8787";

export interface LocalAttendanceWatchStatus {
  ready: boolean;
  missing: string[];
  watchDir: string;
  version: string | null;
  fingerprint?: LocalAttendanceWatchFileMeta | null;
  xerp?: LocalAttendanceWatchFileMeta | null;
}

export interface LocalAttendanceWatchFileMeta {
  name: string;
  fullPath: string;
  mtimeMs: number;
  size: number;
}

export interface LocalAttendanceWatchSourceFile extends LocalAttendanceWatchFileMeta {
  base64: string;
}

export interface LocalAttendanceWatchSourcePayload extends LocalAttendanceWatchStatus {
  ready: true;
  version: string;
  fingerprint: LocalAttendanceWatchSourceFile;
  xerp: LocalAttendanceWatchSourceFile;
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = typeof atob === "function"
    ? atob(base64)
    : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function shouldApplyLocalWatchVersion(
  status: Pick<LocalAttendanceWatchStatus, "ready" | "version">,
  currentVersion: string | null
): boolean {
  return status.ready && !!status.version && status.version !== currentVersion;
}

async function fetchJson<T>(path: string, baseUrl = LOCAL_ATTENDANCE_WATCH_BASE_URL): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`로컬 자동감시 응답 오류: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchLocalAttendanceWatchStatus(baseUrl?: string): Promise<LocalAttendanceWatchStatus> {
  return fetchJson<LocalAttendanceWatchStatus>("/status", baseUrl);
}

export function fetchLocalAttendanceSourceFiles(baseUrl?: string): Promise<LocalAttendanceWatchSourcePayload> {
  return fetchJson<LocalAttendanceWatchSourcePayload>("/source-files", baseUrl);
}
