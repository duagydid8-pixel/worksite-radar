import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  calculateAccruedLeave,
  deriveLeaveStatusRows,
  getUsageDays,
  parseAnnualLeaveRosterWorkbook,
} from "./annualLeaveManagement";

function makeRosterWorkbook() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["소속프로젝트", "구분", "이름", "부서", "입사일"],
    ["P4-PH4", "현재직", "홍길동", "공무", "2026-03-15"],
    ["P4-PH4", "서드파트", "김반차", "안전", "2026.04.01"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "명단");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("annual leave management", () => {
  it("parses the minimal roster workbook", () => {
    const result = parseAnnualLeaveRosterWorkbook(makeRosterWorkbook());

    expect(result.employees).toMatchObject([
      { project: "P4-PH4", category: "현재직", name: "홍길동", department: "공무", hireDate: "2026-03-15" },
      { project: "P4-PH4", category: "서드파트", name: "김반차", department: "안전", hireDate: "2026-04-01" },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("reports missing roster headers", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["이름"], ["홍길동"]]);
    XLSX.utils.book_append_sheet(wb, ws, "명단");

    const result = parseAnnualLeaveRosterWorkbook(
      XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
    );

    expect(result.errors.join("\n")).toContain("소속프로젝트");
    expect(result.employees).toEqual([]);
  });

  it("counts one accrued day from the hire month", () => {
    expect(calculateAccruedLeave("2026-03-15", "2026-03-31")).toBe(1);
    expect(calculateAccruedLeave("2026-03-15", "2026-04-01")).toBe(2);
    expect(calculateAccruedLeave("2026-05-01", "2026-04-30")).toBe(0);
  });

  it("uses full day and half day values", () => {
    expect(getUsageDays("연차")).toBe(1);
    expect(getUsageDays("오전반차")).toBe(0.5);
    expect(getUsageDays("오후반차")).toBe(0.5);
  });

  it("derives used and remaining leave per employee", () => {
    const roster = parseAnnualLeaveRosterWorkbook(makeRosterWorkbook()).employees;
    const rows = deriveLeaveStatusRows(roster, [
      {
        id: "u1",
        date: "2026-04-10",
        employeeId: roster[0].id,
        employeeName: "홍길동",
        type: "연차",
        days: 1,
        memo: "",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "u2",
        date: "2026-04-11",
        employeeId: roster[0].id,
        employeeName: "홍길동",
        type: "오전반차",
        days: 0.5,
        memo: "",
        createdAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
      },
    ], "2026-04-30");

    expect(rows[0]).toMatchObject({ accrued: 2, used: 1.5, remaining: 0.5 });
  });
});
