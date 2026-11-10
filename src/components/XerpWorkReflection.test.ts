import { describe, expect, it } from "vitest";
import {
  calcGongsuForWorkDate,
  getFullDayGongsu,
  getSpecialListLabels,
  getTeamConfig,
  inferGasanReason,
  isCheolgolTeam,
  inferNewEmployeeGasanReason,
  normalizeGasanReasonParentheses,
  canBuildDownloadWorkbook,
  detectCheolya,
  hasNoCalcGongsu,
  isWeekendWorkDate,
  resolveEffInMin,
  resolveEffOutMin,
  resolveIsLate,
  resolveStandardStart,
  getSiteShiftMin,
  isSafetyEduEarlyOut,
  inferGasanReasonTags,
  isShopTeam,
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
  standardEnd: 17 * 60,
  shiftMin: 0,
  dayGongsu: 1,
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

  it("타각은 있는데 공수를 계산할 수 없는 행도 특이자 명단에 넣는다", () => {
    const row = { ...baseRow, isLate: false, needsUpdate: false, calcGongsuVal: null };

    expect(hasNoCalcGongsu(row)).toBe(true);
    expect(shouldShowInSpecialList(row)).toBe(true);
    expect(getSpecialListLabels(row)).toContain("데이터없음");
  });

  it("외주·기록없음 행은 데이터없음으로 보지 않는다", () => {
    expect(hasNoCalcGongsu({ ...baseRow, isWaeju: true, calcGongsuVal: null })).toBe(false);
    expect(hasNoCalcGongsu({ ...baseRow, isNoRecord: true, calcGongsuVal: null })).toBe(false);
    expect(hasNoCalcGongsu({ ...baseRow, calcGongsuVal: 1 })).toBe(false);
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

  it("excludes overnight shifts whose dawn checkout is not an early leave", () => {
    expect(shouldShowInEarlyLeaveList({ isWaeju: false, effIn: "19:00", effOut: "05:00", isCheolya: true })).toBe(false);
    expect(shouldShowInEarlyLeaveList({ isWaeju: false, effIn: "07:00", effOut: "01:00" })).toBe(false);
  });
});

describe("철야(야간 전담) 자동 판정", () => {
  it("저녁 출근 기록은 철야로 본다", () => {
    expect(detectCheolya(19 * 60, 5 * 60)).toBe(true);
    expect(detectCheolya(15 * 60, null)).toBe(true);
  });

  it("출근 기록이 없고 새벽에 퇴근한 기록도 철야로 본다", () => {
    expect(detectCheolya(null, 5 * 60)).toBe(true);
  });

  it("주간 출근은 자정을 넘겨 퇴근해도 철야가 아니다", () => {
    expect(detectCheolya(7 * 60, 1 * 60)).toBe(false);
    expect(detectCheolya(8 * 60, 17 * 60)).toBe(false);
    expect(detectCheolya(null, null)).toBe(false);
  });

  it("철야 지각은 주간 07:00이 아니라 철야 기준 19:00으로 판정한다", () => {
    const base = { standardStart: 7 * 60, isCheolya: true };
    expect(resolveIsLate({ ...base, effInMin: 19 * 60 })).toBe(false);
    expect(resolveIsLate({ ...base, effInMin: 19 * 60 + 40 })).toBe(true);
    // 같은 19:00 출근을 주간으로 보면 지각
    expect(resolveIsLate({ effInMin: 19 * 60, standardStart: 7 * 60, isCheolya: false })).toBe(true);
  });

  it("19:10까지 출근은 기준 19:00으로 인정하고, 더 일찍 와도 기준은 19:00", () => {
    expect(resolveEffInMin(19 * 60 + 9, false, defaultTeamConfig, true)).toBe(19 * 60);
    expect(resolveEffInMin(18 * 60, false, defaultTeamConfig, true)).toBe(19 * 60);
    expect(resolveEffInMin(19 * 60 + 40, false, defaultTeamConfig, true)).toBe(19 * 60 + 40);
  });

  it("외주·기록없음 행도 지각으로 보지 않는다", () => {
    const base = { effInMin: 8 * 60, standardStart: 7 * 60 };
    expect(resolveIsLate({ ...base, isWaeju: true })).toBe(false);
    expect(resolveIsLate({ ...base, isNoRecord: true })).toBe(false);
    expect(resolveIsLate({ effInMin: 7 * 60, standardStart: 7 * 60 })).toBe(false);
  });

  it("철야 기준 근무(19:00 출근 / 04:50 퇴근)는 2공수", () => {
    const effInMin = resolveEffInMin(19 * 60, false, defaultTeamConfig, true);
    const effOutMin = resolveEffOutMin("04:50", ""); // 50분 기준 반올림 → 05:00

    const result = calcGongsuForWorkDate(
      "2026-10-20",
      effInMin,
      effOutMin,
      false,
      defaultTeamConfig,
      false,
      true,
    );

    expect(result).toBe(2);
  });

  it("19:00보다 일찍 출근해도 조기 출근분은 철야 공수에 더하지 않는다", () => {
    const effInMin = resolveEffInMin(18 * 60, false, defaultTeamConfig, true);

    const result = calcGongsuForWorkDate(
      "2026-10-20",
      effInMin,
      resolveEffOutMin("04:50", ""),
      false,
      defaultTeamConfig,
      false,
      true,
    );

    expect(result).toBe(2);
  });

  it("타각이 모두 있으면 철야 근무시간을 사유로 쓴다", () => {
    const reason = inferGasanReason({
      xerpIn: "19:00",
      xerpOut: "04:50",
      pmisIn: "18:55",
      pmisOut: "04:52",
      rawInMin: 19 * 60,
      rawOutMin: 5 * 60,
      isLate: false,
      standardStart: 19 * 60,
      xerpGongsuA: "0",
      calcGongsuVal: 2,
      diff: 2,
      isCheolya: true,
    });

    expect(reason).toBe("8h 철야근무");
  });

  it("XERP 퇴근 타각이 없으면 퇴근미타각(철야)으로 쓴다", () => {
    const reason = inferGasanReason({
      xerpIn: "19:00",
      xerpOut: "",
      pmisIn: "18:55",
      pmisOut: "04:52",
      rawInMin: 19 * 60,
      rawOutMin: 5 * 60,
      isLate: false,
      standardStart: 19 * 60,
      xerpGongsuA: "0",
      calcGongsuVal: 2,
      diff: 2,
      isCheolya: true,
    });

    expect(reason).toBe("퇴근미타각(철야)");
  });

  it("XERP 출근·출퇴근 타각이 없는 철야도 빠진 타각을 사유로 쓴다", () => {
    const base = {
      pmisIn: "18:55",
      pmisOut: "04:52",
      rawInMin: 19 * 60,
      rawOutMin: 5 * 60,
      isLate: false,
      standardStart: 19 * 60,
      xerpGongsuA: "0",
      calcGongsuVal: 2,
      diff: 2,
      isCheolya: true,
    };

    expect(inferGasanReason({ ...base, xerpIn: "", xerpOut: "04:50" })).toBe("출근미타각(철야)");
    expect(inferGasanReason({ ...base, xerpIn: "", xerpOut: "" })).toBe("출퇴근미타각(철야)");
  });

  it("기준 퇴근보다 늦게 끝나면 실근무 1시간당 0.25공이 더 붙는다", () => {
    const result = calcGongsuForWorkDate(
      "2026-10-20",
      resolveEffInMin(19 * 60, false, defaultTeamConfig, true),
      resolveEffOutMin("06:50", ""),
      false,
      defaultTeamConfig,
      false,
      true,
    );

    expect(result).toBe(2.5);
  });

  it("주간 출근이 자정을 넘겨 퇴근하면 0공이 아니라 표준 1공 + 초과분 연장으로 계산한다", () => {
    const result = calcGongsuForWorkDate(
      "2026-10-20",
      7 * 60,
      1 * 60,
      false,
      defaultTeamConfig,
    );

    expect(result).toBe(1 + 8 * 0.25);
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

describe("철골공 팀 공수 (주간 만근 2공 · 연장 단가는 기본과 동일)", () => {
  const WEEKDAY = "2026-04-27";
  const CHEOLGOL = "PH2_기술인(철골공)";
  const cheolgolCfg = getTeamConfig(CHEOLGOL);

  it("팀명에 철골이 들어간 팀만 철골공으로 본다", () => {
    expect(isCheolgolTeam(CHEOLGOL)).toBe(true);
    expect(isCheolgolTeam("PH4_기술인(배관)")).toBe(false);
    expect(cheolgolCfg.dayGongsu).toBe(2);
    expect(getFullDayGongsu(CHEOLGOL)).toBe(2);
    expect(getFullDayGongsu("PH4_기술인(배관)")).toBe(1);
  });

  it("출퇴근 기준 시간은 기본 팀과 같다", () => {
    expect(cheolgolCfg.standardStart).toBe(defaultTeamConfig.standardStart);
    expect(cheolgolCfg.jochulCutoff).toBe(defaultTeamConfig.jochulCutoff);
    expect(cheolgolCfg.breakStart).toBe(defaultTeamConfig.breakStart);
    expect(cheolgolCfg.breakEnd).toBe(defaultTeamConfig.breakEnd);
  });

  it("07:00~17:00 만근은 2공수", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60, false, cheolgolCfg)).toBe(2);
  });

  it("연장은 기본과 같이 시간당 0.25공 — 2시간이면 만근 2.0에 0.5가 붙어 2.5공", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 18 * 60, false, cheolgolCfg)).toBe(2.25);
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 19 * 60, false, cheolgolCfg)).toBe(2.5);
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 21 * 60, false, cheolgolCfg)).toBe(3);
  });

  it("연장 50분 미만은 기본 팀과 같이 미인정", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60 + 40, false, cheolgolCfg)).toBe(2);
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60 + 50, false, cheolgolCfg)).toBe(2.25);
  });

  it("표준 8시간을 못 채우면 2공수를 비례 감산한다", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 16 * 60, false, cheolgolCfg)).toBe(1.75);
  });

  it("중식OT는 기본 1.0 대신 팀 만근 2.0으로 확정한다", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60, false, cheolgolCfg, true)).toBe(2);
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60, false, defaultTeamConfig, true)).toBe(1);
  });

  it("기본 팀 공수는 그대로 둔다", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 17 * 60, false, defaultTeamConfig)).toBe(1);
    expect(calcGongsuForWorkDate(WEEKDAY, 7 * 60, 19 * 60, false, defaultTeamConfig)).toBe(1.5);
  });

  it("공수A 2.0(만근)은 야간근무로 오판하지 않고 퇴근 시각 기준 연장 문구를 쓴다", () => {
    const reason = inferGasanReason({
      팀명: CHEOLGOL,
      xerpIn: "07:00",
      xerpOut: "19:00",
      pmisIn: "",
      pmisOut: "",
      rawInMin: 7 * 60,
      rawOutMin: 19 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "2",
      calcGongsuVal: 2.5,
      diff: 0.5,
    });

    expect(reason).toBe("2h 연장근무");
  });

  it("야간근무 기준이 팀 만근 공수에 맞춰 올라간다 — 철골공은 공수A 2.5부터", () => {
    const reason = inferGasanReason({
      팀명: CHEOLGOL,
      xerpIn: "06:43",
      xerpOut: "20:03",
      pmisIn: "",
      pmisOut: "",
      rawInMin: 6 * 60 + 43,
      rawOutMin: 20 * 60,
      isLate: false,
      standardStart: 7 * 60,
      xerpGongsuA: "2.5",
      calcGongsuVal: 2.75,
      diff: 0.25,
    });

    expect(reason).toBe("1h 야간근무");
  });
});

// ── P5 현장: 근무시간이 전체적으로 5분 앞당겨짐 (06:55~16:55) ──
describe("P5 현장 근무시간 5분 앞당김", () => {
  const P5 = "P5PH1";
  const p5Cfg = getTeamConfig("", P5);
  const p4Cfg = getTeamConfig("", "PH4");
  const WEEKDAY = "2026-11-10"; // 화요일
  const SATURDAY = "2026-11-14";

  it("현장 시프트는 P5만 -5분이고 P4는 0분", () => {
    expect(getSiteShiftMin(P5)).toBe(-5);
    expect(getSiteShiftMin("PH4")).toBe(0);
    expect(getSiteShiftMin("PH2")).toBe(0);
    expect(getSiteShiftMin(undefined)).toBe(0);
  });

  it("P5 팀 기준 시각이 모두 5분 앞당겨진다", () => {
    expect(p5Cfg.standardStart).toBe(6 * 60 + 55);
    expect(p5Cfg.jochulCutoff).toBe(7 * 60 + 5);
    expect(p5Cfg.breakStart).toBe(10 * 60 + 55);
    expect(p5Cfg.breakEnd).toBe(12 * 60 + 55);
    expect(p5Cfg.standardEnd).toBe(16 * 60 + 55);
    expect(p5Cfg.shiftMin).toBe(-5);
  });

  it("P4 현장 기준은 그대로 07:00~17:00", () => {
    expect(p4Cfg.standardStart).toBe(7 * 60);
    expect(p4Cfg.jochulCutoff).toBe(7 * 60 + 10);
    expect(p4Cfg.standardEnd).toBe(17 * 60);
    expect(p4Cfg.shiftMin).toBe(0);
  });

  it("샵장(_S) 팀은 현장 시간 변경과 무관하게 기존 기준 그대로", () => {
    expect(isShopTeam("태화_S")).toBe(true);
    expect(isShopTeam("태화_F")).toBe(false);
    expect(isShopTeam("PH1_기술인")).toBe(false);
    const cfg = getTeamConfig("태화_S", P5);
    expect(cfg.shiftMin).toBe(0);
    expect(cfg.standardStart).toBe(7 * 60 + 30);
    expect(cfg.jochulCutoff).toBe(7 * 60 + 40);
    expect(cfg.breakStart).toBe(11 * 60 + 30);
    expect(cfg.standardEnd).toBe(17 * 60);
  });

  it("P5 현장(_F·기술인) 팀만 5분 앞당겨진다", () => {
    expect(getTeamConfig("태화_F", P5).standardStart).toBe(6 * 60 + 55);
    expect(getTeamConfig("PH1_기술인", P5).standardStart).toBe(6 * 60 + 55);
  });

  it("퇴근 50분 반올림 기준선도 5분 앞당겨진다", () => {
    expect(resolveEffOutMin("16:55", "", -5)).toBe(16 * 60 + 55);
    expect(resolveEffOutMin("16:50", "", -5)).toBe(16 * 60 + 55);
    expect(resolveEffOutMin("16:40", "", -5)).toBe(15 * 60 + 55);
    expect(resolveEffOutMin("04:45", "", -5)).toBe(4 * 60 + 55);
    expect(resolveEffOutMin("17:45", "", -5)).toBe(17 * 60 + 55);
    // 기준 현장은 그대로 정시 기준
    expect(resolveEffOutMin("16:55", "")).toBe(17 * 60);
    expect(resolveEffOutMin("04:45", "")).toBe(4 * 60);
  });

  it("P5 철야 기준(18:55 출근 / 04:45 퇴근)은 정확히 2.0공수", () => {
    const effInMin = resolveEffInMin(18 * 60 + 55, false, p5Cfg, true);
    const effOutMin = resolveEffOutMin("04:45", "", p5Cfg.shiftMin);
    expect(calcGongsuForWorkDate(WEEKDAY, effInMin, effOutMin, false, p5Cfg, false, true)).toBe(2);
  });

  it("P5 정시 퇴근(16:55)은 연장 0분 — 1.0공", () => {
    const effOutMin = resolveEffOutMin("16:55", "16:55", p5Cfg.shiftMin);
    expect(effOutMin).toBe(16 * 60 + 55);
    expect(calcGongsuForWorkDate(WEEKDAY, 6 * 60 + 55, effOutMin, false, p5Cfg)).toBe(1);
  });

  it("P5 철골공 팀은 만근 2공수 + 5분 앞당긴 기준", () => {
    const cfg = getTeamConfig("PH1_기술인(철골공)", P5);
    expect(cfg.dayGongsu).toBe(2);
    expect(cfg.standardStart).toBe(6 * 60 + 55);
    expect(cfg.standardEnd).toBe(16 * 60 + 55);
  });

  it("06:55 출근 ~ 17:00 퇴근(16:55 반올림)은 1.0공", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 6 * 60 + 55, 17 * 60, false, p5Cfg)).toBe(1);
  });

  it("07:00 출근은 유예(07:05) 안이라 06:55로 인정 — 지각 아님, 1.0공", () => {
    const effInMin = resolveEffInMin(7 * 60, false, p5Cfg);
    expect(effInMin).toBe(6 * 60 + 55);
    expect(resolveIsLate({ effInMin, standardStart: p5Cfg.standardStart, shiftMin: p5Cfg.shiftMin })).toBe(false);
    expect(calcGongsuForWorkDate(WEEKDAY, effInMin, 17 * 60, false, p5Cfg)).toBe(1);
  });

  it("07:10 출근은 P5에서 지각 (P4에서는 유예 인정)", () => {
    const p5In = resolveEffInMin(7 * 60 + 10, false, p5Cfg);
    expect(p5In).toBe(7 * 60 + 10);
    expect(resolveIsLate({ effInMin: p5In, standardStart: p5Cfg.standardStart, shiftMin: p5Cfg.shiftMin })).toBe(true);
    const p4In = resolveEffInMin(7 * 60 + 5, false, p4Cfg);
    expect(p4In).toBe(7 * 60);
  });

  it("17:00 퇴근은 P5에서 연장이 아니다 (초과 5분)", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 6 * 60 + 55, 17 * 60, false, p5Cfg)).toBe(1);
    expect(inferGasanReasonTags({ rawOutMin: 17 * 60, shiftMin: -5 })).toEqual(["주간"]);
  });

  it("18:00 퇴근은 연장 1시간 → 1.25공", () => {
    expect(calcGongsuForWorkDate(WEEKDAY, 6 * 60 + 55, 18 * 60, false, p5Cfg)).toBe(1.25);
    expect(inferGasanReasonTags({ rawOutMin: 18 * 60, shiftMin: -5 })).toEqual(["주간", "연장"]);
  });

  it("P5 연장 사유 문구는 시간 수를 반올림해 적는다", () => {
    const reason = inferGasanReason({
      팀명: "PH1_기술인",
      xerpIn: "06:50",
      xerpOut: "18:00",
      pmisIn: "06:50",
      pmisOut: "18:00",
      rawInMin: 6 * 60 + 50,
      rawOutMin: 18 * 60,
      isLate: false,
      standardStart: p5Cfg.standardStart,
      shiftMin: -5,
      xerpGongsuA: "1",
      calcGongsuVal: 1.25,
      diff: 0.25,
    });
    expect(reason).toBe("1h 연장근무");
  });

  it("조출은 06:55 이전 1시간마다 +0.25공", () => {
    const effInMin = resolveEffInMin(5 * 60 + 55, true, p5Cfg);
    expect(effInMin).toBe(5 * 60 + 55);
    expect(calcGongsuForWorkDate(WEEKDAY, effInMin, 17 * 60, true, p5Cfg)).toBe(1.25);
  });

  it("철야 자동 판정·기준 출근도 5분 앞당겨진다", () => {
    expect(detectCheolya(14 * 60 + 55, null, -5)).toBe(true);
    expect(detectCheolya(14 * 60 + 50, null, -5)).toBe(false);
    expect(detectCheolya(null, 6 * 60 + 50, -5)).toBe(true);
    expect(resolveStandardStart(p5Cfg, true)).toBe(18 * 60 + 55);
    expect(resolveEffInMin(18 * 60 + 50, false, p5Cfg, true)).toBe(18 * 60 + 55);
    expect(resolveEffInMin(19 * 60 + 10, false, p5Cfg, true)).toBe(19 * 60 + 10);
  });

  it("철야 기준 근무(18:55~04:55 반올림)는 2공수", () => {
    const effInMin = resolveEffInMin(18 * 60 + 55, false, p5Cfg, true);
    expect(calcGongsuForWorkDate(WEEKDAY, effInMin, 4 * 60 + 55, false, p5Cfg, false, true)).toBe(2);
  });

  it("주말 근무도 06:55~13:55 기준 7시간 = 1공", () => {
    expect(calcGongsuForWorkDate(SATURDAY, 6 * 60 + 55, 13 * 60 + 55, false, p5Cfg)).toBe(1);
  });

  it("정기안전교육 빠른 퇴근 구간은 16:15~16:55", () => {
    expect(isSafetyEduEarlyOut(16 * 60 + 15, p5Cfg.standardEnd)).toBe(true);
    expect(isSafetyEduEarlyOut(16 * 60 + 55, p5Cfg.standardEnd)).toBe(true);
    expect(isSafetyEduEarlyOut(17 * 60, p5Cfg.standardEnd)).toBe(false);
    expect(isSafetyEduEarlyOut(16 * 60 + 20, p4Cfg.standardEnd)).toBe(true);
    expect(isSafetyEduEarlyOut(16 * 60 + 15, p4Cfg.standardEnd)).toBe(false);
  });

  it("정기안전교육 가산도 앞당긴 구간으로 반영한다", () => {
    const row = {
      diff: null,
      가산사유: "",
      xerpGongsuA: "0.5",
      xerpIn: "06:55",
      xerpOut: "16:20",
      pmisIn: "06:55",
      pmisOut: "16:20",
      rawInMin: 6 * 60 + 55,
      rawOutMin: 16 * 60,
      isLate: false,
      standardStart: p5Cfg.standardStart,
      shiftMin: -5,
    };
    expect(resolveWritableGasanAdjustment(row, true)).toEqual({ diff: 0.5, reason: "정기안전교육으로 빠른퇴근타각" });
  });

  it("조퇴 기준 퇴근도 12:55로 앞당겨진다", () => {
    expect(shouldShowInEarlyLeaveList({ isWaeju: false, effOut: "12:50", shiftMin: -5 })).toBe(true);
    expect(shouldShowInEarlyLeaveList({ isWaeju: false, effOut: "12:55", shiftMin: -5 })).toBe(false);
    expect(shouldShowInEarlyLeaveList({ isWaeju: false, effOut: "12:55" })).toBe(true);
  });

  it("예전 저장본(시프트 없음)은 기준 현장 규칙 그대로 본다", () => {
    expect(inferGasanReasonTags({ rawOutMin: 18 * 60 })).toEqual(["주간", "연장"]);
    expect(inferGasanReasonTags({ rawOutMin: 17 * 60 })).toEqual(["주간"]);
  });
});
