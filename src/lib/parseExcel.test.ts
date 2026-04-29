import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelFile } from "./parseExcel";

function sparseRow(values: Record<number, unknown>): unknown[] {
  const row: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    row[Number(key)] = value;
  }
  return row;
}

function headerRow(label: string): unknown[] {
  return [label];
}

function makeAttendanceWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headerRow("header1"),
      headerRow("header2"),
      headerRow("header3"),
      sparseRow({ 1: "지문자", 2: "배관", 3: "기사" }),
      sparseRow({ 1: "엑셀자", 2: "용접", 3: "반장" }),
    ]),
    "P4한성",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headerRow("header"),
      sparseRow({
        0: "2026-03-01",
        2: "지문자",
        7: "2026-03-01 07:00:00",
        8: "2026-03-01 17:00:00",
      }),
    ]),
    "지문 기록",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headerRow("header1"),
      headerRow("header2"),
      sparseRow({
        0: "2026-03-01",
        2: "한성_F",
        3: "엑셀자",
        4: "용접",
        7: 1,
        8: "07:00",
        9: "17:00",
      }),
    ]),
    "XERP 기록",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headerRow("header1"),
      headerRow("header2"),
      headerRow("header3"),
      headerRow("header4"),
      headerRow("header5"),
      headerRow("header6"),
      headerRow("header7"),
      sparseRow({ 2: "지문자", 3: "한성", 4: "2026-01-01", 37: 1, 38: 4 }),
      sparseRow({ 2: "엑셀자", 3: "한성", 4: "2026-01-01", 37: 2, 38: 3 }),
    ]),
    "연차_현채직",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headerRow("header1"),
      headerRow("header2"),
      headerRow("header3"),
      sparseRow({ 1: 3, 2: 5, 4: "지문자", 5: 1, 6: "연차" }),
      sparseRow({ 1: 3, 2: 6, 4: "엑셀자", 5: 1, 6: "연차" }),
    ]),
    "연차_상세",
  );

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("parseExcelFile annual leave visibility", () => {
  it("keeps fingerprint-only workers in attendance but excludes them from annual leave status", () => {
    const parsed = parseExcelFile(makeAttendanceWorkbookBuffer());

    expect(parsed.employees.map((employee) => employee.name)).toEqual(
      expect.arrayContaining(["지문자", "엑셀자"]),
    );
    expect(parsed.leaveEmployees.map((employee) => employee.name)).toEqual(["엑셀자"]);
    expect(parsed.leaveDetails.map((detail) => detail.name)).toEqual(["엑셀자"]);
    expect(parsed.annualLeaveMap["지문자"]).toBeUndefined();
  });
});
