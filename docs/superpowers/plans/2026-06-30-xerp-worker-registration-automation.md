# XERP Worker Registration Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local XERP worker-registration import path for the `기술인 및 관리자 명단` screen. The first supported XERP menu is `노무관리 > 근로자관리 > 근로자 등록`, and the supported sites are `평택 P4-PH4 초순수` and `평택 P4-PH2 초순수`. `P5-PH1` is excluded because it uses different credentials.

**Architecture:** Keep all XERP browser/download access inside a local Node helper, because the Vercel app cannot read the user's browser session or local Downloads folder. The React app talks to that helper over `http://127.0.0.1:8791`, reads the downloaded Excel as base64, reuses the existing worker-registration Excel parser, shows a confirmation summary, and saves through the existing PH4/PH2 Firestore save functions.

**Tech Stack:** React, TypeScript, Vite, Vitest, `xlsx`, Node HTTP server, Playwright persistent Chromium profile, existing Firestore helpers, existing local service CORS utilities.

---

## Constraints

- Do not store XERP usernames or passwords.
- Do not integrate `P5-PH1` in this pass.
- Do not bypass XERP authentication. The user logs in through the visible browser profile launched by the helper.
- Do not send XERP Excel files to an external service. The local helper returns the downloaded workbook only to the local browser app.
- Keep the existing manual Excel upload working.
- Keep duplicate-name highlighting already shipped in `NewEmployeeList`.
- Keep code changes scoped to the isolated worktree: `C:\Users\bongryong\worksite-radar\.worktrees\xerp-worker-registration-automation`.

---

## Task 1: Add Shared XERP Worker-Registration Domain Helpers

**Files**

- Create: `src/lib/xerpWorkerRegistration.ts`
- Create: `src/lib/xerpWorkerRegistration.test.ts`

**Purpose**

Centralize the two supported XERP site names, display labels, and import-summary logic so the UI and local client do not duplicate string constants.

**Test first**

- [ ] Add `src/lib/xerpWorkerRegistration.test.ts`.
- [ ] Include tests for the exact supported site names.
- [ ] Include tests for status counts and duplicate-name counts.

Use this test shape:

```ts
import { describe, expect, it } from "vitest";
import {
  XERP_WORKER_REGISTRATION_SITES,
  getXerpWorkerRegistrationSite,
  summarizeXerpWorkerRegistrationRows,
} from "./xerpWorkerRegistration";

describe("xerpWorkerRegistration", () => {
  it("defines the supported XERP worker-registration sites", () => {
    expect(XERP_WORKER_REGISTRATION_SITES.PH4.xerpSiteName).toBe("평택 P4-PH4 초순수");
    expect(XERP_WORKER_REGISTRATION_SITES.PH2.xerpSiteName).toBe("평택 P4-PH2 초순수");
    expect(Object.keys(XERP_WORKER_REGISTRATION_SITES)).toEqual(["PH4", "PH2"]);
  });

  it("returns a site definition by key", () => {
    expect(getXerpWorkerRegistrationSite("PH4").label).toBe("P4-PH4");
    expect(getXerpWorkerRegistrationSite("PH2").label).toBe("P4-PH2");
  });

  it("summarizes imported rows", () => {
    const summary = summarizeXerpWorkerRegistrationRows([
      { 이름: "홍길동", 입사일: "2026-01-01", 퇴사일: "" },
      { 이름: "홍길동", 입사일: "2026-02-01", 퇴사일: "" },
      { 이름: "김철수", 입사일: "2025-01-01", 퇴사일: "2026-01-31" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.resigned).toBe(1);
    expect(summary.duplicateNameGroups).toBe(1);
    expect(summary.duplicateNameRows).toBe(2);
  });
});
```

**Implementation**

- [ ] Add `XerpWorkerRegistrationSite = "PH4" | "PH2"`.
- [ ] Add `XERP_WORKER_REGISTRATION_SITES` with exact labels and XERP site names.
- [ ] Add `getXerpWorkerRegistrationSite(site)`.
- [ ] Add `summarizeXerpWorkerRegistrationRows(rows)` and reuse existing exported helpers from `src/components/NewEmployeeList.tsx`:
  - `getEmployeeStatusCounts`
  - `getDuplicateNameCounts`

Implementation shape:

```ts
import { getDuplicateNameCounts, getEmployeeStatusCounts } from "@/components/NewEmployeeList";

export type XerpWorkerRegistrationSite = "PH4" | "PH2";

export type XerpWorkerRegistrationSiteDefinition = {
  key: XerpWorkerRegistrationSite;
  label: string;
  xerpSiteName: string;
};

export const XERP_WORKER_REGISTRATION_SITES: Record<
  XerpWorkerRegistrationSite,
  XerpWorkerRegistrationSiteDefinition
> = {
  PH4: { key: "PH4", label: "P4-PH4", xerpSiteName: "평택 P4-PH4 초순수" },
  PH2: { key: "PH2", label: "P4-PH2", xerpSiteName: "평택 P4-PH2 초순수" },
};

type EmployeeStatusInput = {
  이름?: string;
  입사일?: string;
  퇴사일?: string;
};

export function getXerpWorkerRegistrationSite(site: XerpWorkerRegistrationSite) {
  return XERP_WORKER_REGISTRATION_SITES[site];
}

export function summarizeXerpWorkerRegistrationRows(rows: EmployeeStatusInput[]) {
  const statusCounts = getEmployeeStatusCounts(rows);
  const duplicateCounts = getDuplicateNameCounts(rows);
  const duplicateValues = Array.from(duplicateCounts.values());

  return {
    total: rows.length,
    active: statusCounts.active,
    resigned: statusCounts.resigned,
    unknown: statusCounts.unknown,
    duplicateNameGroups: duplicateValues.length,
    duplicateNameRows: duplicateValues.reduce((sum, count) => sum + count, 0),
  };
}
```

**Verify**

- [ ] Run `npm test -- src/lib/xerpWorkerRegistration.test.ts`.
- [ ] Commit after passing:

```powershell
git add src/lib/xerpWorkerRegistration.ts src/lib/xerpWorkerRegistration.test.ts
git commit -m "feat: add xerp worker registration helpers"
```

---

## Task 2: Add Local Helper File-Scanner Logic

**Files**

- Create: `scripts/xerp-worker-registration-sync.mjs`
- Create: `scripts/xerp-worker-registration-sync.test.mjs`

**Purpose**

Detect XERP worker-registration workbook files in Downloads without touching browser automation yet. This gives the UI a reliable first import path and provides the file layer used by browser automation.

**Test first**

- [ ] Add `scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Test that file names beginning with `근로자 등록_` and ending in `.xlsx` or `.xls` are accepted.
- [ ] Test that temp Office lock files beginning with `~$` are ignored.
- [ ] Test that the latest modified workbook is selected.
- [ ] Test that `startedAtMs` filters out older files.
- [ ] Test that the selected file is returned as base64 with size and modified time.

Use this test shape:

```js
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isWorkerRegistrationWorkbookName,
  scanWorkerRegistrationDownloads,
  selectLatestWorkerRegistrationFile,
} from "./xerp-worker-registration-sync.mjs";

describe("xerp-worker-registration-sync file scanner", () => {
  it("recognizes XERP worker-registration workbook names", () => {
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xlsx")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xls")).toBe(true);
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
      expect(Buffer.from(result.base64, "base64").toString("utf8")).toBe("new");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no matching workbook exists", () => {
    expect(selectLatestWorkerRegistrationFile([])).toBeNull();
  });
});
```

**Implementation**

- [ ] Export `DEFAULT_XERP_WORKER_REGISTRATION_PORT = 8791`.
- [ ] Export `DEFAULT_DOWNLOADS_DIR`.
- [ ] Export `isWorkerRegistrationWorkbookName(fileName)`.
- [ ] Export `collectWorkerRegistrationCandidates({ downloadsDir, startedAtMs })`.
- [ ] Export `selectLatestWorkerRegistrationFile(candidates)`.
- [ ] Export `scanWorkerRegistrationDownloads({ downloadsDir, startedAtMs })`.
- [ ] Do not start the HTTP server during tests unless `process.argv[1]` is the script path.

Implementation shape:

```js
import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyCorsHeaders, handleCorsPreflight } from "./local-service-cors.mjs";

export const DEFAULT_XERP_WORKER_REGISTRATION_PORT = 8791;
export const DEFAULT_DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Downloads")
  : path.join(os.homedir(), "Downloads");

const WORKER_REGISTRATION_WORKBOOK_RE = /^근로자\s*등록_.*\.(xlsx|xls)$/i;

export function isWorkerRegistrationWorkbookName(fileName) {
  return !fileName.startsWith("~$") && WORKER_REGISTRATION_WORKBOOK_RE.test(fileName);
}

export async function collectWorkerRegistrationCandidates({ downloadsDir, startedAtMs = 0 }) {
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

export async function scanWorkerRegistrationDownloads({ downloadsDir = DEFAULT_DOWNLOADS_DIR, startedAtMs = 0 } = {}) {
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
```

**Verify**

- [ ] Run `npm test -- scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Commit after passing:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs
git commit -m "feat: scan xerp worker registration downloads"
```

---

## Task 3: Add Local Helper HTTP Endpoints

**Files**

- Modify: `scripts/xerp-worker-registration-sync.mjs`
- Modify: `scripts/xerp-worker-registration-sync.test.mjs`

**Purpose**

Expose local endpoints used by the Vite app. The helper must be useful before browser automation is fully exercised: it can report status, start an import session timestamp, and return the newest downloaded worker-registration workbook.

**Endpoints**

- `GET /xerp-worker-registration/status`
  - Response: `{ ok: true, downloadsDir, port, sites }`
- `POST /xerp-worker-registration/download`
  - Body: `{ site: "PH4" | "PH2" }`
  - Response: `{ ok: true, site, siteName, startedAtMs, mode }`
  - In this task, `mode` is `"download-folder-watch"`.
- `GET /xerp-worker-registration/latest?site=PH4&startedAtMs=1770000000000`
  - Response when found: `{ ok: true, site, file }`
  - Response when missing: `{ ok: true, site, file: null }`

**Test first**

- [ ] Add HTTP tests that start the server on port `0`.
- [ ] Test `/status`.
- [ ] Test `POST /download` rejects an unsupported site.
- [ ] Test `/latest` returns a base64 workbook when a matching file exists.
- [ ] Test CORS preflight is handled.

Use this test shape:

```js
import { afterEach, describe, expect, it } from "vitest";
import { startXerpWorkerRegistrationServer } from "./xerp-worker-registration-sync.mjs";

const servers = [];

afterEach(async () => {
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

async function startTestServer(options) {
  const server = await startXerpWorkerRegistrationServer({ ...options, port: 0 });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
```

**Implementation**

- [ ] Add site validation inside the Node script:

```js
export const XERP_WORKER_REGISTRATION_SITES = {
  PH4: { key: "PH4", label: "P4-PH4", xerpSiteName: "평택 P4-PH4 초순수" },
  PH2: { key: "PH2", label: "P4-PH2", xerpSiteName: "평택 P4-PH2 초순수" },
};

export function normalizeXerpWorkerRegistrationSite(value) {
  return value === "PH4" || value === "PH2" ? value : null;
}
```

- [ ] Add JSON helpers:

```js
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
```

- [ ] Add `createXerpWorkerRegistrationRequestHandler({ downloadsDir })`.
- [ ] Add `startXerpWorkerRegistrationServer({ downloadsDir, port })`.
- [ ] Only call `startXerpWorkerRegistrationServer()` at module entry:

```js
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startXerpWorkerRegistrationServer().then((server) => {
    const address = server.address();
    console.log(`[xerp-worker-registration] listening on http://127.0.0.1:${address.port}`);
    console.log(`[xerp-worker-registration] downloads dir: ${DEFAULT_DOWNLOADS_DIR}`);
  });
}
```

**Verify**

- [ ] Run `npm test -- scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Run `node scripts/xerp-worker-registration-sync.mjs`.
- [ ] In another PowerShell window, run:

```powershell
Invoke-RestMethod http://127.0.0.1:8791/xerp-worker-registration/status
```

- [ ] Stop the local script with Ctrl+C.
- [ ] Commit after passing:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs
git commit -m "feat: serve xerp worker registration files locally"
```

---

## Task 4: Add Frontend Local XERP Client

**Files**

- Create: `src/lib/localXerpWorkerRegistrationClient.ts`
- Create: `src/lib/localXerpWorkerRegistrationClient.test.ts`

**Purpose**

Give React components a small typed API for the local helper. Keep base URL configuration in one place.

**Test first**

- [ ] Mock `fetch` with `vi.stubGlobal`.
- [ ] Test that `fetchXerpWorkerRegistrationStatus()` calls `/status`.
- [ ] Test that `requestXerpWorkerRegistrationDownload("PH4")` posts `{ site: "PH4" }`.
- [ ] Test that `fetchLatestXerpWorkerRegistrationFile("PH2", startedAtMs)` includes query params.
- [ ] Test that non-2xx responses throw Korean user-facing errors.
- [ ] Test base URL override through localStorage.

**Implementation**

Add this API:

```ts
import type { XerpWorkerRegistrationSite } from "./xerpWorkerRegistration";

export const DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL = "http://127.0.0.1:8791";
export const XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY =
  "worksite-radar:xerp-worker-registration-server-url";

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

export function getXerpWorkerRegistrationServerUrl() {
  if (typeof window === "undefined") return DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL;
  return (
    window.localStorage.getItem(XERP_WORKER_REGISTRATION_SERVER_URL_STORAGE_KEY) ||
    DEFAULT_XERP_WORKER_REGISTRATION_SERVER_URL
  );
}

export function decodeBase64Workbook(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
```

Implement fetch helpers with:

```ts
async function readJsonOrThrow<T>(response: Response, actionLabel: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${actionLabel} 실패: 로컬 XERP 연동 서버 응답 ${response.status}`);
  }
  return response.json() as Promise<T>;
}
```

**Verify**

- [ ] Run `npm test -- src/lib/localXerpWorkerRegistrationClient.test.ts`.
- [ ] Commit after passing:

```powershell
git add src/lib/localXerpWorkerRegistrationClient.ts src/lib/localXerpWorkerRegistrationClient.test.ts
git commit -m "feat: add local xerp worker registration client"
```

---

## Task 5: Wire XERP Import Into `NewEmployeeList`

**Files**

- Modify: `src/components/NewEmployeeList.tsx`
- Modify: `src/components/NewEmployeeList.test.ts`

**Purpose**

Add a visible `XERP 가져오기` path for PH4 and PH2 tabs. The UI asks the local helper for the latest worker-registration workbook, parses it with the existing Excel mapping, shows a summary, and saves only after the user confirms.

**Test first**

- [ ] Add unit tests around import summary logic using `summarizeXerpWorkerRegistrationRows`.
- [ ] Add source-level regression tests that exported parser behavior still maps:
  - `성명` to `이름`
  - `연락처` to `연락처`
  - `소속팀` to `팀`
  - `직종` to `직종`
  - `직급` to `직책`
  - `노임` to `단가변동`
- [ ] Keep the existing duplicate-name tests passing.

**Implementation**

- [ ] Import the new helpers:

```ts
import {
  decodeBase64Workbook,
  fetchLatestXerpWorkerRegistrationFile,
  requestXerpWorkerRegistrationDownload,
} from "@/lib/localXerpWorkerRegistrationClient";
import {
  getXerpWorkerRegistrationSite,
  summarizeXerpWorkerRegistrationRows,
  type XerpWorkerRegistrationSite,
} from "@/lib/xerpWorkerRegistration";
```

- [ ] Extend `EmployeeTabContentProps`:

```ts
xerpSite?: XerpWorkerRegistrationSite;
```

- [ ] Pass the site only to the two supported tabs:

```tsx
<EmployeeTabContent
  tabKey="PH4"
  siteLabel="P4-PH4"
  xerpSite="PH4"
  ...
/>

<EmployeeTabContent
  tabKey="PH2"
  siteLabel="P4-PH2"
  xerpSite="PH2"
  ...
/>

<EmployeeTabContent
  tabKey="P5PH1"
  siteLabel="P5-PH1"
  ...
/>
```

- [ ] Add component state:

```ts
const [xerpImporting, setXerpImporting] = useState(false);
const [pendingXerpImport, setPendingXerpImport] = useState<null | {
  fileName: string;
  rows: NewEmployee[];
  summary: ReturnType<typeof summarizeXerpWorkerRegistrationRows>;
}>(null);
const [xerpImportMessage, setXerpImportMessage] = useState<string | null>(null);
```

- [ ] Add `handleXerpImport()`:

```ts
const handleXerpImport = async () => {
  if (!xerpSite) return;
  setXerpImporting(true);
  setXerpImportMessage(null);

  try {
    const downloadSession = await requestXerpWorkerRegistrationDownload(xerpSite);
    const latest = await fetchLatestXerpWorkerRegistrationFile(xerpSite, downloadSession.startedAtMs);

    if (!latest.file) {
      const site = getXerpWorkerRegistrationSite(xerpSite);
      setXerpImportMessage(
        `${site.xerpSiteName} 근로자 등록 엑셀을 찾지 못했습니다. XERP에서 엑셀을 다운로드한 뒤 다시 가져오세요.`,
      );
      return;
    }

    const workbook = XLSX.read(decodeBase64Workbook(latest.file.base64), { type: "array" });
    const importedRows = sanitizeEmployeeRows(parseImportedSheet(workbook));
    setPendingXerpImport({
      fileName: latest.file.fileName,
      rows: importedRows,
      summary: summarizeXerpWorkerRegistrationRows(importedRows),
    });
  } catch (error) {
    setXerpImportMessage(error instanceof Error ? error.message : "XERP 가져오기에 실패했습니다.");
  } finally {
    setXerpImporting(false);
  }
};
```

- [ ] Add `applyPendingXerpImport()`:

```ts
const applyPendingXerpImport = async () => {
  if (!pendingXerpImport) return;
  setRows(pendingXerpImport.rows);
  await onSave(pendingXerpImport.rows);
  setPendingXerpImport(null);
  setXerpImportMessage(`${pendingXerpImport.fileName} 적용 완료`);
};
```

- [ ] Add the button beside the existing Excel upload control only when `xerpSite` exists:

```tsx
{xerpSite && (
  <Button type="button" variant="outline" onClick={handleXerpImport} disabled={xerpImporting}>
    {xerpImporting ? "가져오는 중..." : "XERP 가져오기"}
  </Button>
)}
```

- [ ] Add a compact confirmation modal rendered only when `pendingXerpImport` exists:
  - Title: `XERP 근로자 명단 적용`
  - Body fields:
    - 파일명
    - 전체 인원
    - 재직
    - 퇴직
    - 동명이인 그룹
  - Buttons:
    - `취소`
    - `적용`

Use existing project UI primitives if present in this file. If this file has no dialog primitive, add a local fixed overlay with existing button styles.

**Verify**

- [ ] Run `npm test -- src/components/NewEmployeeList.test.ts src/lib/xerpWorkerRegistration.test.ts src/lib/localXerpWorkerRegistrationClient.test.ts`.
- [ ] Run `npm run build`.
- [ ] Commit after passing:

```powershell
git add src/components/NewEmployeeList.tsx src/components/NewEmployeeList.test.ts
git commit -m "feat: import worker list from local xerp helper"
```

---

## Task 6: Add Playwright Browser Automation to the Local Helper

**Files**

- Modify: `scripts/xerp-worker-registration-sync.mjs`
- Modify: `scripts/xerp-worker-registration-sync.test.mjs`
- Create: `docs/xerp-worker-registration-local-helper.md`

**Purpose**

Make `/download` launch a dedicated visible Chromium profile for XERP, navigate to the worker-registration screen, select the requested site, and click `엑셀`. The user logs in through this helper-owned browser profile when XERP asks for credentials.

**Test first**

- [ ] Unit test pure selector helpers without opening XERP:
  - `buildXerpWorkerRegistrationUrl()`
  - `getXerpProfileDir()`
  - `createDownloadSession(site)`
  - `isLoginLikelyRequired(textSnapshot)`
- [ ] Keep HTTP tests for `/download` by injecting a fake automation function.

**Implementation**

- [ ] Import Playwright:

```js
import { chromium } from "playwright";
```

- [ ] Add constants:

```js
export const XERP_MAIN_URL = "https://hansung.xerp.co.kr/com/actionMain.do#";
export const DEFAULT_XERP_PROFILE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "worksite-radar",
  "xerp-worker-registration-profile",
);
```

- [ ] Add `launchXerpContext({ downloadsDir, profileDir })`:

```js
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
```

- [ ] Add `openWorkerRegistrationPage(page)`:

```js
export async function openWorkerRegistrationPage(page) {
  await page.goto(XERP_MAIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (isLoginLikelyRequired(bodyText)) {
    return { status: "login-required" };
  }

  await clickTextInAnyFrame(page, "노무관리");
  await clickTextInAnyFrame(page, "근로자관리");
  await clickTextInAnyFrame(page, "근로자 등록");
  return { status: "ready" };
}
```

- [ ] Add a frame-aware helper:

```js
export async function clickTextInAnyFrame(page, text) {
  const frames = page.frames();
  let lastError = null;
  for (const frame of frames) {
    try {
      const locator = frame.getByText(text, { exact: true }).first();
      await locator.click({ timeout: 3000 });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`XERP 화면에서 '${text}' 버튼을 찾지 못했습니다: ${lastError?.message || "unknown error"}`);
}
```

- [ ] Add `selectXerpSiteInAnyFrame(page, siteDefinition)`:
  - Search all frames for a select, input, combobox, or visible text around `현장명`.
  - First try standard `<select>` elements with option text matching `siteDefinition.xerpSiteName`.
  - Then try clicking visible text `전체` near `현장명` and selecting `siteDefinition.xerpSiteName`.
  - Throw a Korean error that names the missing site if selection fails.

- [ ] Add `downloadWorkerRegistrationWorkbook({ site, downloadsDir })`:

```js
export async function downloadWorkerRegistrationWorkbook({ site, downloadsDir = DEFAULT_DOWNLOADS_DIR } = {}) {
  const siteDefinition = XERP_WORKER_REGISTRATION_SITES[site];
  const startedAtMs = Date.now();
  const { context, page } = await launchXerpContext({ downloadsDir });

  try {
    const openResult = await openWorkerRegistrationPage(page);
    if (openResult.status === "login-required") {
      return {
        ok: true,
        site,
        siteName: siteDefinition.xerpSiteName,
        startedAtMs,
        mode: "login-required",
      };
    }

    await selectXerpSiteInAnyFrame(page, siteDefinition);
    await clickTextInAnyFrame(page, "조회");
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
    await clickTextInAnyFrame(page, "엑셀");
    const download = await downloadPromise;
    if (download) {
      const suggestedName = download.suggestedFilename();
      await download.saveAs(path.join(downloadsDir, suggestedName));
    }

    return {
      ok: true,
      site,
      siteName: siteDefinition.xerpSiteName,
      startedAtMs,
      mode: "browser-automation",
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
```

- [ ] Update `/download` to call `downloadWorkerRegistrationWorkbook`.
- [ ] Add dependency check: if Playwright browser binaries are missing, return an error telling the user to run `npx playwright install chromium`.
- [ ] Add `docs/xerp-worker-registration-local-helper.md` with:
  - How to start: `npm run xerp:worker`
  - How login works
  - Supported sites
  - What to do when XERP asks for login
  - Why P5-PH1 is excluded

**Manual verification**

- [ ] Start the helper: `npm run xerp:worker`.
- [ ] Open the app dev server.
- [ ] Click `XERP 가져오기` on PH4.
- [ ] If XERP login appears, the user logs in in the visible helper browser.
- [ ] Click `XERP 가져오기` again on PH4.
- [ ] Confirm a new `근로자 등록_*.xlsx` appears in Downloads.
- [ ] Confirm the app shows the import summary.
- [ ] Repeat for PH2.

**Verify**

- [ ] Run `npm test -- scripts/xerp-worker-registration-sync.test.mjs`.
- [ ] Run `npm run build`.
- [ ] Commit after passing:

```powershell
git add scripts/xerp-worker-registration-sync.mjs scripts/xerp-worker-registration-sync.test.mjs docs/xerp-worker-registration-local-helper.md
git commit -m "feat: automate xerp worker registration download"
```

---

## Task 7: Add Dev Scripts and Service Launcher Integration

**Files**

- Modify: `package.json`
- Modify: `scripts/dev-with-services.mjs`

**Purpose**

Make the helper easy to start, both by itself and with the normal dev environment.

**Test first**

- [ ] Inspect current `scripts/dev-with-services.mjs` service list.
- [ ] Add a small unit-free smoke check by running the script briefly and confirming it logs the XERP helper URL.

**Implementation**

- [ ] Add package scripts:

```json
{
  "xerp:worker": "node scripts/xerp-worker-registration-sync.mjs",
  "playwright:install": "playwright install chromium"
}
```

- [ ] In `scripts/dev-with-services.mjs`, add a service entry for:

```js
{
  name: "xerp-worker-registration",
  command: process.execPath,
  args: ["scripts/xerp-worker-registration-sync.mjs"],
}
```

- [ ] Keep existing attendance watcher and RCM services unchanged.

**Verify**

- [ ] Run `npm run xerp:worker`.
- [ ] Confirm the console logs `http://127.0.0.1:8791`.
- [ ] Stop with Ctrl+C.
- [ ] Run `npm run dev:services` if that script exists in `package.json`; otherwise run the existing local-services script name shown in `package.json`.
- [ ] Commit after passing:

```powershell
git add package.json scripts/dev-with-services.mjs
git commit -m "chore: start xerp worker helper with dev services"
```

---

## Task 8: End-to-End Verification and Production Push

**Purpose**

Verify the local helper path, app parsing, duplicate-name display, and save behavior before pushing to `main`.

**Automated checks**

- [ ] Run:

```powershell
npm test -- src/components/NewEmployeeList.test.ts src/lib/xerpWorkerRegistration.test.ts src/lib/localXerpWorkerRegistrationClient.test.ts scripts/xerp-worker-registration-sync.test.mjs
npm run build
```

**Manual checks**

- [ ] Start local services:

```powershell
npm run xerp:worker
```

- [ ] Start the app:

```powershell
npm run dev
```

- [ ] In the app, open `기술인 및 관리자 명단`.
- [ ] On the PH4 tab:
  - Click `XERP 가져오기`.
  - Log in to XERP in the visible helper browser if prompted.
  - Click `XERP 가져오기` again after login.
  - Confirm the import summary appears.
  - Confirm duplicate names show the `동명이인` badge after applying.
- [ ] On the PH2 tab:
  - Repeat the same flow.
- [ ] On the P5-PH1 tab:
  - Confirm no `XERP 가져오기` button is shown.
- [ ] Confirm manual Excel upload still works with `C:\Users\bongryong\Downloads\근로자 등록_10037_20260630132922.xlsx`.

**Git**

- [ ] Review changed files:

```powershell
git status --short
git diff --stat origin/main...HEAD
```

- [ ] Push the feature branch:

```powershell
git push -u origin codex/xerp-worker-registration-automation
```

- [ ] If the user wants this live immediately, cherry-pick the completed implementation commits to `main` from a clean worktree and push `main`, matching the previous production update workflow.

**Production smoke check after push to main**

- [ ] Open `https://worksite-radar.vercel.app/`.
- [ ] Confirm the deployed JS bundle contains the `XERP 가져오기` label.
- [ ] Confirm the UI still shows `동명이인` for duplicate names.
- [ ] Confirm the live app explains local helper connection failure clearly when `npm run xerp:worker` is not running.

---

## Rollback

- If UI import causes issues, revert only the UI/client commits:

```powershell
git revert <commit-for-ui-import> <commit-for-local-client>
```

- If local helper automation is brittle but file import works, keep Tasks 1-5 and revert Task 6 only.
- Manual Excel upload remains the operational fallback throughout the rollout.
