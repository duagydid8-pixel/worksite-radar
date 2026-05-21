# Electronic Card Auto Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runnable electronic-card sync path that saves current-month `eum.cw.or.kr` records to Firestore and lets final work-unit checks consume them.

**Architecture:** Keep browser-site automation in a Node script and shared record normalization in a small TypeScript library. Firestore app helpers mirror the existing PMIS date-index pattern so the UI can load electronic-card evidence by date.

**Tech Stack:** Vite React, TypeScript, Vitest, Firebase Firestore, Playwright for the logged-in EUM browser flow.

---

### Task 1: Shared Electronic Card Model

**Files:**
- Create: `src/lib/electronicCardSync.ts`
- Create: `src/lib/electronicCardSync.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildCurrentMonthRange,
  coerceElectronicCardData,
  groupElectronicCardRowsByDate,
  normalizeElectronicCardApiRows,
} from "./electronicCardSync";

describe("electronicCardSync", () => {
  it("builds a current-month range through the provided today date", () => {
    expect(buildCurrentMonthRange(new Date("2026-05-21T09:00:00+09:00"))).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-21",
      startYmd: "20260501",
      endYmd: "20260521",
    });
  });

  it("normalizes EUM API rows and derives tag date plus times", () => {
    const rows = normalizeElectronicCardApiRows([
      {
        custNm: "홍길동",
        birthday: "900101",
        lbrYmd: "20260521",
        gtwkDt: "2026-05-21 06:58:12",
        lvwkDt: "2026-05-21 17:04:55",
        tagNm: "전자카드",
        conm: "한성크린텍(주)",
      },
    ]);

    expect(rows).toEqual([
      {
        name: "홍길동",
        birthDate: "900101",
        company: "한성크린텍(주)",
        date: "2026-05-21",
        inTime: "06:58",
        outTime: "17:04",
        authMethod: "전자카드",
      },
    ]);
  });

  it("groups duplicate rows by date and worker without losing in/out times", () => {
    const grouped = groupElectronicCardRowsByDate([
      { name: "홍길동", birthDate: "900101", date: "2026-05-21", inTime: "06:58", outTime: "", authMethod: "전자카드" },
      { name: "홍길동", birthDate: "900101", date: "2026-05-21", inTime: "", outTime: "17:04", authMethod: "" },
    ]);

    expect(grouped["2026-05-21"]).toEqual({
      dateLabel: "2026-05-21",
      persons: [
        { name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04", authMethod: "전자카드", company: "" },
      ],
    });
  });

  it("coerces Firestore data into final-work-unit electronic-card data", () => {
    expect(coerceElectronicCardData({
      dateLabel: "2026-05-21",
      persons: [{ name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04" }],
    })).toEqual({
      dateLabel: "2026-05-21",
      persons: [{ name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04", authMethod: "", company: "" }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/electronicCardSync.test.ts`
Expected: FAIL because `src/lib/electronicCardSync.ts` does not exist.

- [ ] **Step 3: Implement the model helpers**

Create `src/lib/electronicCardSync.ts` with exported types and functions named in the test. Normalize dates to `YYYY-MM-DD`, times to `HH:mm`, merge duplicate worker/date rows by `name + birthDate`, and return empty strings for missing optional fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/electronicCardSync.test.ts`
Expected: PASS.

### Task 2: Firestore Date-Indexed Storage

**Files:**
- Modify: `src/lib/firestoreService.ts`

- [ ] **Step 1: Write failing tests by extending `src/lib/electronicCardSync.test.ts`**

Add assertions for `getElectronicCardDocIds("PH4", "2026-05-21")` returning:

```ts
{
  prefix: "electronic_card_ph4",
  dateDocId: "electronic_card_ph4_2026-05-21",
  indexDocId: "electronic_card_ph4_index",
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/electronicCardSync.test.ts`
Expected: FAIL because `getElectronicCardDocIds` is not implemented.

- [ ] **Step 3: Implement Firestore helpers**

Add app helpers mirroring PMIS:

```ts
export function getElectronicCardDocIds(site: string, date: string): { prefix: string; dateDocId: string; indexDocId: string };
export async function saveElectronicCardFS(site: string, date: string, data: unknown): Promise<boolean>;
export async function loadElectronicCardFS(site: string, date: string): Promise<unknown | null>;
export async function listElectronicCardDatesFS(site: string): Promise<string[]>;
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/lib/electronicCardSync.test.ts`
Expected: PASS.

### Task 3: Final Work Units Loader

**Files:**
- Modify: `src/components/FinalWorkUnitsCheck.tsx`

- [ ] **Step 1: Wire saved electronic-card data into analysis**

Import `listElectronicCardDatesFS`, `loadElectronicCardFS`, and `coerceElectronicCardData`. Load saved electronic-card documents in a `useEffect`, build `electronicCardByDate`, and pass it to `analyzeFinalWorkUnits`.

- [ ] **Step 2: Run final-work-unit tests**

Run: `npm test -- src/lib/finalWorkUnitsCheck.test.ts src/lib/electronicCardSync.test.ts`
Expected: PASS.

### Task 4: EUM Browser Sync Script

**Files:**
- Create: `scripts/electronic-card-sync.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add a runnable script**

Implement commands:

```bash
npm run elcd:config
npm run elcd:sync
```

`elcd:config` opens the EUM page with Playwright, reads the selected site and checked companies, and writes `config/electronic-card-sync.json`. `elcd:sync` reuses the config, fetches current-month records through `https://eum.cw.or.kr/api/selectListElcdUseDsctn`, writes `outputs/electronic-card-sync/*.json`, and saves date-indexed docs to Firestore when Firebase env and auth are available.

- [ ] **Step 2: Run script help**

Run: `npm run elcd:sync -- --help`
Expected: prints usage without opening the browser.

### Task 5: Verification And Local Run

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/electronicCardSync.test.ts src/lib/finalWorkUnitsCheck.test.ts`
Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Start the app**

Run: `npm run dev`
Expected: Vite serves the app on a local URL.
