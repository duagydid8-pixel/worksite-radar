import { describe, expect, it } from "vitest";
import { buildFTeamMissingPunchReport, isFTeam } from "./fTeamMissingPunch";

const row = (팀명: string, 성명: string, xerp출근: string, xerp퇴근: string, pmis출근 = "", pmis퇴근 = "") =>
  ({ 팀명, 성명, xerp출근, xerp퇴근, pmis출근, pmis퇴근 });

describe("buildFTeamMissingPunchReport", () => {
  it("lists every F-team XERP in/out gap from the 1st up to the given day", () => {
    const report = buildFTeamMissingPunchReport(
      {
        "2026-09-30": [row("한성F", "홍길동", "", "")],
        "2026-10-01": [row("한성F", "홍길동", "", "17:05", "06:55", "17:06"), row("한성F", "김철수", "06:50", "17:00")],
        "2026-10-02": [row("한성F", "홍길동", "06:58", ""), row("태화F", "이영희", "", "", "", ""), row("현채", "박민수", "", "")],
        "2026-10-03": [row("F기술인", "최지훈", "", "")],
        "2026-10-20": [row("한성F", "홍길동", "", "")],
      },
      "2026-10",
      "2026-10-19",
    );
    expect(report).toEqual([
      { name: "이영희", team: "태화F", missingDates: [{ date: "2026-10-02", missing: "출퇴근", noPmis: true }] },
      {
        name: "홍길동",
        team: "한성F",
        missingDates: [
          { date: "2026-10-01", missing: "출근", noPmis: false },
          { date: "2026-10-02", missing: "퇴근", noPmis: true },
        ],
      },
    ]);
  });

  it("treats only F teams without 기술인 as F teams", () => {
    expect(isFTeam("한성F")).toBe(true);
    expect(isFTeam("F기술인")).toBe(false);
    expect(isFTeam("현채")).toBe(false);
  });
});
