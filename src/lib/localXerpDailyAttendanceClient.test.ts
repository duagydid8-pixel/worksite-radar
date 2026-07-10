import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeBase64Workbook,
  fetchLatestXerpDailyAttendanceFile,
  fetchXerpDailyAttendanceStatus,
  requestXerpDailyAttendanceExtraWorkUpload,
  requestXerpDailyAttendanceDownload,
} from "./localXerpDailyAttendanceClient";

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

describe("localXerpDailyAttendanceClient", () => {
  it("fetches daily attendance helper status from the local XERP helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        downloadsDir: "C:\\Users\\bongryong\\Downloads",
        port: 8793,
        sites: [{ key: "PH4", label: "평택 P4-PH4 초순수" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchXerpDailyAttendanceStatus()).resolves.toMatchObject({ ok: true, port: 8793 });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8793/xerp-daily-attendance/status");
  });

  it("posts the selected site and upload date to the daily attendance download endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        site: "PH2",
        date: "2026-06-30",
        mode: "downloaded",
        startedAtMs: 1782800000000,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestXerpDailyAttendanceDownload("PH2", "2026-06-30")).resolves.toMatchObject({
      site: "PH2",
      date: "2026-06-30",
      mode: "downloaded",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8793/xerp-daily-attendance/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "PH2", date: "2026-06-30" }),
    });
  });

  it("fetches the latest workbook for the selected daily attendance date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        site: "PH4",
        date: "2026-06-30",
        found: true,
        file: {
          fileName: "일일출역집계_20260630.xlsx",
          modifiedAtMs: 1782800000010,
          size: 4,
          base64: "dGVzdA==",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLatestXerpDailyAttendanceFile("PH4", "2026-06-30", 1782800000000)).resolves.toMatchObject({
      found: true,
      file: { fileName: "일일출역집계_20260630.xlsx" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8793/xerp-daily-attendance/latest?site=PH4&date=2026-06-30&startedAtMs=1782800000000",
    );
  });

  it("throws a local helper error for non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "지원하지 않는 현장" }, { status: 400 })));

    await expect(requestXerpDailyAttendanceDownload("PH4", "bad-date")).rejects.toThrow(
      "지원하지 않는 현장",
    );
  });

  it("reuses the local XERP workbook decoder", () => {
    const decoded = new TextDecoder().decode(decodeBase64Workbook("7YWM7Iqk7Yq4"));

    expect(decoded).toBe("테스트");
  });

  it("posts the adjusted extra-work workbook to the local XERP helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        site: "PH4",
        date: "2026-06-30",
        mode: "uploaded",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestXerpDailyAttendanceExtraWorkUpload("PH4", "2026-06-30", {
        fileBase64: "ZmFrZQ==",
        fileName: "extra.xlsx",
      }),
    ).resolves.toMatchObject({ mode: "uploaded" });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8793/xerp-daily-attendance/upload-extra-work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "PH4",
        date: "2026-06-30",
        fileBase64: "ZmFrZQ==",
        fileName: "extra.xlsx",
      }),
    });
  });

  it("retries daily attendance download after auto-starting local services", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          site: "PH4",
          date: "2026-06-30",
          mode: "downloaded",
          startedAtMs: 1782800000000,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestXerpDailyAttendanceDownload("PH4", "2026-06-30")).resolves.toMatchObject({
      site: "PH4",
      mode: "downloaded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
