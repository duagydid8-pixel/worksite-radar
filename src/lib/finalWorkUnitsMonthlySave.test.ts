import { describe, expect, it } from "vitest";
import {
  buildFinalWorkUnitsAnalysisFromSnapshot,
  buildFinalWorkUnitsMonthSnapshot,
  chunkFinalWorkUnitsRows,
  finalWorkUnitsMonthKey,
} from "./finalWorkUnitsMonthlySave";
import type { FinalWorkUnitsRow } from "./finalWorkUnitsCheck";

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

  it("rebuilds analysis from a saved snapshot without the original excel records", () => {
    const baseRow = {
      site: "PH4",
      team: "공무팀",
      birthDate: "900101",
      day: 13,
      xerpIn: "07:00",
      xerpOut: "17:00",
      systemWorkUnits: 1,
      workTime: "8:00",
      statusTone: "warning",
      expectedWorkUnits: 1,
      reflectedWorkUnits: 1,
      missingWorkUnits: 0,
      evidenceSource: "XERP",
      autoReason: "",
      xerpPmisExtraUnits: 0,
      xerpPmisReason: "",
      hasXerpPmisMatch: true,
      hasXerpPmisPhoto: false,
      pmisIn: "07:00",
      pmisOut: "17:00",
      pmisEvents: 2,
      pmisUploaded: true,
      electronicCardIn: "",
      electronicCardOut: "",
      electronicCardSaved: false,
      checks: [],
      message: "확인 필요",
      gasanReason: "",
    } satisfies Partial<FinalWorkUnitsRow>;

    const snapshot = buildFinalWorkUnitsMonthSnapshot<FinalWorkUnitsRow>({
      site: "PH4",
      month: "2026-05",
      startDate: "2026-05-13",
      endDate: "2026-05-15",
      fileName: "saved.xlsx",
      summary: { total: 3, needsReview: 1, evidenceMissing: 1 },
      rows: [
        { ...baseRow, id: "a", name: "김이상", date: "2026-05-13", status: "missing-work-units", statusLabel: "공수반영누락", missingWorkUnits: 0.5 },
        { ...baseRow, id: "b", name: "박미업", date: "2026-05-14", status: "pmis-not-uploaded", statusLabel: "PMIS미업로드", pmisUploaded: false },
        { ...baseRow, id: "c", name: "정상", date: "2026-05-15", status: "normal", statusLabel: "정상", statusTone: "success", message: "정상" },
      ] as FinalWorkUnitsRow[],
      reviews: { a: { flags: ["확인완료"], memo: "저장된 메모" } },
    });

    const analysis = buildFinalWorkUnitsAnalysisFromSnapshot(snapshot, "2026-05-13", "2026-05-14");

    expect(analysis.rows.map((row) => row.name)).toEqual(["김이상", "박미업"]);
    expect(analysis.summary).toMatchObject({
      total: 2,
      needsReview: 1,
      evidenceMissing: 1,
      "missing-work-units": 1,
      "pmis-not-uploaded": 1,
      normal: 0,
    });
  });
});
