# Annual Leave Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible attendance-management workflow with a dedicated annual leave management workflow that imports a simple roster, calculates monthly leave accrual, records leave usage in-app, and persists annual leave data to Firestore.

**Architecture:** Add a focused annual-leave domain module for roster parsing and calculations, a Firestore service for annual leave roster and usage records, and a new `AnnualLeaveManagementPage` component. Keep the old attendance internals available for dependent payroll/XERP/home flows while changing the visible navigation entry from `근태관리` to `연차관리`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Firebase Firestore, XLSX, Tailwind/shadcn UI patterns, lucide-react icons.

---

## File Structure

- Create `src/lib/annualLeaveManagement.ts`
  - Owns annual-leave types, roster workbook parsing, accrual calculation, usage totals, derived status rows, and export helpers.
- Create `src/lib/annualLeaveManagement.test.ts`
  - Covers parser, accrual, usage totals, and derived status rows.
- Modify `src/lib/firestoreService.ts`
  - Adds annual-leave-specific load/save wrappers using the existing `fsGet`/`fsSet` style.
- Create `src/lib/annualLeaveFirestore.test.ts`
  - Tests Firestore payload preparation through a small pure serializer exported from the service layer.
- Create `src/components/AnnualLeaveManagementPage.tsx`
  - New operational screen for roster upload, summary cards, employee status table, usage form, usage list, and employee detail.
- Create `src/components/AnnualLeaveManagementPage.test.tsx`
  - Tests usage entry updates derived totals and labels render.
- Modify `src/pages/Index.tsx`
  - Renames visible `근태관리` to `연차관리`, removes visible attendance sub-tabs, and renders the new annual leave page.

## Task 1: Annual Leave Domain Module

**Files:**
- Create: `src/lib/annualLeaveManagement.test.ts`
- Create: `src/lib/annualLeaveManagement.ts`

- [ ] **Step 1: Write failing tests for roster parsing, accrual, and usage totals**

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  calculateAccruedLeave,
  deriveLeaveStatusRows,
  getUsageDays,
  parseAnnualLeaveRosterWorkbook,
} from "./annualLeaveManagement";

function makeRosterWorkbook() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["소속프로젝트", "구분", "이름", "부서", "입사일"],
    ["P4-PH4", "현재직", "홍길동", "공무", "2026-03-15"],
    ["P4-PH4", "서드파트", "김반차", "안전", "2026.04.01"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "명단");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("annual leave management", () => {
  it("parses the minimal roster workbook", () => {
    const result = parseAnnualLeaveRosterWorkbook(makeRosterWorkbook());
    expect(result.employees).toMatchObject([
      { project: "P4-PH4", category: "현재직", name: "홍길동", department: "공무", hireDate: "2026-03-15" },
      { project: "P4-PH4", category: "서드파트", name: "김반차", department: "안전", hireDate: "2026-04-01" },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("reports missing roster headers", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["이름"], ["홍길동"]]);
    XLSX.utils.book_append_sheet(wb, ws, "명단");
    const result = parseAnnualLeaveRosterWorkbook(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
    expect(result.errors.join("\n")).toContain("소속프로젝트");
    expect(result.employees).toEqual([]);
  });

  it("counts one accrued day from the hire month", () => {
    expect(calculateAccruedLeave("2026-03-15", "2026-03-31")).toBe(1);
    expect(calculateAccruedLeave("2026-03-15", "2026-04-01")).toBe(2);
    expect(calculateAccruedLeave("2026-05-01", "2026-04-30")).toBe(0);
  });

  it("uses full day and half day values", () => {
    expect(getUsageDays("연차")).toBe(1);
    expect(getUsageDays("오전반차")).toBe(0.5);
    expect(getUsageDays("오후반차")).toBe(0.5);
  });

  it("derives used and remaining leave per employee", () => {
    const roster = parseAnnualLeaveRosterWorkbook(makeRosterWorkbook()).employees;
    const rows = deriveLeaveStatusRows(roster, [
      { id: "u1", date: "2026-04-10", employeeId: roster[0].id, employeeName: "홍길동", type: "연차", days: 1, memo: "", createdAt: "2026-04-10T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z" },
      { id: "u2", date: "2026-04-11", employeeId: roster[0].id, employeeName: "홍길동", type: "오전반차", days: 0.5, memo: "", createdAt: "2026-04-11T00:00:00.000Z", updatedAt: "2026-04-11T00:00:00.000Z" },
    ], "2026-04-30");
    expect(rows[0]).toMatchObject({ accrued: 2, used: 1.5, remaining: 0.5 });
  });
});
```

- [ ] **Step 2: Run the domain test to verify RED**

Run: `npm test -- src/lib/annualLeaveManagement.test.ts`

Expected: FAIL because `src/lib/annualLeaveManagement.ts` does not exist.

- [ ] **Step 3: Implement the domain module**

Implement:

- `LeaveManagedEmployee`
- `LeaveUsageType`
- `LeaveUsage`
- `parseAnnualLeaveRosterWorkbook`
- `calculateAccruedLeave`
- `getUsageDays`
- `deriveLeaveStatusRows`
- `buildLeaveUsage`
- `buildAnnualLeaveExportWorkbook`

- [ ] **Step 4: Run the domain test to verify GREEN**

Run: `npm test -- src/lib/annualLeaveManagement.test.ts`

Expected: PASS.

## Task 2: Firestore Annual Leave Service

**Files:**
- Create: `src/lib/annualLeaveFirestore.test.ts`
- Modify: `src/lib/firestoreService.ts`

- [ ] **Step 1: Write failing Firestore serialization tests**

```ts
import { describe, expect, it } from "vitest";
import { prepareAnnualLeavePayload } from "./firestoreService";

describe("annual leave Firestore payload", () => {
  it("serializes roster and usage without undefined fields", () => {
    const payload = prepareAnnualLeavePayload({
      employees: [
        {
          id: "e1",
          project: "P4-PH4",
          category: "현재직",
          name: "홍길동",
          department: "공무",
          hireDate: "2026-03-15",
          sourceRow: 2,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      usages: [
        {
          id: "u1",
          date: "2026-04-10",
          employeeId: "e1",
          employeeName: "홍길동",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        },
      ],
      uploadedAt: "2026-04-11T00:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("undefined");
    expect(payload.roster.employees[0].name).toBe("홍길동");
    expect(payload.usages.items[0].days).toBe(1);
  });
});
```

- [ ] **Step 2: Run the Firestore test to verify RED**

Run: `npm test -- src/lib/annualLeaveFirestore.test.ts`

Expected: FAIL because `prepareAnnualLeavePayload` is not exported.

- [ ] **Step 3: Implement annual leave Firestore functions**

Add to `src/lib/firestoreService.ts`:

- `prepareAnnualLeavePayload`
- `saveAnnualLeaveManagementFS`
- `loadAnnualLeaveManagementFS`

Use `fsSet("annual_leave_roster", ...)` and `fsSet("annual_leave_usages", ...)` to match existing document helper patterns.

- [ ] **Step 4: Run the Firestore test to verify GREEN**

Run: `npm test -- src/lib/annualLeaveFirestore.test.ts`

Expected: PASS.

## Task 3: Annual Leave Management Page

**Files:**
- Create: `src/components/AnnualLeaveManagementPage.test.tsx`
- Create: `src/components/AnnualLeaveManagementPage.tsx`

- [ ] **Step 1: Write failing component tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnnualLeaveManagementPage from "./AnnualLeaveManagementPage";

describe("AnnualLeaveManagementPage", () => {
  it("renders the annual leave workflow labels", () => {
    render(<AnnualLeaveManagementPage isAdmin={true} />);
    expect(screen.getByText("연차관리")).toBeInTheDocument();
    expect(screen.getByText("직원별 연차 현황")).toBeInTheDocument();
    expect(screen.getByText("연차 사용 입력")).toBeInTheDocument();
  });

  it("adds a usage record and updates summary from initial data", () => {
    render(
      <AnnualLeaveManagementPage
        isAdmin={true}
        initialEmployees={[
          {
            id: "e1",
            project: "P4-PH4",
            category: "현재직",
            name: "홍길동",
            department: "공무",
            hireDate: "2026-03-15",
            sourceRow: 2,
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
          },
        ]}
        initialUsages={[]}
        initialBasisDate="2026-04-30"
      />
    );
    fireEvent.change(screen.getByLabelText("사용일"), { target: { value: "2026-04-10" } });
    fireEvent.change(screen.getByLabelText("직원"), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText("구분"), { target: { value: "오전반차" } });
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "병원" } });
    fireEvent.click(screen.getByRole("button", { name: "사용내역 추가" }));
    expect(screen.getByText("병원")).toBeInTheDocument();
    expect(screen.getByText("0.5일")).toBeInTheDocument();
    expect(screen.getByTestId("remaining-e1")).toHaveTextContent("1.5");
  });
});
```

- [ ] **Step 2: Run component tests to verify RED**

Run: `npm test -- src/components/AnnualLeaveManagementPage.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `AnnualLeaveManagementPage`**

Implement compact operational UI:

- Header with `연차관리`.
- Admin-only roster upload and save button.
- Summary cards.
- Employee status table.
- Usage entry form.
- Usage list with edit/delete controls.
- Optional initial props for tests.
- Firestore load/save effects when not using initial props.

- [ ] **Step 4: Run component tests to verify GREEN**

Run: `npm test -- src/components/AnnualLeaveManagementPage.test.tsx`

Expected: PASS.

## Task 4: Navigation Wiring

**Files:**
- Modify: `src/pages/Index.tsx`
- Modify: `src/lib/navigationDisplay.test.ts` if label behavior needs a test update.

- [ ] **Step 1: Add or update navigation test coverage**

Search existing tests first with:

`rg -n "근태관리|연차관리|NAV_PUBLIC|navigation" src`

If no suitable render-level test exists, rely on the component test and TypeScript build for this wiring.

- [ ] **Step 2: Wire the new page**

Change:

- `ActiveTab` includes `연차관리` instead of visible `근태관리`.
- `NAV_PUBLIC` label/key uses `연차관리`.
- Guidance cards route to `연차관리`.
- Remove desktop/mobile visible attendance sub-tab controls.
- Render `<LazyAnnualLeaveManagementPage isAdmin={isAdmin} />` for `activeTab === "연차관리"`.

Do not delete old attendance parsing helpers or `AttendanceTable`.

- [ ] **Step 3: Run focused tests**

Run:

- `npm test -- src/lib/annualLeaveManagement.test.ts src/lib/annualLeaveFirestore.test.ts src/components/AnnualLeaveManagementPage.test.tsx`

Expected: PASS.

## Task 5: Verification

**Files:**
- No new files unless failures reveal a missing focused test.

- [ ] **Step 1: Run full relevant test suite**

Run: `npm test -- src/lib/annualLeaveManagement.test.ts src/lib/annualLeaveFirestore.test.ts src/components/AnnualLeaveManagementPage.test.tsx src/lib/navigationDisplay.test.ts`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Browser smoke check**

Open `http://127.0.0.1:5173`.

Verify:

- Top navigation shows `연차관리`.
- `근태관리` is no longer visible as the main workflow label.
- `연차관리` opens the new page.
- There is no `근태현황` / `연차현황` sub-tab selector in the new workflow.
- Usage input is visible for admin users.

