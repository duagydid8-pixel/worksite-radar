import { describe, expect, it } from "vitest";
import { buildElcdCompareRows, personKey } from "./elcdCompare";

describe("buildElcdCompareRows", () => {
  it("checks electronic-card taps only for workers with an XERP check-in", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "김출근", 생년월일: "900101-1234567", xerp출근: "07:00" },
        { 팀명: "A", 직종: "배관", 성명: "이미타각", 생년월일: "900102-1234567", xerp출근: "07:05" },
        { 팀명: "A", 직종: "배관", 성명: "박휴무", 생년월일: "900103-1234567", xerp출근: "" },
      ],
      elcdRows: [
        { name: "김출근", birthday: "900101-1234567", inTime: "06:58" },
      ],
      maskBirth: (value) => value,
    });

    expect(result.map((row) => [row.성명, row.타각여부])).toEqual([
      ["김출근", "Y"],
      ["이미타각", "N"],
    ]);
  });

  it("classifies electronic-card taps without an XERP check-in as missed XERP check-ins", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "김누락", 생년월일: "900101-1234567", xerp출근: "" },
      ],
      elcdRows: [
        { name: "김누락", birthday: "900101-1234567", inTime: "06:58" },
      ],
      maskBirth: (value) => value,
    });

    expect(result).toMatchObject([
      {
        성명: "김누락",
        타각여부: "XERP출근미타각",
        출근: "06:58",
      },
    ]);
  });

  it("flags a worker who tapped on a previous project as 타현장타각", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "김이관", 생년월일: "900101-1234567", xerp출근: "07:00" },
      ],
      elcdRows: [
        { name: "김이관", birthday: "900101-1234567", inTime: "06:58", site: "[P4 Ph2] 이전현장" },
      ],
      maskBirth: (value) => value,
    });

    expect(result).toMatchObject([
      {
        성명: "김이관",
        타각여부: "타현장타각",
        소속현장: "[P4 Ph2] 이전현장",
        출근: "06:58",
      },
    ]);
  });

  it("classifies an admin-marked worker with no tap as 미가입 instead of 미타각", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "김미가입", 생년월일: "900101-1234567", xerp출근: "07:00" },
        { 팀명: "A", 직종: "배관", 성명: "이미타각", 생년월일: "900102-1234567", xerp출근: "07:05" },
      ],
      elcdRows: [],
      maskBirth: (value) => value,
      unregisteredKeys: new Set([personKey("김미가입", "900101-1234567")]),
    });

    expect(result.map((row) => [row.성명, row.타각여부])).toEqual([
      ["김미가입", "미가입"],
      ["이미타각", "N"],
    ]);
  });

  it("does not guess a 이름불일치 match when two XERP workers share the same birth6", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "홍길동", 생년월일: "930215-1234567", xerp출근: "07:00" },
        { 팀명: "B", 직종: "전기", 성명: "김영수", 생년월일: "930215-2234567", xerp출근: "07:10" },
      ],
      // 전자카드에는 홍길동이 이름 다르게("홍 길동") 찍힘. 김영수는 안 찍음.
      elcdRows: [
        { name: "홍 길동", birthday: "930215", inTime: "06:55" },
      ],
      maskBirth: (value) => value,
    });

    const byName = Object.fromEntries(result.map((r) => [r.성명, r.타각여부]));
    expect(byName["김영수"]).toBe("N");
    expect(byName["홍길동"]).toBe("N");
    // 실제 태각자는 미등록 명단으로 노출
    expect(result.some((r) => r.팀명 === "미등록" && r.성명 === "홍 길동")).toBe(true);
  });

  it("uses the resident-number gender digit to disambiguate a shared birth6", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "홍길동", 생년월일: "930215-1234567", xerp출근: "07:00" },
        { 팀명: "B", 직종: "전기", 성명: "김영수", 생년월일: "930215-2234567", xerp출근: "07:10" },
      ],
      elcdRows: [
        { name: "홍길동오타", birthday: "9302151234567", inTime: "06:55" },
      ],
      maskBirth: (value) => value,
    });

    const holgildong = result.find((r) => r.성명 === "홍길동");
    expect(holgildong?.타각여부).toBe("이름불일치");
    expect(holgildong?.elcdName).toBe("홍길동오타");
    expect(result.find((r) => r.성명 === "김영수")?.타각여부).toBe("N");
  });

  it("keeps electronic-card workers missing from the XERP roster as unregistered", () => {
    const result = buildElcdCompareRows({
      xerpRows: [
        { 팀명: "A", 직종: "배관", 성명: "김출근", 생년월일: "900101-1234567", xerp출근: "07:00" },
      ],
      elcdRows: [
        { name: "이외부", birthday: "900104-1234567", inTime: "06:59" },
      ],
      maskBirth: (value) => value,
    });

    expect(result).toMatchObject([
      {
        팀명: "A",
        성명: "김출근",
        타각여부: "N",
      },
      {
        팀명: "미등록",
        성명: "이외부",
        타각여부: "Y",
      },
    ]);
  });
});
