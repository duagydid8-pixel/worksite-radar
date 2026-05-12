import { describe, expect, it } from "vitest";
import { getAdminMenuButtonLabel, shouldShowAdminMenuPanel } from "./navigationDisplay";

describe("navigation display helpers", () => {
  it("keeps the top-level admin button compact unless an admin section is active", () => {
    expect(getAdminMenuButtonLabel(false, "주간일정")).toBe("관리자");
    expect(getAdminMenuButtonLabel(true, "주간일정")).toBe("관리자: 주간일정");
  });

  it("only opens the admin menu panel for authenticated admins", () => {
    expect(shouldShowAdminMenuPanel({ isAdmin: false, isOpen: true })).toBe(false);
    expect(shouldShowAdminMenuPanel({ isAdmin: true, isOpen: false })).toBe(false);
    expect(shouldShowAdminMenuPanel({ isAdmin: true, isOpen: true })).toBe(true);
  });
});
