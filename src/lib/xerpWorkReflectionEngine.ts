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
const GASAN_REASON_TAG_ORDER = ["조출", "주간", "조퇴", "연장", "야간", "철야", "주말OT"] as const;
const LUNCH_OT_REASON = "중식OT";
const NEW_EMP_REASON_PREFIX = "xerp 승인대기로 인한 ";
const CHEOLYA_CROSS_MIDNIGHT_THRESHOLD = 12 * 60; // 철야 체크 시, 이 시각 이전 퇴근 기록은 익일로 간주
const CHEOLYA_BREAK_MIN = 120; // 철야 고정 휴게(저녁·야식) 2시간
const CHEOLYA_HOURLY_RATE = 0.25; // 19:00~05:00 철야: 실근무 1시간당 0.25공 (예: 8시간 근무 = 2.0공)
const CHEOLYA_AUTO_IN_MIN = 15 * 60;  // 15:00 이후 출근 → 야간 전담(철야) 근무로 자동 판정
const CHEOLYA_AUTO_OUT_MAX = 7 * 60;  // 출근 기록 없이 07:00 이전 퇴근 → 철야로 자동 판정
export const CHEOLYA_START = 19 * 60; // 철야 기준 출근 19:00 (이보다 일찍 와도 기준은 19:00)
const CHEOLYA_GRACE_CUTOFF = CHEOLYA_START + 10; // 19:10까지 출근은 정시 인정
const OVERTIME_RATE_PER_HOUR = 0.25;  // 연장: 표준 8시간 초과분 시간당 0.25공
const DEFAULT_DAY_GONGSU = 1;         // 주간(표준 8시간) 만근 공수
const CHEOLGOL_DAY_GONGSU = 2;        // 철골공 팀 주간 만근 2공수 (연장은 기본과 같이 시간당 0.25공)
const SAFETY_EDU_EARLY_OUT_MIN = 40;  // 정기안전교육 빠른 퇴근 인정 구간 — 표준 퇴근 40분 전부터 (기준 현장 16:20~17:00)
const EARLY_LEAVE_CUTOFF = 13 * 60;   // 조퇴 판정 기준 퇴근 시각 (기준 현장 13:00)
const OVERTIME_ROUND_MIN = 50;        // 연장은 50분부터 1시간으로 인정

// ── 현장별 근무시간 시프트 ─────────────────────────────
export type GongsuSite = "PH4" | "PH2" | "P5PH1";

/**
 * 현장별 근무시간 시프트(분) — 기준 현장(P4)은 0.
 * P5 현장은 근무시간이 전체적으로 5분 앞당겨졌다 (07:00~17:00 → 06:55~16:55).
 * 출근·퇴근·점심·조출·지각유예·철야·주말·정기안전교육·조퇴 기준이 모두 같이 당겨진다.
 */
const SITE_SHIFT_MIN: Record<GongsuSite, number> = { PH4: 0, PH2: 0, P5PH1: -5 };

export function getSiteShiftMin(site?: GongsuSite | string | null): number {
  if (!site) return 0;
  return SITE_SHIFT_MIN[site as GongsuSite] ?? 0;
}

/** 그 현장의 표준 퇴근 시각 */
export function resolveStandardEnd(shiftMin = 0): number {
  return STANDARD_END + shiftMin;
}

/** 저장된 행의 현장 시프트 — 예전 저장본은 비어 있어 기준 현장(0분)으로 본다 */
function rowShiftMin(row: { shiftMin?: number }): number {
  return row.shiftMin ?? 0;
}

function rowStandardEnd(row: { shiftMin?: number }): number {
  return STANDARD_END + rowShiftMin(row);
}

/** 연장 시간 수 — 표준 퇴근 초과분을 50분 기준으로 시간 단위 반올림 */
function overtimeHourCount(rawOutMin: number | null, standardEnd: number): number {
  if (rawOutMin === null) return 0;
  const excess = Math.max(0, rawOutMin - standardEnd);
  return Math.floor(excess / 60) + (excess % 60 >= OVERTIME_ROUND_MIN ? 1 : 0);
}

/** 연장 인정 여부 — 50분 미만 초과는 연장으로 보지 않는다 */
function hasOvertimeOut(rawOutMin: number | null, standardEnd: number): boolean {
  return overtimeHourCount(rawOutMin, standardEnd) > 0;
}

/** 조퇴 판정 기준 퇴근 시각 */
export function resolveEarlyLeaveCutoff(shiftMin = 0): number {
  return EARLY_LEAVE_CUTOFF + shiftMin;
}

/** 정기안전교육 빠른 퇴근 구간(표준 퇴근 40분 전 ~ 표준 퇴근) */
export function isSafetyEduEarlyOut(outMin: number | null, standardEnd = STANDARD_END): boolean {
  if (outMin === null) return false;
  return outMin >= standardEnd - SAFETY_EDU_EARLY_OUT_MIN && outMin <= standardEnd;
}

export type GasanReasonTag = typeof GASAN_REASON_TAG_ORDER[number];

function uniqueGasanReasonTags(tags: GasanReasonTag[]): GasanReasonTag[] {
  return GASAN_REASON_TAG_ORDER.filter((tag) => tags.includes(tag));
}

function formatGasanReasonTags(tags: GasanReasonTag[]): string {
  const orderedTags = uniqueGasanReasonTags(tags);
  return orderedTags[orderedTags.length - 1] ?? "";
}

/**
 * 철야(야간 전담) 근무 자동 판정 — 저녁 출근은 주간 교대일 수 없다.
 * ① 출근 기록이 15:00 이후 → 철야
 * ② 출근 기록이 없고 퇴근이 07:00 이전(자정을 넘긴 새벽 퇴근) → 철야
 * 주간에 출근해 자정을 넘겨 일한 경우는 철야가 아니라 연장이므로 제외한다.
 * 현장 시프트(P5 -5분)만큼 두 기준도 함께 당겨진다.
 */
export function detectCheolya(rawInMin: number | null, rawOutMin: number | null, shiftMin = 0): boolean {
  if (rawInMin !== null) return rawInMin >= CHEOLYA_AUTO_IN_MIN + shiftMin;
  return rawOutMin !== null && rawOutMin < CHEOLYA_AUTO_OUT_MAX + shiftMin;
}

/** 지각 판정 — 철야 근무자는 주간 기준(07:00)이 아니라 철야 기준 19:00과 비교한다 */
export function resolveIsLate(row: {
  effInMin: number | null;
  standardStart: number;
  isWaeju?: boolean;
  isNoRecord?: boolean;
  isCheolya?: boolean;
  shiftMin?: number;
}): boolean {
  if (row.isWaeju || row.isNoRecord) return false;
  const standardStart = row.isCheolya ? CHEOLYA_START + rowShiftMin(row) : row.standardStart;
  return row.effInMin !== null && row.effInMin > standardStart;
}

/** 철야 체크 시 자정을 넘긴 퇴근 기록(예: 01:00)을 익일 시각으로 보정 */
export function resolveCheolyaEffOutMin(rawOutMin: number | null, isCheolya: boolean): number | null {
  if (rawOutMin === null) return null;
  if (isCheolya && rawOutMin < CHEOLYA_CROSS_MIDNIGHT_THRESHOLD) return rawOutMin + 24 * 60;
  return rawOutMin;
}

/**
 * 철야(야간 전담) 근무 공수 — 경과시간에서 고정 휴게 2시간을 뺀 실근무시간 × 0.25공/h
 * 기준 근무 19:00 출근 ~ 04:50 퇴근(50분 기준 반올림 → 05:00) = 경과 10h - 휴게 2h = 실근무 8h = 2.0공
 */
function calcCheolyaGongsu(effInMin: number | null, effOutMin: number | null): number | null {
  if (effInMin === null || effOutMin === null) return null;
  const adjustedOutMin = resolveCheolyaEffOutMin(effOutMin, true)!;
  const elapsedMin = adjustedOutMin - effInMin;
  const workMin = Math.max(0, elapsedMin - CHEOLYA_BREAK_MIN);
  return (workMin / 60) * CHEOLYA_HOURLY_RATE;
}

export function inferGasanReasonTags(row: { rawOutMin: number | null; isCheolya?: boolean; shiftMin?: number }): GasanReasonTag[] {
  const tags: GasanReasonTag[] = ["주간"];
  if (row.isCheolya) tags.push("철야");
  else if (hasOvertimeOut(row.rawOutMin, rowStandardEnd(row))) tags.push("연장");
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
  if (compact.includes("철야")) tags.push("철야");
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
  shiftMin?: number;
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
    if (isSafetyEduEarlyOut(outMin, rowStandardEnd(row))) {
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

// ── 샵장 팀 판별 ──────────────────────────────────────
/**
 * 샵장(SHOP) 팀 — 팀명 뒤에 _S가 붙는다 (예: 태화_S). _F(현장)·_W와 구분된다.
 * 현장 근무시간이 바뀌어도 샵장 인원은 기존 기준을 그대로 쓴다.
 */
export function isShopTeam(팀명: string): boolean {
  return 팀명.split(/[_\s]/).some((part) => part.trim().toUpperCase() === "S") || 팀명.includes("샵");
}

// ── 철골공 팀 판별 ─────────────────────────────────────
/** 철골공 팀 (예: PH2_기술인(철골공)) — 출퇴근 기준·연장 단가는 같고 주간 만근만 2공 */
export function isCheolgolTeam(팀명: string): boolean {
  return 팀명.includes("철골");
}

// ── 팀별 출근 기준 시간·공수 ───────────────────────────
export interface TeamConfig {
  standardStart: number;
  jochulCutoff: number;
  breakStart: number;
  breakEnd: number;
  /** 표준 퇴근 시각 — 기준 현장 17:00, P5 현장 16:55 */
  standardEnd: number;
  /** 현장별 근무시간 시프트(분) — 기준 현장 0, P5 현장 -5 */
  shiftMin: number;
  /** 주간(표준 8시간) 만근 공수 — 기본 1.0, 철골공 팀 2.0 */
  dayGongsu: number;
}
export function getTeamConfig(팀명: string, site?: GongsuSite | string | null): TeamConfig {
  // 기본: 07:00 출근, 11:00~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  // 태화_S: 07:30 출근, 11:30~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  // 철골공: 출퇴근 기준·연장 단가는 기본과 같고 주간 만근만 2공
  // P5 현장(site "P5PH1"): 위 기준이 전체적으로 5분 앞당겨짐 (06:55~16:55, 점심 10:55~12:55)
  // 단, 샵장(_S) 팀은 현장 근무시간 변경과 무관하게 기존 기준을 그대로 쓴다
  const shiftMin = isShopTeam(팀명) ? 0 : getSiteShiftMin(site);
  const dayGongsu = isCheolgolTeam(팀명) ? CHEOLGOL_DAY_GONGSU : DEFAULT_DAY_GONGSU;
  const base = 팀명.includes("태화_S")
    ? { standardStart: 7 * 60 + 30, jochulCutoff: 7 * 60 + 40, breakStart: 11 * 60 + 30, breakEnd: 13 * 60 }
    : { standardStart: 7 * 60,      jochulCutoff: 7 * 60 + 10, breakStart: 11 * 60,      breakEnd: 13 * 60 };
  return {
    standardStart: base.standardStart + shiftMin,
    jochulCutoff:  base.jochulCutoff + shiftMin,
    breakStart:    base.breakStart + shiftMin,
    breakEnd:      base.breakEnd + shiftMin,
    standardEnd:   STANDARD_END + shiftMin,
    shiftMin,
    dayGongsu,
  };
}

/** 그 팀의 만근 공수 — 신규자·정기안전교육처럼 하루를 만근으로 확정하는 자리에 쓴다 */
export function getFullDayGongsu(팀명: string): number {
  return getTeamConfig(팀명).dayGongsu;
}

/**
 * 퇴근 시각 50분 기준 반올림 — 현장 기준 시각에 맞춰 올린다.
 * 기준 현장은 정시(17:00·18:00), P5 현장은 5분 앞당긴 시각(16:55·17:55)이 기준선이다.
 * 예) P5에서 04:45 퇴근 → 04:55 (철야 기준 퇴근), 16:55 퇴근 → 16:55 (연장 0분)
 */
function roundBy50(min: number, shiftMin = 0): number {
  const base = min - shiftMin;
  const h = Math.floor(base / 60);
  const m = base % 60;
  return (m >= 50 ? (h + 1) * 60 : h * 60) + shiftMin;
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
  shiftMin?: number;
}): number | null {
  if (row.rawOutMin === null || (row.rawOutMin - rowShiftMin(row)) % 60 !== 0) return null;
  if (!hasOvertimeOut(row.rawOutMin, rowStandardEnd(row))) return null;

  const xerpOutMin = parseMin(row.xerpOut);
  const pmisOutMin = parseMin(row.pmisOut);
  if (xerpOutMin === null || pmisOutMin === null || pmisOutMin < row.rawOutMin) return null;

  const nextHourThreshold = row.rawOutMin - 10;
  const shortageMin = nextHourThreshold - xerpOutMin;
  return shortageMin >= 1 && shortageMin <= 2 ? shortageMin : null;
}

/** 가산 사유 자동 추론 */
/**
 * 신규자 가산사유 — 신규 등록자는 XERP 승인이 나기 전이라 타각/공수가 비어 있거나 늦게 찍힌다.
 * 예) "xerp 승인대기로 인한 출근타각지연(주간)", "xerp 승인대기로 인한 퇴근미타각(주간)"
 */
export function inferNewEmployeeGasanReason(row: {
  xerpIn: string; xerpOut: string;
  rawOutMin: number | null;
  standardStart: number;
  isCheolya?: boolean;
  shiftMin?: number;
}): string {
  const tagLabel = formatGasanReasonTags(inferGasanReasonTags(row)) || "주간";
  const noXerpIn  = !row.xerpIn;
  const noXerpOut = !row.xerpOut;
  const xerpInMin = parseMin(row.xerpIn);

  const reasons: string[] = [];
  if (noXerpIn && noXerpOut) {
    reasons.push(`출퇴근미타각(${tagLabel})`);
  } else {
    if (noXerpIn) reasons.push(`출근미타각(${tagLabel})`);
    else if (xerpInMin !== null && xerpInMin > row.standardStart) reasons.push(`출근타각지연(${tagLabel})`);
    if (noXerpOut) reasons.push(`퇴근미타각(${tagLabel})`);
  }
  if (reasons.length === 0) reasons.push(`공수미반영(${tagLabel})`);

  return `${NEW_EMP_REASON_PREFIX}${reasons.join(" / ")}`;
}

export function inferGasanReason(row: {
  xerpIn: string; xerpOut: string;
  pmisIn: string; pmisOut?: string;
  rawInMin: number | null; rawOutMin: number | null;
  isLate: boolean; standardStart: number;
  xerpGongsuA?: string;
  calcGongsuVal?: number | null;
  diff?: number | null;
  isLunchOt?: boolean;
  isCheolya?: boolean;
  isNewEmployee?: boolean;
  팀명?: string;
  shiftMin?: number;
}): string {
  if (row.isNewEmployee) return inferNewEmployeeGasanReason(row);
  if (row.isLunchOt) return LUNCH_OT_REASON;
  if (row.isCheolya) {
    // XERP 타각이 빠진 날은 근무시간 문구가 아니라 빠진 타각을 사유로 쓴다
    if (!row.xerpIn && !row.xerpOut) return "출퇴근미타각(철야)";
    if (!row.xerpIn) return "출근미타각(철야)";
    if (!row.xerpOut) return "퇴근미타각(철야)";
    const hours = row.calcGongsuVal !== undefined && row.calcGongsuVal !== null
      ? row.calcGongsuVal / CHEOLYA_HOURLY_RATE
      : null;
    return hours !== null && hours > 0 ? `${formatHourCount(hours)}h 철야근무` : "철야근무";
  }

  const reasons: string[] = [];
  const noXerpIn  = !row.xerpIn;
  const noXerpOut = !row.xerpOut;
  const standardEnd = rowStandardEnd(row);
  const hasOvertime = hasOvertimeOut(row.rawOutMin, standardEnd);
  const reasonTags = inferGasanReasonTags(row);
  const jochulCutoff = row.standardStart + 10;
  const xerpGongsu = parseNumber(row.xerpGongsuA);
  const { dayGongsu } = getTeamConfig(row.팀명 ?? "");
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
    const isEarlyLeave = row.rawOutMin !== null && row.rawOutMin <= resolveEarlyLeaveCutoff(rowShiftMin(row));
    reasons.push(isEarlyLeave ? "퇴근미타각(조퇴)" : hasOvertime ? "퇴근미타각(연장)" : "퇴근미타각(주간)");
  } else if (fastCheckoutShortageMin !== null) {
    reasons.push(`${fastCheckoutShortageMin}분빠른퇴근타각(연장)`);
  } else if (reasons.length === 0 && hasOvertime) {
    // 기준은 팀 만근 공수 + 0.5 — 철골공 팀은 공수A가 2.0부터 시작하므로 2.5 이상일 때만 야간근무
    if (xerpGongsu !== null && xerpGongsu >= dayGongsu + 0.5 && addedHourCount !== null && addedHourCount > 0) {
      reasons.push(`${formatHourCount(addedHourCount)}h 야간근무`);
    } else {
      reasons.push(`${formatHourCount(overtimeHourCount(row.rawOutMin, standardEnd))}h 연장근무`);
    }
  }

  return normalizeGasanReasonParentheses(reasons.join(" / "), reasonTags);
}

/** 철야 적용 출근 — 19:10까지 출근은 기준 19:00으로 인정, 더 늦으면 실제 타각 시각(지각) */
export function resolveCheolyaEffInMin(rawInMin: number | null, shiftMin = 0): number | null {
  if (rawInMin === null) return null;
  return rawInMin < CHEOLYA_GRACE_CUTOFF + shiftMin ? CHEOLYA_START + shiftMin : rawInMin;
}

/** 출근 기준 시각 — 철야는 팀 주간 기준(07:00·07:30)이 아니라 19:00 (현장 시프트 적용) */
export function resolveStandardStart(cfg: TeamConfig, isCheolya = false): number {
  return isCheolya ? CHEOLYA_START + (cfg.shiftMin ?? 0) : cfg.standardStart;
}

export function resolveEffInMin(rawInMin: number | null, isJochul: boolean, cfg: TeamConfig, isCheolya = false): number | null {
  if (rawInMin === null) return null;
  if (isCheolya) return resolveCheolyaEffInMin(rawInMin, cfg.shiftMin ?? 0);
  if (!isJochul && rawInMin < cfg.jochulCutoff) return cfg.standardStart;
  return rawInMin;
}

export function resolveEffOutMin(xerpOut: unknown, pmisOut: unknown, shiftMin = 0): number | null {
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);
  if (xOMin !== null && pOMin !== null) return Math.max(roundBy50(xOMin, shiftMin), roundBy50(pOMin, shiftMin));
  if (xOMin !== null) return roundBy50(xOMin, shiftMin);
  if (pOMin !== null) return roundBy50(pOMin, shiftMin);
  return null;
}

/**
 * 공수 계산
 *
 * ① standardStart~퇴근 사이 실근무시간(점심 제외) 집계 — 지각해도 그만큼 더 늦게까지
 *    일해서 표준 8시간을 채우면 지각 손실 없이 팀 만근 공수(cfg.dayGongsu) 전액 인정
 * ② 표준 8시간 미충족 시에는 채운 비율만큼 비례 감산 (예: 7시간 근무 = 0.875)
 * ③ 표준 8시간을 넘긴 실근무시간은 50분 기준으로 시간 단위 반올림해 시간당 0.25공 가산
 * ④ 조출: standardStart 이전 1시간마다 +0.25 (체크 시에만, 표준/연장 집계와 별도)
 * ⑤ 철골공 팀(cfg.dayGongsu 2): 만근만 2공수로 올라가고 연장·조출 단가는 기본과 같다
 *    (예: 만근 2.0 + 연장 2시간 0.5 = 2.5공)
 */
function calcGongsu(effInMin: number | null, effOutMin: number | null, isJochul: boolean, cfg: TeamConfig): number | null {
  if (effInMin === null || effOutMin === null) return null;

  const { standardStart, breakStart, breakEnd } = cfg;
  const standardEnd = cfg.standardEnd ?? STANDARD_END;
  // 팀 기준 하루 실근무 = 오전(breakStart-standardStart) + 오후(standardEnd-breakEnd)
  const standardWorkMin = (breakStart - standardStart) + (standardEnd - breakEnd);

  // 출근보다 이른 퇴근 기록은 자정을 넘긴 익일 퇴근(예: 출근 07:00 / 퇴근 01:00)으로 보정
  const outMin = effOutMin < effInMin ? effOutMin + 24 * 60 : effOutMin;

  // standardStart 이전(조출 구간)은 jochulBonus에서 별도 가산하므로 표준/연장 집계에서는 제외
  const workStart = Math.max(effInMin, standardStart);
  const lunchOverlap = Math.max(0, Math.min(outMin, breakEnd) - Math.max(workStart, breakStart));
  const netWorkedMin = Math.max(0, outMin - workStart - lunchOverlap);

  // 표준 공수: 못 채운 만큼 비례 감산, 늦게까지 일해 채우면 팀 만근 공수 전액 인정
  const stdWorkMin = Math.min(netWorkedMin, standardWorkMin);
  const stdGongsu  = (stdWorkMin / standardWorkMin) * cfg.dayGongsu;

  // 연장 공수: 표준 8시간 초과분을 50분 기준 반올림해 시간당 0.25공 (만근 공수와 무관하게 동일)
  const excessMin      = Math.max(0, netWorkedMin - standardWorkMin);
  const overtimeHours   = Math.floor(excessMin / 60) + (excessMin % 60 >= OVERTIME_ROUND_MIN ? 1 : 0);
  const overtimeGongsu = overtimeHours * OVERTIME_RATE_PER_HOUR;

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

function calcWeekendGongsu(effInMin: number | null, effOutMin: number | null, shiftMin = 0): number | null {
  if (effInMin === null || effOutMin === null) return null;

  const start = Math.max(effInMin, WEEKEND_START + shiftMin);
  const end = Math.min(effOutMin, WEEKEND_END + shiftMin);
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
  isLunchOt = false,
  isCheolya = false,
): number | null {
  if (isLunchOt) return cfg.dayGongsu;
  if (isCheolya) return calcCheolyaGongsu(effInMin, effOutMin);
  if (isWeekendWorkDate(workDate)) return calcWeekendGongsu(effInMin, effOutMin, cfg.shiftMin ?? 0);
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
  calcGongsuVal?: number | null;
}

/** 타각은 있는데 공수를 계산할 수 없는 행 — 한쪽 타각만 있어 손으로 확인해야 한다 */
export function hasNoCalcGongsu(row: { isWaeju: boolean; isNoRecord: boolean; calcGongsuVal?: number | null }): boolean {
  return !row.isWaeju && !row.isNoRecord && row.calcGongsuVal === null;
}

export function shouldShowInSpecialList(row: XerpSpecialListRow): boolean {
  return !row.isWaeju && !row.isNoRecord && (row.isLate || row.needsUpdate || hasNoCalcGongsu(row));
}

export function getSpecialListLabels(row: XerpSpecialListRow): string[] {
  const labels: string[] = [];
  if (row.isNewEmployee) labels.push("신규자");
  if (row.isLate) labels.push("지각");
  if (row.needsUpdate) labels.push("가산");
  if (hasNoCalcGongsu(row)) labels.push("데이터없음");
  return labels;
}

export interface XerpEarlyLeaveRow {
  isWaeju: boolean;
  effOut: string;
  effIn?: string;
  isCheolya?: boolean;
  shiftMin?: number;
}

export function shouldShowInEarlyLeaveList(row: XerpEarlyLeaveRow): boolean {
  if (row.isWaeju || row.isCheolya) return false; // 철야는 새벽 퇴근이 정상이라 조퇴가 아니다
  const outMin = parseMin(row.effOut);
  if (outMin === null || outMin >= resolveEarlyLeaveCutoff(rowShiftMin(row))) return false;
  // 출근보다 이른 퇴근은 자정을 넘긴 익일 퇴근이므로 조퇴가 아니다
  const inMin = parseMin(row.effIn);
  return inMin === null || outMin >= inMin;
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

/**
 * 가산B를 수기로 입력한 행은 계산공수도 공수A + 가산B로 맞춘다.
 * (가산B를 지운 행은 공수A 그대로) 자동 계산 행은 손대지 않는다.
 */
export function syncManualCalcGongsu<T extends { manualAdjustment?: boolean; diff: number | null; xerpGongsuA: string; calcGongsuVal: number | null }>(row: T): T {
  if (!row.manualAdjustment) return row;
  const a = parseFloat(row.xerpGongsuA);
  const base = isNaN(a) ? 0 : a;
  if (isNaN(a) && (row.diff === null || row.diff <= 0)) return row;
  const next = Math.round((base + (row.diff !== null && row.diff > 0 ? row.diff : 0)) * 1000) / 1000;
  return next === row.calcGongsuVal ? row : { ...row, calcGongsuVal: next };
}
