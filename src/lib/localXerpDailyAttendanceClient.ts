import {
  decodeBase64Workbook,
  fetchXerpHelperOrThrow,
} from "./localXerpWorkerRegistrationClient";
import type { XerpWorkerRegistrationSite } from "./xerpWorkerRegistration";

export type XerpDailyAttendanceSite = XerpWorkerRegistrationSite;

export type LocalXerpDailyAttendanceStatus = {
  ok: true;
  downloadsDir: string;
  port: number;
  sites: Array<{ key: XerpDailyAttendanceSite; label: string }>;
};

export type LocalXerpDailyAttendanceDownloadResponse = {
  ok: true;
  site: XerpDailyAttendanceSite;
  siteName: string;
  date: string;
  startedAtMs: number;
  finishedAtMs?: number;
  mode: "downloaded" | "login-required" | "manual-required" | string;
  fileName?: string;
  filePath?: string;
  message?: string;
  profileDir?: string;
};

export type LocalXerpDailyAttendanceExtraWorkUploadResponse = {
  ok: true;
  site: XerpDailyAttendanceSite;
  siteName?: string;
  date: string;
  startedAtMs?: number;
  finishedAtMs?: number;
  mode: "uploaded" | "login-required" | string;
  message?: string;
  profileDir?: string;
};

export type LocalXerpDailyAttendanceLatestResponse = {
  ok: true;
  site: XerpDailyAttendanceSite;
  date: string;
  found: boolean;
  file: null | {
    fileName: string;
    name?: string;
    filePath?: string;
    path?: string;
    modifiedAtMs: number;
    mtimeMs?: number;
    size: number;
    base64: string;
  };
};

export type XerpDailyAttendanceExtraWorkUploadPayload = {
  fileBase64: string;
  fileName?: string;
};

export { decodeBase64Workbook };

async function readJsonOrThrow<T>(response: Response, actionLabel: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `로컬 XERP 연동 서버 응답 ${response.status}`;
    throw new Error(`${actionLabel} 실패: ${serverMessage}`);
  }
  return payload as T;
}

export async function fetchXerpDailyAttendanceStatus() {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-daily-attendance/status",
    "XERP 일일출역집계 상태 확인",
  );
  return readJsonOrThrow<LocalXerpDailyAttendanceStatus>(response, "XERP 일일출역집계 상태 확인");
}

export async function requestXerpDailyAttendanceDownload(
  site: XerpDailyAttendanceSite,
  date: string,
) {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-daily-attendance/download",
    "XERP 일일출역집계 다운로드 요청",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, date }),
    },
  );
  return readJsonOrThrow<LocalXerpDailyAttendanceDownloadResponse>(
    response,
    "XERP 일일출역집계 다운로드 요청",
  );
}

export async function requestXerpDailyAttendanceExtraWorkUpload(
  site: XerpDailyAttendanceSite,
  date: string,
  payload: XerpDailyAttendanceExtraWorkUploadPayload,
) {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-daily-attendance/upload-extra-work",
    "XERP 가산공수 업로드 요청",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, date, ...payload }),
    },
  );
  return readJsonOrThrow<LocalXerpDailyAttendanceExtraWorkUploadResponse>(
    response,
    "XERP 가산공수 업로드 요청",
  );
}

export async function fetchLatestXerpDailyAttendanceFile(
  site: XerpDailyAttendanceSite,
  date: string,
  startedAtMs = 0,
) {
  const query = new URLSearchParams({
    site,
    date,
    startedAtMs: String(startedAtMs),
  });
  const response = await fetchXerpHelperOrThrow(
    `/xerp-daily-attendance/latest?${query.toString()}`,
    "XERP 일일출역집계 엑셀 조회",
  );
  return readJsonOrThrow<LocalXerpDailyAttendanceLatestResponse>(
    response,
    "XERP 일일출역집계 엑셀 조회",
  );
}
