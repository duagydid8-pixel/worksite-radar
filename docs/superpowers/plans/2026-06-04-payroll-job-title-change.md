# Payroll Job Title Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `직종변경` submenu under `급여대장` that uploads a payroll workbook, normalizes job titles using the retirement deduction job list, and downloads the patched workbook.

**Architecture:** Put workbook parsing and xlsx XML patching in `src/lib/payrollJobTitleChanger.ts`, covered by Vitest. Add `src/components/PayrollJobTitleChangePage.tsx` for upload, summary, result table, and download. Wire the page into the existing payroll submenu in `src/pages/Index.tsx`.

**Tech Stack:** React, TypeScript, Vite, Vitest, `xlsx`, `jszip`, `lucide-react`, `sonner`.

---

### Task 1: Workbook Job Title Changer

**Files:**
- Create: `src/lib/payrollJobTitleChanger.ts`
- Test: `src/lib/payrollJobTitleChanger.test.ts`

- [ ] **Step 1: Write the failing test**

Create tests that build a minimal payroll workbook and a minimal job-list workbook. Assert that:

```ts
expect(summary.map((row) => [row.name, row.before, row.after])).toEqual([
  ["나경민", "공사관리자", "관리자"],
  ["이중현", "차량운행", "관리자"],
  ["김두형", "도비공", "보통인부"],
  ["신동민", "융착공", "보통인부"],
]);
```

Also assert that listed jobs such as `배관공`, `보통인부`, `신호수`, and `용접공` remain unchanged, and that the patched workbook reads back the changed `H` column values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/payrollJobTitleChanger.test.ts`

Expected: FAIL because `payrollJobTitleChanger.ts` does not exist.

- [ ] **Step 3: Implement the library**

Implement:

```ts
export interface PayrollJobTitleChange {
  sheetName: string;
  rowNumber: number;
  name: string;
  before: string;
  after: string;
  reason: "manager" | "not-in-job-list";
}

export interface PayrollJobTitleChangeResult {
  outputBuffer: ArrayBuffer;
  changes: PayrollJobTitleChange[];
  summary: { total: number; manager: number; fallback: number };
}

export function readJobTitleSet(buffer: ArrayBuffer): Set<string>;
export function resolvePayrollJobTitle(jobTitle: string, allowedJobTitles: Set<string>): string;
export async function changePayrollJobTitles(payrollBuffer: ArrayBuffer, jobListBuffer: ArrayBuffer): Promise<PayrollJobTitleChangeResult>;
```

Use the same XML patching pattern as existing payroll processors, but write string cells safely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/payrollJobTitleChanger.test.ts`

Expected: PASS.

### Task 2: 직종변경 React Page

**Files:**
- Create: `src/components/PayrollJobTitleChangePage.tsx`

- [ ] **Step 1: Build upload and result UI**

Create a page that:

- accepts only `.xlsx`
- reads the fixed job list from `/payroll-job-titles.xlsx`
- calls `changePayrollJobTitles`
- shows total, manager, and fallback counts
- shows changed rows in a table
- downloads `<original>_직종변경완료.xlsx`

- [ ] **Step 2: Add public job-list asset**

Copy `C:\Users\bongryong\Desktop\모음\염효양\7. 퇴직공제관리대장\양식\직종표.xlsx` to `public/payroll-job-titles.xlsx` so the deployed browser app can fetch it.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

### Task 3: Menu Wiring

**Files:**
- Modify: `src/pages/Index.tsx`

- [ ] **Step 1: Add lazy import and submenu option**

Add `LazyPayrollJobTitleChangePage`, extend `PayrollSubTab` with `직종변경`, and add a `FilePenLine` icon submenu option.

- [ ] **Step 2: Render the new page**

Change the payroll render expression so:

```tsx
{payrollSubTab === "급여대장보정" && <LazyPayrollPage />}
{payrollSubTab === "추가공수스캔" && <LazyAdditionalWorkScanPage />}
{payrollSubTab === "직종변경" && <LazyPayrollJobTitleChangePage />}
```

- [ ] **Step 3: Run focused tests and build**

Run:

```bash
npm test -- src/lib/payrollJobTitleChanger.test.ts
npm run build
```

Expected: both PASS.

### Task 4: Browser Verification and Publish

**Files:**
- No source edits unless verification exposes a bug.

- [ ] **Step 1: Start dev server**

Run: `npm run dev -- --host 127.0.0.1`

- [ ] **Step 2: Verify browser menu**

Open the local app and confirm the `급여대장` area shows `직종변경`.

- [ ] **Step 3: Commit and push**

Commit source, tests, asset, and plan. Push to `origin/main` after fast-forwarding main from the feature branch.
