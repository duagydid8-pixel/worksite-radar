import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { emptyRow, EMPLOYEE_EXPORT_HEADERS, getEmployeeStatusCounts, parseImportedSheet } from "./NewEmployeeList";

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

describe("NewEmployeeList import cleanup", () => {
  it("ignores imported rows without a name even when other cells are filled", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["성명", "주민등록번호", "입사일", "퇴사일"],
      ["", "9001011234567", "2026.01.01", "2026.05.01"],
      ["김철수", "9001021234567", "2026.01.02", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근로자 등록");

    expect(parseImportedSheet(wb).map((row) => row.이름)).toEqual(["김철수"]);
  });

  it("prefers explicit worker-registration headers over legacy fixed columns", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "사번", "성명", "주민등록번호", "성별", "연락처", "본인인증", "APP", "기본주소",
        "소속팀", "직종", "직급", "근로자", "반장", "재직", "노조", "근무현장",
        "입사일", "퇴사일", "노임", "은행", "계좌번호", "계좌확인", "단가",
      ],
      [
        "308870", "전효영", "930627-2528114", "여", "010-5833-7222", "2026.05.27", "Y",
        "경기도 평택시", "P5-PH1_인원", "품질관리자", "", "N", "N", "재직", "N",
        "평택 P5-PH1 초순수", "2026.05.27", "", "월급", "국민", "23270204369421",
        "정상", 2500000,
      ],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근로자 등록");

    expect(parseImportedSheet(wb)[0]).toMatchObject({
      현장구분: "P5-PH1_인원",
      이름: "전효영",
      주민번호: "930627-2528114",
      연락처: "010-5833-7222",
      남여: "여",
      입사일: "2026-05-27",
      퇴사일: "",
      신청공종: "품질관리자",
      단가: "2500000",
      단가변동: "월급",
      은행명: "국민",
      계좌번호: "23270204369421",
      주소: "경기도 평택시",
    });
  });

  it("does not count nameless or date-incomplete rows as resigned", () => {
    expect(getEmployeeStatusCounts([
      { 이름: "", 입사일: "", 퇴사일: "2026-05-01" },
      { 이름: "재직자", 입사일: "2026-01-01", 퇴사일: "" },
      { 이름: "퇴사자", 입사일: "2026-01-01", 퇴사일: "2026-05-01" },
      { 이름: "날짜누락", 입사일: "", 퇴사일: "" },
    ])).toEqual({ total: 3, active: 1, resigned: 1, unknown: 1 });
  });
});
