# XERP PMIS Perfect Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a site-specific `만근 통계` tab to XERP & PMIS that manages Saturday workdays and calculates monthly perfect attendance.

**Architecture:** Keep the existing `XerpPmisTable` UI flow, but move the perfect-attendance calculation into a small pure helper module so it can be tested without rendering the full table. Persist PH4/PH2 Saturday workdays through the existing Firestore service layer.

**Tech Stack:** Vite, React, TypeScript, Vitest, Firebase Firestore, shadcn/Tailwind, lucide-react.

---

## File Structure

- Create `src/lib/perfectAttendance.ts`
  - Owns the pure monthly perfect-attendance calculation.
  - Exports input types, result types, and `calculatePerfectAttendance`.
- Create `src/lib/perfectAttendance.test.ts`
  - Covers Sunday exclusion, site-entered Saturday inclusion, lateness, insufficient gongsu, and `예비군` exception.
- Modify `src/lib/firestoreService.ts`
  - Adds `loadPerfectAttendanceSaturdaysFS(site)` and `savePerfectAttendanceSaturdaysFS(site, dates)`.
- Modify `src/components/XerpPmisTable.tsx`
  - Adds `가산사유` to `XerpPmisRow`.
  - Preserves Z-column `가산사유` from Excel uploads.
  - Adds `만근 통계` tab, Saturday management UI, summary cards, perfect list, and failed list.
- Modify `src/components/XerpWorkReflection.tsx`
  - Preserves `가산사유` when syncing XERP work reflection rows into XERP & PMIS.

---

### Task 1: Pure Perfect Attendance Calculator

**Files:**
- Create: `src/lib/perfectAttendance.ts`
- Test: `src/lib/perfectAttendance.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/perfectAttendance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculatePerfectAttendance, type PerfectAttendanceDateMap } from "./perfectAttendance";

const row = (overrides: Partial<PerfectAttendanceDateMap[string][number]> = {}) => ({
  id: crypto.randomUUID(),
  팀명: "배관",
  직종: "기공",
  사번: "E001",
  성명: "김철수",
  xerp출근: "07:00",
  pmis출근: "",
  공수합계AB: "1",
  가산사유: "",
  ...overrides,
});

describe("calculatePerfectAttendance", () => {
  it("counts weekdays and manually registered Saturdays, excluding Sundays", () => {
    const dateMap: PerfectAttendanceDateMap = {
      "2026-04-01": [row()],
      "2026-04-04": [row()],
      "2026-04-05": [],
    };

    const result = calculatePerfectAttendance({
      dateMap,
      yearMonth: "2026-04",
      saturdayWorkDates: ["2026-04-04"],
      resignedNames: new Set(),
    });

    expect(result.targetDates).toEqual(["2026-04-01", "2026-04-04"]);
    expect(result.summary.perfectCount).toBe(1);
    expect(result.perfect[0].성명).toBe("김철수");
  });

  it("fails workers with any lateness", () => {
    const result = calculatePerfectAttendance({
      dateMap: { "2026-04-01": [row({ xerp출근: "07:11" })] },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(),
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].지각횟수).toBe(1);
    expect(result.failed[0].상세사유).toContain("04/01 지각");
  });

  it("fails workers when final gongsu is below 1.0", () => {
    const result = calculatePerfectAttendance({
      dateMap: { "2026-04-01": [row({ 공수합계AB: "0.5" })] },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(),
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].공수미달일수).toBe(1);
    expect(result.failed[0].상세사유).toContain("04/01 공수 0.5");
  });

  it("treats 예비군 reason as attendance even when gongsu is below 1.0", () => {
    const result = calculatePerfectAttendance({
      dateMap: { "2026-04-01": [row({ 공수합계AB: "0", 가산사유: "예비군 훈련" })] },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(),
    });

    expect(result.summary.reserveForceCount).toBe(1);
    expect(result.summary.perfectCount).toBe(1);
    expect(result.perfect[0].예비군인정일수).toBe(1);
  });

  it("excludes resigned workers from the result", () => {
    const result = calculatePerfectAttendance({
      dateMap: { "2026-04-01": [row({ 성명: "퇴사자" })] },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(["퇴사자"]),
    });

    expect(result.summary.totalWorkers).toBe(0);
    expect(result.perfect).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- src/lib/perfectAttendance.test.ts
```

Expected: FAIL because `src/lib/perfectAttendance.ts` does not exist.

- [ ] **Step 3: Implement the calculator**

Create `src/lib/perfectAttendance.ts`:

```ts
export interface PerfectAttendanceRow {
  id?: string;
  팀명?: string;
  직종?: string;
  사번?: string;
  성명: string;
  xerp출근?: string;
  pmis출근?: string;
  공수합계AB?: string;
  가산사유?: string;
}

export type PerfectAttendanceDateMap = Record<string, PerfectAttendanceRow[]>;

export interface PerfectAttendancePerson {
  key: string;
  팀명: string;
  직종: string;
  사번: string;
  성명: string;
  출근인정일수: number;
  대상근무일수: number;
  결근일수: number;
  지각횟수: number;
  공수미달일수: number;
  예비군인정일수: number;
  상세사유: string[];
}

export interface PerfectAttendanceResult {
  yearMonth: string;
  targetDates: string[];
  summary: {
    targetWorkDays: number;
    totalWorkers: number;
    perfectCount: number;
    failedCount: number;
    reserveForceCount: number;
  };
  perfect: PerfectAttendancePerson[];
  failed: PerfectAttendancePerson[];
}

export interface CalculatePerfectAttendanceInput {
  dateMap: PerfectAttendanceDateMap;
  yearMonth: string;
  saturdayWorkDates: string[];
  resignedNames: Set<string>;
}

function isLateTime(timeStr: string): boolean {
  if (!timeStr) return false;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour > 7 || (hour === 7 && minute > 10);
}

function dateLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

function rowKey(row: PerfectAttendanceRow): string {
  return row.사번?.trim() || row.성명.trim();
}

function isReserveForce(row: PerfectAttendanceRow | null): boolean {
  return Boolean(row?.가산사유?.includes("예비군"));
}

function finalGongsu(row: PerfectAttendanceRow | null): number {
  if (!row) return 0;
  return Number.parseFloat(row.공수합계AB ?? "") || 0;
}

function buildTargetDates(yearMonth: string, dateMap: PerfectAttendanceDateMap, saturdayWorkDates: string[]): string[] {
  const saturdaySet = new Set(saturdayWorkDates.filter((date) => date.startsWith(yearMonth)));
  return Object.keys(dateMap)
    .filter((date) => {
      if (!date.startsWith(yearMonth)) return false;
      const day = new Date(`${date}T00:00:00`).getDay();
      if (day === 0) return false;
      if (day === 6) return saturdaySet.has(date);
      return day >= 1 && day <= 5;
    })
    .sort();
}

export function calculatePerfectAttendance(input: CalculatePerfectAttendanceInput): PerfectAttendanceResult {
  const targetDates = buildTargetDates(input.yearMonth, input.dateMap, input.saturdayWorkDates);
  const employeeMap = new Map<string, PerfectAttendanceRow>();

  for (const date of Object.keys(input.dateMap)) {
    if (!date.startsWith(input.yearMonth)) continue;
    for (const row of input.dateMap[date] ?? []) {
      if (!row.성명 || input.resignedNames.has(row.성명)) continue;
      const key = rowKey(row);
      if (!employeeMap.has(key)) employeeMap.set(key, row);
    }
  }

  const people: PerfectAttendancePerson[] = [];

  for (const [key, baseRow] of employeeMap) {
    const person: PerfectAttendancePerson = {
      key,
      팀명: baseRow.팀명 ?? "",
      직종: baseRow.직종 ?? "",
      사번: baseRow.사번 ?? "",
      성명: baseRow.성명,
      출근인정일수: 0,
      대상근무일수: targetDates.length,
      결근일수: 0,
      지각횟수: 0,
      공수미달일수: 0,
      예비군인정일수: 0,
      상세사유: [],
    };

    for (const date of targetDates) {
      const record = (input.dateMap[date] ?? []).find((row) => rowKey(row) === key) ?? null;
      if (!record) {
        person.결근일수++;
        person.상세사유.push(`${dateLabel(date)} 결근`);
        continue;
      }

      const reserveForce = isReserveForce(record);
      const gongsu = finalGongsu(record);
      const inTime = record.xerp출근 || record.pmis출근 || "";

      if (isLateTime(inTime)) {
        person.지각횟수++;
        person.상세사유.push(`${dateLabel(date)} 지각`);
      }

      if (reserveForce) {
        person.예비군인정일수++;
        person.출근인정일수++;
        continue;
      }

      if (gongsu >= 1) {
        person.출근인정일수++;
      } else {
        person.공수미달일수++;
        person.상세사유.push(`${dateLabel(date)} 공수 ${gongsu}`);
      }
    }

    people.push(person);
  }

  const perfect = people
    .filter((person) => person.결근일수 === 0 && person.지각횟수 === 0 && person.공수미달일수 === 0)
    .sort((a, b) => a.팀명.localeCompare(b.팀명) || a.성명.localeCompare(b.성명));
  const failed = people
    .filter((person) => person.결근일수 > 0 || person.지각횟수 > 0 || person.공수미달일수 > 0)
    .sort((a, b) => a.팀명.localeCompare(b.팀명) || a.성명.localeCompare(b.성명));

  return {
    yearMonth: input.yearMonth,
    targetDates,
    summary: {
      targetWorkDays: targetDates.length,
      totalWorkers: people.length,
      perfectCount: perfect.length,
      failedCount: failed.length,
      reserveForceCount: people.reduce((sum, person) => sum + person.예비군인정일수, 0),
    },
    perfect,
    failed,
  };
}
```

- [ ] **Step 4: Run the calculator tests**

Run:

```bash
npm test -- src/lib/perfectAttendance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/perfectAttendance.ts src/lib/perfectAttendance.test.ts
git commit -m "test: cover xerp pmis perfect attendance calculation"
```

Expected: commit succeeds.

---

### Task 2: Firestore Persistence for Saturday Workdays

**Files:**
- Modify: `src/lib/firestoreService.ts`

- [ ] **Step 1: Add Firestore service functions**

Add this block after `saveDateMemosFS`:

```ts
// ── 만근 통계: 현장별 토요 현장근무일 ────────────────────────
export async function loadPerfectAttendanceSaturdaysFS(site: string): Promise<string[]> {
  const data = await fsGet<{ dates: string[] }>(`perfect_attendance_saturdays_${site}`);
  return data?.dates ?? [];
}

export async function savePerfectAttendanceSaturdaysFS(site: string, dates: string[]): Promise<boolean> {
  const normalized = [...new Set(dates)].sort();
  return fsSet(`perfect_attendance_saturdays_${site}`, { dates: normalized });
}
```

- [ ] **Step 2: Type-check through build**

Run:

```bash
npm run build
```

Expected: PASS, with no TypeScript errors from the new exports.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/lib/firestoreService.ts
git commit -m "feat: persist perfect attendance Saturdays"
```

Expected: commit succeeds.

---

### Task 3: Preserve `가산사유` in XERP & PMIS Data

**Files:**
- Modify: `src/components/XerpPmisTable.tsx`
- Modify: `src/components/XerpWorkReflection.tsx`

- [ ] **Step 1: Extend the XERP & PMIS row model**

In `src/components/XerpPmisTable.tsx`, add `가산사유: string;` to `XerpPmisRow`:

```ts
interface XerpPmisRow {
  id: string;
  팀명: string; 직종: string; 사번: string; 성명: string; 생년월일: string;
  xerp출근: string; xerp퇴근: string;
  pmis출근: string; pmis퇴근: string;
  조출: string; 오전: string; 오후: string; 연장: string;
  야간: string; 철야: string; 점심: string; 공수합계A: string;
  초과당일: string; 초과합계: string;
  가산신청: string; 가산승인: string;
  공수합계AB: string; 월누계: string;
  가산사유: string;
}
```

Update `emptyRow()`:

```ts
공수합계AB:"", 월누계:"", 가산사유:"",
```

In `parseSheet`, after the existing `COL_MAP` assignment loop, preserve Z-column:

```ts
emp.가산사유 = String(row[25] ?? "").trim();
```

- [ ] **Step 2: Preserve `가산사유` when syncing from XERP work reflection**

In `src/components/XerpWorkReflection.tsx`, inside `handleSync`, add `가산사유` to the returned object:

```ts
가산사유: pr?.가산사유 ?? c[25] ?? "",
```

Place it after `월누계: c[22],`.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/components/XerpPmisTable.tsx src/components/XerpWorkReflection.tsx
git commit -m "feat: preserve xerp pmis adjustment reasons"
```

Expected: commit succeeds.

---

### Task 4: Add the `만근 통계` Tab UI

**Files:**
- Modify: `src/components/XerpPmisTable.tsx`

- [ ] **Step 1: Add imports**

Update imports:

```ts
import { Search, X, Download, Upload, FolderOpen, CalendarDays, Trash2, ChevronLeft, ChevronRight, AlertTriangle, Clock, CheckCircle2, XCircle, ArrowUpDown, ArrowUp, ArrowDown, BarChart2, MessageSquare, TrendingUp, Award, Plus, ShieldCheck } from "lucide-react";
import { calculatePerfectAttendance } from "@/lib/perfectAttendance";
import { loadXerpFS, saveXerpFS, loadXerpPH2FS, saveXerpPH2FS, loadEmployeesPH4FS, loadEmployeesPH2FS, loadSafetyEduDatesFS, saveSafetyEduDatesFS, loadDateMemosFS, saveDateMemosFS, loadPerfectAttendanceSaturdaysFS, savePerfectAttendanceSaturdaysFS } from "@/lib/firestoreService";
```

- [ ] **Step 2: Add state and derived data**

Change `viewMode` state:

```ts
const [viewMode, setViewMode] = useState<"daily" | "stats" | "perfect">("daily");
```

Add state near date memo state:

```ts
const [saturdayWorkDates, setSaturdayWorkDates] = useState<string[]>([]);
const [saturdayInput, setSaturdayInput] = useState(TODAY);
```

Load site-specific Saturday dates in the existing Firestore load effect:

```ts
loadPerfectAttendanceSaturdaysFS(site).then((dates) => {
  setSaturdayWorkDates(dates);
});
```

Add derived `selectedYearMonth` and `perfectAttendance` after `monthlyStats`:

```ts
const selectedYearMonth = selectedDate.slice(0, 7);

const perfectAttendance = useMemo(
  () => calculatePerfectAttendance({
    dateMap,
    yearMonth: selectedYearMonth,
    saturdayWorkDates,
    resignedNames,
  }),
  [dateMap, selectedYearMonth, saturdayWorkDates, resignedNames]
);
```

- [ ] **Step 3: Add Saturday handlers**

Add handlers before `handleExportSelected`:

```ts
const saveSaturdayWorkDates = async (dates: string[]) => {
  const normalized = [...new Set(dates)].sort();
  setSaturdayWorkDates(normalized);
  const ok = await savePerfectAttendanceSaturdaysFS(site, normalized);
  if (!ok) toast.error("토요 현장근무일 저장 실패");
};

const addSaturdayWorkDate = async () => {
  if (!saturdayInput) return;
  const date = new Date(`${saturdayInput}T00:00:00`);
  if (date.getDay() !== 6) {
    toast.error("토요일만 등록할 수 있습니다.");
    return;
  }
  await saveSaturdayWorkDates([...saturdayWorkDates, saturdayInput]);
  toast.success(`${formatLabel(saturdayInput)} 토요 현장근무일을 등록했습니다.`);
};

const removeSaturdayWorkDate = async (date: string) => {
  await saveSaturdayWorkDates(saturdayWorkDates.filter((d) => d !== date));
  toast.success(`${formatLabel(date)} 토요 현장근무일을 삭제했습니다.`);
};
```

- [ ] **Step 4: Add the tab button**

Add a third button after `월별 통계`:

```tsx
<button
  onClick={() => setViewMode("perfect")}
  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
    viewMode === "perfect"
      ? "bg-primary text-primary-foreground border-primary shadow-sm"
      : "bg-white text-muted-foreground border-border hover:bg-muted/50"
  }`}
>
  <Award className="h-4 w-4" />
  만근 통계
</button>
```

Change the toolbar hidden condition:

```tsx
<div className={`flex flex-wrap items-center gap-3 shrink-0 ${viewMode !== "daily" ? "hidden" : ""}`}>
```

- [ ] **Step 5: Render the perfect attendance tab**

Add this block before the monthly stats block:

```tsx
{viewMode === "perfect" && (
  <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-3 overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
    <div className="space-y-3">
      <div className="bg-white border border-border rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">토요 현장근무일</h3>
            <p className="text-[11px] text-muted-foreground">{site} · {selectedYearMonth} 기준</p>
          </div>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={saturdayInput}
            onChange={(e) => setSaturdayInput(e.target.value)}
            className="min-w-0 flex-1 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <button
            onClick={addSaturdayWorkDate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {saturdayWorkDates.filter((d) => d.startsWith(selectedYearMonth)).length === 0 ? (
            <span className="text-xs text-muted-foreground">등록된 토요일 없음</span>
          ) : saturdayWorkDates.filter((d) => d.startsWith(selectedYearMonth)).map((date) => (
            <button
              key={date}
              onClick={() => removeSaturdayWorkDate(date)}
              className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-colors"
              title="클릭하면 삭제"
            >
              {formatLabel(date)} 삭제
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">일요일은 자동 제외되고, 등록된 토요일만 만근 대상일에 포함됩니다.</p>
      </div>
    </div>

    <div className="space-y-3 min-w-0">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "대상 근무일", value: perfectAttendance.summary.targetWorkDays, sub: "평일 + 등록 토요일", color: "text-slate-700", icon: <CalendarDays className="h-4 w-4" /> },
          { label: "만근자", value: perfectAttendance.summary.perfectCount, sub: "결근 0 · 지각 0", color: "text-emerald-700", icon: <Award className="h-4 w-4" /> },
          { label: "탈락자", value: perfectAttendance.summary.failedCount, sub: "결근/지각/공수미달", color: "text-orange-600", icon: <AlertTriangle className="h-4 w-4" /> },
          { label: "예비군 인정", value: perfectAttendance.summary.reserveForceCount, sub: "가산사유 기준", color: "text-indigo-700", icon: <ShieldCheck className="h-4 w-4" /> },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-border rounded-xl shadow-sm p-4">
            <div className={`flex items-center gap-2 text-xs font-semibold ${item.color}`}>{item.icon}{item.label}</div>
            <p className={`text-3xl font-bold tabular-nums mt-2 ${item.color}`}>{item.value}</p>
            <p className="text-[11px] text-muted-foreground">{item.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[0.9fr_1.1fr] gap-3">
        <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-border bg-muted/40 text-sm font-bold">만근자 목록</div>
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className={th()}>팀명</th>
                <th className={th()}>직종</th>
                <th className={th()}>사번</th>
                <th className={th()}>성명</th>
                <th className={th()}>출근인정</th>
              </tr>
            </thead>
            <tbody>
              {perfectAttendance.perfect.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">만근자가 없습니다.</td></tr>
              ) : perfectAttendance.perfect.map((person) => (
                <tr key={person.key} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-center text-muted-foreground">{person.팀명 || "—"}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{person.직종 || "—"}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{person.사번 || "—"}</td>
                  <td className="px-3 py-2 text-center font-semibold">{person.성명}</td>
                  <td className="px-3 py-2 text-center font-bold text-emerald-700">{person.출근인정일수}/{person.대상근무일수}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-border bg-muted/40 text-sm font-bold">탈락자 사유</div>
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className={th()}>팀명</th>
                <th className={th()}>성명</th>
                <th className={th()}>결근</th>
                <th className={th()}>지각</th>
                <th className={th()}>공수미달</th>
                <th className={th()}>예비군</th>
                <th className={th("min-w-[220px]")}>상세</th>
              </tr>
            </thead>
            <tbody>
              {perfectAttendance.failed.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">탈락자가 없습니다.</td></tr>
              ) : perfectAttendance.failed.map((person) => (
                <tr key={person.key} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-center text-muted-foreground">{person.팀명 || "—"}</td>
                  <td className="px-3 py-2 text-center font-semibold">{person.성명}</td>
                  <td className="px-3 py-2 text-center font-bold text-red-600">{person.결근일수}</td>
                  <td className="px-3 py-2 text-center font-bold text-orange-500">{person.지각횟수}</td>
                  <td className="px-3 py-2 text-center font-bold text-orange-600">{person.공수미달일수}</td>
                  <td className="px-3 py-2 text-center font-bold text-indigo-600">{person.예비군인정일수}</td>
                  <td className="px-3 py-2 text-left text-muted-foreground">{person.상세사유.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/components/XerpPmisTable.tsx
git commit -m "feat: add xerp pmis perfect attendance tab"
```

Expected: commit succeeds.

---

### Task 5: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test -- src/lib/perfectAttendance.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree, except for unrelated user changes if any appeared during implementation.

---

## Self-Review

- Spec coverage: The plan covers a new `만근 통계` tab, PH4/PH2-separated Saturday storage, selected-month calculation, Sunday exclusion, Saturday inclusion, final gongsu threshold, lateness failure, and `예비군` exception.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `PerfectAttendanceRow`, `XerpPmisRow`, Firestore service signatures, and UI state names are consistent across tasks.
