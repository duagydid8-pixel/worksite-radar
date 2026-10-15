# XERP Daily Attendance Summary Import Design

## Goal

Add an XERP import path for `출역관리 > 일일출역집계` and connect it to the existing `XERP & PMIS` screen.

The user flow is:

1. Open `XERP & PMIS`.
2. Select a site and an `업로드 날짜`.
3. Click `XERP 가져오기`.
4. The local helper opens or reuses the XERP browser profile.
5. The helper navigates to `출역관리 > 일일출역집계`.
6. The helper selects the matching XERP site and the selected date.
7. The helper downloads the Excel file.
8. The web app parses the workbook with the existing `XerpPmisTable` parser and saves it to the selected date.

## Scope

Supported sites:

- `PH4`: `평택 P4-PH4 초순수`
- `PH2`: `평택 P4-PH2 초순수`

Excluded site:

- `P5-PH1`, because the user already confirmed it uses different credentials.

Supported destination:

- Existing `XERP & PMIS` date map storage through `loadXerpFS/saveXerpFS` for PH4 and `loadXerpPH2FS/saveXerpPH2FS` for PH2.

Selected date rule:

- Use the `업로드 날짜` value from `XERP & PMIS` as the XERP 조회 date.
- If the downloaded file name contains a date, the UI still saves under the user-selected `업로드 날짜`, because the user explicitly confirmed this behavior.

## Existing Context

The app already has:

- `src/components/XerpPmisTable.tsx`
  - Parses uploaded daily summary workbooks with `parseSheet`.
  - Saves rows by date in `dateMap`.
  - Supports manual file upload and folder import.
- `src/lib/xerpPmisDates.ts`
  - Extracts dates from names such as `일일출력_20260316_평택 P4-Ph4 초순수.xlsx`.
- `scripts/xerp-worker-registration-sync.mjs`
  - Local HTTP helper on `127.0.0.1:8791`.
  - Playwright persistent browser profile for XERP login without storing credentials.
  - PH4/PH2 site definitions and frame-aware text clicking helpers.
- `src/lib/localXerpWorkerRegistrationClient.ts`
  - Frontend client for the local helper.

This feature should extend the local XERP helper rather than create a second local service, because both XERP imports share the same login profile, site definitions, Downloads folder, and CORS needs.

## Architecture

### Local Helper

Extend `scripts/xerp-worker-registration-sync.mjs` into a broader XERP local helper while keeping current worker-registration endpoints compatible.

Add daily-summary endpoints under a separate namespace:

- `GET /xerp-daily-attendance/status`
- `POST /xerp-daily-attendance/download`
- `GET /xerp-daily-attendance/latest`

Request body for `/download`:

```json
{
  "site": "PH4",
  "date": "2026-06-30"
}
```

Successful response:

```json
{
  "ok": true,
  "site": "PH4",
  "siteName": "평택 P4-PH4 초순수",
  "date": "2026-06-30",
  "startedAtMs": 1782800000000,
  "mode": "browser-automation"
}
```

If XERP login is required:

```json
{
  "ok": true,
  "site": "PH4",
  "siteName": "평택 P4-PH4 초순수",
  "date": "2026-06-30",
  "startedAtMs": 1782800000000,
  "mode": "login-required"
}
```

The helper must not store or request XERP credentials. It only launches a visible Playwright Chromium profile and lets the user log in.

### Browser Automation

Add a daily-summary automation function:

```js
downloadDailyAttendanceSummaryWorkbook({ site, date, downloadsDir })
```

Automation sequence:

1. Launch persistent XERP Chromium profile.
2. Go to `https://hansung.xerp.co.kr/com/actionMain.do#`.
3. If the page looks like a login screen, return `mode: "login-required"`.
4. Click `출역관리`.
5. Click `일일출역집계`.
6. Select the requested site.
7. Set the date field to the requested date.
8. Click `조회`.
9. Click `엑셀`.
10. Save the downloaded workbook to Downloads.

Because XERP is a live legacy app, selectors must be frame-aware and text-first, matching the existing worker-registration helper pattern.

### File Detection

Add file-name detection for daily summary workbooks:

- Accept names containing `일일출역`, `일일출력`, or `일일출역집계`.
- Accept `.xlsx` and `.xls`.
- Ignore Office lock files beginning with `~$`.
- Prefer files modified after `startedAtMs`.
- Prefer files whose extracted date matches the requested date when possible.
- Return base64 payload and metadata to the app.

### Frontend Client

Add a new client module or extend the existing local XERP client with daily-summary functions:

- `requestXerpDailyAttendanceDownload(site, date)`
- `fetchLatestXerpDailyAttendanceFile(site, date, startedAtMs)`
- `decodeBase64Workbook(base64)`

Use the same base URL and localStorage setting as the current XERP worker-registration client so users do not configure two helper URLs.

### XERP & PMIS UI

In `src/components/XerpPmisTable.tsx`:

- Show `XERP 가져오기` only for PH4 and PH2.
- Place it near the existing `업로드 날짜`, `업로드`, and folder import controls.
- Use `uploadDate` as the XERP 조회 date.
- After the file is received:
  - Parse it with existing `parseSheet`.
  - Save rows under `uploadDate`.
  - Move `selectedDate` to `uploadDate`.
  - Show a toast with imported row count and file name.
- If XERP asks for login:
  - Show a toast instructing the user to log in in the opened XERP browser, then click `XERP 가져오기` again.
- If no downloaded workbook is found:
  - Show a clear toast naming the date and site.

Do not change manual upload, folder upload, export, memo, safety education, or perfect-attendance behavior.

## Data Flow

```text
XerpPmisTable uploadDate + site
  -> local XERP client POST /xerp-daily-attendance/download
  -> Playwright XERP browser download
  -> local helper GET /xerp-daily-attendance/latest
  -> base64 workbook
  -> XLSX.read
  -> parseSheet
  -> dateMap[uploadDate] = importedRows
  -> saveXerp(dateMap)
```

## Error Handling

- Local helper not running:
  - Frontend shows local helper connection error.
- XERP login required:
  - Frontend says login in the visible XERP browser and retry.
- Site unsupported:
  - Frontend blocks P5-PH1 by hiding the button; helper also rejects unsupported site.
- Date invalid:
  - Frontend validates `YYYY-MM-DD`; helper rejects invalid date.
- Download not found:
  - Helper returns `file: null`; frontend explains the specific date/site was not found.
- Parse result empty:
  - Frontend does not overwrite saved data and shows an error.
- Save failure:
  - Frontend keeps imported rows out of Firestore and shows save failure.

## Testing

Use TDD.

Add tests for:

- Daily summary file-name recognition.
- Latest-file selection by date and modified time.
- Daily summary helper endpoint validation.
- Frontend local client URL/body/error behavior.
- `XerpPmisTable` source-level wiring:
  - PH4 and PH2 allow daily XERP import.
  - P5-PH1 does not expose the button.
  - `uploadDate` is passed as the requested date.
- Existing `XerpPmisTable` parser behavior remains unchanged.

Manual verification:

- Start helper with `npm run xerp:worker`.
- Open live or local app.
- Go to `XERP & PMIS`.
- Select PH4 and an upload date.
- Click `XERP 가져오기`.
- Log in if prompted.
- Retry import.
- Confirm the selected date gets saved rows.
- Repeat for PH2.
- Confirm P5-PH1 has no `XERP 가져오기` button.

## Rollout

Ship on a feature branch first, run tests and build, then push to `main` so Vercel production updates.

The existing manual upload path remains the fallback if XERP DOM automation needs selector adjustment.
