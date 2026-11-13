import { describe, expect, it } from "vitest";
import {
  classifyGasanDivision,
  gasanDivisionCellValue,
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

  it("의도된 단축·변경 근무는 기타", () => {
    expect(div("6h 근무(주간)")).toBe("기타");
    expect(div("7H근무(조퇴)")).toBe("기타");
    expect(div("주간근무")).toBe("기타");
  });

  it("규칙에 없는 문구는 기타 + 확인 필요", () => {
    expect(classifyGasanDivision("정기안전교육으로 빠른퇴근타각")).toEqual({ division: "기타", certain: false });
    expect(classifyGasanDivision("중식OT")).toEqual({ division: "기타", certain: false });
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
    expect(gasanDivisionCellValue("기타")).toBe("기타");
  });

  it("코드값이 필요하면 format만 바꾸면 된다", () => {
    expect(gasanDivisionCellValue("출퇴근 미체크", "code")).toBe("100");
    expect(gasanDivisionCellValue("근무시간부족", "code")).toBe("200");
    expect(gasanDivisionCellValue("기타", "code")).toBe("900");
  });

  it("구분이 없으면 빈 값 — Y열을 건드리지 않는다", () => {
    expect(gasanDivisionCellValue("")).toBe("");
    expect(gasanDivisionCellValue("", "code")).toBe("");
  });
});

describe("shortGasanDivision (화면 배지)", () => {
  it("긴 라벨을 줄여 준다", () => {
    expect(shortGasanDivision("출퇴근 미체크")).toBe("미체크");
    expect(shortGasanDivision("근무시간부족")).toBe("시간부족");
    expect(shortGasanDivision("기타")).toBe("기타");
    expect(shortGasanDivision("")).toBe("");
  });
});
