import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isMonthlyWorker, processPayroll } from "./payrollProcessor";
import type { Employee, LeaveDetail } from "./parseExcel";

function makePayrollWorkbookBuffer(
  dayValues: Record<number, number> = {},
  options: { year?: number; month?: number } = {}
): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  const year = options.year ?? 2026;
  const month = options.month ?? 4;

  ws["A1"] = { t: "s", v: `${year}년 ${month}월` };
  ws["H5"] = { t: "s", v: "직종" };
  ws["I5"] = { t: "s", v: "성명" };
  ws["AV5"] = { t: "s", v: "근무일수" };
  ws["AW5"] = { t: "s", v: "출력공수" };
  ws["AX5"] = { t: "s", v: "추가공수" };
  ws["AY5"] = { t: "s", v: "총공수" };
  ws["AZ5"] = { t: "s", v: "단가" };
  ws["BA5"] = { t: "s", v: "경비(1)" };
  ws["BB5"] = { t: "s", v: "경비(2)" };
  ws["BC5"] = { t: "s", v: "급여액" };
  ws["BD5"] = { t: "s", v: "국민연금산정용\n참조보수월액" };

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

  const dayTotal = Object.values(values).reduce((sum, value) => sum + value, 0);
  ws["AW7"] = { t: "n", v: dayTotal, f: "SUM(Q7:AU7)" };
  ws["AX7"] = { t: "n", v: 0 };
  ws["AY7"] = { t: "n", v: dayTotal, f: "AW7+AX7" };
  ws["AZ7"] = { t: "n", v: 100000 };
  ws["BA7"] = { t: "n", v: 0 };
  ws["BC7"] = { t: "n", v: dayTotal * 100000, f: "IFERROR(((AY7*AZ7)+BA7), 0)" };
  ws["BD7"] = { t: "n", v: Math.floor((dayTotal * 100000) / 1000) * 1000, f: "ROUNDDOWN(BC7,-3)" };

  ws["!ref"] = "A1:BD7";

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "P4 초순수_P4-PJT Ph4(216명)_Field");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function makeFlatPayrollWorkbookBuffer(dayValues: Record<number, number> = {}): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};

  ws["A1"] = { t: "s", v: "업체" };
  ws["B1"] = { t: "s", v: "인원정보" };
  ws["N1"] = { t: "s", v: "급여정보" };
  ws["B2"] = { t: "s", v: "순번" };
  ws["C2"] = { t: "s", v: "직종" };
  ws["D2"] = { t: "s", v: "사번" };
  ws["E2"] = { t: "s", v: "성명" };

  for (let day = 1; day <= 31; day++) {
    ws[XLSX.utils.encode_cell({ r: 1, c: 13 + (day - 1) })] = { t: "n", v: day };
  }

  ws["B3"] = { t: "n", v: 1 };
  ws["C3"] = { t: "s", v: "공사관리자" };
  ws["D3"] = { t: "s", v: "308804" };
  ws["E3"] = { t: "s", v: "나경민" };

  for (const [dayText, value] of Object.entries(dayValues)) {
    const day = Number(dayText);
    ws[XLSX.utils.encode_cell({ r: 2, c: 13 + (day - 1) })] = { t: "n", v: value };
  }

  ws["!ref"] = "A1:AY3";

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "급여대장");
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
  it("treats job titles containing manager or vehicle operation as monthly workers", () => {
    expect(isMonthlyWorker("공사관리자")).toBe(true);
    expect(isMonthlyWorker("차량운행")).toBe(true);
    expect(isMonthlyWorker("차량운행 보조")).toBe(true);
    expect(isMonthlyWorker("배관공")).toBe(false);
  });

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

  it("updates cached formula totals after changing daily work units", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [i + 1, 1]));
    const employees: Employee[] = [makeEmployee(makePresentRecords(Array.from({ length: 26 }, (_, i) => i + 1)))];

    const result = await processPayroll(makePayrollWorkbookBuffer(dayValues), {}, [], employees, null);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array", cellFormula: true });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];

    expect(outputWs["AW7"]?.f).toBe("SUM(Q7:AU7)");
    expect(outputWs["AW7"]?.v).toBe(25);
    expect(outputWs["AY7"]?.f).toBe("AW7+AX7");
    expect(outputWs["AY7"]?.v).toBe(25);
    expect(outputWs["BC7"]?.v).toBe(2500000);
    expect(outputWs["BD7"]?.v).toBe(2500000);
  });

  it("recognizes the flat payroll export layout and parses year/month from the file name", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [i + 1, 1]));

    const result = await processPayroll(
      makeFlatPayrollWorkbookBuffer(dayValues),
      {},
      [],
      [],
      null,
      [],
      "급여대장_202605_평택 P4-Ph4 초순수.xlsx"
    );
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["급여대장"];
    const total = Array.from({ length: 31 }, (_, i) => {
      const day = i + 1;
      return Number(outputWs[XLSX.utils.encode_cell({ r: 2, c: 13 + (day - 1) })]?.v ?? 0);
    }).reduce((sum, value) => sum + value, 0);

    expect(result.year).toBe(2026);
    expect(result.month).toBe(5);
    expect(result.corrections[0]).toEqual(
      expect.objectContaining({
        name: "나경민",
        jobTitle: "공사관리자",
        totalBefore: 26,
        totalAfter: 25,
      })
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
    expect(result.corrections[0].totalAfter).toBe(24.25);
    expect(outputWs["S7"]?.v).toBe(0);
  });

  it("deducts manual absence from the total even when the absence date cell is already blank", async () => {
    const dayValues = Object.fromEntries(
      Array.from({ length: 26 }, (_, i) => [i + 1, 1]).filter(([day]) => day !== 3)
    );
    const employees: Employee[] = [makeEmployee(makePresentRecords(Array.from({ length: 26 }, (_, i) => i + 1)))];
    const manualAbsences = [
      { id: "abs-1", date: "2026-04-03", name: "홍 길동", memo: "", createdAt: "2026-04-28T00:00:00.000Z" },
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
    const total = Array.from({ length: 26 }, (_, i) => {
      const day = i + 1;
      return Number(outputWs[XLSX.utils.encode_cell({ r: 6, c: 16 + (day - 1) })]?.v ?? 0);
    }).reduce((sum, value) => sum + value, 0);

    expect(result.corrections[0].totalBefore).toBe(25);
    expect(result.corrections[0].totalAfter).toBe(24.25);
    expect(result.corrections[0].changes).toContainEqual({
      day: 3,
      before: 0,
      after: 0,
      reason: "결근(수동입력)",
    });
    expect(result.corrections[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "결근 총공수 감산" }),
      ])
    );
    expect(total).toBe(24.25);
  });

  it("calculates manual absence ranges from monthly period pay into 0.125-step work units", async () => {
    const dayValues = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i + 1, 1]));
    const employees: Employee[] = [];
    const manualAbsences = Array.from({ length: 16 }, (_, i) => {
      const day = i + 15;
      return {
        id: `abs-${day}`,
        date: `2026-04-${String(day).padStart(2, "0")}`,
        name: "홍길동",
        memo: "",
        createdAt: "2026-04-28T00:00:00.000Z",
      };
    });

    const result = await processPayroll(
      makePayrollWorkbookBuffer(dayValues, { year: 2026, month: 4 }),
      {},
      [],
      employees,
      null,
      manualAbsences
    );
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(216명)_Field"];
    const total = Array.from({ length: 31 }, (_, i) => {
      const day = i + 1;
      return Number(outputWs[XLSX.utils.encode_cell({ r: 6, c: 16 + (day - 1) })]?.v ?? 0);
    }).reduce((sum, value) => sum + value, 0);

    expect(result.corrections[0].totalAfter).toBe(11.75);
    expect(total).toBe(11.75);
  });
});
