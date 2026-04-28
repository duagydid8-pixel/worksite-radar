import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { processPayroll } from "./payrollProcessor";
import type { Employee, LeaveDetail } from "./parseExcel";

function makePayrollWorkbookBuffer(dayValues: Record<number, number> = {}): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};

  ws["A1"] = { t: "s", v: "2026년 4월" };
  ws["H5"] = { t: "s", v: "직종" };
  ws["I5"] = { t: "s", v: "성명" };

  // Q6=1 is intentionally absent, matching the real template shape.
  ws["R6"] = { t: "n", v: 2 };
  ws["S6"] = { t: "n", v: 3 };
  ws["T6"] = { t: "n", v: 4 };

  ws["H7"] = { t: "s", v: "관리자" };
  ws["I7"] = { t: "s", v: "홍길동" };
  const values = Object.keys(dayValues).length > 0
    ? dayValues
    : Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i + 2, 1]));

  for (const [dayText, value] of Object.entries(values)) {
    const day = Number(dayText);
    ws[XLSX.utils.encode_cell({ r: 6, c: 16 + (day - 1) })] = { t: "n", v: value };
  }

  ws["!ref"] = "A1:AU7";

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "P4 초순수_P4-PJT Ph4(216명)_Field");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function makeEmployee(dailyRecords: Employee["dailyRecords"] = {}): Employee {
  return {
    team: "한성_F",
    name: "홍길동",
    jobTitle: "관리자",
    rank: "",
    totalDays: 0,
    dataYear: 2026,
    dataMonth: 4,
    dailyRecords,
  };
}

function makePresentRecords(days: number[]): Employee["dailyRecords"] {
  return Object.fromEntries(
    days.map((day) => [`2026-4-${day}`, { punchIn: "07:00", punchOut: "17:00" }])
  );
}

describe("processPayroll XML patching", () => {
  it("creates a missing attendance cell when a leave day changes from blank to 1", async () => {
    const leaveDetails: LeaveDetail[] = [
      { year: 2026, month: 4, day: 1, name: "홍길동", days: 1, reason: "연차" },
    ];
    const employees: Employee[] = [makeEmployee(makePresentRecords(Array.from({ length: 24 }, (_, i) => i + 2)))];

    const result = await processPayroll(makePayrollWorkbookBuffer(), {}, leaveDetails, employees, null);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];

    expect(result.corrections[0].changes).toContainEqual({
      day: 1,
      before: 0,
      after: 1,
      reason: "연차",
    });
    expect(outputWs["Q7"]?.v).toBe(1);
  });

  it("reduces monthly worker attendance total to 25 when it exceeds 25", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [i + 1, 1]));
    const employees: Employee[] = [makeEmployee(makePresentRecords(Array.from({ length: 26 }, (_, i) => i + 1)))];

    const result = await processPayroll(makePayrollWorkbookBuffer(dayValues), {}, [], employees, null);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];
    const total = Array.from({ length: 26 }, (_, i) => {
      const day = i + 1;
      return Number(outputWs[XLSX.utils.encode_cell({ r: 6, c: 16 + (day - 1) })]?.v ?? 0);
    }).reduce((sum, value) => sum + value, 0);

    expect(result.corrections[0].totalBefore).toBe(26);
    expect(result.corrections[0].totalAfter).toBe(25);
    expect(result.corrections[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ before: 1, after: 0, reason: "총공수 25 초과 감산" }),
      ])
    );
    expect(total).toBe(25);
  });

  it("treats attendance no-check days as unpaid leave and does not refill them back to 25", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i + 1, 1]));
    const dailyRecords = makePresentRecords(Array.from({ length: 25 }, (_, i) => i + 1));
    dailyRecords["2026-4-1"] = { punchIn: null, punchOut: null };
    const employees: Employee[] = [makeEmployee(dailyRecords)];

    const result = await processPayroll(makePayrollWorkbookBuffer(dayValues), {}, [], employees, null);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];

    expect(result.corrections[0].changes).toContainEqual({
      day: 1,
      before: 1,
      after: 0,
      reason: "무급연차(미타각)",
    });
    expect(result.corrections[0].totalBefore).toBe(25);
    expect(result.corrections[0].totalAfter).toBe(24);
    expect(outputWs["Q7"]?.v).toBe(0);
  });

  it("does not treat missing attendance records from a different month as unpaid leave", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i + 1, 1]));
    const employee = makeEmployee({});
    employee.dataMonth = 3;

    const result = await processPayroll(makePayrollWorkbookBuffer(dayValues), {}, [], [employee], null);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];
    const total = Array.from({ length: 25 }, (_, i) => {
      const day = i + 1;
      return Number(outputWs[XLSX.utils.encode_cell({ r: 6, c: 16 + (day - 1) })]?.v ?? 0);
    }).reduce((sum, value) => sum + value, 0);

    expect(result.corrections).toHaveLength(0);
    expect(total).toBe(25);
  });

  it("deducts manually entered absences for the matching payroll date and name", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i + 1, 1]));
    const employees: Employee[] = [makeEmployee(makePresentRecords(Array.from({ length: 25 }, (_, i) => i + 1)))];
    const manualAbsences = [
      { id: "abs-1", date: "2026-04-03", name: "홍길동", memo: "", createdAt: "2026-04-28T00:00:00.000Z" },
    ];

    const result = await processPayroll(
      makePayrollWorkbookBuffer(dayValues),
      {},
      [],
      employees,
      null,
      manualAbsences
    );
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];

    expect(result.corrections[0].changes).toContainEqual({
      day: 3,
      before: 1,
      after: 0,
      reason: "결근(수동입력)",
    });
    expect(result.corrections[0].totalBefore).toBe(25);
    expect(result.corrections[0].totalAfter).toBe(24);
    expect(outputWs["S7"]?.v).toBe(0);
  });
});
