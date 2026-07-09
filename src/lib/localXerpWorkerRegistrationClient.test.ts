import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL,
  XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY,
  decodeBase64Workbook,
  fetchLatestXerpWorkerRegistrationFile,
  fetchXerpWorkerRegistrationStatus,
  getXerpWorkerRegistrationServerUrl,
  requestXerpLoginWindowOpen,
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

  it("requests the shared XERP login window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        mode: "login-window",
        startedAtMs: 1782800000000,
        profileDir: "C:\\LocalAppData\\worksite-radar\\xerp-worker-registration-profile",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestXerpLoginWindowOpen()).resolves.toMatchObject({
      ok: true,
      mode: "login-window",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8793/xerp-login/open", {
      method: "POST",
    });
  });

  it("falls back to the worker-registration download endpoint when the local helper is older", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Not found" }, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          site: "PH4",
          siteName: "평택 P4-PH4 초순수",
          startedAtMs: 1782800000000,
          mode: "login-required",
          profileDir: "C:\\LocalAppData\\worksite-radar\\xerp-worker-registration-profile",
          message: "XERP 로그인 후 다시 시도하세요.",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestXerpLoginWindowOpen()).resolves.toMatchObject({
      ok: true,
      mode: "login-window",
      startedAtMs: 1782800000000,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8793/xerp-login/open", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8793/xerp-worker-registration/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "PH4" }),
    });
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })));

    await expect(fetchXerpWorkerRegistrationStatus()).rejects.toThrow(
      "XERP 연동 상태 확인 실패: 로컬 XERP 연동 서버 응답 500",
    );
  });

  it("includes the local helper error body when a download request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: "XERP 화면에서 '조회' 항목을 찾지 못했습니다." },
          { status: 500 },
        ),
      ),
    );

    await expect(requestXerpWorkerRegistrationDownload("PH2")).rejects.toThrow(
      "XERP 다운로드 요청 실패: XERP 화면에서 '조회' 항목을 찾지 못했습니다.",
    );
  });

  it("explains how to start the local helper when fetch cannot connect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(requestXerpWorkerRegistrationDownload("PH4")).rejects.toThrow(
      "XERP 다운로드 요청 실패: 로컬 XERP 연동 서버에 연결할 수 없습니다. 서버창에서 npm run xerp:worker가 실행 중인지 확인한 뒤 다시 시도하세요.",
    );
  });

  it("decodes base64 workbook payloads", () => {
    const decoded = new TextDecoder().decode(decodeBase64Workbook("7YWM7Iqk7Yq4"));

    expect(decoded).toBe("테스트");
  });
});
