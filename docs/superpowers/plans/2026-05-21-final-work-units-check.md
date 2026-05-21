# Final Work Units Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working `최종공수확인` section inside `XERP & PMIS` so users can upload XERP monthly attendance, compare against loaded PMIS evidence, and review issues with detail rows, checkboxes, and notes.

**Architecture:** Put parsing and status classification in `src/lib/finalWorkUnitsCheck.ts` with Vitest coverage. Add `src/components/FinalWorkUnitsCheck.tsx` for upload, filters, table, detail expansion, and local review state. Wire it into the existing `XerpPmisPageWrapper` as the third sub-page.

**Tech Stack:** React, TypeScript, Vite, Vitest, xlsx, localStorage.

---

### Task 1: Parser And Classifier

**Files:**
- Create: `src/lib/finalWorkUnitsCheck.ts`
- Create: `src/lib/finalWorkUnitsCheck.test.ts`

- [ ] Write tests for parsing `월간출퇴근현황` rows into daily records.
- [ ] Write tests for `공수 누락 의심`, `연장 확인필요`, `PMIS 확인필요`, `PMIS 미업로드`, and `정상`.
- [ ] Implement parser and classifier.
- [ ] Run `npx vitest run src/lib/finalWorkUnitsCheck.test.ts`.

### Task 2: Review UI

**Files:**
- Create: `src/components/FinalWorkUnitsCheck.tsx`

- [ ] Add upload control for monthly XERP attendance workbook.
- [ ] Add compact summary, status chips, date range fields, and table.
- [ ] Add expandable detail panel showing XERP, PMIS, electronic-card placeholder, reason, review checkboxes, and memo.
- [ ] Store review checks and memos in localStorage.

### Task 3: Navigation Wiring

**Files:**
- Modify: `src/pages/Index.tsx`

- [ ] Add `final` sub-page type under `XERP & PMIS`.
- [ ] Add sidebar button `최종공수확인`.
- [ ] Render `FinalWorkUnitsCheck` and pass the current site plus loaded PMIS data.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run `npx vitest run src/lib/finalWorkUnitsCheck.test.ts`.
- [ ] Run `npm run build`.
- [ ] Inspect the local app before committing/pushing.

