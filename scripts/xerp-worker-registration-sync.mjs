import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { rejectDisallowedOrigin, writeCorsHeaders } from "./local-service-cors.mjs";

export const DEFAULT_XERP_WORKER_REGISTRATION_PORT = 8791;
export const DEFAULT_DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Downloads")
  : path.join(os.homedir(), "Downloads");
export const XERP_MAIN_URL = "https://hansung.xerp.co.kr/com/actionMain.do#";

const WORKER_REGISTRATION_WORKBOOK_RE = /^근로자\s*등록_.*\.(xlsx|xls)$/i;

export const XERP_WORKER_REGISTRATION_SITES = {
  PH4: { key: "PH4", label: "P4-PH4", xerpSiteName: "평택 P4-PH4 초순수" },
  PH2: { key: "PH2", label: "P4-PH2", xerpSiteName: "평택 P4-PH2 초순수" },
};

export function getXerpProfileDir({
  localAppData = process.env.LOCALAPPDATA,
  homeDir = os.homedir(),
} = {}) {
  const baseDir = localAppData || path.join(homeDir, "AppData", "Local");
  return path.join(baseDir, "worksite-radar", "xerp-worker-registration-profile");
}

export const DEFAULT_XERP_PROFILE_DIR = getXerpProfileDir();

export function buildXerpWorkerRegistrationUrl() {
  return XERP_MAIN_URL;
}

export function isLoginLikelyRequired(textSnapshot = "") {
  const text = String(textSnapshot).replace(/\s+/g, " ");
  if (/노무관리|근로자\s*등록/.test(text)) return false;
  return /로그인|아이디|비밀번호|password|login/i.test(text);
}

export function isWorkerRegistrationWorkbookName(fileName) {
  return !fileName.startsWith("~$") && WORKER_REGISTRATION_WORKBOOK_RE.test(fileName);
}

export async function collectWorkerRegistrationCandidates({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  startedAtMs = 0,
} = {}) {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isWorkerRegistrationWorkbookName(entry.name)) continue;
    const filePath = path.join(downloadsDir, entry.name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs < startedAtMs) continue;
    candidates.push({
      fileName: entry.name,
      filePath,
      modifiedAtMs: fileStat.mtimeMs,
      size: fileStat.size,
    });
  }

  return candidates;
}

export function selectLatestWorkerRegistrationFile(candidates) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)[0];
}

export async function scanWorkerRegistrationDownloads({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  startedAtMs = 0,
} = {}) {
  const candidates = await collectWorkerRegistrationCandidates({ downloadsDir, startedAtMs });
  const latest = selectLatestWorkerRegistrationFile(candidates);
  if (!latest) return null;

  const buffer = await readFile(latest.filePath);
  return {
    fileName: latest.fileName,
    modifiedAtMs: latest.modifiedAtMs,
    size: latest.size,
    base64: buffer.toString("base64"),
  };
}

export function normalizeXerpWorkerRegistrationSite(value) {
  return value === "PH4" || value === "PH2" ? value : null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function createDownloadSession({
  site,
  mode = "browser-automation",
  startedAtMs = Date.now(),
} = {}) {
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];
  return {
    ok: true,
    site,
    siteName: siteDefinition.xerpSiteName,
    startedAtMs,
    mode,
  };
}

export function createXerpWorkerRegistrationRequestHandler({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  getPort = () => DEFAULT_XERP_WORKER_REGISTRATION_PORT,
  downloadWorkerRegistrationWorkbook: runWorkerRegistrationDownload = downloadWorkerRegistrationWorkbook,
} = {}) {
  return async function handleXerpWorkerRegistrationRequest(req, res) {
    writeCorsHeaders(req, res);
    if (rejectDisallowedOrigin(req, res)) return;

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");

    try {
      if (req.method === "GET" && url.pathname === "/xerp-worker-registration/status") {
        sendJson(res, 200, {
          ok: true,
          downloadsDir,
          port: getPort(),
          sites: XERP_WORKER_REGISTRATION_SITES,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/xerp-worker-registration/download") {
        const body = await readJsonBody(req);
        const site = normalizeXerpWorkerRegistrationSite(body.site);
        if (!site) {
          sendJson(res, 400, { error: "지원하지 않는 현장입니다. PH4 또는 PH2만 사용할 수 있습니다." });
          return;
        }

        sendJson(res, 200, await runWorkerRegistrationDownload({ site, downloadsDir }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/xerp-worker-registration/latest") {
        const site = normalizeXerpWorkerRegistrationSite(url.searchParams.get("site"));
        if (!site) {
          sendJson(res, 400, { error: "지원하지 않는 현장입니다. PH4 또는 PH2만 사용할 수 있습니다." });
          return;
        }

        const startedAtMs = Number(url.searchParams.get("startedAtMs") || 0);
        const file = await scanWorkerRegistrationDownloads({
          downloadsDir,
          startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
        });
        sendJson(res, 200, { ok: true, site, file });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "XERP 근로자 등록 연동 처리 중 오류가 발생했습니다.",
      });
    }
  };
}

export async function launchXerpContext({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  profileDir = DEFAULT_XERP_PROFILE_DIR,
} = {}) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    viewport: { width: 1440, height: 950 },
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

export async function clickTextInAnyFrame(page, text) {
  let lastError = null;
  for (const frame of page.frames()) {
    try {
      await frame.getByText(text, { exact: true }).first().click({ timeout: 3000 });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`XERP 화면에서 '${text}' 항목을 찾지 못했습니다: ${lastError?.message || "unknown error"}`);
}

export async function openWorkerRegistrationPage(page) {
  await page.goto(buildXerpWorkerRegistrationUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (isLoginLikelyRequired(bodyText)) return { status: "login-required" };
  if (/근로자\s*등록/.test(bodyText)) return { status: "ready" };

  await clickTextInAnyFrame(page, "노무관리");
  await clickTextInAnyFrame(page, "근로자관리").catch(() => undefined);
  await clickTextInAnyFrame(page, "근로자 등록");
  return { status: "ready" };
}

export async function selectXerpSiteInAnyFrame(page, siteDefinition) {
  for (const frame of page.frames()) {
    const selects = frame.locator("select");
    const count = await selects.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const select = selects.nth(i);
      const optionTexts = await select
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.textContent?.trim() || ""))
        .catch(() => []);
      if (optionTexts.includes(siteDefinition.xerpSiteName)) {
        await select.selectOption({ label: siteDefinition.xerpSiteName });
        return true;
      }
    }
  }

  for (const frame of page.frames()) {
    const siteText = frame.getByText(siteDefinition.xerpSiteName, { exact: true }).first();
    if (await siteText.isVisible({ timeout: 1000 }).catch(() => false)) {
      await siteText.click();
      return true;
    }
  }

  throw new Error(`XERP 현장명 '${siteDefinition.xerpSiteName}'을 선택하지 못했습니다.`);
}

function normalizePlaywrightError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType\.launchPersistentContext|playwright install/i.test(message)) {
    return new Error("Playwright Chromium 브라우저가 설치되어 있지 않습니다. npx playwright install chromium 실행 후 다시 시도하세요.");
  }
  return error;
}

export async function downloadWorkerRegistrationWorkbook({
  site,
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
} = {}) {
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];
  const startedAtMs = Date.now();
  let context;

  try {
    const launched = await launchXerpContext({ downloadsDir });
    context = launched.context;
    const page = launched.page;

    const openResult = await openWorkerRegistrationPage(page);
    if (openResult.status === "login-required") {
      return createDownloadSession({ site, mode: "login-required", startedAtMs });
    }

    await selectXerpSiteInAnyFrame(page, siteDefinition);
    await clickTextInAnyFrame(page, "조회");
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
    await clickTextInAnyFrame(page, "엑셀");
    const download = await downloadPromise;
    if (download) {
      await download.saveAs(path.join(downloadsDir, download.suggestedFilename()));
    }

    return createDownloadSession({ site, mode: "browser-automation", startedAtMs });
  } catch (error) {
    throw normalizePlaywrightError(error);
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export async function startXerpWorkerRegistrationServer({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  port = DEFAULT_XERP_WORKER_REGISTRATION_PORT,
  downloadWorkerRegistrationWorkbook,
} = {}) {
  let server;
  const handler = createXerpWorkerRegistrationRequestHandler({
    downloadsDir,
    downloadWorkerRegistrationWorkbook,
    getPort: () => {
      const address = server?.address();
      return typeof address === "object" && address ? address.port : port;
    },
  });

  server = createServer(handler);
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  return server;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startXerpWorkerRegistrationServer()
    .then((server) => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : DEFAULT_XERP_WORKER_REGISTRATION_PORT;
      console.log(`[xerp-worker-registration] listening on http://127.0.0.1:${port}`);
      console.log(`[xerp-worker-registration] downloads dir: ${DEFAULT_DOWNLOADS_DIR}`);
    })
    .catch((error) => {
      console.error("[xerp-worker-registration] failed to start", error);
      process.exitCode = 1;
    });
}
