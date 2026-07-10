import type { XerpWorkerRegistrationSite } from "./xerpWorkerRegistration";
import { requestLocalServicesStart } from "./localServicesLauncher";

export const DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL = "http://127.0.0.1:8793";
const LEGACY_XERP_WORKER_REGISTRATION_SERVER_URL = "http://127.0.0.1:8791";
export const XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY =
  "worksite-radar:xerp-worker-registration-server-url";
const DEFAULT_XERP_HELPER_RETRY_COUNT = 12;
const DEFAULT_XERP_HELPER_RETRY_DELAY_MS = 250;

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
  message?: string;
  profileDir?: string;
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

export type LocalXerpLoginWindowOpenResponse = {
  ok: true;
  mode: "login-window" | string;
  startedAtMs: number;
  profileDir: string;
  message?: string;
};

export type LocalXerpLoginStatusResponse = {
  ok: true;
  status: "logged-in" | "login-required" | "no-window" | "unknown" | string;
  loggedIn: boolean;
  message?: string;
};

export function getXerpWorkerRegistrationServerUrl() {
  if (typeof window === "undefined") return DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL;
  const configured =
    window.localStorage.getItem(XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY) ||
    DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL;
  try {
    const origin = new URL(configured).origin;
    return origin === LEGACY_XERP_WORKER_REGISTRATION_SERVER_URL
      ? DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL
      : origin;
  } catch {
    return DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL;
  }
}

export function decodeBase64Workbook(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function readJsonOrThrow<T>(response: Response, actionLabel: string): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json() as { error?: unknown; message?: unknown };
      detail = typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "";
    } catch {
      detail = await response.clone().text().catch(() => "");
    }
    const message = detail.trim() || `로컬 XERP 연동 서버 응답 ${response.status}`;
    throw new Error(`${actionLabel} 실패: ${message}`);
  }
  return response.json() as Promise<T>;
}

function buildXerpWorkerRegistrationUrl(path: string) {
  return `${getXerpWorkerRegistrationServerUrl()}${path}`;
}

type FetchXerpHelperOptions = {
  launchLocalServices?: () => void;
  retryCount?: number;
  retryDelayMs?: number;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchXerpWorkerRegistrationOrThrow(
  path: string,
  actionLabel: string,
  init?: RequestInit,
) {
  try {
    const url = buildXerpWorkerRegistrationUrl(path);
    return init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new Error(
      `${actionLabel} 실패: 로컬 XERP 연동 서버에 연결할 수 없습니다. 서버창에서 npm run xerp:worker가 실행 중인지 확인한 뒤 다시 시도하세요.`,
    );
  }
}

export async function fetchXerpHelperOrThrow(
  path: string,
  actionLabel: string,
  init?: RequestInit,
  options: FetchXerpHelperOptions = {},
) {
  try {
    return await fetchXerpWorkerRegistrationOrThrow(path, actionLabel, init);
  } catch (firstError) {
    const retryCount = options.retryCount ?? DEFAULT_XERP_HELPER_RETRY_COUNT;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_XERP_HELPER_RETRY_DELAY_MS;
    const launchLocalServices = options.launchLocalServices ?? requestLocalServicesStart;

    try {
      launchLocalServices();
    } catch {
      // The Windows protocol may not be registered yet.
    }

    for (let attempt = 0; attempt < retryCount; attempt += 1) {
      if (attempt > 0 && retryDelayMs > 0) await wait(retryDelayMs);
      try {
        return await fetchXerpWorkerRegistrationOrThrow(path, actionLabel, init);
      } catch {
        // Keep polling while the local helper starts.
      }
    }

    throw firstError;
  }
}

export async function fetchXerpWorkerRegistrationStatus() {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-worker-registration/status",
    "XERP 연동 상태 확인",
  );
  return readJsonOrThrow<LocalXerpWorkerRegistrationStatus>(response, "XERP 연동 상태 확인");
}

export async function requestXerpWorkerRegistrationDownload(site: XerpWorkerRegistrationSite) {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-worker-registration/download",
    "XERP 다운로드 요청",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site }),
    },
  );
  return readJsonOrThrow<LocalXerpWorkerRegistrationDownloadResponse>(response, "XERP 다운로드 요청");
}

export async function requestXerpLoginWindowOpen() {
  try {
    const response = await fetchXerpHelperOrThrow(
      "/xerp-login/open",
      "XERP 로그인 창 열기",
      { method: "POST" },
    );
    return await readJsonOrThrow<LocalXerpLoginWindowOpenResponse>(response, "XERP 로그인 창 열기");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Not found|응답 404/.test(message)) throw error;

    const fallback = await requestXerpWorkerRegistrationDownload("PH4");
    return {
      ok: true,
      mode: "login-window",
      startedAtMs: fallback.startedAtMs,
      profileDir: fallback.profileDir ?? "",
      message:
        fallback.message ||
        "로컬 XERP 서버가 이전 버전이라 기존 XERP 가져오기 방식으로 로그인 창을 열었습니다. 로그인 후 다시 이용하세요.",
    };
  }
}

export async function fetchXerpLoginStatus() {
  const response = await fetchXerpHelperOrThrow(
    "/xerp-login/status",
    "XERP 로그인 상태 확인",
  );
  return readJsonOrThrow<LocalXerpLoginStatusResponse>(response, "XERP 로그인 상태 확인");
}

export async function fetchLatestXerpWorkerRegistrationFile(
  site: XerpWorkerRegistrationSite,
  startedAtMs = 0,
) {
  const query = new URLSearchParams({
    site,
    startedAtMs: String(startedAtMs),
  });
  const response = await fetchXerpHelperOrThrow(
    `/xerp-worker-registration/latest?${query.toString()}`,
    "XERP 엑셀 조회",
  );
  return readJsonOrThrow<LocalXerpWorkerRegistrationLatestResponse>(response, "XERP 엑셀 조회");
}
