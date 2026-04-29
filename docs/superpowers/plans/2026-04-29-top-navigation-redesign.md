# Top Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop sidebar and mobile bottom nav with a top navigation system that gives the home dashboard more width.

**Architecture:** Keep all tab state and business logic in `src/pages/Index.tsx`. Replace the visible shell navigation with a top bar, primary menu, contextual submenus, and a compact admin menu row. Scope visual changes through `.ops-topbar` CSS in `src/index.css`.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vite.

---

### Task 1: Replace Shell Navigation

**Files:**
- Modify: `src/pages/Index.tsx`

- [ ] Remove the visible sidebar and mobile bottom nav.
- [ ] Add a top app bar with brand, primary navigation, selected date, and login/logout.
- [ ] Add contextual second rows for attendance, admin, mail, and payroll submenus.

### Task 2: Style Top Navigation

**Files:**
- Modify: `src/index.css`

- [ ] Add `.ops-topbar`, `.ops-topnav`, `.ops-subbar`, and `.ops-admin-strip` styles.
- [ ] Keep industrial field ERP colors and compact 4-6px radii.
- [ ] Ensure horizontal overflow works on narrow screens.

### Task 3: Verify

**Files:**
- No source change.

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run build`.
- [ ] Verify local dev server still serves the app.
