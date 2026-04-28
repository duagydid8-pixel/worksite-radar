import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { emptyRow, EMPLOYEE_EXPORT_HEADERS, parseImportedSheet } from "./NewEmployeeList";

describe("NewEmployeeList memo field", () => {
  it("creates new rows with an empty memo", () => {
    expect(emptyRow().메모).toBe("");
  });

  it("imports memo text from memo-like Excel headers", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["이름", "주민번호", "메모"],
      ["홍길동", "9001011234567", "안전교육 서류 확인"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "명단");

    expect(parseImportedSheet(wb)[0].메모).toBe("안전교육 서류 확인");
  });

  it("includes memo in Excel export headers", () => {
    expect(EMPLOYEE_EXPORT_HEADERS).toContain("메모");
  });
});
