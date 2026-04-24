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
  it("counts uploaded weekdays and manually registered Saturdays, excluding Sundays", () => {
    const dateMap: PerfectAttendanceDateMap = {
      "2026-04-01": [row()],
      "2026-04-04": [row()],
      "2026-04-05": [row()],
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

  it("counts a registered Saturday even when no rows are uploaded for that date", () => {
    const result = calculatePerfectAttendance({
      dateMap: { "2026-04-01": [row()] },
      yearMonth: "2026-04",
      saturdayWorkDates: ["2026-04-04"],
      resignedNames: new Set(),
    });

    expect(result.targetDates).toEqual(["2026-04-01", "2026-04-04"]);
    expect(result.failed[0].결근일수).toBe(1);
    expect(result.failed[0].상세사유).toContain("04/04 결근");
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
    expect(result.perfect[0].예비군인정일자).toEqual(["04/01"]);
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

  it("excludes TaeHwa F/W/S and HanSung F teams from perfect attendance", () => {
    const result = calculatePerfectAttendance({
      dateMap: {
        "2026-04-01": [
          row({ 팀명: "배관", 사번: "E001", 성명: "김철수" }),
          row({ 팀명: "태화_F", 사번: "E002", 성명: "태화에프" }),
          row({ 팀명: "태화_W", 사번: "E003", 성명: "태화더블유" }),
          row({ 팀명: "태화_S", 사번: "E004", 성명: "태화에스" }),
          row({ 팀명: "한성_F", 사번: "E005", 성명: "한성에프" }),
        ],
      },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(),
    });

    expect(result.summary.totalWorkers).toBe(1);
    expect(result.summary.perfectCount).toBe(1);
    expect(result.perfect.map((person) => person.성명)).toEqual(["김철수"]);
  });

  it("excludes workers who first appear after the first target workday", () => {
    const result = calculatePerfectAttendance({
      dateMap: {
        "2026-04-01": [row({ 사번: "E001", 성명: "김철수" })],
        "2026-04-02": [
          row({ 사번: "E001", 성명: "김철수" }),
          row({ 사번: "E002", 성명: "중간입사" }),
        ],
      },
      yearMonth: "2026-04",
      saturdayWorkDates: [],
      resignedNames: new Set(),
    });

    expect(result.summary.totalWorkers).toBe(1);
    expect(result.perfect.map((person) => person.성명)).toEqual(["김철수"]);
    expect(result.failed.map((person) => person.성명)).not.toContain("중간입사");
  });
});
