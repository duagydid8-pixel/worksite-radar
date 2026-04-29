# Field ERP Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved field-control ERP visual direction to the app shell, home dashboard, and additional work scan screen.

**Architecture:** Keep React component behavior unchanged. Add scoped CSS classes to existing top-level containers, then use `src/index.css` to restyle descendants without rewriting business logic.

**Tech Stack:** Vite, React, TypeScript, Tailwind CSS, existing shadcn/Radix components.

---

### Task 1: Add Field ERP Shell Classes

**Files:**
- Modify: `src/pages/Index.tsx`
- Modify: `src/components/HomePage.tsx`
- Modify: `src/components/AdditionalWorkScanPage.tsx`

- [ ] Add `ops-shell`, `ops-layout`, `ops-sidebar`, `ops-main`, `ops-mobile-header`, and `ops-mobile-nav` classes to the app shell.
- [ ] Add `ops-home` to the home page root.
- [ ] Add `ops-scan` to the additional work scan page root.

### Task 2: Add Scoped Design CSS

**Files:**
- Modify: `src/index.css`

- [ ] Update design tokens away from blue/purple SaaS defaults.
- [ ] Add scoped rules for `.ops-shell`, `.ops-sidebar`, `.ops-main`, `.ops-home`, and `.ops-scan`.
- [ ] Override large radii, shadows, and soft card treatment inside the pilot scope.

### Task 3: Verify

**Files:**
- No source change.

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run build`.
- [ ] Start the dev server and verify the page loads.
