# Annual Leave Management Redesign

Date: 2026-07-09

## Goal

Replace the current attendance-focused entry point with a dedicated `연차관리` workflow.

The new workflow uploads only the employee roster from Excel, calculates accrued leave inside the app, lets users enter leave usage directly in the UI, and persists roster and usage records to Firestore. Existing attendance, payroll, and XERP-related internals should remain available for other features, but the public navigation should no longer expose the old `근태현황` screen.

## User Decisions

- Top-level menu label: `연차관리`.
- Remove the visible `근태현황` flow from the main UI.
- Keep internal attendance logic and dependent payroll behavior intact.
- Build a new annual leave management screen rather than patching the old Excel-driven panel.
- Roster Excel contains only:
  - `소속프로젝트`
  - `구분`
  - `이름`
  - `부서`
  - `입사일`
- Leave accrual rule: one day per month from the employee's hire month.
- Tenure beyond one year does not change the accrual rule.
- Leave usage can be:
  - `연차`: 1 day
  - `오전반차`: 0.5 day
  - `오후반차`: 0.5 day
- Usage input includes a memo field.
- Roster and usage data must persist in Firestore.

## Scope

### In Scope

- Rename the visible `근태관리` navigation item to `연차관리`.
- Remove `근태현황` and `연차현황` sub-tabs from the visible annual leave workflow.
- Replace the current annual leave panel with a purpose-built annual leave management screen.
- Add roster Excel parsing for the new minimal roster format.
- Add Firestore persistence for annual leave roster and usage records.
- Add usage entry, editing, deletion, and list display.
- Calculate accrued, used, and remaining leave in the app.
- Add tests for parsing, calculation, persistence serialization, and the main UI behaviors.

### Out of Scope

- Removing attendance parsing, attendance storage, payroll correction, XERP, PMIS, or home dashboard internals.
- Rewriting payroll leave correction logic.
- Migrating historical attendance documents.
- Implementing legally complex annual leave rules.
- Building approval workflows or multi-user permissions beyond the existing app's admin controls.

## Information Architecture

Top-level public navigation should become:

- `홈`
- `연차관리`
- `조직도`
- `본사 송부용`

`연차관리` opens directly to the annual leave management screen. There is no secondary `근태현황` / `연차현황` selector in desktop, mobile, or side navigation.

Existing guidance text that points users to `근태관리` should be updated to point to `연차관리` when it refers to checking leave status. Home widgets that still depend on attendance data may remain unchanged unless they directly link to the removed attendance screen.

## Screen Design

The `연차관리` screen has three working areas.

### 1. Header and Controls

Controls:

- Roster Excel upload.
- Cloud save status.
- Export button for the current annual leave state.
- Optional search by employee name.

Admin-only controls should follow the existing app pattern. If upload and usage mutation are currently admin-only in surrounding workflows, keep them admin-only. Read-only annual leave status can remain visible to non-admin users if the menu is public.

### 2. Summary and Employee Status

Summary cards:

- Total employees.
- Total accrued leave.
- Total used leave.
- Total remaining leave.
- Employees with negative remaining leave.

Employee table columns:

- `소속프로젝트`
- `구분`
- `이름`
- `부서`
- `입사일`
- `발생연차`
- `사용연차`
- `잔여연차`

Rows should support search and stable sorting. Existing row drag ordering can be kept only if it remains simple; otherwise default roster order is enough for this redesign.

### 3. Usage Entry and Usage List

Usage input fields:

- Date.
- Employee.
- Type: `연차`, `오전반차`, `오후반차`.
- Memo.

Usage list columns:

- Date.
- Employee.
- Type.
- Days.
- Memo.
- Created or updated time.
- Edit/delete actions for admin users.

Selecting an employee from the table can open a detail panel or modal showing that employee's usage history and summary.

## Data Model

### Leave Employee

```ts
interface LeaveManagedEmployee {
  id: string;
  project: string;
  category: string;
  name: string;
  department: string;
  hireDate: string;
  sourceRow: number;
  createdAt: string;
  updatedAt: string;
}
```

`id` should be stable across uploads where possible. A normalized combination of project, category, name, department, and hire date is acceptable unless the implementation finds an existing local ID pattern.

### Leave Usage

```ts
type LeaveUsageType = "연차" | "오전반차" | "오후반차";

interface LeaveUsage {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  type: LeaveUsageType;
  days: 1 | 0.5;
  memo: string;
  createdAt: string;
  updatedAt: string;
}
```

Store `employeeName` redundantly for readable history and exports, but calculations should prefer `employeeId` when available.

### Derived Annual Leave Status

```ts
interface LeaveStatusRow {
  employee: LeaveManagedEmployee;
  accrued: number;
  used: number;
  remaining: number;
}
```

`LeaveStatusRow` is derived in memory and does not need to be stored.

## Accrual Calculation

Accrual is monthly and inclusive of the hire month.

For a selected basis date:

```ts
months =
  (basisYear - hireYear) * 12 +
  (basisMonth - hireMonth) +
  1
accrued = max(0, months)
```

Examples:

- Hire date `2026-03-15`, basis date in March 2026: accrued = 1.
- Hire date `2026-03-15`, basis date in April 2026: accrued = 2.
- Hire date after the basis month: accrued = 0.

The basis date can default to today. If the screen includes a month selector later, calculations should use that selected month.

## Firestore Design

Use annual-leave-specific storage rather than adding more responsibility to the existing attendance documents.

Recommended logical documents:

- `annual_leave/roster`
  - `employees: LeaveManagedEmployee[]`
  - `uploadedAt`
  - `uploadedBy` if available
- `annual_leave/usages`
  - `items: LeaveUsage[]`
  - `updatedAt`

This document-based approach matches the existing app's simple Firestore service style and avoids introducing pagination until usage volume requires it.

If document size becomes a realistic issue, split usage records by year-month in a later migration:

- `annual_leave_usages/{yyyy_mm}`

## Excel Import

The roster parser should accept a worksheet with headers:

- `소속프로젝트`
- `구분`
- `이름`
- `부서`
- `입사일`

Parser behavior:

- Ignore completely empty rows.
- Require `이름` and `입사일`.
- Normalize dates from Excel serials, ISO-like strings, and Korean date strings when feasible.
- Preserve row order.
- Return clear row-level errors for missing required fields or invalid dates.
- Replace the stored roster on successful upload after user save.

Leave usage is no longer imported from the annual leave workbook. Usage is entered in the app.

## Export

The export button should generate an Excel workbook with at least:

- `직원별 연차현황`: current derived status rows.
- `연차 사용내역`: saved usage records.

The filename should use the existing app style, for example `연차관리_YYYYMMDD.xlsx`.

## Error Handling

- Invalid roster file: show a toast and keep the previous saved roster.
- Missing required headers: show which headers are missing.
- Invalid usage input: block save and focus the missing field when practical.
- Firestore load failure: show an error state and allow retry.
- Firestore save failure: keep local state and show a clear failure toast.
- Deleted employee with historical usage: keep usage in history and label the employee as missing from current roster.

## Testing

Add focused tests for:

- Roster Excel parsing with valid rows.
- Roster parser errors for missing headers and invalid hire dates.
- Accrual calculation from hire month.
- Usage day values for full day and half day.
- Derived used and remaining totals.
- Firestore serialization removes undefined fields.
- `연차관리` navigation renders without `근태현황` sub-tabs.
- Usage entry adds a record and updates derived remaining leave.
- Usage edit/delete updates derived totals.

## Implementation Notes

- Keep the old attendance table component and attendance parsers in the codebase for dependent workflows.
- The current `AnnualLeavePanel` can either be replaced or wrapped by a new component; prefer a new component if it keeps the annual leave domain clearer.
- Existing `LeaveEmployee` and `LeaveDetail` types are tied to the old workbook shape. Prefer new explicit types for the redesigned annual leave workflow.
- Keep UI styling consistent with the current operational dashboard: compact controls, dense tables, restrained colors, and no landing-page treatment.

