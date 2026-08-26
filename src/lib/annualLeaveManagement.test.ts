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

function makeLegacySummaryWorkbook() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["연차 현황 요약", "", "", "", "", "", "", ""],
    ["기준일", 46212, "", "", "", "", "", ""],
    ["번호", "성명", "직종", "부서", "입사일", "발생연차", "사용연차", "잔여연차"],
    [1, "엄태원", "현채", "공사팀", 45962, 8, 3, 5],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "연차_요약");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function makeCompLeaveSummaryWorkbook() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["연차 현황 요약", "", "", "", "", "", "", "", ""],
    ["기준일", 46260, "", "", "", "", "", "", ""],
    ["번호", "성명", "직종", "부서", "입사일", "발생연차", "사용연차", "잔여연차", "보상휴가"],
    [1, "나경민", "현채", "공사팀", 46142, 3, 0, 3, 2],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "연차_요약");
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

  it("parses the previous annual leave summary workbook as starting counts", () => {
    const result = parseAnnualLeaveRosterWorkbook(makeLegacySummaryWorkbook());

    expect(result.basisDate).toBe("2026-07-09");
    expect(result.errors).toEqual([]);
    expect(result.employees).toMatchObject([
      {
        project: "",
        category: "현채",
        name: "엄태원",
        department: "공사팀",
        hireDate: "2025-11-01",
        startingBasisDate: "2026-07-09",
        startingAccrued: 8,
        startingUsed: 3,
        startingRemaining: 5,
      },
    ]);
  });

  it("reports missing roster headers", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["이름"], ["홍길동"]]);
    XLSX.utils.book_append_sheet(wb, ws, "명단");

    const result = parseAnnualLeaveRosterWorkbook(
      XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
    );

    expect(result.errors.join("\n")).toContain("구분");
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

  it("continues counting from imported starting counts", () => {
    const employee = parseAnnualLeaveRosterWorkbook(makeLegacySummaryWorkbook()).employees[0];
    const rows = deriveLeaveStatusRows([
      employee,
    ], [
      {
        id: "u1",
        date: "2026-08-10",
        employeeId: employee.id,
        employeeName: "엄태원",
        type: "오후반차",
        days: 0.5,
        memo: "",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ], "2026-08-31");

    expect(rows[0]).toMatchObject({ accrued: 9, used: 3.5, remaining: 5.5 });
  });

  it("parses the 보상휴가 column into startingCompLeave", () => {
    const result = parseAnnualLeaveRosterWorkbook(makeCompLeaveSummaryWorkbook());

    expect(result.errors).toEqual([]);
    expect(result.employees).toMatchObject([
      {
        name: "나경민",
        startingAccrued: 3,
        startingUsed: 0,
        startingRemaining: 3,
        startingCompLeave: 2,
      },
    ]);
  });

  it("consumes 보상휴가 before regular 연차 when usage is added", () => {
    const employee = parseAnnualLeaveRosterWorkbook(makeCompLeaveSummaryWorkbook()).employees[0];

    // 보상휴가(2일) 이내 사용 → 보상휴가만 줄고 연차 사용/잔여는 그대로.
    const withinComp = deriveLeaveStatusRows(
      [employee],
      [
        {
          id: "u1",
          date: "2026-08-10",
          employeeId: employee.id,
          employeeName: "나경민",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
      "2026-08-26"
    );
    expect(withinComp[0]).toMatchObject({ used: 0, remaining: 3, compRemaining: 1 });

    // 보상휴가(2일)를 넘는 3일 사용 → 보상휴가 전부 소진 후 남은 1일만 연차에서 차감.
    const beyondComp = deriveLeaveStatusRows(
      [employee],
      [
        {
          id: "u1",
          date: "2026-08-10",
          employeeId: employee.id,
          employeeName: "나경민",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
        {
          id: "u2",
          date: "2026-08-11",
          employeeId: employee.id,
          employeeName: "나경민",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
        {
          id: "u3",
          date: "2026-08-12",
          employeeId: employee.id,
          employeeName: "나경민",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
      ],
      "2026-08-26"
    );
    expect(beyondComp[0]).toMatchObject({ used: 1, remaining: 2, compRemaining: 0 });
  });
});
