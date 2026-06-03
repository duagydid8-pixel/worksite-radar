import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  changePayrollJobTitles,
  readJobTitleSet,
  resolvePayrollJobTitle,
} from "./payrollJobTitleChanger";

function workbookToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function makeJobListBuffer(jobTitles: string[]): ArrayBuffer {
  const ws: XLSX.WorkSheet = {
    A1: { t: "s", v: "직종표" },
    "!ref": `A1:A${jobTitles.length + 1}`,
  };

  jobTitles.forEach((jobTitle, index) => {
    ws[XLSX.utils.encode_cell({ r: index + 1, c: 0 })] = { t: "s", v: jobTitle };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "직종표");
  return workbookToBuffer(wb);
}

function makePayrollBuffer(): ArrayBuffer {
  const ws: XLSX.WorkSheet = {
    F2: { t: "s", v: "■ 2026년 05월 삼성 평택 초순수 P4 [ph.4] 현장 급여 대장" },
    G5: { t: "s", v: "순번" },
    H5: { t: "s", v: "직종" },
    I5: { t: "s", v: "성명" },
    J5: { t: "s", v: "취득일" },
    Q6: { t: "n", v: 1 },
    R6: { t: "n", v: 2 },
    "!ref": "A2:DG16",
  };

  const rows = [
    ["공사관리자", "나경민"],
    ["차량운행", "이중현"],
    ["도비공", "김두형"],
    ["융착공", "신동민"],
    ["배관공", "강기철"],
    ["보통인부", "강영민"],
    ["신호수", "김헌수"],
    ["용접공", "김보현"],
  ] as const;

  rows.forEach(([jobTitle, name], index) => {
    const row = 7 + index;
    ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { t: "n", v: index + 1 };
    ws[XLSX.utils.encode_cell({ r: row, c: 7 })] = { t: "s", v: jobTitle };
    ws[XLSX.utils.encode_cell({ r: row, c: 8 })] = { t: "s", v: name };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "P4 초순수_P4-PJT Ph4(209명)_Field");
  return workbookToBuffer(wb);
}

describe("payrollJobTitleChanger", () => {
  it("reads allowed job titles from column A and ignores the title row", () => {
    const allowed = readJobTitleSet(makeJobListBuffer(["관리자", "배관공", "보통인부"]));

    expect([...allowed].sort()).toEqual(["관리자", "배관공", "보통인부"]);
  });

  it("normalizes managers, vehicle operation, and unlisted technical job titles", () => {
    const allowed = new Set(["관리자", "배관공", "보통인부", "신호수", "용접공"]);

    expect(resolvePayrollJobTitle("공사관리자", allowed)).toBe("관리자");
    expect(resolvePayrollJobTitle("품질관리자", allowed)).toBe("관리자");
    expect(resolvePayrollJobTitle("차량운행", allowed)).toBe("관리자");
    expect(resolvePayrollJobTitle("배관공", allowed)).toBe("배관공");
    expect(resolvePayrollJobTitle("화기/유도원", allowed)).toBe("보통인부");
  });

  it("patches payroll workbook job title cells while leaving listed titles unchanged", async () => {
    const jobListBuffer = makeJobListBuffer(["관리자", "배관공", "보통인부", "신호수", "용접공"]);

    const result = await changePayrollJobTitles(makePayrollBuffer(), jobListBuffer);
    const outputWb = XLSX.read(result.outputBuffer, { type: "array" });
    const outputWs = outputWb.Sheets["P4 초순수_P4-PJT Ph4(209명)_Field"];

    expect(result.summary).toEqual({ total: 4, manager: 2, fallback: 2 });
    expect(result.changes.map((row) => [row.name, row.before, row.after])).toEqual([
      ["나경민", "공사관리자", "관리자"],
      ["이중현", "차량운행", "관리자"],
      ["김두형", "도비공", "보통인부"],
      ["신동민", "융착공", "보통인부"],
    ]);

    expect(outputWs["H8"]?.v).toBe("관리자");
    expect(outputWs["H9"]?.v).toBe("관리자");
    expect(outputWs["H10"]?.v).toBe("보통인부");
    expect(outputWs["H11"]?.v).toBe("보통인부");
    expect(outputWs["H12"]?.v).toBe("배관공");
    expect(outputWs["H13"]?.v).toBe("보통인부");
    expect(outputWs["H14"]?.v).toBe("신호수");
    expect(outputWs["H15"]?.v).toBe("용접공");
  });
});
