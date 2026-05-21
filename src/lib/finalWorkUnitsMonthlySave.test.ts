import { describe, expect, it } from "vitest";
import {
  buildFinalWorkUnitsMonthSnapshot,
  chunkFinalWorkUnitsRows,
  finalWorkUnitsMonthKey,
} from "./finalWorkUnitsMonthlySave";

describe("final work units monthly save helpers", () => {
  it("uses the selected month only when the date range stays in one month", () => {
    expect(finalWorkUnitsMonthKey("2026-05-01", "2026-05-31")).toBe("2026-05");
    expect(finalWorkUnitsMonthKey("2026-05-13", "2026-05-22")).toBe("2026-05");
    expect(finalWorkUnitsMonthKey("2026-05-31", "2026-06-01")).toBeNull();
  });

  it("splits rows into stable chunks for Firestore document size safety", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: String(index) }));

    expect(chunkFinalWorkUnitsRows(rows, 2)).toEqual([
      [{ id: "0" }, { id: "1" }],
      [{ id: "2" }, { id: "3" }],
      [{ id: "4" }],
    ]);
  });

  it("builds a month snapshot that can replace the previous saved month", () => {
    const snapshot = buildFinalWorkUnitsMonthSnapshot({
      site: "PH4",
      month: "2026-05",
      startDate: "2026-05-13",
      endDate: "2026-05-22",
      fileName: "final-work-units.xlsx",
      summary: { total: 1, needsReview: 1, evidenceMissing: 0 },
      rows: [{ id: "row-1", name: "worker-a" }],
      reviews: { "row-1": { flags: ["checked"], memo: "verified" } },
    });

    expect(snapshot).toMatchObject({
      site: "PH4",
      month: "2026-05",
      startDate: "2026-05-13",
      endDate: "2026-05-22",
      rowCount: 1,
      reviewCount: 1,
      rows: [{ id: "row-1", name: "worker-a" }],
    });
  });
});
