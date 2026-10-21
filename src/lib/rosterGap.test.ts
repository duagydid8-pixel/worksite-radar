import { describe, expect, it } from "vitest";
import {
  birthToJuminFront,
  buildRosterRow,
  findIncompletePersonalInfo,
  findUnregistered,
  missingPersonalInfo,
} from "./rosterGap";

const ROWS = [
  { 성명: "홍길동", 팀명: "한성_F" },
  { 성명: "김 철수", 팀명: "태화_S" },
  { 성명: "홍길동", 팀명: "한성_F" }, // 같은 사람이 여러 줄
  { 성명: "박외주", 팀명: "외주_도장", isWaeju: true },
  { 성명: "", 팀명: "한성_F" },
];

const ROSTER = [
  { 이름: "홍길동", 주민번호: "900101-1234567", 연락처: "010-1234-5678", 은행명: "국민", 계좌번호: "12345678901", 주소: "평택시" },
  { 이름: "이영희", 주민번호: "", 연락처: "", 은행명: "", 계좌번호: "", 주소: "" },
];

describe("rosterGap", () => {
  it("명단에 없는 사람만 찾고 외주·빈 이름·중복은 뺀다", () => {
    expect(findUnregistered(ROWS, ROSTER)).toEqual([{ 성명: "김 철수", 팀명: "태화_S" }]);
  });

  it("이름의 공백은 무시하고 같은 사람으로 본다", () => {
    expect(findUnregistered(ROWS, [...ROSTER, { 이름: "김철수" }])).toEqual([]);
  });

  it("빈 개인정보 항목을 집어낸다", () => {
    expect(missingPersonalInfo(ROSTER[0])).toEqual([]);
    expect(missingPersonalInfo(ROSTER[1])).toEqual(["주민번호", "연락처", "은행명", "계좌번호", "주소"]);
    // 주민번호 앞자리만 들어간 행은 아직 부족한 것으로 본다
    expect(missingPersonalInfo({ 이름: "김철수", 주민번호: "961201-" })).toContain("주민번호");
  });

  it("이번 공수에 나온 사람 중 개인정보가 빈 사람만 알려준다 (퇴사자 제외)", () => {
    const roster = [{ 이름: "홍길동", 주민번호: "900101-123456", 연락처: "", 은행명: "", 계좌번호: "", 주소: "" }];
    expect(findIncompletePersonalInfo(ROWS, roster)).toEqual([
      { 이름: "홍길동", 팀명: "한성_F", missing: ["주민번호", "연락처", "은행명", "계좌번호", "주소"] },
    ]);
    // 명단에 없는 사람(이영희)은 여기 말고 findUnregistered에서 잡는다
    expect(findIncompletePersonalInfo(ROWS, ROSTER)).toEqual([]);
    expect(findIncompletePersonalInfo(ROWS, [{ 이름: "홍길동", 퇴사일: "2026-10-01" }])).toEqual([]);
  });

  it("생년월일을 주민번호 앞자리로 바꾼다", () => {
    expect(birthToJuminFront("1996-12-01")).toBe("961201");
    expect(birthToJuminFront("19961201")).toBe("961201");
    expect(birthToJuminFront("961201")).toBe("961201");
    expect(birthToJuminFront("")).toBe("");
  });

  it("명단 행은 이름·소속·입사일을 채우고 개인정보는 비워 둔다", () => {
    const row = buildRosterRow({ 성명: "김 철수", 팀명: "태화_S", 입사일: "2026-10-22", 생년월일: "1996-12-01", 단가: "180000", 메모: "자동 추가" });
    expect(row.이름).toBe("김 철수");
    expect(row.현장구분).toBe("태화_S");
    expect(row.입사일).toBe("2026-10-22");
    expect(row.주민번호).toBe("961201-");
    expect(row.단가).toBe("180000");
    expect(row.연락처).toBe("");
    expect(row.계좌번호).toBe("");
    expect(row.id).toBeTruthy();
  });
});
