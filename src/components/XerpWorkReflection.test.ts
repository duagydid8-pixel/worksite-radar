import { describe, expect, it } from "vitest";
import { calcGongsuForWorkDate, isWeekendWorkDate } from "./XerpWorkReflection";

const defaultTeamConfig = {
  standardStart: 7 * 60,
  jochulCutoff: 7 * 60 + 10,
  breakStart: 11 * 60,
  breakEnd: 13 * 60,
};

describe("XERP work reflection gongsu rules", () => {
  it("detects Saturday and Sunday as weekend work dates", () => {
    expect(isWeekendWorkDate("2026-04-25")).toBe(true);
    expect(isWeekendWorkDate("2026-04-26")).toBe(true);
    expect(isWeekendWorkDate("2026-04-27")).toBe(false);
  });

  it("calculates weekend work as 7 hours equals 1 gongsu without lunch deduction", () => {
    const result = calcGongsuForWorkDate(
      "2026-04-25",
      7 * 60,
      14 * 60,
      false,
      defaultTeamConfig,
    );

    expect(result).toBe(1);
  });

  it("calculates weekend partial work at 0.143 gongsu per hour", () => {
    const result = calcGongsuForWorkDate(
      "2026-04-25",
      7 * 60,
      10 * 60,
      false,
      defaultTeamConfig,
    );

    expect(result).toBeCloseTo(0.429, 3);
  });

  it("keeps weekday work on the existing lunch-deduction rule", () => {
    const result = calcGongsuForWorkDate(
      "2026-04-27",
      7 * 60,
      17 * 60,
      false,
      defaultTeamConfig,
    );

    expect(result).toBe(1);
  });
});
