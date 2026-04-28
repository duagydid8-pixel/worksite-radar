import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyAdditionalWorkToPayroll, parseAdditionalWorkText, readPayrollEmployeeOptions } from "./additionalWorkProcessor";

function makePayrollBuffer(options: { expense2?: number; salary?: number } = {}): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  ws["A1"] = { t: "s", v: "업체" };
  ws["AV1"] = { t: "s", v: "단가" };
  ws["AX1"] = { t: "s", v: "경비(2)" };
  ws["AY1"] = { t: "s", v: "급여액" };
  ws["E2"] = { t: "s", v: "성명" };
  ws["AX2"] = { t: "s", v: "추가공수x단가" };
  ws["E3"] = { t: "s", v: "송승석" };
  ws["C3"] = { t: "s", v: "배관공" };
  ws["AV3"] = { t: "n", v: 190000 };
  ws["AX3"] = { t: "n", v: options.expense2 ?? 0 };
  ws["AY3"] = { t: "n", v: options.salary ?? 5320000 };
  ws["E4"] = { t: "s", v: "정회옥" };
  ws["C4"] = { t: "s", v: "화기/유도원" };
  ws["AV4"] = { t: "n", v: 150000 };
  ws["AX4"] = { t: "n", v: 0 };
  ws["AY4"] = { t: "n", v: 4350000 };
  ws["!ref"] = "A1:AY4";

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "급여대장");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function makeDuplicateNamePayrollBuffer(): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  ws["C1"] = { t: "s", v: "직종" };
  ws["E2"] = { t: "s", v: "성명" };
  ws["I2"] = { t: "s", v: "주민번호" };
  ws["AV1"] = { t: "s", v: "단가" };
  ws["AX1"] = { t: "s", v: "경비(2)" };
  ws["AY1"] = { t: "s", v: "급여액" };
  ws["E3"] = { t: "s", v: "김철수" };
  ws["C3"] = { t: "s", v: "배관" };
  ws["I3"] = { t: "s", v: "800101-1234567" };
  ws["AV3"] = { t: "n", v: 100000 };
  ws["AX3"] = { t: "n", v: 0 };
  ws["AY3"] = { t: "n", v: 2500000 };
  ws["E4"] = { t: "s", v: "김철수" };
  ws["C4"] = { t: "s", v: "도비" };
  ws["I4"] = { t: "s", v: "900202-1234567" };
  ws["AV4"] = { t: "n", v: 200000 };
  ws["AX4"] = { t: "n", v: 0 };
  ws["AY4"] = { t: "n", v: 5000000 };
  ws["!ref"] = "A1:AY4";

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "급여대장");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("additional work processor", () => {
  it("parses scanned table text into additional work rows", () => {
    const rows = parseAdditionalWorkText(`
      이름 공종 추가요청공수
      송승석 공구장 1.00
      정회옥 유도원 0.50
    `);

    expect(rows).toEqual([
      { name: "송승석", trade: "공구장", units: 1, sourceLine: "송승석 공구장 1.00" },
      { name: "정회옥", trade: "유도원", units: 0.5, sourceLine: "정회옥 유도원 0.50" },
    ]);
  });

  it("parses noisy OCR table rows even when the unit is not the last token", () => {
    const rows = parseAdditionalWorkText(`
      | 2 | mas | 유도원 | 2026.03-30 ㅣ 100] 26년4월 | @masstzs _ | = |
      | 6 | 이상민 | 신호수 | 202603-30 ㅣ roo] ded ㅣ 3윙 만근 추가 공수 및 공정관리보조 _ㅎ | 무 |
      | 5 | sue | 신호수 | 202603-30 ㅣ 200] 26년4월 | 3웹 만근 추가 공수 및 공정관리보조 _ㅎ | 무 |
    `);

    expect(rows).toEqual([
      expect.objectContaining({ name: "mas", trade: "유도원", units: 1 }),
      expect.objectContaining({ name: "이상민", trade: "신호수", units: 1 }),
      expect.objectContaining({ name: "sue", trade: "신호수", units: 2 }),
    ]);
  });

  it("writes additional work amount into expense2 and adjusts salary by the delta", async () => {
    const result = await applyAdditionalWorkToPayroll(makePayrollBuffer(), [
      { name: "송승석", trade: "공구장", units: 1.5 },
    ]);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const ws = outputWb.Sheets["급여대장"];

    expect(result.unmatched).toHaveLength(0);
    expect(result.applied).toEqual([
      expect.objectContaining({
        name: "송승석",
        units: 1.5,
        unitPrice: 190000,
        expense2After: 285000,
        salaryAfter: 5605000,
      }),
    ]);
    expect(ws["AX3"]?.v).toBe(285000);
    expect(ws["AY3"]?.v).toBe(5605000);
  });

  it("replaces an existing expense2 amount instead of adding on top of it", async () => {
    const result = await applyAdditionalWorkToPayroll(makePayrollBuffer({ expense2: 10000, salary: 5330000 }), [
      { name: "송승석", trade: "공구장", units: 1 },
    ]);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const ws = outputWb.Sheets["급여대장"];

    expect(ws["AX3"]?.v).toBe(190000);
    expect(ws["AY3"]?.v).toBe(5510000);
  });

  it("reports names that are not present in the payroll workbook", async () => {
    const result = await applyAdditionalWorkToPayroll(makePayrollBuffer(), [
      { name: "없는사람", trade: "배관", units: 1 },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.unmatched).toEqual([
      { name: "없는사람", trade: "배관", units: 1, reason: "급여대장에서 이름을 찾지 못했습니다." },
    ]);
  });

  it("applies to the selected payroll row when duplicate names exist", async () => {
    const options = readPayrollEmployeeOptions(makeDuplicateNamePayrollBuffer());
    const target = options.find((row) => row.residentNo === "900202-1234567");

    const result = await applyAdditionalWorkToPayroll(makeDuplicateNamePayrollBuffer(), [
      { name: "김철수", trade: "도비", units: 1, payrollRowKey: target?.rowKey },
    ]);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const ws = outputWb.Sheets["급여대장"];

    expect(result.unmatched).toHaveLength(0);
    expect(ws["AX3"]?.v).toBe(0);
    expect(ws["AX4"]?.v).toBe(200000);
    expect(ws["AY4"]?.v).toBe(5200000);
  });

  it("keeps duplicate names unmatched until a payroll row is selected", async () => {
    const result = await applyAdditionalWorkToPayroll(makeDuplicateNamePayrollBuffer(), [
      { name: "김철수", trade: "도비", units: 1 },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.unmatched).toEqual([
      { name: "김철수", trade: "도비", units: 1, reason: "급여대장에 같은 이름이 2명 이상 있습니다." },
    ]);
  });

  it("reads payroll employee names for manual OCR correction", () => {
    expect(readPayrollEmployeeOptions(makePayrollBuffer())).toEqual([
      { name: "송승석", jobTitle: "배관공", residentNo: "", rowKey: "급여대장!3" },
      { name: "정회옥", jobTitle: "화기/유도원", residentNo: "", rowKey: "급여대장!4" },
    ]);
  });
});
