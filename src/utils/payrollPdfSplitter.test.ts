import { describe, expect, it } from "vitest";
import { buildPayrollPdfSections, extractPayrollEmployeeName } from "./payrollPdfSplitter";

describe("payrollPdfSplitter", () => {
  it("extracts employee name after the 성명 label", () => {
    const text = "2026 년 4 월 임 금 명 세 서 현장명: P4-PH.4 지급일 : 2026.05.20 성명 박슬기 주민등록번호 910514-2408719";

    expect(extractPayrollEmployeeName(text)).toBe("박슬기");
  });

  it("creates one-page sections named by employee", () => {
    const sections = buildPayrollPdfSections([
      "성명 박슬기 주민등록번호 910514-2408719",
      "성명 박재영 주민등록번호 790521-1852828",
    ]);

    expect(sections).toEqual([
      { id: "payroll-page-1", startPage: 1, endPage: 1, name: "박슬기", fileName: "박슬기" },
      { id: "payroll-page-2", startPage: 2, endPage: 2, name: "박재영", fileName: "박재영" },
    ]);
  });

  it("uses unique names when employee names repeat", () => {
    const sections = buildPayrollPdfSections([
      "성명 김한성 주민등록번호 900101-1234567",
      "성명 김한성 주민등록번호 900101-1234567",
    ]);

    expect(sections.map((section) => section.fileName)).toEqual(["김한성", "김한성_2"]);
  });
});
