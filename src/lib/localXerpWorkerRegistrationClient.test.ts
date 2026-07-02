import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL,
  XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY,
  decodeBase64Workbook,
  fetchLatestXerpWorkerRegistrationFile,
  fetchXerpWorkerRegistrationStatus,
  getXerpWorkerRegistrationServerUrl,
  requestXerpWorkerRegistrationDownload,
} from "./localXerpWorkerRegistrationClient";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("localXerpWorkerRegistrationClient", () => {
  it("uses the default local helper URL", () => {
    expect(getXerpWorkerRegistrationServerUrl()).toBe(DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL);
    expect(DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL).toBe("http://127.0.0.1:8793");
  });

  it("uses a locally configured helper URL", () => {
    window.localStorage.setItem(XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY, "http://127.0.0.1:9898");

    expect(getXerpWorkerRegistrationServerUrl()).toBe("http://127.0.0.1:9898");
  });

  it("normalizes locally configured helper URLs to the server origin", () => {
    window.localStorage.setItem(
      XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY,
      "http://127.0.0.1:8793/",
    );

    expect(getXerpWorkerRegistrationServerUrl()).toBe("http://127.0.0.1:8793");
  });

  it("migrates the legacy XERP helper port that conflicts with the RCM image server", () => {
    window.localStorage.setItem(
      XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY,
      "http://127.0.0.1:8791",
    );

    expect(getXerpWorkerRegistrationServerUrl()).toBe(DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL);
  });

  it("fetches local helper status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        downloadsDir: "C:\\Users\\bongryong\\Downloads",
        port: 8793,
        sites: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchXerpWorkerRegistrationStatus()).resolves.toMatchObject({
      ok: true,
      port: 8793,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8793/xerp-worker-registration/status",
    );
  });

  it("requests a worker-registration download session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        site: "PH4",
        siteName: "평택 P4-PH4 초순수",
        startedAtMs: 1782800000000,
        mode: "download-folder-watch",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestXerpWorkerRegistrationDownload("PH4")).resolves.toMatchObject({
      site: "PH4",
      startedAtMs: 1782800000000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8793/xerp-worker-registration/download",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: "PH4" }),
      },
    );
  });

  it("fetches the latest workbook for a site and session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        site: "PH2",
        file: {
          fileName: "근로자 등록_10037_20260630132922.xlsx",
          modifiedAtMs: 1782800000010,
          size: 4,
          base64: "dGVzdA==",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLatestXerpWorkerRegistrationFile("PH2", 1782800000000)).resolves.toMatchObject({
      site: "PH2",
      file: { fileName: "근로자 등록_10037_20260630132922.xlsx" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8793/xerp-worker-registration/latest?site=PH2&startedAtMs=1782800000000",
    );
  });

  it("throws a Korean error for non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, { status: 500 })));

    await expect(fetchXerpWorkerRegistrationStatus()).rejects.toThrow(
      "XERP 연동 상태 확인 실패: 로컬 XERP 연동 서버 응답 500",
    );
  });

  it("decodes base64 workbook payloads", () => {
    const decoded = new TextDecoder().decode(decodeBase64Workbook("7YWM7Iqk7Yq4"));

    expect(decoded).toBe("테스트");
  });
});
