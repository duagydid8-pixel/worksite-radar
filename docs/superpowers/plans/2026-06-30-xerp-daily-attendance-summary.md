# XERP Daily Attendance Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `XERP 가져오기` path to the existing `XERP & PMIS` screen so admins can import XERP `출역관리 > 일일출역집계` Excel data for `평택 P4-PH4 초순수` and `평택 P4-PH2 초순수`, using the screen's selected `업로드 날짜` as the XERP query date and app storage date.

**Architecture:** Extend the existing local XERP helper (`scripts/xerp-worker-registration-sync.mjs`) with daily attendance endpoints and Playwright automation, add a small frontend client for those endpoints, and wire `src/components/XerpPmisTable.tsx` to parse the returned workbook with its existing `parseSheet` logic and save into the current per-site date map.

**Tech Stack:** Node.js HTTP server, Playwright persistent Chromium context, React, TypeScript, Vitest, xlsx, existing Firebase save/load helpers.

---

## Task 1: Add Daily Attendance File-Selection Tests

- [ ] Edit `scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Add tests before the existing server endpoint tests so the pure download scanner behavior is locked before implementation.
- [ ] Import these new exports from `scripts/xerp-worker-registration-sync.mjs`:

```js
  isDailyAttendanceSummaryWorkbookName,
  extractDailyAttendanceDateFromFileName,
  selectLatestDailyAttendanceSummaryFile,
  scanDailyAttendanceSummaryDownloads,
```

- [ ] Add this test block:

```js
test("recognizes daily attendance summary workbook names", () => {
  assert.equal(isDailyAttendanceSummaryWorkbookName("일일출역집계_20260630.xlsx"), true);
  assert.equal(isDailyAttendanceSummaryWorkbookName("일일출역_평택 P4-PH4 초순수_2026-06-30.xls"), true);
  assert.equal(isDailyAttendanceSummaryWorkbookName("일일출력_2026.06.30.xlsx"), true);
  assert.equal(isDailyAttendanceSummaryWorkbookName("근로자 등록_10037_20260630132922.xlsx"), false);
  assert.equal(isDailyAttendanceSummaryWorkbookName("~$일일출역집계_20260630.xlsx"), false);
  assert.equal(isDailyAttendanceSummaryWorkbookName("일일출역집계.csv"), false);
});

test("extracts requested dates from daily attendance filenames", () => {
  assert.equal(extractDailyAttendanceDateFromFileName("일일출역집계_20260630.xlsx"), "2026-06-30");
  assert.equal(extractDailyAttendanceDateFromFileName("일일출역_2026.06.30.xlsx"), "2026-06-30");
  assert.equal(extractDailyAttendanceDateFromFileName("일일출력_2026-06-30.xlsx"), "2026-06-30");
  assert.equal(extractDailyAttendanceDateFromFileName("일일출역집계.xlsx"), null);
});

test("selects latest daily attendance workbook preferring the requested date", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xerp-daily-attendance-"));
  const olderMatch = join(dir, "일일출역집계_20260630.xlsx");
  const newerWrongDate = join(dir, "일일출역집계_20260701.xlsx");
  const newerMatch = join(dir, "일일출력_평택 P4-PH4 초순수_2026-06-30.xlsx");

  await writeFile(olderMatch, "older");
  await writeFile(newerWrongDate, "wrong");
  await writeFile(newerMatch, "right");

  const base = new Date("2026-06-30T00:00:00Z");
  await utimes(olderMatch, base, base);
  await utimes(newerWrongDate, new Date(base.getTime() + 60_000), new Date(base.getTime() + 60_000));
  await utimes(newerMatch, new Date(base.getTime() + 120_000), new Date(base.getTime() + 120_000));

  const selected = await selectLatestDailyAttendanceSummaryFile({
    downloadsDir: dir,
    site: "PH4",
    date: "2026-06-30",
    startedAtMs: base.getTime() - 1,
  });

  assert.equal(selected?.path, newerMatch);
});

test("scans daily attendance downloads and returns base64 workbook content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xerp-daily-attendance-scan-"));
  const workbook = join(dir, "일일출역집계_20260630.xlsx");
  await writeFile(workbook, Buffer.from("daily-attendance"));

  const scanned = await scanDailyAttendanceSummaryDownloads({
    downloadsDir: dir,
    site: "PH4",
    date: "2026-06-30",
    startedAtMs: 0,
  });

  assert.equal(scanned.found, true);
  assert.equal(scanned.file.name, "일일출역집계_20260630.xlsx");
  assert.equal(Buffer.from(scanned.file.base64, "base64").toString("utf8"), "daily-attendance");
});
```

- [ ] Run the focused test and confirm it fails for missing exports:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs
```

## Task 2: Implement Daily Attendance Download Scanner

- [ ] Edit `scripts/xerp-worker-registration-sync.mjs`.
- [ ] Add constants next to the existing worker registration constants:

```js
const DAILY_ATTENDANCE_KEYWORDS = ["일일출역집계", "일일출역", "일일출력"];
```

- [ ] Add this date parser near the existing filename helpers:

```js
function toIsoDateFromParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (!normalizedYear || normalizedMonth < 1 || normalizedMonth > 12 || normalizedDay < 1 || normalizedDay > 31) {
    return null;
  }
  return `${String(normalizedYear).padStart(4, "0")}-${String(normalizedMonth).padStart(2, "0")}-${String(normalizedDay).padStart(2, "0")}`;
}

export function normalizeXerpDailyAttendanceDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const dashed = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dashed) return null;
  return toIsoDateFromParts(dashed[1], dashed[2], dashed[3]);
}

export function formatXerpDailyAttendanceDateForInput(value) {
  const normalized = normalizeXerpDailyAttendanceDate(value);
  if (!normalized) return null;
  return normalized;
}

export function extractDailyAttendanceDateFromFileName(name) {
  const base = basename(String(name ?? ""));
  const compact = base.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (compact) return toIsoDateFromParts(compact[1], compact[2], compact[3]);

  const separated = base.match(/(?<!\d)(20\d{2})[-._년\s](\d{1,2})[-._월\s](\d{1,2})(?:일)?(?!\d)/);
  if (separated) return toIsoDateFromParts(separated[1], separated[2], separated[3]);

  return null;
}
```

- [ ] Add this workbook-name predicate:

```js
export function isDailyAttendanceSummaryWorkbookName(name) {
  const base = basename(String(name ?? ""));
  if (!base || base.startsWith("~$")) return false;
  if (!/\.(xlsx|xls)$/i.test(base)) return false;
  return DAILY_ATTENDANCE_KEYWORDS.some((keyword) => base.includes(keyword));
}
```

- [ ] Add scanner helpers:

```js
async function collectDailyAttendanceSummaryCandidates({ downloadsDir, site, date, startedAtMs = 0 }) {
  const entries = await readdir(downloadsDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  const requestedDate = normalizeXerpDailyAttendanceDate(date);
  const siteLabel = XERP_WORKER_REGISTRATION_SITES[site]?.label ?? "";

  for (const entry of entries) {
    if (!entry.isFile() || !isDailyAttendanceSummaryWorkbookName(entry.name)) continue;
    const filePath = join(downloadsDir, entry.name);
    const stats = await stat(filePath).catch(() => null);
    if (!stats || stats.mtimeMs < startedAtMs) continue;

    const extractedDate = extractDailyAttendanceDateFromFileName(entry.name);
    const nameContainsSite = siteLabel ? entry.name.includes(siteLabel) || entry.name.toUpperCase().includes(site) : false;
    candidates.push({
      path: filePath,
      name: entry.name,
      mtimeMs: stats.mtimeMs,
      extractedDate,
      matchesDate: Boolean(requestedDate && extractedDate === requestedDate),
      nameContainsSite,
    });
  }

  return candidates;
}

export async function selectLatestDailyAttendanceSummaryFile({ downloadsDir, site, date, startedAtMs = 0 }) {
  const candidates = await collectDailyAttendanceSummaryCandidates({ downloadsDir, site, date, startedAtMs });
  candidates.sort((a, b) => {
    if (a.matchesDate !== b.matchesDate) return a.matchesDate ? -1 : 1;
    if (a.nameContainsSite !== b.nameContainsSite) return a.nameContainsSite ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates[0] ?? null;
}

export async function scanDailyAttendanceSummaryDownloads({ downloadsDir, site, date, startedAtMs = 0 }) {
  const file = await selectLatestDailyAttendanceSummaryFile({ downloadsDir, site, date, startedAtMs });
  if (!file) {
    return { found: false, file: null };
  }

  const bytes = await readFile(file.path);
  return {
    found: true,
    file: {
      name: file.name,
      path: file.path,
      mtimeMs: file.mtimeMs,
      base64: bytes.toString("base64"),
    },
  };
}
```

- [ ] Run the focused test and confirm the Task 1 tests pass before endpoint work:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs
```

- [ ] Commit scanner changes:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs
git commit -m "test: cover xerp daily attendance file selection"
```

## Task 3: Add Daily Attendance HTTP Endpoint Tests

- [ ] Edit `scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Import `createXerpWorkerRegistrationRequestHandler` is already present; keep using that handler factory.
- [ ] Add a test that injects `downloadDailyAttendanceSummaryWorkbook` into `createXerpWorkerRegistrationRequestHandler`.
- [ ] Add this endpoint test block:

```js
test("daily attendance endpoints validate input and expose downloaded files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xerp-daily-endpoint-"));
  const calls = [];
  const handler = createXerpWorkerRegistrationRequestHandler({
    downloadsDir: dir,
    getPort: () => 8791,
    downloadDailyAttendanceSummaryWorkbook: async (args) => {
      calls.push(args);
      const workbook = join(dir, "일일출역집계_20260630.xlsx");
      await writeFile(workbook, "downloaded");
      return {
        mode: "downloaded",
        filePath: workbook,
        fileName: "일일출역집계_20260630.xlsx",
        startedAtMs: 10,
        finishedAtMs: 20,
      };
    },
  });

  const server = await listenForTest(handler);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const status = await fetch(`${base}/xerp-daily-attendance/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      ok: true,
      port: 8791,
      sites: [
        { key: "PH4", label: "평택 P4-PH4 초순수" },
        { key: "PH2", label: "평택 P4-PH2 초순수" },
      ],
    });

    const invalid = await fetch(`${base}/xerp-daily-attendance/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "P5PH1", date: "2026-06-30" }),
    });
    assert.equal(invalid.status, 400);

    const requested = await fetch(`${base}/xerp-daily-attendance/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: "PH4", date: "2026-06-30" }),
    });
    assert.equal(requested.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].site, "PH4");
    assert.equal(calls[0].date, "2026-06-30");

    const latest = await fetch(`${base}/xerp-daily-attendance/latest?site=PH4&date=2026-06-30&startedAtMs=0`);
    assert.equal(latest.status, 200);
    const latestJson = await latest.json();
    assert.equal(latestJson.found, true);
    assert.equal(latestJson.file.name, "일일출역집계_20260630.xlsx");
    assert.equal(Buffer.from(latestJson.file.base64, "base64").toString("utf8"), "downloaded");
  } finally {
    await closeForTest(server);
  }
});
```

- [ ] Run the focused test and confirm it fails for missing daily endpoints or injection parameter:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs
```

## Task 4: Implement Daily Attendance HTTP Endpoints

- [ ] Edit `scripts/xerp-worker-registration-sync.mjs`.
- [ ] Update handler factory signature:

```js
export function createXerpWorkerRegistrationRequestHandler({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  getPort = () => DEFAULT_XERP_WORKER_REGISTRATION_PORT,
  downloadWorkerRegistrationWorkbook: runWorkerRegistrationDownload = downloadWorkerRegistrationWorkbook,
  downloadDailyAttendanceSummaryWorkbook: runDailyAttendanceDownload = downloadDailyAttendanceSummaryWorkbook,
} = {}) {
```

- [ ] Add this request normalizer next to `normalizeXerpWorkerRegistrationSite`:

```js
export function normalizeXerpDailyAttendanceSite(value) {
  return normalizeXerpWorkerRegistrationSite(value);
}
```

- [ ] Add endpoint handling inside `createXerpWorkerRegistrationRequestHandler`, before the existing 404 branch:

```js
if (url.pathname === "/xerp-daily-attendance/status" && request.method === "GET") {
  sendJson(response, 200, {
    ok: true,
    port: getPort(),
    sites: Object.entries(XERP_WORKER_REGISTRATION_SITES).map(([key, value]) => ({
      key,
      label: value.label,
    })),
  });
  return;
}

if (url.pathname === "/xerp-daily-attendance/download" && request.method === "POST") {
  const body = await readJsonBody(request);
  const site = normalizeXerpDailyAttendanceSite(body.site);
  const date = normalizeXerpDailyAttendanceDate(body.date);
  if (!site || !date) {
    sendJson(response, 400, { ok: false, error: "지원하지 않는 현장 또는 날짜입니다." });
    return;
  }

  try {
    const result = await runDailyAttendanceDownload({ site, date, downloadsDir });
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
  }
  return;
}

if (url.pathname === "/xerp-daily-attendance/latest" && request.method === "GET") {
  const site = normalizeXerpDailyAttendanceSite(url.searchParams.get("site"));
  const date = normalizeXerpDailyAttendanceDate(url.searchParams.get("date"));
  const startedAtMs = Number(url.searchParams.get("startedAtMs") ?? 0);
  if (!site || !date) {
    sendJson(response, 400, { ok: false, error: "지원하지 않는 현장 또는 날짜입니다." });
    return;
  }

  const result = await scanDailyAttendanceSummaryDownloads({
    downloadsDir,
    site,
    date,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
  });
  sendJson(response, 200, result);
  return;
}
```

- [ ] Run the focused test:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs
```

- [ ] Commit endpoint changes:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs
git commit -m "feat: add xerp daily attendance helper endpoints"
```

## Task 5: Add Browser Automation for Daily Attendance Download

- [ ] Edit `scripts/xerp-worker-registration-sync.mjs`.
- [ ] Add menu navigation helpers near the existing worker registration automation helpers.
- [ ] Implement `openDailyAttendanceSummaryPage(page)`:

```js
export async function openDailyAttendanceSummaryPage(page) {
  await page.goto(XERP_MAIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const snapshot = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (isLoginLikelyRequired(snapshot)) {
    return { mode: "login-required" };
  }

  if (!snapshot.includes("일일출역집계")) {
    await clickTextInAnyFrame(page, "출역관리");
    await page.waitForTimeout(500);
  }

  await clickTextInAnyFrame(page, "일일출역집계");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return { mode: "ready" };
}
```

- [ ] Implement `fillDailyAttendanceDateInAnyFrame(page, date)`:

```js
async function fillDailyAttendanceDateInAnyFrame(page, date) {
  const formatted = formatXerpDailyAttendanceDateForInput(date);
  if (!formatted) throw new Error("유효하지 않은 조회 날짜입니다.");

  const frames = page.frames();
  for (const frame of frames) {
    const dateInput = frame.locator('input[type="date"]').first();
    if (await dateInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await dateInput.fill(formatted);
      return;
    }
  }

  const compact = formatted.replaceAll("-", "");
  const dotted = formatted.replaceAll("-", ".");
  for (const frame of frames) {
    const inputs = frame.locator('input:not([type="hidden"])');
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const value = await input.inputValue({ timeout: 200 }).catch(() => "");
      if (/^\d{4}[-.]?\d{2}[-.]?\d{2}$/.test(value) || value === "") {
        await input.fill(formatted).catch(async () => input.fill(dotted));
        const confirmed = await input.inputValue({ timeout: 200 }).catch(() => "");
        if ([formatted, dotted, compact].includes(confirmed.replaceAll(" ", ""))) return;
      }
    }
  }

  throw new Error("일일출역집계 날짜 입력칸을 찾지 못했습니다.");
}
```

- [ ] Implement `downloadDailyAttendanceSummaryWorkbook({ site, date, downloadsDir })`:

```js
export async function downloadDailyAttendanceSummaryWorkbook({ site, date, downloadsDir = DEFAULT_DOWNLOADS_DIR }) {
  const normalizedSite = normalizeXerpDailyAttendanceSite(site);
  const normalizedDate = normalizeXerpDailyAttendanceDate(date);
  if (!normalizedSite || !normalizedDate) {
    throw new Error("지원하지 않는 현장 또는 날짜입니다.");
  }

  await mkdir(downloadsDir, { recursive: true });
  const startedAtMs = Date.now();
  const context = await launchXerpContext({ downloadsDir });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    const opened = await openDailyAttendanceSummaryPage(page);
    if (opened.mode === "login-required") {
      return {
        mode: "login-required",
        startedAtMs,
        profileDir: DEFAULT_XERP_PROFILE_DIR,
        message: "XERP 로그인 후 다시 시도하세요.",
      };
    }

    await selectXerpSiteInAnyFrame(page, normalizedSite);
    await fillDailyAttendanceDateInAnyFrame(page, normalizedDate);
    await clickTextInAnyFrame(page, "조회");
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      clickTextInAnyFrame(page, "엑셀"),
    ]);
    const suggested = download.suggestedFilename();
    const fileName = isDailyAttendanceSummaryWorkbookName(suggested)
      ? suggested
      : `일일출역집계_${normalizedSite}_${normalizedDate.replaceAll("-", "")}.xlsx`;
    const targetPath = join(downloadsDir, fileName);
    await download.saveAs(targetPath);

    return {
      mode: "downloaded",
      filePath: targetPath,
      fileName,
      startedAtMs,
      finishedAtMs: Date.now(),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
```

- [ ] Run the existing script tests:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs
```

- [ ] Commit automation changes:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs
git commit -m "feat: automate xerp daily attendance downloads"
```

## Task 6: Add Frontend Daily Attendance Client Tests

- [ ] Create `src/lib/localXerpDailyAttendanceClient.test.ts`.
- [ ] Use Vitest and mock `global.fetch`.
- [ ] Add tests for status, download request body, latest query params, and base64 workbook decoding.
- [ ] Test file content:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLatestXerpDailyAttendanceFile,
  fetchXerpDailyAttendanceStatus,
  requestXerpDailyAttendanceDownload,
} from "./localXerpDailyAttendanceClient";

describe("localXerpDailyAttendanceClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("fetches helper status from the local XERP helper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, port: 8791, sites: [] }),
      }),
    );

    await expect(fetchXerpDailyAttendanceStatus()).resolves.toEqual({ ok: true, port: 8791, sites: [] });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8791/xerp-daily-attendance/status");
  });

  it("posts the selected site and upload date to the download endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, mode: "downloaded", startedAtMs: 10 }),
      }),
    );

    await requestXerpDailyAttendanceDownload("PH2", "2026-06-30");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8791/xerp-daily-attendance/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ site: "PH2", date: "2026-06-30" }),
      }),
    );
  });

  it("fetches the latest workbook for the same selected date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ found: false, file: null }),
      }),
    );

    await fetchLatestXerpDailyAttendanceFile("PH4", "2026-06-30", 123);

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8791/xerp-daily-attendance/latest?site=PH4&date=2026-06-30&startedAtMs=123",
    );
  });
});
```

- [ ] Run the new client test and confirm it fails for missing file/export:

```powershell
npm test -- src/lib/localXerpDailyAttendanceClient.test.ts
```

## Task 7: Implement Frontend Daily Attendance Client

- [ ] Create `src/lib/localXerpDailyAttendanceClient.ts`.
- [ ] Reuse existing local helper base URL and workbook decoder from `src/lib/localXerpWorkerRegistrationClient.ts`.
- [ ] Implement:

```ts
import {
  decodeBase64Workbook,
  getXerpWorkerRegistrationServerUrl,
} from "./localXerpWorkerRegistrationClient";

export type XerpDailyAttendanceSite = "PH4" | "PH2";

export interface XerpDailyAttendanceStatus {
  ok: boolean;
  port: number;
  sites: Array<{ key: XerpDailyAttendanceSite; label: string }>;
}

export interface XerpDailyAttendanceDownloadResult {
  ok: boolean;
  mode: "downloaded" | "login-required";
  startedAtMs: number;
  finishedAtMs?: number;
  filePath?: string;
  fileName?: string;
  message?: string;
  profileDir?: string;
}

export interface XerpDailyAttendanceLatestResult {
  found: boolean;
  file: null | {
    name: string;
    path: string;
    mtimeMs: number;
    base64: string;
  };
}

export { decodeBase64Workbook };

function buildXerpDailyAttendanceUrl(path: string): string {
  return `${getXerpWorkerRegistrationServerUrl()}${path}`;
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `XERP local helper request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchXerpDailyAttendanceStatus(): Promise<XerpDailyAttendanceStatus> {
  const response = await fetch(buildXerpDailyAttendanceUrl("/xerp-daily-attendance/status"));
  return readJsonOrThrow<XerpDailyAttendanceStatus>(response);
}

export async function requestXerpDailyAttendanceDownload(
  site: XerpDailyAttendanceSite,
  date: string,
): Promise<XerpDailyAttendanceDownloadResult> {
  const response = await fetch(buildXerpDailyAttendanceUrl("/xerp-daily-attendance/download"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site, date }),
  });
  return readJsonOrThrow<XerpDailyAttendanceDownloadResult>(response);
}

export async function fetchLatestXerpDailyAttendanceFile(
  site: XerpDailyAttendanceSite,
  date: string,
  startedAtMs: number,
): Promise<XerpDailyAttendanceLatestResult> {
  const params = new URLSearchParams({
    site,
    date,
    startedAtMs: String(startedAtMs),
  });
  const response = await fetch(buildXerpDailyAttendanceUrl(`/xerp-daily-attendance/latest?${params.toString()}`));
  return readJsonOrThrow<XerpDailyAttendanceLatestResult>(response);
}
```

- [ ] Run the client test:

```powershell
npm test -- src/lib/localXerpDailyAttendanceClient.test.ts
```

- [ ] Commit client changes:

```powershell
git add src/lib/localXerpDailyAttendanceClient.ts src/lib/localXerpDailyAttendanceClient.test.ts
git commit -m "feat: add xerp daily attendance frontend client"
```

## Task 8: Add XERP Import Wiring Tests for XERP & PMIS

- [ ] Create `src/components/XerpPmisTable.xerpImport.test.ts`.
- [ ] Use a source-level test because the component has heavy browser, Firebase, xlsx, and table dependencies.
- [ ] Test content:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/XerpPmisTable.tsx"), "utf8");

describe("XerpPmisTable XERP daily attendance import wiring", () => {
  it("uses the local daily attendance client", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload");
    expect(source).toContain("fetchLatestXerpDailyAttendanceFile");
    expect(source).toContain("decodeBase64Workbook");
  });

  it("does not enable the XERP import button for P5-PH1", () => {
    expect(source).toContain('site !== "P5PH1"');
    expect(source).toContain("canUseXerpDailyImport");
  });

  it("uses uploadDate for the XERP query and saved date", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload(site, uploadDate)");
    expect(source).toContain("[uploadDate]: imported");
    expect(source).toContain("setSelectedDate(uploadDate)");
  });
});
```

- [ ] Run the new wiring test and confirm it fails:

```powershell
npm test -- src/components/XerpPmisTable.xerpImport.test.ts
```

## Task 9: Wire XERP Import Button into XerpPmisTable

- [ ] Edit `src/components/XerpPmisTable.tsx`.
- [ ] Add imports:

```ts
import {
  decodeBase64Workbook,
  fetchLatestXerpDailyAttendanceFile,
  requestXerpDailyAttendanceDownload,
  type XerpDailyAttendanceSite,
} from "@/lib/localXerpDailyAttendanceClient";
```

- [ ] Add state near existing upload state:

```ts
const [xerpImporting, setXerpImporting] = useState(false);
```

- [ ] Add a site guard near existing site-derived constants:

```ts
const canUseXerpDailyImport = isAdmin && site !== "P5PH1";
```

- [ ] Add handler near `handleUpload` and `handleFolderUpload`:

```ts
const handleXerpDailyImport = async () => {
  if (!canUseXerpDailyImport) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(uploadDate)) {
    toast.error("XERP 조회 날짜를 먼저 선택하세요.");
    return;
  }

  setXerpImporting(true);
  try {
    const xerpSite = site as XerpDailyAttendanceSite;
    const session = await requestXerpDailyAttendanceDownload(xerpSite, uploadDate);
    if (session.mode === "login-required") {
      toast.info("열린 XERP 창에서 로그인한 뒤 다시 XERP 가져오기를 눌러주세요.");
      return;
    }

    const latest = await fetchLatestXerpDailyAttendanceFile(xerpSite, uploadDate, session.startedAtMs ?? 0);
    if (!latest.found || !latest.file) {
      toast.error("다운로드된 일일출역집계 엑셀을 찾지 못했습니다.");
      return;
    }

    const buffer = decodeBase64Workbook(latest.file.base64);
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const imported = parseSheet(wb);
    if (imported.length === 0) {
      toast.error("일일출역집계 엑셀에서 가져올 행이 없습니다.");
      return;
    }

    uploadedTemplateBuffersRef.current[uploadDate] = buffer.slice(0);
    const nextMap = { ...dateMap, [uploadDate]: imported };
    setDateMap(nextMap);
    syncXerpFS(nextMap);
    setSelectedDate(uploadDate);
    toast.success(`${latest.file.name}에서 ${imported.length.toLocaleString()}건을 가져왔습니다.`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "XERP 일일출역집계 가져오기에 실패했습니다.");
  } finally {
    setXerpImporting(false);
  }
};
```

- [ ] Add button in the existing admin upload control row, after `업로드` and before `폴더 일괄`:

```tsx
{canUseXerpDailyImport && (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    onClick={handleXerpDailyImport}
    disabled={xerpImporting}
  >
    <Download className="h-4 w-4" />
    {xerpImporting ? "가져오는 중" : "XERP 가져오기"}
  </Button>
)}
```

- [ ] Confirm `Download` icon already exists in the component imports. If it does not, import it from `lucide-react`.
- [ ] Run wiring and component type checks:

```powershell
npm test -- src/components/XerpPmisTable.xerpImport.test.ts src/lib/localXerpDailyAttendanceClient.test.ts
npm run build
```

- [ ] Commit UI changes:

```powershell
git add src/components/XerpPmisTable.tsx src/components/XerpPmisTable.xerpImport.test.ts
git commit -m "feat: import xerp daily attendance into pmis table"
```

## Task 10: Document the Daily Attendance Helper Flow

- [ ] Edit `docs/xerp-worker-registration-local-helper.md`.
- [ ] Add a section named `일일출역집계 가져오기`.
- [ ] Document:
  - Supported sites: `평택 P4-PH4 초순수`, `평택 P4-PH2 초순수`
  - Unsupported site: `P5-PH1`
  - The app uses `XERP & PMIS` `업로드 날짜` for both XERP 조회 and app 저장 날짜.
  - Start command remains:

```powershell
npm run xerp:worker
```

  - Endpoints:

```text
GET  /xerp-daily-attendance/status
POST /xerp-daily-attendance/download
GET  /xerp-daily-attendance/latest
```

- [ ] Run markdown/source verification:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs src/lib/localXerpDailyAttendanceClient.test.ts src/components/XerpPmisTable.xerpImport.test.ts
```

- [ ] Commit docs:

```powershell
git add docs/xerp-worker-registration-local-helper.md
git commit -m "docs: explain xerp daily attendance import"
```

## Task 11: Full Verification and Push

- [ ] Run the focused test suite:

```powershell
npm test -- scripts/xerp-worker-registration-sync.test.mjs src/lib/localXerpDailyAttendanceClient.test.ts src/components/XerpPmisTable.xerpImport.test.ts
```

- [ ] Run production build:

```powershell
npm run build
```

- [ ] Start or reuse the local helper:

```powershell
npm run xerp:worker
```

- [ ] Verify the helper status endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8791/xerp-daily-attendance/status
```

- [ ] Confirm the feature branch history:

```powershell
git status --short
git log --oneline -5
```

- [ ] Push the feature branch:

```powershell
git push -u origin codex/xerp-daily-attendance-summary
```

- [ ] If the user wants this live on `https://worksite-radar.vercel.app/`, merge into `main` and push `main`:

```powershell
git switch main
git pull --ff-only origin main
git merge --ff-only codex/xerp-daily-attendance-summary
git push origin main
```

- [ ] After Vercel deployment finishes, verify the live app bundle includes `XERP 가져오기` in the `XERP & PMIS` path and report the deployment status.

## Self-Review Checklist

- [ ] The helper supports only `PH4` and `PH2`; `P5PH1` is blocked by both frontend and backend validation.
- [ ] The selected `uploadDate` is passed to XERP and used as the app save key.
- [ ] Empty or missing downloads do not overwrite existing app data.
- [ ] Login-required mode does not close the user's ability to log in through the persistent Chromium profile.
- [ ] Existing worker registration endpoints remain compatible.
- [ ] Tests cover helper scanner, helper endpoints, frontend client, and XERP & PMIS wiring.
