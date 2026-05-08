import { describe, expect, it } from "vitest";
import type { Employee, ParsedData } from "./parseExcel";
import { getVisibleAttendanceEmployees } from "./attendanceVisibility";

function employee(name: string, dailyRecords: Employee["dailyRecords"]): Employee {
  return {
    team: "한성_F",
    name,
    jobTitle: "",
    rank: "",
    totalDays: Object.keys(dailyRecords).length,
    dataYear: 2026,
    dataMonth: 5,
    dailyRecords,
  };
}

function data(employees: Employee[]): ParsedData {
  return {
    employees,
    anomalies: [],
    annualLeaveMap: {},
    dataYear: 2026,
    dataMonth: 5,
    leaveEmployees: [],
    leaveDetails: [],
  };
}

describe("getVisibleAttendanceEmployees", () => {
  it("hides roster-only employees that have no punch or manual attendance for the selected month", () => {
    const result = getVisibleAttendanceEmployees(
      data([
        employee("김기록", { "2026-5-8": { punchIn: "06:20", punchOut: "17:10" } }),
        employee("김명단", {}),
      ]),
      { selectedDate: "2026-05-08", monday: new Date(2026, 4, 4), manualAttendanceOverrides: [] }
    );

    expect(result.map((item) => item.name)).toEqual(["김기록"]);
  });

  it("shows a roster-only employee when a manual attendance override exists in the selected month", () => {
    const result = getVisibleAttendanceEmployees(
      data([
        employee("김기록", { "2026-5-8": { punchIn: "06:20", punchOut: "17:10" } }),
        employee("김명단", {}),
      ]),
      {
        selectedDate: "2026-05-08",
        monday: new Date(2026, 4, 4),
        manualAttendanceOverrides: [{
          id: "manual",
          date: "2026-05-09",
          name: "김명단",
          status: "결근",
          createdAt: "2026-05-08T00:00:00.000Z",
        }],
      }
    );

    expect(result.map((item) => item.name)).toEqual(["김기록", "김명단"]);
  });

  it("hides employees outside the uploaded roster even when they have punch records", () => {
    const result = getVisibleAttendanceEmployees(
      data([
        employee("Roster Worker", { "2026-5-8": { punchIn: "06:20", punchOut: "17:10" } }),
        employee("Outside Worker", { "2026-5-8": { punchIn: "06:20", punchOut: "17:10" } }),
      ]),
      {
        selectedDate: "2026-05-08",
        monday: new Date(2026, 4, 4),
        manualAttendanceOverrides: [],
        attendanceRoster: [{ name: "Roster Worker" }],
      }
    );

    expect(result.map((item) => item.name)).toEqual(["Roster Worker"]);
  });
});
