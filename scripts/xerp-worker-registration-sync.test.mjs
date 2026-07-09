import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  buildXerpWorkerRegistrationUrl,
  classifyXerpLoginText,
  clickTextInAnyFrame,
  closeReusableXerpContext,
  createDownloadSession,
  DEFAULT_XERP_WORKER_REGISTRATION_PORT,
  downloadDailyAttendanceSummaryWorkbook,
  downloadWorkerRegistrationWorkbook,
  extractDailyAttendanceDateFromFileName,
  getXerpProfileDir,
  isDailyAttendanceSummaryWorkbookName,
  isWorkerRegistrationWorkbookName,
  isLoginLikelyRequired,
  getXerpLoginStatus,
  openDailyAttendanceSummaryPage,
  openXerpLoginWindow,
  scanDailyAttendanceSummaryDownloads,
  scanWorkerRegistrationDownloads,
  selectLatestDailyAttendanceSummaryFile,
  selectLatestWorkerRegistrationFile,
  startXerpWorkerRegistrationServer,
  uploadDailyAttendanceExtraWorkWorkbook,
  waitForXerpPageReadyAfterLogin,
} from "./xerp-worker-registration-sync.mjs";

const servers = [];

afterEach(async () => {
  await closeReusableXerpContext();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  servers.length = 0;
});

async function startTestServer(options = {}) {
  const server = await startXerpWorkerRegistrationServer({ ...options, port: 0 });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function createWorkerRegistrationWorkbookBuffer(siteName) {
  const ws = XLSX.utils.aoa_to_sheet([
    ["사번", "성명", "근무현장"],
    ["10001", "홍길동", siteName],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "근로자 등록");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

describe("xerp-worker-registration-sync server defaults", () => {
  it("uses a dedicated default port that does not conflict with the RCM image server", () => {
    expect(DEFAULT_XERP_WORKER_REGISTRATION_PORT).toBe(8793);
  });
});

describe("xerp-worker-registration-sync file scanner", () => {
  it("recognizes XERP worker-registration workbook names", () => {
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xlsx")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xls")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("근로자등록_10037_20260630132922.xlsx")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("~$근로자 등록_10037_20260630132922.xlsx")).toBe(false);
    expect(isWorkerRegistrationWorkbookName("출역관리_20260630.xlsx")).toBe(false);
  });

  it("selects the latest workbook newer than the session start", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const oldPath = path.join(dir, "근로자 등록_old.xlsx");
      const newPath = path.join(dir, "근로자 등록_new.xlsx");
      await writeFile(oldPath, "old");
      await writeFile(newPath, "new");
      const oldTime = new Date("2026-06-30T01:00:00.000Z");
      const newTime = new Date("2026-06-30T02:00:00.000Z");
      await utimes(oldPath, oldTime, oldTime);
      await utimes(newPath, newTime, newTime);

      const result = await scanWorkerRegistrationDownloads({
        downloadsDir: dir,
        startedAtMs: new Date("2026-06-30T01:30:00.000Z").getTime(),
      });

      expect(result.fileName).toBe("근로자 등록_new.xlsx");
      expect(result.size).toBe(3);
      expect(Buffer.from(result.base64, "base64").toString("utf8")).toBe("new");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not return a PH4 worker-registration workbook for PH2 scans", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-site-"));
    try {
      const ph2Path = path.join(dir, "근로자 등록_ph2.xlsx");
      const ph4Path = path.join(dir, "근로자 등록_ph4.xlsx");
      await writeFile(ph2Path, createWorkerRegistrationWorkbookBuffer("평택 P4-PH2 초순수"));
      await writeFile(ph4Path, createWorkerRegistrationWorkbookBuffer("평택 P4-PH4 초순수"));
      const base = new Date("2026-06-30T01:00:00.000Z");
      await utimes(ph2Path, base, base);
      await utimes(ph4Path, new Date(base.getTime() + 60_000), new Date(base.getTime() + 60_000));

      const result = await scanWorkerRegistrationDownloads({
        downloadsDir: dir,
        site: "PH2",
        startedAtMs: 0,
      });

      expect(result.fileName).toBe("근로자 등록_ph2.xlsx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no matching workbook exists", () => {
    expect(selectLatestWorkerRegistrationFile([])).toBeNull();
  });

  it("recognizes XERP daily attendance summary workbook names", () => {
    expect(isDailyAttendanceSummaryWorkbookName("일일출역집계_20260630.xlsx")).toBe(true);
    expect(isDailyAttendanceSummaryWorkbookName("일일출역_평택 P4-PH4 초순수_2026-06-30.xls")).toBe(true);
    expect(isDailyAttendanceSummaryWorkbookName("일일출력_2026.06.30.xlsx")).toBe(true);
    expect(isDailyAttendanceSummaryWorkbookName("근로자 등록_10037_20260630132922.xlsx")).toBe(false);
    expect(isDailyAttendanceSummaryWorkbookName("~$일일출역집계_20260630.xlsx")).toBe(false);
    expect(isDailyAttendanceSummaryWorkbookName("일일출역집계.csv")).toBe(false);
  });

  it("extracts requested dates from daily attendance workbook names", () => {
    expect(extractDailyAttendanceDateFromFileName("일일출역집계_20260630.xlsx")).toBe("2026-06-30");
    expect(extractDailyAttendanceDateFromFileName("일일출역_2026.06.30.xlsx")).toBe("2026-06-30");
    expect(extractDailyAttendanceDateFromFileName("일일출력_2026-06-30.xlsx")).toBe("2026-06-30");
    expect(extractDailyAttendanceDateFromFileName("일일출역집계.xlsx")).toBeNull();
  });

  it("selects the latest daily attendance workbook preferring the requested date", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-daily-attendance-"));
    try {
      const olderMatch = path.join(dir, "일일출역집계_20260630.xlsx");
      const newerWrongDate = path.join(dir, "일일출역집계_20260701.xlsx");
      const newerMatch = path.join(dir, "일일출력_평택 P4-PH4 초순수_2026-06-30.xlsx");

      await writeFile(olderMatch, "older");
      await writeFile(newerWrongDate, "wrong");
      await writeFile(newerMatch, "right");

      const base = new Date("2026-06-30T00:00:00.000Z");
      await utimes(olderMatch, base, base);
      await utimes(newerWrongDate, new Date(base.getTime() + 60_000), new Date(base.getTime() + 60_000));
      await utimes(newerMatch, new Date(base.getTime() + 120_000), new Date(base.getTime() + 120_000));

      const selected = await selectLatestDailyAttendanceSummaryFile({
        downloadsDir: dir,
        site: "PH4",
        date: "2026-06-30",
        startedAtMs: base.getTime() - 1,
      });

      expect(selected?.filePath).toBe(newerMatch);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scans daily attendance downloads and returns base64 workbook content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-daily-attendance-scan-"));
    try {
      const workbook = path.join(dir, "일일출역집계_20260630.xlsx");
      await writeFile(workbook, Buffer.from("daily-attendance"));

      const scanned = await scanDailyAttendanceSummaryDownloads({
        downloadsDir: dir,
        site: "PH4",
        date: "2026-06-30",
        startedAtMs: 0,
      });

      expect(scanned.found).toBe(true);
      expect(scanned.file.fileName).toBe("일일출역집계_20260630.xlsx");
      expect(Buffer.from(scanned.file.base64, "base64").toString("utf8")).toBe("daily-attendance");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("xerp-worker-registration-sync browser automation helpers", () => {
  it("builds the XERP main URL", () => {
    expect(buildXerpWorkerRegistrationUrl()).toBe("https://hansung.xerp.co.kr/com/actionMain.do#");
  });

  it("builds a deterministic Playwright profile directory", () => {
    expect(getXerpProfileDir({ localAppData: "C:\\LocalAppData" })).toBe(
      path.join("C:\\LocalAppData", "worksite-radar", "xerp-worker-registration-profile"),
    );
    expect(getXerpProfileDir({ localAppData: "C:\\LocalAppData", site: "P5PH1" })).toBe(
      path.join("C:\\LocalAppData", "worksite-radar", "xerp-worker-registration-profile-p5ph1"),
    );
  });

  it("creates a download session payload", () => {
    expect(
      createDownloadSession({
        site: "PH4",
        mode: "browser-automation",
        startedAtMs: 1782800000000,
      }),
    ).toMatchObject({
      ok: true,
      site: "PH4",
      siteName: "평택 P4-PH4 초순수",
      startedAtMs: 1782800000000,
      mode: "browser-automation",
    });
  });

  it("detects likely XERP login screens", () => {
    expect(isLoginLikelyRequired("로그인\n아이디\n비밀번호")).toBe(true);
    expect(isLoginLikelyRequired("사용자 ID\n비밀번호\n로그인")).toBe(true);
    expect(isLoginLikelyRequired("노무관리 근로자관리 근로자 등록")).toBe(false);
  });

  it("classifies XERP login status from visible page text", () => {
    expect(classifyXerpLoginText("로그인\n아이디\n비밀번호")).toMatchObject({
      status: "login-required",
      loggedIn: false,
    });
    expect(classifyXerpLoginText("노무관리 근로자관리 근로자 등록 출역관리")).toMatchObject({
      status: "logged-in",
      loggedIn: true,
    });
    expect(classifyXerpLoginText("공지사항 현장관리 메인메뉴 즐겨찾기")).toMatchObject({
      status: "logged-in",
      loggedIn: true,
    });
    expect(classifyXerpLoginText("")).toMatchObject({
      status: "unknown",
      loggedIn: false,
    });
  });

  it("waits for the XERP login window and retries the requested page", async () => {
    const page = {
      bringToFront: vi.fn(),
      waitForTimeout: vi.fn(),
    };
    const openPage = vi
      .fn()
      .mockResolvedValueOnce({ status: "login-required" })
      .mockResolvedValueOnce({ status: "ready" });
    const getLoginStatus = vi.fn().mockResolvedValue({
      status: "logged-in",
      loggedIn: true,
    });

    const openResult = await openPage(page);
    const result = await waitForXerpPageReadyAfterLogin({
      page,
      openPage,
      openResult,
      getLoginStatus,
      waitMs: 5,
      pollMs: 1,
    });

    expect(result).toEqual({ status: "ready" });
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(getLoginStatus).toHaveBeenCalledWith({ page });
    expect(page.bringToFront).toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(1);
  });

  it("continues from the current XERP page when login opens a new page", async () => {
    const currentPage = {
      isClosed: () => false,
      bringToFront: vi.fn(),
      waitForTimeout: vi.fn(),
    };
    const originalLoginPage = {
      isClosed: () => true,
      context: () => ({ pages: () => [originalLoginPage, currentPage] }),
    };
    currentPage.context = () => ({ pages: () => [originalLoginPage, currentPage] });

    const openPage = vi
      .fn()
      .mockResolvedValueOnce({ status: "login-required" })
      .mockResolvedValueOnce({ status: "ready" });
    const getLoginStatus = vi.fn().mockResolvedValue({
      status: "logged-in",
      loggedIn: true,
    });

    const openResult = await openPage(originalLoginPage);
    const result = await waitForXerpPageReadyAfterLogin({
      page: originalLoginPage,
      openPage,
      openResult,
      getLoginStatus,
      waitMs: 5,
      pollMs: 1,
    });

    expect(result).toEqual({ status: "ready" });
    expect(getLoginStatus).toHaveBeenCalledWith({ page: currentPage });
    expect(openPage).toHaveBeenLastCalledWith(currentPage);
    expect(currentPage.bringToFront).toHaveBeenCalled();
  });

  it("reads login status from the current XERP page frames", async () => {
    const page = {
      frames: () => [
        {
          locator: () => ({
            innerText: vi.fn().mockResolvedValue("노무관리 근로자관리 근로자 등록"),
          }),
        },
      ],
    };

    await expect(getXerpLoginStatus({ page })).resolves.toMatchObject({
      ok: true,
      status: "logged-in",
      loggedIn: true,
    });
  });

  it("opens a reusable XERP login window with the shared profile", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const bringToFront = vi.fn().mockResolvedValue(undefined);
    const launchContext = vi.fn(async ({ downloadsDir }) => {
      expect(downloadsDir).toBe("C:\\Downloads");
      return {
        context: { close: vi.fn() },
        page: { goto, bringToFront, isClosed: () => false },
      };
    });

    const result = await openXerpLoginWindow({
      downloadsDir: "C:\\Downloads",
      launchContext,
    });

    expect(launchContext).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("https://hansung.xerp.co.kr/com/actionMain.do#", {
      waitUntil: "domcontentloaded",
    });
    expect(bringToFront).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      mode: "login-window",
      profileDir: expect.any(String),
    });
  });

  it("keeps the worker-registration browser open when login is required", async () => {
    let closed = false;
    const result = await downloadWorkerRegistrationWorkbook({
      site: "PH4",
      launchContext: async () => ({
        context: { close: async () => { closed = true; } },
        page: {},
      }),
      openPage: async () => ({ status: "login-required" }),
      loginWaitMs: 0,
    });

    expect(result.mode).toBe("login-required");
    expect(closed).toBe(false);
  });

  it("reuses the open worker-registration browser after login is required", async () => {
    const page = { isClosed: () => false };
    const context = {
      pages: () => [page],
      close: vi.fn(),
    };
    const launchContext = vi.fn(async () => ({ context, page }));
    const openPage = vi.fn(async () => ({ status: "login-required" }));

    await downloadWorkerRegistrationWorkbook({ site: "PH4", launchContext, openPage, loginWaitMs: 0 });
    await downloadWorkerRegistrationWorkbook({ site: "PH4", launchContext, openPage, loginWaitMs: 0 });

    expect(launchContext).toHaveBeenCalledTimes(1);
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(openPage).toHaveBeenNthCalledWith(2, page);
  });

  it("keeps the daily-attendance browser open when login is required", async () => {
    let closed = false;
    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "PH4",
      date: "2026-07-02",
      launchContext: async () => ({
        context: { close: async () => { closed = true; } },
        page: {},
      }),
      openPage: async () => ({ status: "login-required" }),
      loginWaitMs: 0,
    });

    expect(result.mode).toBe("login-required");
    expect(closed).toBe(false);
  });

  it("uses a separate XERP browser profile for P5 daily attendance login", async () => {
    const launchContext = vi.fn(async ({ profileDir }) => ({
      context: { close: vi.fn(), on: vi.fn() },
      page: { isClosed: () => false },
      profileDir,
    }));

    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "P5PH1",
      date: "2026-07-02",
      launchContext,
      openPage: async () => ({ status: "login-required" }),
      loginWaitMs: 0,
    });

    expect(launchContext).toHaveBeenCalledWith(expect.objectContaining({
      profileDir: expect.stringContaining("xerp-worker-registration-profile-p5ph1"),
    }));
    expect(result.mode).toBe("login-required");
    expect(result.profileDir).toContain("xerp-worker-registration-profile-p5ph1");
  });

  it("uses the P5 profile for extra-work uploads that need login", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-extra-work-login-"));
    let closed = false;
    const launchContext = vi.fn(async ({ profileDir }) => ({
      context: {
        close: async () => {
          closed = true;
        },
        on: vi.fn(),
      },
      page: { isClosed: () => false },
      profileDir,
    }));

    try {
      const result = await uploadDailyAttendanceExtraWorkWorkbook({
        site: "P5PH1",
        date: "2026-07-02",
        fileBase64: "ZmFrZQ==",
        fileName: "extra.xlsx",
        downloadsDir: dir,
        launchContext,
        openPage: async () => ({ status: "login-required" }),
        loginWaitMs: 0,
      });

      expect(launchContext).toHaveBeenCalledWith(expect.objectContaining({
        profileDir: expect.stringContaining("xerp-worker-registration-profile-p5ph1"),
      }));
      expect(result.mode).toBe("login-required");
      expect(result.profileDir).toContain("xerp-worker-registration-profile-p5ph1");
      expect(closed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the daily-attendance browser open when the XERP menu cannot be found", async () => {
    let closed = false;
    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "PH4",
      date: "2026-07-02",
      launchContext: async () => ({
        context: { close: async () => { closed = true; } },
        page: {},
      }),
      openPage: async () => {
        throw new Error("XERP 화면에서 '출역관리' 항목을 찾지 못했습니다");
      },
    });

    expect(result.mode).toBe("manual-required");
    expect(result.message).toContain("메뉴");
    expect(closed).toBe(false);
  });

  it("treats an already-open XERP browser profile as a login-required session", async () => {
    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "PH4",
      date: "2026-07-02",
      launchContext: async () => {
        throw new Error("browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory. This means that the profile is already in use.");
      },
    });

    expect(result.mode).toBe("login-required");
    expect(result.message).toContain("XERP");
  });

  it("treats a closed launch with the XERP profile as a login-required session", async () => {
    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "PH4",
      date: "2026-07-02",
      launchContext: async () => {
        throw new Error(
          "browserType.launchPersistentContext: Target page, context or browser has been closed\n--user-data-dir=C:\\Users\\bongryong\\AppData\\Local\\worksite-radar\\xerp-worker-registration-profile",
        );
      },
    });

    expect(result.mode).toBe("login-required");
    expect(result.message).toContain("XERP");
  });

  it("treats bare 'Target page, context or browser has been closed' as login-required", async () => {
    const result = await downloadDailyAttendanceSummaryWorkbook({
      site: "PH4",
      date: "2026-07-02",
      launchContext: async () => {
        throw new Error("page.waitForTimeout: Target page, context or browser has been closed");
      },
    });

    expect(result.mode).toBe("login-required");
    expect(result.message).toContain("XERP");
  });

  it("retries menu clicks when an XERP frame is detached mid-click", async () => {
    const detachedFrame = {
      getByText: vi.fn(() => ({
        first: () => ({
          click: vi.fn().mockRejectedValue(new Error("locator.click: Frame was detached")),
        }),
      })),
    };
    const click = vi.fn().mockResolvedValue(undefined);
    const activeFrame = {
      getByText: vi.fn(() => ({
        first: () => ({ click }),
      })),
    };
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn()
        .mockReturnValueOnce([detachedFrame])
        .mockReturnValueOnce([activeFrame]),
      waitForTimeout,
    };

    await expect(clickTextInAnyFrame(page, "출역관리")).resolves.toBe(true);
    expect(page.frames).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it("opens daily attendance through labor management before attendance management", async () => {
    const actions = [];
    const frame = {
      locator: () => ({
        innerText: vi.fn().mockResolvedValue("공지사항 현장관리 메인메뉴 즐겨찾기"),
      }),
      getByText: vi.fn((label) => ({
        first: () => ({
          click: vi.fn(async () => {
            actions.push(`click:${label instanceof RegExp ? label.toString() : label}`);
          }),
          hover: vi.fn(async () => {
            actions.push(`hover:${label instanceof RegExp ? label.toString() : label}`);
          }),
        }),
      })),
    };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      frames: vi.fn(() => [frame]),
    };

    await expect(openDailyAttendanceSummaryPage(page)).resolves.toEqual({ status: "ready" });
    expect(actions).toEqual([
      "hover:노무관리",
      "click:/출역\\s*관리/i",
      "click:/일일\\s*출역\\s*집계/i",
    ]);
  });
});

describe("xerp-worker-registration-sync server", () => {
  it("proxies the deployed app through the local helper origin before static fallback", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-proxied-app-"));
    const fetchAppAsset = vi.fn(async (url) => {
      const requested = String(url);
      if (requested.endsWith("/assets/app.js")) {
        return new Response('console.log("remote firebase app");', {
          status: 200,
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        });
      }
      return new Response('<script type="module" src="/assets/app.js"></script><div>remote app</div>', {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });

    try {
      await writeFile(path.join(dir, "index.html"), "<div>local no firebase app</div>");

      const baseUrl = await startTestServer({
        downloadsDir: dir,
        staticAppDir: dir,
        appProxyOrigin: "https://worksite-radar.vercel.app",
        fetchAppAsset,
      });
      const indexResponse = await fetch(`${baseUrl}/`);
      const assetResponse = await fetch(`${baseUrl}/assets/app.js`);

      expect(indexResponse.status).toBe(200);
      expect(await indexResponse.text()).toContain("remote app");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toContain("remote firebase app");
      expect(fetchAppAsset).toHaveBeenCalledWith("https://worksite-radar.vercel.app/");
      expect(fetchAppAsset).toHaveBeenCalledWith("https://worksite-radar.vercel.app/assets/app.js");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves the built app from the local helper origin", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-static-app-"));
    try {
      await mkdir(path.join(dir, "assets"), { recursive: true });
      await writeFile(path.join(dir, "index.html"), '<script type="module" src="/assets/app.js"></script>');
      await writeFile(path.join(dir, "assets", "app.js"), 'console.log("local app");');

      const baseUrl = await startTestServer({ downloadsDir: dir, staticAppDir: dir, appProxyOrigin: "" });
      const indexResponse = await fetch(`${baseUrl}/`);
      const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
      const routeResponse = await fetch(`${baseUrl}/xerp-work-reflection`);

      expect(indexResponse.status).toBe(200);
      expect(indexResponse.headers.get("content-type")).toContain("text/html");
      expect(await indexResponse.text()).toContain("/assets/app.js");
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
      expect(await assetResponse.text()).toContain("local app");
      expect(routeResponse.status).toBe(200);
      expect(await routeResponse.text()).toContain("/assets/app.js");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves local helper status", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const baseUrl = await startTestServer({ downloadsDir: dir });
      const response = await fetch(`${baseUrl}/xerp-worker-registration/status`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.downloadsDir).toBe(dir);
      expect(json.port).toBeGreaterThan(0);
      expect(json.sites.PH4.xerpSiteName).toBe("평택 P4-PH4 초순수");
      expect(json.sites.PH2.xerpSiteName).toBe("평택 P4-PH2 초순수");
      expect(json.sites.P5PH1.xerpSiteName).toBe("평택 P5-PH1 초순수");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported download sites", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/xerp-worker-registration/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "BAD" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("지원하지 않는 현장");
  });

  it("delegates supported downloads to the injected automation function", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    const downloadWorkerRegistrationWorkbook = vi.fn().mockResolvedValue({
      ok: true,
      site: "PH4",
      siteName: "평택 P4-PH4 초순수",
      startedAtMs: 1782800000000,
      mode: "browser-automation",
    });
    try {
      const baseUrl = await startTestServer({ downloadsDir: dir, downloadWorkerRegistrationWorkbook });
      const response = await fetch(`${baseUrl}/xerp-worker-registration/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: "PH4" }),
      });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.mode).toBe("browser-automation");
      expect(downloadWorkerRegistrationWorkbook).toHaveBeenCalledWith({ site: "PH4", downloadsDir: dir });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("opens the XERP login window through the local helper", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-login-"));
    const runXerpLoginOpen = vi.fn().mockResolvedValue({
      ok: true,
      mode: "login-window",
      startedAtMs: 1782800000000,
      profileDir: "C:\\LocalAppData\\worksite-radar\\xerp-worker-registration-profile",
    });
    try {
      const baseUrl = await startTestServer({ downloadsDir: dir, openXerpLoginWindow: runXerpLoginOpen });
      const response = await fetch(`${baseUrl}/xerp-login/open`, { method: "POST" });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.mode).toBe("login-window");
      expect(runXerpLoginOpen).toHaveBeenCalledWith({ downloadsDir: dir });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the XERP login status through the local helper", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-login-status-"));
    const runXerpLoginStatus = vi.fn().mockResolvedValue({
      ok: true,
      status: "logged-in",
      loggedIn: true,
      message: "XERP 로그인됨",
    });
    try {
      const baseUrl = await startTestServer({ downloadsDir: dir, getXerpLoginStatus: runXerpLoginStatus });
      const response = await fetch(`${baseUrl}/xerp-login/status`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.loggedIn).toBe(true);
      expect(json.status).toBe("logged-in");
      expect(runXerpLoginStatus).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the latest workbook as base64", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const workbookPath = path.join(dir, "근로자 등록_10037_20260630132922.xlsx");
      const workbookBuffer = createWorkerRegistrationWorkbookBuffer("평택 P4-PH4 초순수");
      await writeFile(workbookPath, workbookBuffer);

      const baseUrl = await startTestServer({ downloadsDir: dir });
      const response = await fetch(
        `${baseUrl}/xerp-worker-registration/latest?site=PH4&startedAtMs=0`,
      );
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.site).toBe("PH4");
      expect(json.file.fileName).toBe("근로자 등록_10037_20260630132922.xlsx");
      expect(Buffer.compare(Buffer.from(json.file.base64, "base64"), Buffer.from(workbookBuffer))).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("validates daily attendance input and exposes downloaded files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-daily-endpoint-"));
    const downloadDailyAttendanceSummaryWorkbook = vi.fn(async ({ downloadsDir }) => {
      const workbookPath = path.join(downloadsDir, "일일출역집계_20260630.xlsx");
      await writeFile(workbookPath, "downloaded");
      return {
        ok: true,
        mode: "downloaded",
        filePath: workbookPath,
        fileName: "일일출역집계_20260630.xlsx",
        startedAtMs: 10,
        finishedAtMs: 20,
      };
    });

    try {
      const baseUrl = await startTestServer({ downloadsDir: dir, downloadDailyAttendanceSummaryWorkbook });

      const statusResponse = await fetch(`${baseUrl}/xerp-daily-attendance/status`);
      const statusJson = await statusResponse.json();
      expect(statusResponse.status).toBe(200);
      expect(statusJson.ok).toBe(true);
      expect(statusJson.port).toBeGreaterThan(0);
      expect(statusJson.sites).toEqual([
        { key: "PH4", label: "평택 P4-PH4 초순수" },
        { key: "PH2", label: "평택 P4-PH2 초순수" },
        { key: "P5PH1", label: "평택 P5-PH1 초순수" },
      ]);

      const invalidResponse = await fetch(`${baseUrl}/xerp-daily-attendance/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: "UNKNOWN", date: "2026-06-30" }),
      });
      expect(invalidResponse.status).toBe(400);

      const downloadResponse = await fetch(`${baseUrl}/xerp-daily-attendance/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: "P5PH1", date: "2026-06-30" }),
      });
      const downloadJson = await downloadResponse.json();
      expect(downloadResponse.status).toBe(200);
      expect(downloadJson.mode).toBe("downloaded");
      expect(downloadDailyAttendanceSummaryWorkbook).toHaveBeenCalledWith({
        site: "P5PH1",
        date: "2026-06-30",
        downloadsDir: dir,
      });

      const latestResponse = await fetch(
        `${baseUrl}/xerp-daily-attendance/latest?site=P5PH1&date=2026-06-30&startedAtMs=0`,
      );
      const latestJson = await latestResponse.json();
      expect(latestResponse.status).toBe(200);
      expect(latestJson.found).toBe(true);
      expect(latestJson.file.fileName).toBe("일일출역집계_20260630.xlsx");
      expect(Buffer.from(latestJson.file.base64, "base64").toString("utf8")).toBe("downloaded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uploads adjusted daily attendance extra-work files through the local helper", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-extra-work-upload-"));
    const uploadDailyAttendanceExtraWorkWorkbook = vi.fn(async () => ({
      ok: true,
      mode: "uploaded",
      site: "PH4",
      date: "2026-06-30",
    }));

    try {
      const baseUrl = await startTestServer({ downloadsDir: dir, uploadDailyAttendanceExtraWorkWorkbook });
      const response = await fetch(`${baseUrl}/xerp-daily-attendance/upload-extra-work`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: "PH4",
          date: "2026-06-30",
          fileBase64: "ZmFrZQ==",
          fileName: "extra.xlsx",
        }),
      });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.mode).toBe("uploaded");
      expect(uploadDailyAttendanceExtraWorkWorkbook).toHaveBeenCalledWith({
        site: "PH4",
        date: "2026-06-30",
        fileBase64: "ZmFrZQ==",
        fileName: "extra.xlsx",
        downloadsDir: dir,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles CORS preflight", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/xerp-worker-registration/status`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
