// ── 시간 유틸 ─────────────────────────────────────────
export function parseMin(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    const totalMin = Math.round(val * 24 * 60);
    return totalMin % (24 * 60);
  }
  const s = String(val).trim();
  if (!s) return null;
  // "H:MM AM/PM" or "HH:MM:SS AM/PM" (Excel 12-hour format)
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const d4 = s.match(/^(\d{2})(\d{2})$/);
  if (d4) return parseInt(d4[1]) * 60 + parseInt(d4[2]);
  return null;
}

export function hasClockCellValue(...values: unknown[]): boolean {
  return values.some((value) => {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  });
}

export function minToStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const STANDARD_END       = 17 * 60;  // 17:00
const WEEKEND_START      = 7 * 60;   // 07:00
const WEEKEND_END        = 14 * 60;  // 14:00
const WEEKEND_RATE_PER_HOUR = 0.143;
const WEEKEND_FULL_WORK_MIN = 7 * 60;
const GASAN_REASON_TAG_ORDER = ["조출", "주간", "조퇴", "연장", "야간", "주말OT"] as const;

export type GasanReasonTag = typeof GASAN_REASON_TAG_ORDER[number];

function uniqueGasanReasonTags(tags: GasanReasonTag[]): GasanReasonTag[] {
  return GASAN_REASON_TAG_ORDER.filter((tag) => tags.includes(tag));
}

function formatGasanReasonTags(tags: GasanReasonTag[]): string {
  const orderedTags = uniqueGasanReasonTags(tags);
  return orderedTags[orderedTags.length - 1] ?? "";
}

export function inferGasanReasonTags(row: { rawOutMin: number | null }): GasanReasonTag[] {
  const tags: GasanReasonTag[] = ["주간"];
  if (row.rawOutMin !== null && row.rawOutMin > STANDARD_END) tags.push("연장");
  return uniqueGasanReasonTags(tags);
}

function extractGasanReasonTags(text: string): GasanReasonTag[] {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  const tags: GasanReasonTag[] = [];

  if (compact.includes("조출")) tags.push("조출");
  if (compact.includes("주간")) tags.push("주간");
  if (compact.includes("조퇴")) tags.push("조퇴");
  if (compact.includes("연장")) tags.push("연장");
  if (compact.includes("야간")) tags.push("야간");
  if (compact.includes("주말")) tags.push("주말OT");

  return uniqueGasanReasonTags(tags);
}

export function normalizeGasanReasonParentheses(reason: string, fallbackTags: GasanReasonTag[] = []): string {
  if (!reason.trim()) return "";

  return reason
    .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      const tags = extractGasanReasonTags(inner);
      const label = formatGasanReasonTags(tags.length > 0 ? tags : fallbackTags);
      return label ? `(${label})` : "";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\/\s+/g, " / ")
    .trim();
}

export function cleanGasanReason(value: unknown): string {
  const text = String(value ?? "").trim();
  const compact = text.replace(/\s+/g, "");
  if (!text || ["-", "—", "–", "기타"].includes(compact)) return "";
  return text;
}

export function resolveSyncedGasanReason(
  originalReason: unknown,
  processed?: { reason?: string; manualAdjustment?: boolean; rawOutMin?: number | null } | null,
): string {
  const fallbackTags = inferGasanReasonTags({ rawOutMin: processed?.rawOutMin ?? null });
  const workbookReason = cleanGasanReason(originalReason);
  if (workbookReason) return normalizeGasanReasonParentheses(workbookReason, fallbackTags);
  const processedReason = cleanGasanReason(processed?.reason);
  if (!processedReason) return "";
  return normalizeGasanReasonParentheses(processedReason, fallbackTags);
}

export interface XerpWritableGasanRow {
  diff: number | null;
  가산사유?: string;
  xerpGongsuA?: string;
  xerpIn: string;
  xerpOut: string;
  pmisIn: string;
  pmisOut?: string;
  rawInMin: number | null;
  rawOutMin: number | null;
  isLate: boolean;
  standardStart: number;
}

export function resolveWritableGasanAdjustment(
  row: XerpWritableGasanRow,
  isSafetyEduDate: boolean,
): { diff: number | null; reason: string } {
  const storedReason = cleanGasanReason(row.가산사유);
  let diff = row.diff;
  let reason = normalizeGasanReasonParentheses(
    storedReason || (row.diff !== null ? inferGasanReason(row) : ""),
    inferGasanReasonTags(row),
  );

  if (isSafetyEduDate) {
    const outMin = parseMin(row.xerpOut);
    if (outMin !== null && outMin >= 16 * 60 + 20 && outMin <= 17 * 60) {
      const xerpA = parseNumber(row.xerpGongsuA) ?? 0;
      const safetyDiff = parseFloat(Math.max(0, 1.0 - xerpA).toFixed(2));
      if (safetyDiff > 0) diff = safetyDiff;
      reason = "정기안전교육으로 빠른퇴근타각";
    }
  }

  return { diff, reason };
}

export function excelSerialToDateStr(serial: unknown): string {
  const n = typeof serial === "number" ? serial : parseFloat(String(serial));
  if (isNaN(n) || n <= 0) return "";
  const date = new Date((n - 25569) * 86400 * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── 외주 팀 판별 ──────────────────────────────────────
export function isWaejuTeam(팀명: string): boolean {
  return 팀명.includes("외주");
}

// ── 팀별 출근 기준 시간 ────────────────────────────────
export interface TeamConfig { standardStart: number; jochulCutoff: number; breakStart: number; breakEnd: number; }
export function getTeamConfig(팀명: string): TeamConfig {
  // 기본: 07:00 출근, 11:00~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  // 태화_S: 07:30 출근, 11:30~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  if (팀명.includes("태화_S")) return { standardStart: 7 * 60 + 30, jochulCutoff: 7 * 60 + 40, breakStart: 11 * 60 + 30, breakEnd: 13 * 60 };
  return { standardStart: 7 * 60, jochulCutoff: 7 * 60 + 10, breakStart: 11 * 60, breakEnd: 13 * 60 };
}

function roundBy50(min: number): number {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 50 ? (h + 1) * 60 : h * 60;
}

function parseNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function formatHourCount(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(parseFloat(hours.toFixed(2)));
}

function resolveAddedHourCount(row: {
  diff?: number | null;
  calcGongsuVal?: number | null;
  xerpGongsuA?: string;
}): number | null {
  const diff = row.diff ?? (
    row.calcGongsuVal !== undefined && row.calcGongsuVal !== null
      ? row.calcGongsuVal - (parseNumber(row.xerpGongsuA) ?? 0)
      : null
  );
  if (diff === null || diff <= 0) return null;
  return Math.round((diff / 0.25) * 100) / 100;
}

function resolveFastCheckoutShortageMinutes(row: {
  xerpOut: string;
  pmisOut?: string;
  rawOutMin: number | null;
}): number | null {
  if (row.rawOutMin === null || row.rawOutMin <= STANDARD_END || row.rawOutMin % 60 !== 0) return null;

  const xerpOutMin = parseMin(row.xerpOut);
  const pmisOutMin = parseMin(row.pmisOut);
  if (xerpOutMin === null || pmisOutMin === null || pmisOutMin < row.rawOutMin) return null;

  const nextHourThreshold = row.rawOutMin - 10;
  const shortageMin = nextHourThreshold - xerpOutMin;
  return shortageMin >= 1 && shortageMin <= 2 ? shortageMin : null;
}

/** 가산 사유 자동 추론 */
export function inferGasanReason(row: {
  xerpIn: string; xerpOut: string;
  pmisIn: string; pmisOut?: string;
  rawInMin: number | null; rawOutMin: number | null;
  isLate: boolean; standardStart: number;
  xerpGongsuA?: string;
  calcGongsuVal?: number | null;
  diff?: number | null;
}): string {
  const reasons: string[] = [];
  const noXerpIn  = !row.xerpIn;
  const noXerpOut = !row.xerpOut;
  const hasOvertime = row.rawOutMin !== null && row.rawOutMin > STANDARD_END;
  const reasonTags = inferGasanReasonTags(row);
  const jochulCutoff = row.standardStart + 10;
  const xerpGongsu = parseNumber(row.xerpGongsuA);
  const addedHourCount = resolveAddedHourCount(row);
  const fastCheckoutShortageMin = resolveFastCheckoutShortageMinutes(row);

  const xerpInMin = parseMin(row.xerpIn);
  const pmisInMin = parseMin(row.pmisIn);

  // 출근 관련 사유 판별
  if (noXerpIn && noXerpOut) {
    reasons.push(hasOvertime ? "출퇴근미타각(연장)" : "출퇴근미타각(주간)");
  } else if (noXerpIn) {
    reasons.push(hasOvertime ? "출근미타각(연장)" : "출근미타각(주간)");
  } else {
    // PMIS는 기준 전, XERP는 늦게 찍힌 경우 → 출근 타각 지연
    const pmisOnTime = pmisInMin !== null && pmisInMin <= row.standardStart;
    const xerpLate   = xerpInMin !== null && xerpInMin > row.standardStart;
    if (pmisOnTime && xerpLate) {
      reasons.push(`출근타각지연(${formatGasanReasonTags(reasonTags)})`);
    }
    // 유예 10분 내 지각 → 인정 처리 (isLate = false 이지만 rawInMin이 기준 초과)
    else if (
      row.rawInMin !== null &&
      row.rawInMin > row.standardStart &&
      row.rawInMin < jochulCutoff &&
      !row.isLate
    ) {
      if (xerpInMin !== null && xerpInMin > row.standardStart) {
        const lateMin = xerpInMin - row.standardStart;
        const types = hasOvertime ? "주간, 연장" : "주간";
        reasons.push(`지각${lateMin}분인정(${types})`);
      }
    }
  }

  // 퇴근 관련 사유
  if (noXerpOut && !noXerpIn) {
    const isEarlyLeave = row.rawOutMin !== null && row.rawOutMin <= 13 * 60;
    reasons.push(isEarlyLeave ? "퇴근미타각(조퇴)" : hasOvertime ? "퇴근미타각(연장)" : "퇴근미타각(주간)");
  } else if (fastCheckoutShortageMin !== null) {
    reasons.push(`${fastCheckoutShortageMin}분빠른퇴근타각(연장)`);
  } else if (reasons.length === 0 && hasOvertime) {
    if (xerpGongsu !== null && xerpGongsu >= 1.5 && addedHourCount !== null && addedHourCount > 0) {
      reasons.push(`${formatHourCount(addedHourCount)}h 야간근무`);
    } else {
      const h = (row.rawOutMin! - STANDARD_END) / 60;
      reasons.push(`${formatHourCount(h)}h 연장근무`);
    }
  }

  return normalizeGasanReasonParentheses(reasons.join(" / "), reasonTags);
}

/** 지각 시 출근 시간을 다음 정각으로 올림 (ex. 16:37 → 17:00) */
function ceilToHour(min: number): number {
  const m = min % 60;
  return m === 0 ? min : (Math.floor(min / 60) + 1) * 60;
}

export function resolveEffInMin(rawInMin: number | null, isJochul: boolean, cfg: TeamConfig): number | null {
  if (rawInMin === null) return null;
  if (!isJochul && rawInMin < cfg.jochulCutoff) return cfg.standardStart;
  return rawInMin;
}

export function resolveEffOutMin(xerpOut: unknown, pmisOut: unknown): number | null {
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);
  if (xOMin !== null && pOMin !== null) return Math.max(roundBy50(xOMin), roundBy50(pOMin));
  if (xOMin !== null) return roundBy50(xOMin);
  if (pOMin !== null) return roundBy50(pOMin);
  return null;
}

/**
 * 공수 계산
 *
 * ① 출근 시간이 standardStart 이후 지각이면 다음 정각으로 올림
 * ② standardStart~17:00 표준 시간대 내 근무분 / 480분 = 주간 공수 (최대 1.0)
 * ③ 17:00 이후 연장 시간:
 *    - 주간 8시간 충족(공수 1.0) 시 → 0.25/h (연장 단가)
 *    - 주간 8시간 미충족 시         → 0.125/h (기본 단가, 연장 할증 없음)
 * ④ 조출: standardStart 이전 1시간마다 +0.25
 */
function calcGongsu(effInMin: number | null, effOutMin: number | null, isJochul: boolean, cfg: TeamConfig): number | null {
  if (effInMin === null || effOutMin === null) return null;

  const { standardStart, breakStart, breakEnd } = cfg;
  // 팀 기준 하루 실근무 = 오전(breakStart-standardStart) + 오후(STANDARD_END-breakEnd)
  const standardWorkMin = (breakStart - standardStart) + (STANDARD_END - breakEnd);

  // 지각 시 출근 올림 처리 (standardStart 이후 지각만 적용)
  const ceiledIn = effInMin > standardStart ? ceilToHour(effInMin) : effInMin;
  const lateMin  = effInMin > standardStart ? (ceiledIn - standardStart) : 0;

  const stdIn  = Math.max(ceiledIn, standardStart);
  const stdOut = Math.min(effOutMin, STANDARD_END);

  // 오전 근무 (휴게 시작 전)
  const morningMin   = Math.max(0, Math.min(stdOut, breakStart) - stdIn);
  // 오후 근무 (휴게 종료 후)
  const afternoonMin = Math.max(0, stdOut - Math.max(stdIn, breakEnd));
  const stdWorkMin   = morningMin + afternoonMin;

  // 지각 손실분 차감 후 공수 계산
  const effectiveWorkMin = Math.min(stdWorkMin, standardWorkMin - lateMin);
  const stdGongsu = Math.max(0, effectiveWorkMin / standardWorkMin);

  // 연장 시간 (17:00 이후) — 주간 충족 여부에 따라 단가 분기
  const overtimeMin    = Math.max(0, effOutMin - STANDARD_END);
  const isStdMet       = stdGongsu >= 1.0;
  const overtimeGongsu = (overtimeMin / 60) * (isStdMet ? 0.25 : 0.125);

  // 조출 보너스: standardStart 이전 1시간마다 0.25 (체크 시에만)
  const jochulBonus = isJochul
    ? Math.max(0, Math.floor((standardStart - effInMin) / 60)) * 0.25
    : 0;

  return jochulBonus + stdGongsu + overtimeGongsu;
}

export function isWeekendWorkDate(workDate: string): boolean {
  const m = workDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, month, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== month ||
    date.getDate() !== d
  ) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function calcWeekendGongsu(effInMin: number | null, effOutMin: number | null): number | null {
  if (effInMin === null || effOutMin === null) return null;

  const start = Math.max(effInMin, WEEKEND_START);
  const end = Math.min(effOutMin, WEEKEND_END);
  const workedMin = Math.max(0, end - start);

  if (workedMin >= WEEKEND_FULL_WORK_MIN) return 1;
  return (workedMin / 60) * WEEKEND_RATE_PER_HOUR;
}

export function calcGongsuForWorkDate(
  workDate: string,
  effInMin: number | null,
  effOutMin: number | null,
  isJochul: boolean,
  cfg: TeamConfig,
): number | null {
  if (isWeekendWorkDate(workDate)) return calcWeekendGongsu(effInMin, effOutMin);
  return calcGongsu(effInMin, effOutMin, isJochul, cfg);
}

export function calcDiff(calcVal: number | null, xerpGongsuA: string) {
  const aNum = parseFloat(xerpGongsuA);
  if (calcVal === null || isNaN(aNum)) return { diff: null, needsUpdate: false };
  const d = calcVal - aNum;
  if (d > 0.001) return { diff: d, needsUpdate: true };
  return { diff: null, needsUpdate: false };
}

export interface XerpSpecialListRow {
  isWaeju: boolean;
  isNoRecord: boolean;
  isLate: boolean;
  needsUpdate: boolean;
  isNewEmployee?: boolean;
}

export function shouldShowInSpecialList(row: XerpSpecialListRow): boolean {
  return !row.isWaeju && !row.isNoRecord && (row.isLate || row.needsUpdate);
}

export function getSpecialListLabels(row: XerpSpecialListRow): string[] {
  const labels: string[] = [];
  if (row.isNewEmployee) labels.push("신규자");
  if (row.isLate) labels.push("지각");
  if (row.needsUpdate) labels.push("가산");
  return labels;
}

export interface XerpEarlyLeaveRow {
  isWaeju: boolean;
  effOut: string;
}

export function shouldShowInEarlyLeaveList(row: XerpEarlyLeaveRow): boolean {
  const outMin = parseMin(row.effOut);
  return !row.isWaeju && outMin !== null && outMin < 13 * 60;
}

export function shouldShowDownloadActions(rowCount: number): boolean {
  return rowCount > 0;
}

export function canBuildDownloadWorkbook(hasOriginalBuffer: boolean): boolean {
  return hasOriginalBuffer;
}

export interface XerpAdjustmentState {
  diff: number | null;
  needsUpdate: boolean;
  가산사유: string;
  manualAdjustment: boolean;
}

export function resolveLoadedAdjustment(
  saved: { diff?: number | null; 가산사유?: string; manualAdjustment?: boolean },
  calculated: { diff: number | null; needsUpdate: boolean; 가산사유: string },
): XerpAdjustmentState {
  const savedReason = normalizeGasanReasonParentheses(
    (saved.가산사유 ?? "").trim(),
    extractGasanReasonTags(calculated.가산사유),
  );
  const hasSavedAdjustment =
    Boolean(saved.manualAdjustment) ||
    (saved.diff !== undefined && saved.diff !== null) ||
    savedReason !== "";

  if (!hasSavedAdjustment) {
    return { ...calculated, manualAdjustment: false };
  }

  if (saved.manualAdjustment && (saved.diff === null || saved.diff === undefined || saved.diff <= 0)) {
    return { diff: null, needsUpdate: false, 가산사유: savedReason, manualAdjustment: true };
  }

  const diff = saved.diff !== undefined ? saved.diff : calculated.diff;
  return {
    diff,
    needsUpdate: diff !== null && diff > 0,
    가산사유: savedReason || calculated.가산사유,
    manualAdjustment: Boolean(saved.manualAdjustment),
  };
}
