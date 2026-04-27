# Head Office Mail Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `본사 메일송부` tab that turns typed employee names into a certificate request title and copyable table.

**Architecture:** Put certificate request parsing, employee matching, title generation, and table HTML/text generation in `src/lib/headOfficeMail.ts` with Vitest coverage. Add a focused `src/components/HeadOfficeMailRequest.tsx` UI that loads PH4/PH2 employee rows from Firestore and uses the pure helper functions. Wire the component into `src/pages/Index.tsx` as an admin tab.

**Tech Stack:** React, TypeScript, Vite, Vitest, Firebase Firestore service helpers, existing Tailwind utility style.

---

### Task 1: Pure Certificate Request Helpers

**Files:**
- Create: `src/lib/headOfficeMail.ts`
- Test: `src/lib/headOfficeMail.test.ts`

- [ ] **Step 1: Write failing tests**

Test certificate title generation, name parsing, row matching from employee data, and copied table HTML/text output.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/headOfficeMail.test.ts`
Expected: fail because `src/lib/headOfficeMail.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create constants for certificate options and site options, then implement:

- `splitNames`
- `formatDateDots`
- `resolveCertificateName`
- `createMailSubject`
- `buildCertificateRows`
- `createCertificateTableHtml`
- `createCertificateTableText`

- [ ] **Step 4: Run helper tests**

Run: `npx vitest run src/lib/headOfficeMail.test.ts`
Expected: pass.

### Task 2: 본사 메일송부 UI

**Files:**
- Create: `src/components/HeadOfficeMailRequest.tsx`

- [ ] **Step 1: Implement the component**

Build a work-tool layout with:

- data source selector: PH4/PH2 명단
- certificate dropdown: 재직증명서, 경력증명서, 원천징수영수증, 기타
- custom certificate input when 기타 is selected
- site dropdown: P4-PH4, P4-PH2, P5-PH1 full site names
- request date input
- names textarea
- title preview
- table preview matching the email screenshot
- copy title and copy table buttons

- [ ] **Step 2: Clipboard behavior**

Use `navigator.clipboard.write` with `text/html` and `text/plain` for table copy, and fall back to text copy if rich clipboard is unavailable.

### Task 3: Navigation Integration

**Files:**
- Modify: `src/pages/Index.tsx`

- [ ] **Step 1: Import component and icon**

Import `HeadOfficeMailRequest` and a mail icon from `lucide-react`.

- [ ] **Step 2: Add tab key**

Add `본사메일송부` to `ActiveTab`.

- [ ] **Step 3: Add admin nav item**

Add a sidebar item labeled `본사 메일송부`.

- [ ] **Step 4: Render tab content**

Render `<HeadOfficeMailRequest />` when the tab is active and admin is logged in.

### Task 4: Verification

**Files:**
- Run only.

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: build succeeds. Existing chunk-size and browserslist warnings are acceptable.

- [ ] **Step 3: Commit and push**

Commit code changes and push to `main` so Vercel can deploy the testable page.
