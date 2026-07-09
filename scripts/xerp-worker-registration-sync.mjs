import { createServer } from "node:http";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { rejectDisallowedOrigin, writeCorsHeaders } from "./local-service-cors.mjs";

export const DEFAULT_XERP_WORKER_REGISTRATION_PORT = Number(process.env.XERP_WORKER_REGISTRATION_PORT || 8793);
export const DEFAULT_DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Downloads")
  : path.join(os.homedir(), "Downloads");
export const XERP_MAIN_URL = "https://hansung.xerp.co.kr/com/actionMain.do#";

const WORKER_REGISTRATION_WORKBOOK_RE = /^근로자\s*등록_.*\.(xlsx|xls)$/i;
const DAILY_ATTENDANCE_KEYWORDS = ["일일출역집계", "일일출역", "일일출력"];

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

function normalizeWorkbookSiteText(value) {
  return String(value ?? "").toUpperCase().replace(/[\s_-]+/g, "");
}

export function workerRegistrationWorkbookMatchesSite(buffer, site) {
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];
  if (!siteDefinition) return true;

  const expectedSiteText = normalizeWorkbookSiteText(siteDefinition.xerpSiteName);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    for (const row of rows) {
      for (const cell of row) {
        if (normalizeWorkbookSiteText(cell).includes(expectedSiteText)) return true;
      }
    }
  }
  return false;
}

function toIsoDateFromParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (
    !Number.isInteger(normalizedYear) ||
    !Number.isInteger(normalizedMonth) ||
    !Number.isInteger(normalizedDay)
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay));
  if (
    candidate.getUTCFullYear() !== normalizedYear ||
    candidate.getUTCMonth() !== normalizedMonth - 1 ||
    candidate.getUTCDate() !== normalizedDay
  ) {
    return null;
  }

  return `${String(normalizedYear).padStart(4, "0")}-${String(normalizedMonth).padStart(2, "0")}-${String(normalizedDay).padStart(2, "0")}`;
}

export function normalizeXerpDailyAttendanceDate(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return toIsoDateFromParts(match[1], match[2], match[3]);
}

export function formatXerpDailyAttendanceDateForInput(value) {
  return normalizeXerpDailyAttendanceDate(value);
}

export function extractDailyAttendanceDateFromFileName(name) {
  const base = path.basename(String(name ?? ""));
  const compact = base.match(/(^|[^\d])(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (compact) return toIsoDateFromParts(compact[2], compact[3], compact[4]);

  const separated = base.match(/(^|[^\d])(20\d{2})[-._년\s]+(\d{1,2})[-._월\s]+(\d{1,2})(?:일)?(?!\d)/);
  if (separated) return toIsoDateFromParts(separated[2], separated[3], separated[4]);

  return null;
}

export function isDailyAttendanceSummaryWorkbookName(fileName) {
  const base = path.basename(String(fileName ?? ""));
  if (!base || base.startsWith("~$")) return false;
  if (!/\.(xlsx|xls)$/i.test(base)) return false;
  return DAILY_ATTENDANCE_KEYWORDS.some((keyword) => base.includes(keyword));
}

export async function collectWorkerRegistrationCandidates({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  site,
  startedAtMs = 0,
} = {}) {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isWorkerRegistrationWorkbookName(entry.name)) continue;
    const filePath = path.join(downloadsDir, entry.name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs < startedAtMs) continue;
    if (site) {
      const buffer = await readFile(filePath);
      if (!workerRegistrationWorkbookMatchesSite(buffer, site)) continue;
    }
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
  site,
  startedAtMs = 0,
} = {}) {
  const candidates = await collectWorkerRegistrationCandidates({ downloadsDir, site, startedAtMs });
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

async function collectDailyAttendanceSummaryCandidates({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  site,
  date,
  startedAtMs = 0,
} = {}) {
  const entries = await readdir(downloadsDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  const requestedDate = normalizeXerpDailyAttendanceDate(date);
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];

  for (const entry of entries) {
    if (!entry.isFile() || !isDailyAttendanceSummaryWorkbookName(entry.name)) continue;

    const filePath = path.join(downloadsDir, entry.name);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || fileStat.mtimeMs < startedAtMs) continue;

    const upperName = entry.name.toUpperCase();
    const extractedDate = extractDailyAttendanceDateFromFileName(entry.name);
    const nameContainsSite = Boolean(
      siteDefinition &&
        (entry.name.includes(siteDefinition.xerpSiteName) ||
          entry.name.includes(siteDefinition.label) ||
          upperName.includes(siteDefinition.key)),
    );

    candidates.push({
      fileName: entry.name,
      filePath,
      path: filePath,
      modifiedAtMs: fileStat.mtimeMs,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      extractedDate,
      matchesDate: Boolean(requestedDate && extractedDate === requestedDate),
      nameContainsSite,
    });
  }

  return candidates;
}

export async function selectLatestDailyAttendanceSummaryFile({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  site,
  date,
  startedAtMs = 0,
} = {}) {
  const candidates = await collectDailyAttendanceSummaryCandidates({ downloadsDir, site, date, startedAtMs });
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    if (a.matchesDate !== b.matchesDate) return a.matchesDate ? -1 : 1;
    if (a.nameContainsSite !== b.nameContainsSite) return a.nameContainsSite ? -1 : 1;
    return b.modifiedAtMs - a.modifiedAtMs;
  })[0];
}

export async function scanDailyAttendanceSummaryDownloads({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  site,
  date,
  startedAtMs = 0,
} = {}) {
  const latest = await selectLatestDailyAttendanceSummaryFile({ downloadsDir, site, date, startedAtMs });
  if (!latest) {
    return { found: false, file: null };
  }

  const buffer = await readFile(latest.filePath);
  return {
    found: true,
    file: {
      fileName: latest.fileName,
      name: latest.fileName,
      filePath: latest.filePath,
      path: latest.filePath,
      modifiedAtMs: latest.modifiedAtMs,
      mtimeMs: latest.modifiedAtMs,
      size: latest.size,
      base64: buffer.toString("base64"),
    },
  };
}

export function normalizeXerpWorkerRegistrationSite(value) {
  return value === "PH4" || value === "PH2" ? value : null;
}

export function normalizeXerpDailyAttendanceSite(value) {
  return normalizeXerpWorkerRegistrationSite(value);
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
  downloadDailyAttendanceSummaryWorkbook: runDailyAttendanceDownload = downloadDailyAttendanceSummaryWorkbook,
  uploadPmisAttendanceWorkbook: runPmisAttendanceUpload = uploadPmisAttendanceWorkbook,
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
          site,
          startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
        });
        sendJson(res, 200, { ok: true, site, file });
        return;
      }

      if (req.method === "GET" && url.pathname === "/xerp-daily-attendance/status") {
        sendJson(res, 200, {
          ok: true,
          downloadsDir,
          port: getPort(),
          sites: Object.values(XERP_WORKER_REGISTRATION_SITES).map((siteDefinition) => ({
            key: siteDefinition.key,
            label: siteDefinition.xerpSiteName,
          })),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/xerp-daily-attendance/download") {
        const body = await readJsonBody(req);
        const site = normalizeXerpDailyAttendanceSite(body.site);
        const date = normalizeXerpDailyAttendanceDate(body.date);
        if (!site || !date) {
          sendJson(res, 400, { error: "지원하지 않는 현장 또는 날짜입니다. PH4 또는 PH2와 YYYY-MM-DD 날짜만 사용할 수 있습니다." });
          return;
        }

        const result = await runDailyAttendanceDownload({ site, date, downloadsDir });
        sendJson(res, 200, result?.ok === undefined ? { ok: true, ...result } : result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/xerp-daily-attendance/latest") {
        const site = normalizeXerpDailyAttendanceSite(url.searchParams.get("site"));
        const date = normalizeXerpDailyAttendanceDate(url.searchParams.get("date"));
        if (!site || !date) {
          sendJson(res, 400, { error: "지원하지 않는 현장 또는 날짜입니다. PH4 또는 PH2와 YYYY-MM-DD 날짜만 사용할 수 있습니다." });
          return;
        }

        const startedAtMs = Number(url.searchParams.get("startedAtMs") || 0);
        const result = await scanDailyAttendanceSummaryDownloads({
          downloadsDir,
          site,
          date,
          startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
        });
        sendJson(res, 200, { ok: true, site, date, ...result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/xerp-pmis-attendance/upload") {
        const body = await readJsonBody(req);
        const site = normalizeXerpDailyAttendanceSite(body.site);
        const date = normalizeXerpDailyAttendanceDate(body.date);
        if (!site || !date) {
          sendJson(res, 400, { error: "지원하지 않는 현장 또는 날짜입니다. PH4 또는 PH2와 YYYY-MM-DD 날짜만 사용할 수 있습니다." });
          return;
        }
        if (!body.filePath && !body.fileBase64) {
          sendJson(res, 400, { error: "filePath 또는 fileBase64를 제공해야 합니다." });
          return;
        }

        const result = await runPmisAttendanceUpload({ site, date, filePath: body.filePath, fileBase64: body.fileBase64, fileName: body.fileName, downloadsDir });
        sendJson(res, 200, result);
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

function isTransientFrameClickError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Frame was detached|Execution context was destroyed|Target closed|Page closed/i.test(message);
}

export async function clickTextInAnyFrame(page, text, { attempts = 4 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const frame of page.frames()) {
      if (typeof frame.isDetached === "function" && frame.isDetached()) continue;
      try {
        await frame.getByText(text, { exact: true }).first().click({ timeout: 3000 });
        return true;
      } catch (error) {
        lastError = error;
        if (isTransientFrameClickError(error)) break;
      }
    }
    if (attempt < attempts - 1) {
      await page.waitForTimeout?.(300);
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

export async function openDailyAttendanceSummaryPage(page) {
  await page.goto(buildXerpWorkerRegistrationUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  let allFrameText = "";
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 2000 }).catch(() => "");
    if (isLoginLikelyRequired(text)) return { status: "login-required" };
    allFrameText += text;
  }

  if (!allFrameText.includes("일일출역집계")) {
    await clickTextInAnyFrame(page, "출역관리");
    await page.waitForTimeout(500);
  }

  await clickTextInAnyFrame(page, "일일출역집계");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
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

async function fillDailyAttendanceDateInAnyFrame(page, date) {
  const formatted = formatXerpDailyAttendanceDateForInput(date);
  if (!formatted) throw new Error("유효하지 않은 조회 날짜입니다.");

  const dateValues = [formatted, formatted.replaceAll("-", "."), formatted.replaceAll("-", "")];
  for (const frame of page.frames()) {
    const dateInput = frame.locator('input[type="date"]').first();
    if (await dateInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await dateInput.fill(formatted);
      return true;
    }
  }

  const fillCandidate = async (input) => {
    for (const value of dateValues) {
      await input.fill(value).catch(() => undefined);
      const confirmed = await input.inputValue({ timeout: 300 }).catch(() => "");
      if (dateValues.includes(confirmed.replaceAll(" ", ""))) return true;
    }
    return false;
  };

  for (const frame of page.frames()) {
    const inputs = frame.locator('input:not([type="hidden"]):not([disabled])');
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const input = inputs.nth(i);
      if (!(await input.isVisible({ timeout: 300 }).catch(() => false))) continue;

      const metadata = await input
        .evaluate((element) =>
          [
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("placeholder"),
            element.getAttribute("title"),
            element.getAttribute("aria-label"),
            element.value,
          ]
            .filter(Boolean)
            .join(" "),
        )
        .catch(() => "");
      if (!/(date|ymd|날짜|일자|조회|기간|\d{4}[-.]?\d{2}[-.]?\d{2})/i.test(metadata)) continue;
      if (await fillCandidate(input)) return true;
    }
  }

  throw new Error("일일출역집계 날짜 입력칸을 찾지 못했습니다.");
}

function normalizePlaywrightError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|playwright install/i.test(message)) {
    return new Error("Playwright Chromium 브라우저가 설치되어 있지 않습니다. npx playwright install chromium 실행 후 다시 시도하세요.");
  }
  return error;
}

function isXerpBrowserProfileInUse(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ProcessSingleton|profile.*already in use|profile.*in use|user data directory.*in use/i.test(message)) {
    return true;
  }
  if (
    /xerp-worker-registration-profile/i.test(message) &&
    /Target page, context or browser has been closed|launchPersistentContext|user-data-dir/i.test(message)
  ) {
    return true;
  }
  if (/Target page, context or browser has been closed/i.test(message)) {
    return true;
  }
  return false;
}

function isXerpManualInterventionRequired(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /XERP .*항목을 찾지 못했습니다/.test(message);
}

export async function downloadWorkerRegistrationWorkbook({
  site,
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  launchContext = launchXerpContext,
  openPage = openWorkerRegistrationPage,
} = {}) {
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];
  const startedAtMs = Date.now();
  let context;
  let keepContextOpen = false;

  try {
    const launched = await launchContext({ downloadsDir });
    context = launched.context;
    const page = launched.page;

    const openResult = await openPage(page);
    if (openResult.status === "login-required") {
      keepContextOpen = true;
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
    if (isXerpBrowserProfileInUse(error)) {
      keepContextOpen = true;
      return {
        ...createDownloadSession({ site, mode: "login-required", startedAtMs }),
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "이미 열린 XERP 창이 있습니다. 그 창에서 로그인 또는 메뉴 상태를 확인하고, 창을 닫은 뒤 다시 XERP 가져오기를 눌러주세요.",
      };
    }
    if (isXerpManualInterventionRequired(error)) {
      keepContextOpen = true;
      return createDownloadSession({ site, mode: "login-required", startedAtMs });
    }
    throw normalizePlaywrightError(error);
  } finally {
    if (!keepContextOpen) await context?.close().catch(() => undefined);
  }
}

export async function downloadDailyAttendanceSummaryWorkbook({
  site,
  date,
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  launchContext = launchXerpContext,
  openPage = openDailyAttendanceSummaryPage,
} = {}) {
  const normalizedSite = normalizeXerpDailyAttendanceSite(site);
  const normalizedDate = normalizeXerpDailyAttendanceDate(date);
  if (!normalizedSite || !normalizedDate) {
    throw new Error("지원하지 않는 현장 또는 날짜입니다. PH4 또는 PH2와 YYYY-MM-DD 날짜만 사용할 수 있습니다.");
  }

  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[normalizedSite];
  const startedAtMs = Date.now();
  let context;
  let keepContextOpen = false;

  try {
    await mkdir(downloadsDir, { recursive: true });
    const launched = await launchContext({ downloadsDir });
    context = launched.context;
    const page = launched.page;

    const openResult = await openPage(page);
    if (openResult.status === "login-required") {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "XERP 로그인 후 다시 시도하세요.",
      };
    }

    await selectXerpSiteInAnyFrame(page, siteDefinition);
    await fillDailyAttendanceDateInAnyFrame(page, normalizedDate);
    await clickTextInAnyFrame(page, "조회");
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
    await clickTextInAnyFrame(page, "엑셀");
    const download = await downloadPromise;

    if (download) {
      const suggested = download.suggestedFilename();
      const fileName = isDailyAttendanceSummaryWorkbookName(suggested)
        ? suggested
        : `일일출역집계_${normalizedSite}_${normalizedDate.replaceAll("-", "")}.xlsx`;
      const filePath = path.join(downloadsDir, fileName);
      await download.saveAs(filePath);
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        finishedAtMs: Date.now(),
        mode: "downloaded",
        fileName,
        filePath,
      };
    }

    const scanned = await selectLatestDailyAttendanceSummaryFile({
      downloadsDir,
      site: normalizedSite,
      date: normalizedDate,
      startedAtMs,
    });
    if (scanned) {
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        finishedAtMs: Date.now(),
        mode: "downloaded",
        fileName: scanned.fileName,
        filePath: scanned.filePath,
      };
    }

    throw new Error("일일출역집계 엑셀 다운로드를 확인하지 못했습니다.");
  } catch (error) {
    if (isXerpBrowserProfileInUse(error)) {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "이미 열린 XERP 창이 있습니다. 그 창에서 로그인 또는 메뉴 상태를 확인하고, 창을 닫은 뒤 다시 XERP 가져오기를 눌러주세요.",
      };
    }
    if (isXerpManualInterventionRequired(error)) {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "열린 XERP 창에서 로그인 또는 메뉴 상태를 확인한 뒤 다시 시도하세요.",
      };
    }
    throw normalizePlaywrightError(error);
  } finally {
    if (!keepContextOpen) await context?.close().catch(() => undefined);
  }
}

export async function openPmisAttendanceUploadPage(page) {
  await page.goto(XERP_MAIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (isLoginLikelyRequired(text)) return { status: "login-required" };
  }

  let opened = false;
  for (const frame of page.frames()) {
    const result = await frame.evaluate(() => {
      const el = document.querySelector('[data-pgmcode="CM251200"]');
      if (!el) return false;
      el.click();
      return true;
    }).catch(() => false);
    if (result) { opened = true; break; }
  }

  if (!opened) {
    throw new Error("XERP 화면에서 'PMIS 출역일보 Upload' 메뉴를 찾지 못했습니다.");
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return { status: "ready" };
}

export async function uploadPmisAttendanceWorkbook({
  site,
  date,
  filePath,
  fileBase64,
  fileName,
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  launchContext = launchXerpContext,
  openPage = openPmisAttendanceUploadPage,
} = {}) {
  const normalizedSite = normalizeXerpDailyAttendanceSite(site);
  const normalizedDate = normalizeXerpDailyAttendanceDate(date);
  if (!normalizedSite || !normalizedDate) {
    throw new Error("지원하지 않는 현장 또는 날짜입니다.");
  }

  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[normalizedSite];
  const startedAtMs = Date.now();
  let context;
  let keepContextOpen = false;
  let tempFilePath = null;

  try {
    // base64로 파일이 오면 임시 파일로 저장
    let uploadFilePath = filePath;
    if (!uploadFilePath && fileBase64) {
      await mkdir(downloadsDir, { recursive: true });
      const baseName = fileName || `pmis_upload_${normalizedSite}_${normalizedDate}.xlsx`;
      tempFilePath = path.join(downloadsDir, `~tmp_${Date.now()}_${baseName}`);
      await import("node:fs/promises").then(({ writeFile: wf }) =>
        wf(tempFilePath, Buffer.from(fileBase64, "base64"))
      );
      uploadFilePath = tempFilePath;
    }

    if (!uploadFilePath) throw new Error("업로드할 파일을 찾을 수 없습니다.");

    const launched = await launchContext({ downloadsDir });
    context = launched.context;
    const page = launched.page;

    const openResult = await openPage(page);
    if (openResult.status === "login-required") {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "XERP 로그인 후 다시 시도하세요.",
      };
    }

    await selectXerpSiteInAnyFrame(page, siteDefinition);
    await fillDailyAttendanceDateInAnyFrame(page, normalizedDate);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10000 }),
      clickTextInAnyFrame(page, "엑셀업로드"),
    ]);
    await fileChooser.setFiles(uploadFilePath);

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    await clickTextInAnyFrame(page, "저장");
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    return {
      ok: true,
      site: normalizedSite,
      siteName: siteDefinition.xerpSiteName,
      date: normalizedDate,
      startedAtMs,
      finishedAtMs: Date.now(),
      mode: "uploaded",
    };
  } catch (error) {
    if (isXerpBrowserProfileInUse(error)) {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition?.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "이미 열린 XERP 창이 있습니다. 그 창을 닫은 뒤 다시 시도하세요.",
      };
    }
    if (isXerpManualInterventionRequired(error)) {
      keepContextOpen = true;
      return {
        ok: true,
        site: normalizedSite,
        siteName: siteDefinition?.xerpSiteName,
        date: normalizedDate,
        startedAtMs,
        mode: "login-required",
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "열린 XERP 창에서 로그인 또는 메뉴 상태를 확인한 뒤 다시 시도하세요.",
      };
    }
    throw normalizePlaywrightError(error);
  } finally {
    if (!keepContextOpen) await context?.close().catch(() => undefined);
    if (tempFilePath) await import("node:fs/promises").then(({ unlink }) => unlink(tempFilePath).catch(() => {}));
  }
}

export async function startXerpWorkerRegistrationServer({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  port = DEFAULT_XERP_WORKER_REGISTRATION_PORT,
  downloadWorkerRegistrationWorkbook,
  downloadDailyAttendanceSummaryWorkbook,
} = {}) {
  let server;
  const handler = createXerpWorkerRegistrationRequestHandler({
    downloadsDir,
    downloadWorkerRegistrationWorkbook,
    downloadDailyAttendanceSummaryWorkbook,
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
