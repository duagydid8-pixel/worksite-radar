import { describe, expect, it } from "vitest";
import { removeTransientNoOpChanges, type PayrollCellChange } from "./payrollChangeTracking";

describe("removeTransientNoOpChanges", () => {
  it("removes internal fill and reduce changes when the final cell value is unchanged", () => {
    const originalValues = [0];
    const changes: PayrollCellChange[] = [
      { day: 1, before: 0, after: 1, reason: "weekday fill" },
      { day: 1, before: 1, after: 0, reason: "total reduction" },
    ];

    expect(removeTransientNoOpChanges(changes, originalValues)).toEqual([]);
  });

  it("keeps explicit no-op records such as manual absences on already blank cells", () => {
    const originalValues = [0];
    const changes: PayrollCellChange[] = [
      { day: 1, before: 0, after: 0, reason: "manual absence" },
    ];

    expect(removeTransientNoOpChanges(changes, originalValues)).toEqual(changes);
  });

  it("keeps changes when the final cell value differs from the original value", () => {
    const originalValues = [1, 0];
    const changes: PayrollCellChange[] = [
      { day: 1, before: 1, after: 0, reason: "absence" },
      { day: 2, before: 0, after: 1, reason: "leave" },
    ];

    expect(removeTransientNoOpChanges(changes, originalValues)).toEqual(changes);
  });
});
