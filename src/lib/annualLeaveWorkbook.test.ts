import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { filterAnnualLeaveData, mergeAnnualLeaveData, parseAnnualLeaveWorkbook } from "./annualLeaveWorkbook";
import type { ParsedData } from "./parseExcel";

function sparseRow(values: Record<number, unknown>): unknown[] {
  const row: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    row[Number(key)] = value;
  }
  return row;
}

function makeLeaveWorkbookBuffer(detailDay = 8): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["header"],
      ["header"],
      ["header"],
      ["header"],
      ["header"],
      ["header"],
      ["header"],
      sparseRow({ 2: "홍길동", 3: "현채", 4: "2026-01-02", 37: 2, 38: 8 }),
    ]),
    "연차_현채직",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["header"],
      ["header"],
      ["header"],
      sparseRow({ 1: 5, 2: detailDay, 4: "홍길동", 5: 1, 6: "개인연차" }),
    ]),
    "연차_상세",
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function makeData(): ParsedData {
  return {
    employees: [],
    anomalies: [],
    annualLeaveMap: {
      홍길동: { "2026|5|7": true },
      보존자: { "2026|5|9": true },
    },
    dataYear: 2026,
    dataMonth: 5,
    leaveEmployees: [{ name: "홍길동", dept: "현채", hireDate: "2026-01-02", totalUsed: 1, remaining: 9 }],
    leaveDetails: [{ year: 2026, month: 5, day: 7, name: "홍길동", days: 1, reason: "이전연차" }],
  };
}

describe("annual leave workbook", () => {
  it("parses leave employees, details, and attendance map from a standalone leave workbook", () => {
    const result = parseAnnualLeaveWorkbook(makeLeaveWorkbookBuffer(), 2026);

    expect(result.leaveEmployees).toEqual([
      { name: "홍길동", dept: "현채", hireDate: "2026-01-02", totalUsed: 2, remaining: 8 },
    ]);
    expect(result.leaveDetails).toEqual([
      { year: 2026, month: 5, day: 8, name: "홍길동", days: 1, reason: "개인연차" },
    ]);
    expect(result.annualLeaveMap).toEqual({
      홍길동: { "2026|5|8": true },
    });
  });

  it("replaces old leave workbook data while preserving unrelated leave entries", () => {
    const leaveData = parseAnnualLeaveWorkbook(makeLeaveWorkbookBuffer(10), 2026);
    const result = mergeAnnualLeaveData(makeData(), leaveData);

    expect(result.leaveDetails).toEqual([
      { year: 2026, month: 5, day: 10, name: "홍길동", days: 1, reason: "개인연차" },
    ]);
    expect(result.annualLeaveMap).toEqual({
      보존자: { "2026|5|9": true },
      홍길동: { "2026|5|10": true },
    });
  });

  it("excludes separately managed Hanseong employees from annual leave data", () => {
    const leaveData = {
      annualLeaveMap: {
        한성직원: { "2026|5|8": true },
        현채직원: { "2026|5|9": true },
      },
      leaveEmployees: [
        { name: "한성직원", dept: "한성", hireDate: "2026-01-01", totalUsed: 1, remaining: 9 },
        { name: "현채직원", dept: "현채", hireDate: "2026-01-01", totalUsed: 2, remaining: 8 },
      ],
      leaveDetails: [
        { year: 2026, month: 5, day: 8, name: "한성직원", days: 1, reason: "별도관리" },
        { year: 2026, month: 5, day: 9, name: "현채직원", days: 1, reason: "연차" },
      ],
    };

    expect(filterAnnualLeaveData(leaveData, new Set(["한성직원"]))).toEqual({
      annualLeaveMap: {
        현채직원: { "2026|5|9": true },
      },
      leaveEmployees: [
        { name: "현채직원", dept: "현채", hireDate: "2026-01-01", totalUsed: 2, remaining: 8 },
      ],
      leaveDetails: [
        { year: 2026, month: 5, day: 9, name: "현채직원", days: 1, reason: "연차" },
      ],
    });
  });
});
