import { describe, expect, it } from "vitest";
import type { ParsedData } from "./parseExcel";
import { applyManualAttendanceOverrides, type ManualAttendanceOverride } from "./manualAttendanceOverrides";

function makeData(): ParsedData {
  return {
    dataYear: 2026,
    dataMonth: 5,
    employees: [
      {
        team: "태화_F",
        name: "홍길동",
        jobTitle: "직원",
        rank: "",
        totalDays: 1,
        dataYear: 2026,
        dataMonth: 5,
        dailyRecords: {
          "2026-5-8": { punchIn: "06:20", punchOut: "17:10" },
        },
      },
    ],
    anomalies: [],
    annualLeaveMap: {},
    leaveEmployees: [],
    leaveDetails: [],
  };
}

function override(status: ManualAttendanceOverride["status"]): ManualAttendanceOverride {
  return {
    id: status,
    date: "2026-05-08",
    name: "홍길동",
    status,
    createdAt: "2026-05-08T00:00:00.000Z",
  };
}

describe("applyManualAttendanceOverrides", () => {
  it("updates existing employee metadata from the roster", () => {
    const data = makeData();
    data.employees[0] = {
      ...data.employees[0],
      jobTitle: "",
      rank: "",
    };

    const result = applyManualAttendanceOverrides(data, [], [
      { team: "태화_F", name: "홍길동", jobTitle: "공사", rank: "수석" },
    ]);

    expect(result.employees[0]).toMatchObject({
      team: "태화_F",
      name: "홍길동",
      jobTitle: "공사",
      rank: "수석",
      dailyRecords: {
        "2026-5-8": { punchIn: "06:20", punchOut: "17:10" },
      },
    });
  });

  it("creates an employee from the roster when a manual override targets a roster-only name", () => {
    const data = makeData();
    data.employees = [];

    const result = applyManualAttendanceOverrides(data, [
      {
        id: "absence",
        date: "2026-05-09",
        name: "김명단",
        status: "결근",
        createdAt: "2026-05-08T00:00:00.000Z",
      },
    ], [
      { team: "한성_F", name: "김명단", jobTitle: "관리자", rank: "반장" },
    ]);

    expect(result.employees[0]).toMatchObject({
      team: "한성_F",
      name: "김명단",
      jobTitle: "관리자",
      rank: "반장",
      dailyRecords: {
        "2026-5-9": { punchIn: null, punchOut: null, status: "결근" },
      },
    });
  });

  it("makes annual leave override automatic punch records", () => {
    const result = applyManualAttendanceOverrides(makeData(), [override("연차")]);

    expect(result.employees[0].dailyRecords["2026-5-8"]).toEqual({
      punchIn: null,
      punchOut: null,
      status: "연차",
    });
    expect(result.annualLeaveMap["홍길동"]["2026|5|8"]).toBe(true);
    expect(result.leaveDetails[0]).toMatchObject({ name: "홍길동", days: 1 });
  });

  it("keeps punch records while marking half-day leave", () => {
    const result = applyManualAttendanceOverrides(makeData(), [override("오후반차")]);

    expect(result.employees[0].dailyRecords["2026-5-8"]).toEqual({
      punchIn: "06:20",
      punchOut: "17:10",
      status: "오후반차",
    });
    expect(result.annualLeaveMap["홍길동"]).toBeUndefined();
    expect(result.leaveDetails[0]).toMatchObject({ name: "홍길동", days: 0.5, reason: "오후반차" });
  });

  it("marks absence as a manual status", () => {
    const result = applyManualAttendanceOverrides(makeData(), [override("결근")]);

    expect(result.employees[0].dailyRecords["2026-5-8"]).toEqual({
      punchIn: null,
      punchOut: null,
      status: "결근",
    });
    expect(result.leaveDetails).toEqual([]);
  });
});
