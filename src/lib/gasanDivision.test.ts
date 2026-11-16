import { describe, expect, it } from "vitest";
import {
  GASAN_DIVISIONS,
  classifyGasanDivision,
  gasanDivisionCellValue,
  isGasanDivision,
  shortGasanDivision,
} from "@/lib/xerpWorkReflectionEngine";

const div = (s: string) => classifyGasanDivision(s).division;

describe("classifyGasanDivision (가산사유 → XERP 구분)", () => {
  it("미타각·타각지연은 출퇴근 미체크", () => {
    expect(div("퇴근미타각(주간)")).toBe("출퇴근 미체크");
    expect(div("출퇴근미타각(연장)")).toBe("출퇴근 미체크");
    expect(div("출근타각지연(연장)")).toBe("출퇴근 미체크");
    expect(div("퇴근미타각(조퇴)")).toBe("출퇴근 미체크");
  });

  it("xerp 승인대기 문구는 기타", () => {
    expect(div("xerp 승인대기로 인한 출근타각지연(주간)")).toBe("기타");
    expect(div("XERP 승인대기로 인한 퇴근미타각(주간)")).toBe("기타");
  });

  it("빠른퇴근·지각인정·조퇴는 근무시간부족", () => {
    expect(div("1분빠른퇴근타각(연장)")).toBe("근무시간부족");
    expect(div("지각19분인정(연장)")).toBe("근무시간부족");
    expect(div("오전근무 후 조퇴")).toBe("근무시간부족");
  });

  it("연장·야간·철야 근무는 기준공수변경", () => {
    expect(div("1h 연장근무")).toBe("기준공수변경");
    expect(div("2h 야간근무")).toBe("기준공수변경");
    expect(div("2.5h 연장근무")).toBe("기준공수변경");
    expect(div("10h 철야근무")).toBe("기준공수변경");
    expect(div("철야근무")).toBe("기준공수변경");
    expect(div("주간근무")).toBe("기준공수변경");
  });

  it("미타각이 같이 적힌 건은 출퇴근 미체크가 우선", () => {
    expect(div("퇴근미타각(연장)")).toBe("출퇴근 미체크");
    expect(div("출퇴근미타각(철야)")).toBe("출퇴근 미체크");
  });

  it("단축근무는 기준공수변경 + 확인 필요", () => {
    expect(classifyGasanDivision("6h 근무(주간)")).toEqual({ division: "기준공수변경", certain: false });
  });

  it("조퇴·지각이 적힌 단축근무는 근무시간부족", () => {
    expect(div("7H근무(조퇴)")).toBe("근무시간부족");
  });

  it("중식OT는 점심OT", () => {
    expect(classifyGasanDivision("중식OT")).toEqual({ division: "점심OT", certain: true });
  });

  it("규칙에 없는 문구는 기타 + 확인 필요", () => {
    expect(classifyGasanDivision("정기안전교육으로 빠른퇴근타각")).toEqual({ division: "기타", certain: false });
    expect(classifyGasanDivision("뭔가 새로운 사유")).toEqual({ division: "기타", certain: false });
  });

  it("빈 값은 구분 없음", () => {
    expect(div("")).toBe("");
    expect(div("—")).toBe("");
  });
});

describe("gasanDivisionCellValue (엑셀 Y열에 적을 값)", () => {
  it("기본은 한글 라벨 그대로", () => {
    expect(gasanDivisionCellValue("출퇴근 미체크")).toBe("출퇴근 미체크");
    expect(gasanDivisionCellValue("근무시간부족")).toBe("근무시간부족");
    expect(gasanDivisionCellValue("기준공수변경")).toBe("기준공수변경");
    expect(gasanDivisionCellValue("점심OT")).toBe("점심OT");
    expect(gasanDivisionCellValue("기타")).toBe("기타");
  });

  it("코드값이 필요하면 format만 바꾸면 된다 (목록 순번 — 실제 코드값 확인 전)", () => {
    expect(gasanDivisionCellValue("출퇴근 미체크", "code")).toBe("1");
    expect(gasanDivisionCellValue("근무시간부족", "code")).toBe("2");
    expect(gasanDivisionCellValue("기준공수변경", "code")).toBe("12");
    expect(gasanDivisionCellValue("기타", "code")).toBe("17");
  });

  it("구분이 없으면 빈 값 — Y열을 건드리지 않는다", () => {
    expect(gasanDivisionCellValue("")).toBe("");
    expect(gasanDivisionCellValue("", "code")).toBe("");
  });
});

describe("XERP 드롭다운 목록과 완전 일치", () => {
  it("목록은 XERP 화면 순서·띄어쓰기 그대로", () => {
    expect([...GASAN_DIVISIONS]).toEqual([
      "출퇴근 미체크",
      "근무시간부족",
      "OT 미신청 미승인",
      "시스템 장애",
      "리더기 오류",
      "신규교육",
      "야간작업",
      "점심OT",
      "공장방문",
      "본사출근",
      "프로그램사용미숙",
      "기준공수변경",
      "공휴일",
      "주야간교대조",
      "작업종료 조기퇴근",
      "공장처리",
      "기타",
    ]);
  });

  it("엑셀에 적히는 값은 반드시 목록 안의 문구", () => {
    const 사유들 = [
      "퇴근미타각(주간)", "출퇴근미타각(철야)", "출근타각지연(연장)",
      "xerp 승인대기로 인한 출근타각지연(주간)",
      "1h 연장근무", "2h 야간근무", "10h 철야근무", "철야근무", "주간근무",
      "1분빠른퇴근타각(연장)", "지각19분인정(연장)", "오전근무 후 조퇴",
      "중식OT", "6h 근무(주간)", "정기안전교육으로 빠른퇴근타각", "뭔가 새로운 사유",
    ];
    for (const 사유 of 사유들) {
      const value = gasanDivisionCellValue(classifyGasanDivision(사유).division);
      expect(isGasanDivision(value), `${사유} → "${value}"`).toBe(true);
    }
  });
});

describe("shortGasanDivision (화면 배지)", () => {
  it("긴 라벨을 줄여 준다", () => {
    expect(shortGasanDivision("출퇴근 미체크")).toBe("미체크");
    expect(shortGasanDivision("근무시간부족")).toBe("시간부족");
    expect(shortGasanDivision("기준공수변경")).toBe("기준변경");
    expect(shortGasanDivision("기타")).toBe("기타");
    expect(shortGasanDivision("")).toBe("");
  });
});
