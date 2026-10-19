import { describe, expect, it } from "vitest";
import {
  calcGongsuForWorkDate,
  getSpecialListLabels,
  inferGasanReason,
  inferNewEmployeeGasanReason,
  normalizeGasanReasonParentheses,
  canBuildDownloadWorkbook,
  isWeekendWorkDate,
  resolveLoadedAdjustment,
  resolveSyncedGasanReason,
  resolveWritableGasanAdjustment,
  shouldShowDownloadActions,
  shouldShowInEarlyLeaveList,
  shouldShowInSpecialList,
  syncManualCalcGongsu,
} from "@/lib/xerpWorkReflectionEngine";

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

describe("XERP work reflection adjustment reasons", () => {
  it("uses only the last work type label inside adjustment reason parentheses", () => {
    const reason = inferGasanReason({
      xerpIn: "07:20",
      xerpOut: "18:00",
      pmisIn: "07:00",
      pmisOut: "18:00",
      rawInMin: 7 * 60,
      rawOutMin: 18 * 60,
      isLate: false,
      standardStart: 7 * 60,
    });

    expect(reason).toBe("출근타각지연(연장)");
    expect(reason).not.toContain("XERP");
  });

  it("uses an overtime tag for missing check-in when the whole 1.5 gongsu is added", () => {
    const reason = inferGasanReason({
      xerpIn: "",
      xerpOut: "18:50",
      pmisIn: "05:48",
      pmisOut: "19:05",
      rawInMin: 5 * 60 + 48,
      rawOutMin: 19 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "0",
      calcGongsuVal: 1.5,
      diff: 1.5,
    });

    expect(reason).toBe("출근미타각(연장)");
  });

  it("uses a fast-checkout reason when PMIS clears an XERP checkout just before the overtime threshold", () => {
    const oneMinute = inferGasanReason({
      xerpIn: "06:31",
      xerpOut: "18:49",
      pmisIn: "06:08",
      pmisOut: "19:03",
      rawInMin: 6 * 60 + 8,
      rawOutMin: 19 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "1",
      calcGongsuVal: 1.5,
      diff: 0.5,
    });
    const twoMinutes = inferGasanReason({
      xerpIn: "06:31",
      xerpOut: "18:48",
      pmisIn: "06:08",
      pmisOut: "19:03",
      rawInMin: 6 * 60 + 8,
      rawOutMin: 19 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "1",
      calcGongsuVal: 1.5,
      diff: 0.5,
    });

    expect(oneMinute).toBe("1분빠른퇴근타각(연장)");
    expect(twoMinutes).toBe("2분빠른퇴근타각(연장)");
  });

  it("uses a night-work reason for the shortage after XERP already reflected work through 19:00", () => {
    const reason = inferGasanReason({
      xerpIn: "06:43",
      xerpOut: "20:03",
      pmisIn: "",
      pmisOut: "",
      rawInMin: 6 * 60 + 43,
      rawOutMin: 20 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "1.5",
      calcGongsuVal: 1.75,
      diff: 0.25,
    });

    expect(reason).toBe("1h 야간근무");
  });

  it("uses early-leave wording for missing checkout on a half-day early leave", () => {
    const reason = inferGasanReason({
      xerpIn: "06:50",
      xerpOut: "",
      pmisIn: "06:37",
      pmisOut: "12:58",
      rawInMin: 6 * 60 + 37,
      rawOutMin: 13 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "0",
      calcGongsuVal: 0.5,
      diff: 0.5,
    });

    expect(reason).toBe("퇴근미타각(조퇴)");
  });

  it("removes old XERP times from saved adjustment reason parentheses", () => {
    const reason = normalizeGasanReasonParentheses("출근타각지연(XERP 07:20)", ["주간", "연장"]);

    expect(reason).toBe("출근타각지연(연장)");
    expect(reason).not.toContain("07:20");
  });

  it("keeps only the last allowed label when a reason has multiple labels", () => {
    const reason = normalizeGasanReasonParentheses("근무인정(주간, 연장, 야간)");

    expect(reason).toBe("근무인정(야간)");
  });
});

describe("XERP work reflection special list", () => {
  const baseRow = {
    isWaeju: false,
    isNoRecord: false,
    isLate: false,
    needsUpdate: false,
    isNewEmployee: false,
  };

  it("excludes rows that only have no XERP record", () => {
    expect(shouldShowInSpecialList({ ...baseRow, isNoRecord: true })).toBe(false);
  });

  it("includes non-no-record rows that are late or need adjustment", () => {
    expect(shouldShowInSpecialList({ ...baseRow, isLate: true })).toBe(true);
    expect(shouldShowInSpecialList({ ...baseRow, needsUpdate: true })).toBe(true);
  });

  it("shows a new employee label for new employee rows", () => {
    expect(getSpecialListLabels({ ...baseRow, isNewEmployee: true })).toContain("신규자");
  });
});

describe("XERP work reflection early leave list", () => {
  const baseRow = {
    isWaeju: false,
    effOut: "13:00",
  };

  it("includes non-outsourced rows whose applied checkout is before 13:00", () => {
    expect(shouldShowInEarlyLeaveList({ ...baseRow, effOut: "12:59" })).toBe(true);
  });

  it("excludes rows whose applied checkout is 13:00 or later", () => {
    expect(shouldShowInEarlyLeaveList({ ...baseRow, effOut: "13:00" })).toBe(false);
    expect(shouldShowInEarlyLeaveList({ ...baseRow, effOut: "17:00" })).toBe(false);
  });

  it("excludes outsourced rows and rows without an applied checkout", () => {
    expect(shouldShowInEarlyLeaveList({ ...baseRow, isWaeju: true, effOut: "12:30" })).toBe(false);
    expect(shouldShowInEarlyLeaveList({ ...baseRow, effOut: "" })).toBe(false);
  });
});

describe("XERP work reflection download actions", () => {
  it("shows download actions whenever loaded rows exist", () => {
    expect(shouldShowDownloadActions(1)).toBe(true);
  });

  it("hides download actions when no rows are loaded", () => {
    expect(shouldShowDownloadActions(0)).toBe(false);
  });

  it("only builds a download when the original workbook buffer is available", () => {
    expect(canBuildDownloadWorkbook(true)).toBe(true);
    expect(canBuildDownloadWorkbook(false)).toBe(false);
  });
});

describe("XERP work reflection saved adjustment loading", () => {
  it("keeps a saved manual adjustment instead of replacing it with recalculated values", () => {
    const result = resolveLoadedAdjustment(
      { diff: 0.5, 가산사유: "사용자 수정 사유" },
      { diff: 0.25, needsUpdate: true, 가산사유: "자동 계산 사유" },
    );

    expect(result).toEqual({
      diff: 0.5,
      needsUpdate: true,
      가산사유: "사용자 수정 사유",
      manualAdjustment: false,
    });
  });

  it("keeps a manually cleared adjustment when the saved row has the manual flag", () => {
    const result = resolveLoadedAdjustment(
      { diff: null, 가산사유: "", manualAdjustment: true },
      { diff: 0.25, needsUpdate: true, 가산사유: "자동 계산 사유" },
    );

    expect(result).toEqual({
      diff: null,
      needsUpdate: false,
      가산사유: "",
      manualAdjustment: true,
    });
  });

  it("preserves 가산사유 such as 예비군 when diff is null but reason was set", () => {
    const result = resolveLoadedAdjustment(
      { diff: null, 가산사유: "예비군", manualAdjustment: true },
      { diff: 0.25, needsUpdate: true, 가산사유: "자동 계산 사유" },
    );

    expect(result).toEqual({
      diff: null,
      needsUpdate: false,
      가산사유: "예비군",
      manualAdjustment: true,
    });
  });

  it("uses recalculated values when the saved row has no adjustment fields", () => {
    const result = resolveLoadedAdjustment(
      {},
      { diff: 0.25, needsUpdate: true, 가산사유: "자동 계산 사유" },
    );

    expect(result).toEqual({
      diff: 0.25,
      needsUpdate: true,
      가산사유: "자동 계산 사유",
      manualAdjustment: false,
    });
  });
});

describe("XERP work reflection XERP&PMIS sync reasons", () => {
  it("persists automatically inferred gasan reasons as saved XERP&PMIS reasons", () => {
    const result = resolveSyncedGasanReason("", {
      reason: "1h 야간근무",
      manualAdjustment: false,
      rawOutMin: 21 * 60,
    });

    expect(result).toBe("1h 야간근무");
  });

  it("persists manually edited gasan reasons when syncing to XERP&PMIS", () => {
    const result = resolveSyncedGasanReason("", {
      reason: "사용자 입력 사유",
      manualAdjustment: true,
      rawOutMin: 21 * 60,
    });

    expect(result).toBe("사용자 입력 사유");
  });

  it("preserves gasan reasons already written in the original workbook", () => {
    const result = resolveSyncedGasanReason("원본 Z열 사유", {
      reason: "자동 추론 사유",
      manualAdjustment: false,
      rawOutMin: 21 * 60,
    });

    expect(result).toBe("원본 Z열 사유");
  });
});

describe("XERP work reflection writable adjustment values", () => {
  const baseRow = {
    diff: null,
    가산사유: "",
    xerpGongsuA: "0.875",
    xerpIn: "07:00",
    xerpOut: "16:30",
    pmisIn: "07:00",
    pmisOut: "16:30",
    rawInMin: 7 * 60,
    rawOutMin: 16 * 60 + 30,
    isLate: false,
    standardStart: 7 * 60,
  };

  it("applies the regular safety-education early-checkout adjustment when syncing or downloading", () => {
    const result = resolveWritableGasanAdjustment(baseRow, true);

    expect(result).toEqual({
      diff: 0.13,
      reason: "정기안전교육으로 빠른퇴근타각",
    });
  });

  it("keeps an automatically inferred reason for normal writable adjustments", () => {
    const result = resolveWritableGasanAdjustment({
      ...baseRow,
      diff: 0.25,
      xerpGongsuA: "1",
      xerpOut: "18:00",
      pmisOut: "18:00",
      rawOutMin: 18 * 60,
    }, false);

    expect(result).toEqual({
      diff: 0.25,
      reason: "1h 연장근무",
    });
  });
});

describe("신규자 가산사유", () => {
  const newEmpRow = {
    xerpIn: "13:29",
    xerpOut: "17:02",
    pmisIn: "",
    pmisOut: "",
    rawInMin: 13 * 60 + 29,
    rawOutMin: 17 * 60,
    isLate: true,
    standardStart: 7 * 60,
    isNewEmployee: true,
  };

  it("XERP 출근 타각이 기준보다 늦으면 출근타각지연으로 적는다", () => {
    expect(inferGasanReason(newEmpRow)).toBe("xerp 승인대기로 인한 출근타각지연(주간)");
  });

  it("퇴근 타각이 없으면 퇴근미타각으로 적는다", () => {
    expect(inferNewEmployeeGasanReason({ xerpIn: "07:00", xerpOut: "", rawOutMin: null, standardStart: 7 * 60 }))
      .toBe("xerp 승인대기로 인한 퇴근미타각(주간)");
  });

  it("출근 타각이 없으면 출근미타각으로 적는다", () => {
    expect(inferNewEmployeeGasanReason({ xerpIn: "", xerpOut: "17:02", rawOutMin: 17 * 60, standardStart: 7 * 60 }))
      .toBe("xerp 승인대기로 인한 출근미타각(주간)");
  });

  it("출퇴근 모두 미타각이면 출퇴근미타각으로 적는다", () => {
    expect(inferNewEmployeeGasanReason({ xerpIn: "", xerpOut: "", rawOutMin: null, standardStart: 7 * 60 }))
      .toBe("xerp 승인대기로 인한 출퇴근미타각(주간)");
  });

  it("타각이 모두 정상이면 공수미반영으로 적는다", () => {
    expect(inferNewEmployeeGasanReason({ xerpIn: "07:00", xerpOut: "17:02", rawOutMin: 17 * 60, standardStart: 7 * 60 }))
      .toBe("xerp 승인대기로 인한 공수미반영(주간)");
  });

  it("신규자가 아니면 기존 사유 규칙을 그대로 쓴다", () => {
    expect(inferGasanReason({ ...newEmpRow, isNewEmployee: false }))
      .not.toContain("xerp 승인대기");
  });
});

describe("syncManualCalcGongsu", () => {
  it("makes 계산공수 = 공수A + 수기 가산B", () => {
    expect(syncManualCalcGongsu({ manualAdjustment: true, diff: 0.5, xerpGongsuA: "1", calcGongsuVal: 1.25 }).calcGongsuVal).toBe(1.5);
    expect(syncManualCalcGongsu({ manualAdjustment: true, diff: 1, xerpGongsuA: "", calcGongsuVal: 0.5 }).calcGongsuVal).toBe(1);
  });
  it("drops back to 공수A when 가산B is cleared", () => {
    expect(syncManualCalcGongsu({ manualAdjustment: true, diff: null, xerpGongsuA: "0.75", calcGongsuVal: 1 }).calcGongsuVal).toBe(0.75);
  });
  it("leaves auto-calculated rows alone", () => {
    expect(syncManualCalcGongsu({ manualAdjustment: false, diff: 0.25, xerpGongsuA: "1", calcGongsuVal: 1.5 }).calcGongsuVal).toBe(1.5);
  });
});
