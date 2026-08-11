/**
 * 근속 1년 도래 알림 — 이관자 최초입사일 추적
 *
 * 프로젝트(현장) 간 이관 시 X-ERP상 신규 등록되어 최초입사일이 초기화되는 문제를 보완한다.
 * 주민번호 앞6자리+성명을 고유키로 삼아 현장별 등록 이력(employment record)을 한 근로자로 묶고,
 * 그중 가장 빠른 입사일을 최초입사일로 확정해 만1년/단절기준일 D-day를 계산한다.
 *
 * 개인정보 보호를 위해 주민번호 전체는 저장하지 않는다 — 파싱 시점에 생년월일만 뽑아내고
 * 고유키는 원문이 아닌 해시값으로 저장한다.
 */
import * as XLSX from "xlsx";
import { addMonths, differenceInCalendarDays, format, isValid, parseISO, subDays } from "date-fns";

export type TenureProjectCode = "PH4" | "PH2" | "P5PH1";

export const TENURE_PROJECTS: { code: TenureProjectCode; label: string }[] = [
  { code: "PH4", label: "P4-PH4 초순수" },
  { code: "PH2", label: "P4-PH2 초순수" },
  { code: "P5PH1", label: "P5-PH1 초순수" },
];

export function tenureProjectLabel(code: string): string {
  return TENURE_PROJECTS.find((p) => p.code === code)?.label ?? code;
}

export interface EmploymentRecord {
  id: string;
  project: TenureProjectCode;
  hireDate: string; // YYYY-MM-DD, 해당 현장 등록일
  leaveDate: string; // YYYY-MM-DD, 상실일 (없으면 "")
  erpNo: string; // X-ERP 사번
  note: string; // 이관/251103 형태
}

export interface TenureWorker {
  id: string;
  residentKey: string; // 주민번호 앞6자리+성명 해시
  name: string;
  birthDate: string; // YYYY-MM-DD
  records: EmploymentRecord[];
  // 입사일 없는 "구 명단"(예: 기존 P4-PH4) 등 참고용 시트에서 확인된, 과거 소속이 있었던 현장 목록.
  // 정확한 날짜는 없지만 이관자 판별에 쓰인다.
  priorSites?: TenureProjectCode[];
}

// ── 고유키 해시 (FNV-1a 32bit) ─────────────────────────
function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function makeResidentKey(residentFront6: string, name: string): string {
  const front6 = residentFront6.replace(/\D/g, "").slice(0, 6);
  const normalizedName = name.replace(/\s+/g, "");
  return `wk_${hashString(`${front6}|${normalizedName}`)}`;
}

// ── 주민번호 → 생년월일 (calcAge와 동일한 세기 판정 로직) ──
export function birthDateFromResidentNo(jumin: string): string {
  const raw = jumin.replace(/\D/g, "");
  if (raw.length < 7) return "";
  const yy = parseInt(raw.slice(0, 2), 10);
  const mm = parseInt(raw.slice(2, 4), 10);
  const dd = parseInt(raw.slice(4, 6), 10);
  const genderDigit = parseInt(raw[6], 10);
  if ([yy, mm, dd, genderDigit].some((n) => isNaN(n))) return "";
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  const fullYear = genderDigit <= 2 ? 1900 + yy : 2000 + yy;
  return `${fullYear}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// ── 계산 로직 ───────────────────────────────────────────
function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function sortRecordsByHireDate(records: EmploymentRecord[]): EmploymentRecord[] {
  return [...records].filter((r) => r.hireDate).sort((a, b) => a.hireDate.localeCompare(b.hireDate));
}

export function getFirstHireDate(records: EmploymentRecord[]): string {
  return sortRecordsByHireDate(records)[0]?.hireDate ?? "";
}

// 재직중 레코드가 있으면 그중 가장 최근, 없으면 가장 마지막 레코드
export function getCurrentRecord(records: EmploymentRecord[]): EmploymentRecord | null {
  const sorted = sortRecordsByHireDate(records);
  if (sorted.length === 0) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (!sorted[i].leaveDate) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

export function getOneYearDate(firstHireDate: string): string {
  if (!firstHireDate) return "";
  const d = parseISO(firstHireDate);
  if (!isValid(d)) return "";
  return toISODate(subDays(addMonths(d, 12), 1));
}

export function getCutoffDate(firstHireDate: string): string {
  if (!firstHireDate) return "";
  const d = parseISO(firstHireDate);
  if (!isValid(d)) return "";
  return toISODate(subDays(addMonths(d, 11), 1));
}

export function getDday(cutoffDate: string, today: Date = new Date()): number | null {
  if (!cutoffDate) return null;
  const d = parseISO(cutoffDate);
  if (!isValid(d)) return null;
  return differenceInCalendarDays(d, today);
}

export function getTransferCount(records: EmploymentRecord[]): number {
  return Math.max(0, sortRecordsByHireDate(records).length - 1);
}

export interface RecordGap {
  afterRecord: EmploymentRecord;
  beforeRecord: EmploymentRecord;
  days: number;
}

// 이전 레코드 상실일 ~ 다음 레코드 등록일 간격 (이관 판정용)
export function getGaps(records: EmploymentRecord[]): RecordGap[] {
  const sorted = sortRecordsByHireDate(records);
  const gaps: RecordGap[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (!cur.leaveDate) continue;
    const leave = parseISO(cur.leaveDate);
    const hire = parseISO(next.hireDate);
    if (!isValid(leave) || !isValid(hire)) continue;
    gaps.push({ afterRecord: cur, beforeRecord: next, days: differenceInCalendarDays(hire, leave) });
  }
  return gaps;
}

export type DdayUrgency = "overdue" | "critical" | "warning" | "normal" | "none";

export function getDdayUrgency(dday: number | null): DdayUrgency {
  if (dday === null) return "none";
  if (dday < 0) return "overdue";
  if (dday <= 30) return "critical";
  if (dday <= 60) return "warning";
  return "normal";
}

export const DDAY_BADGE_CLASS: Record<DdayUrgency, string> = {
  overdue: "border-slate-300 bg-slate-100 text-slate-500",
  critical: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-slate-200 bg-white text-slate-600",
  none: "border-slate-200 bg-white text-slate-400",
};

export function formatDday(dday: number | null): string {
  if (dday === null) return "—";
  if (dday < 0) return `D+${Math.abs(dday)}`;
  if (dday === 0) return "D-Day";
  return `D-${dday}`;
}

export type EmploymentStatus = "active" | "resigned" | "unknown";

// 현재현장(가장 최근 레코드) 기준 재직/퇴사 판정. 재직중 레코드가 하나라도 있으면 재직중으로 본다.
export function getEmploymentStatus(records: EmploymentRecord[]): EmploymentStatus {
  const sorted = sortRecordsByHireDate(records);
  if (sorted.length === 0) return "unknown";
  return sorted.some((r) => !r.leaveDate) ? "active" : "resigned";
}

export interface TenureWorkerView {
  worker: TenureWorker;
  firstHireDate: string;
  currentRecord: EmploymentRecord | null;
  oneYearDate: string;
  cutoffDate: string;
  dday: number | null;
  urgency: DdayUrgency;
  transferCount: number;
  gaps: RecordGap[];
  origin: TenureOrigin;
  employmentStatus: EmploymentStatus;
  transferPath: TenureProjectCode[];
}

// 실제 근무 이력(날짜순) + 참고 명단에서만 확인된 과거 소속(날짜 미상, 실제 이력에 없는 것만)을 합쳐
// "어느 현장에서 어느 현장으로" 이동했는지 보여주는 경로. 이관이 없으면 현재현장 1개짜리 배열이 된다.
export function getTransferPath(worker: TenureWorker): TenureProjectCode[] {
  const dated = sortRecordsByHireDate(worker.records).map((r) => r.project);
  const priorOnly = (worker.priorSites ?? []).filter((p) => !dated.includes(p));
  const path = [...priorOnly, ...dated];
  return path.filter((p, i) => i === 0 || p !== path[i - 1]);
}

// transferee: 실제 기록상 현장 이력이 2개 이상이거나, 참고 명단(예: 기존 P4-PH4)에서 현재와 다른 현장 소속이 확인된 경우
// existing:   참고 명단에 있지만 현재도 같은 현장(이관 없이 계속 근무) — 혹은 "신규" 표시 기간(입사월)이 지난 인원
// new:        참고 명단에 없고, 아직 입사월이 지나지 않은 이번 달 신규 인원
export type TenureOrigin = "transferee" | "existing" | "new";

function classifyOrigin(
  transferCount: number,
  currentProject: TenureProjectCode | undefined,
  priorSites: TenureProjectCode[] | undefined,
  firstHireDate: string,
  today: Date,
): TenureOrigin {
  if (transferCount >= 1) return "transferee";
  const sites = priorSites ?? [];
  if (sites.length > 0) {
    if (currentProject && sites.some((p) => p !== currentProject)) return "transferee";
    return "existing";
  }
  // "신규" 배지는 입사월이 지나면 더 이상 의미가 없으므로 그 달까지만 표시한다.
  if (firstHireDate && firstHireDate.slice(0, 7) === format(today, "yyyy-MM")) return "new";
  return "existing";
}

export function buildTenureWorkerView(worker: TenureWorker, today: Date = new Date()): TenureWorkerView {
  const records = worker.records ?? [];
  const firstHireDate = getFirstHireDate(records);
  const cutoffDate = getCutoffDate(firstHireDate);
  const dday = getDday(cutoffDate, today);
  const currentRecord = getCurrentRecord(records);
  const transferCount = getTransferCount(records);
  return {
    worker,
    firstHireDate,
    currentRecord,
    oneYearDate: getOneYearDate(firstHireDate),
    cutoffDate,
    dday,
    urgency: getDdayUrgency(dday),
    transferCount,
    gaps: getGaps(records),
    origin: classifyOrigin(transferCount, currentRecord?.project, worker.priorSites, firstHireDate, today),
    employmentStatus: getEmploymentStatus(records),
    transferPath: getTransferPath(worker),
  };
}

// ── X-ERP 근로자 명부 엑셀 업로드 파싱 ───────────────────
export interface ParsedRosterRow {
  name: string;
  residentFront6: string;
  birthDate: string;
  project: TenureProjectCode | "";
  hireDate: string;
  leaveDate: string;
  erpNo: string;
  note: string;
}

// 입사일 컬럼이 없는 참고용 명단(예: "기존 P4-PH4" — 현장명/팀명/사번/성명/주민등록번호만 존재)에서 뽑아내는 행.
// 정확한 근무 기간은 알 수 없지만, 이 현장에 소속된 적이 있었다는 사실 자체가 이관자 판별의 근거가 된다.
export interface PriorRegistrationRow {
  name: string;
  residentFront6: string;
  birthDate: string;
  project: TenureProjectCode | "";
}

type RosterField = keyof ParsedRosterRow | "resident";

const ROSTER_HEADER_MAP: Record<string, RosterField> = {
  이름: "name", 성명: "name",
  주민번호: "resident", 주민등록번호: "resident",
  생년월일: "birthDate",
  현장: "project", 현장구분: "project", 프로젝트: "project", 소속현장: "project", 근무현장: "project", 현장명: "project",
  입사일: "hireDate", 등록일: "hireDate",
  퇴사일: "leaveDate", 상실일: "leaveDate",
  사번: "erpNo", "erp사번": "erpNo", "x-erp사번": "erpNo", erp번호: "erpNo",
  메모: "note", 비고: "note", 사유: "note",
};

function headerToRosterField(header: unknown): RosterField | undefined {
  const text = String(header ?? "").trim();
  return ROSTER_HEADER_MAP[text] ?? ROSTER_HEADER_MAP[text.replace(/\s+/g, "").toLowerCase()];
}

function detectProjectCode(text: string): TenureProjectCode | "" {
  const t = text.replace(/\s+/g, "").toUpperCase();
  if (!t) return "";
  if (t.includes("PH4")) return "PH4";
  if (t.includes("PH2")) return "PH2";
  if (t.includes("P5") || t.includes("PH1")) return "P5PH1";
  return "";
}

// 엑셀 셀 값을 YYYY-MM-DD 문자열로 변환 (NewEmployeeList.excelDateToISO와 동일 로직)
function excelDateToISO(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const str = String(val).trim();
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  const dotSlash = str.replace(/[./]/g, "-");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dotSlash)) {
    const [y, m, d] = dotSlash.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return str;
}

interface SheetParseResult {
  employmentRows: ParsedRosterRow[];
  priorRows: PriorRegistrationRow[];
}

// 업로드된 엑셀의 모든 시트를 훑는다 — 현장별로 시트가 나뉘어 있는 명부(예: "현재 P4-PH4" / "현재 P4-PH2" / "현재 P5-PH1")를
// 한 파일로 올리는 경우가 실제 업무 방식이라 첫 시트만 읽으면 나머지 현장 데이터가 누락된다.
// 입사일 컬럼이 있는 시트는 근무 이력(employment record)으로, 없는 시트(예: "기존 P4-PH4")는
// 참고용 사전 등록 이력(prior registration)으로 나눠서 반환한다.
export function parseTenureRosterWorkbook(wb: XLSX.WorkBook): SheetParseResult {
  const employmentRows: ParsedRosterRow[] = [];
  const priorRows: PriorRegistrationRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const result = parseTenureRosterSheetRows(wb.Sheets[sheetName]);
    employmentRows.push(...result.employmentRows);
    priorRows.push(...result.priorRows);
  }
  return { employmentRows, priorRows };
}

function parseTenureRosterSheetRows(ws: XLSX.WorkSheet): SheetParseResult {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return { employmentRows: [], priorRows: [] };

  const headers = (raw[0] as unknown[]).map((h) => String(h).trim());
  const fieldMap: { colIdx: number; field: RosterField }[] = [];
  headers.forEach((h, idx) => {
    const field = headerToRosterField(h);
    if (field) fieldMap.push({ colIdx: idx, field });
  });
  const hasHireDateColumn = fieldMap.some((f) => f.field === "hireDate");

  // 입사일 컬럼이 없는 시트 — 이름/주민번호/현장만 참고 이력으로 추출
  if (!hasHireDateColumn) {
    const priorRows: PriorRegistrationRow[] = [];
    for (let i = 1; i < raw.length; i++) {
      const row = raw[i] as unknown[];
      if (row.every((c) => String(c).trim() === "")) continue;

      const prior: PriorRegistrationRow = { name: "", residentFront6: "", birthDate: "", project: "" };
      for (const { colIdx, field } of fieldMap) {
        const val = row[colIdx];
        if (field === "resident") {
          const digits = typeof val === "number"
            ? String(Math.round(val)).padStart(13, "0")
            : String(val ?? "").replace(/\D/g, "");
          if (digits.length >= 6) prior.residentFront6 = digits.slice(0, 6);
          if (digits.length >= 7) prior.birthDate = birthDateFromResidentNo(digits);
        } else if (field === "project") {
          prior.project = detectProjectCode(String(val ?? ""));
        } else if (field === "name") {
          prior.name = String(val ?? "").trim();
        }
      }
      if (!prior.name || !prior.residentFront6 || !prior.project) continue;
      priorRows.push(prior);
    }
    return { employmentRows: [], priorRows };
  }

  const employmentRows: ParsedRosterRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (row.every((c) => String(c).trim() === "")) continue;

    const parsed: ParsedRosterRow = {
      name: "", residentFront6: "", birthDate: "", project: "",
      hireDate: "", leaveDate: "", erpNo: "", note: "",
    };
    for (const { colIdx, field } of fieldMap) {
      const val = row[colIdx];
      if (field === "resident") {
        const digits = typeof val === "number"
          ? String(Math.round(val)).padStart(13, "0")
          : String(val ?? "").replace(/\D/g, "");
        if (digits.length >= 6) parsed.residentFront6 = digits.slice(0, 6);
        if (digits.length >= 7) parsed.birthDate = birthDateFromResidentNo(digits);
      } else if (field === "project") {
        parsed.project = detectProjectCode(String(val ?? ""));
      } else if (field === "hireDate" || field === "leaveDate") {
        parsed[field] = excelDateToISO(val);
      } else if (field === "birthDate") {
        parsed.birthDate = parsed.birthDate || excelDateToISO(val);
      } else {
        parsed[field] = String(val ?? "").trim();
      }
    }
    if (!parsed.name || !parsed.residentFront6 || !parsed.project || !parsed.hireDate) continue;
    employmentRows.push(parsed);
  }
  return { employmentRows, priorRows: [] };
}

// 파싱된 명부 행을 resident_key 기준으로 기존 근로자 목록에 upsert.
// 매칭 우선순위:
//   1) 같은 현장의 "재직중"(leaveDate 없음) 레코드가 있으면 같은 근무 구간으로 보고 갱신한다.
//      X-ERP 입사일을 나중에 실제 최초입사일로 정정해서 재업로드하는 흐름(아직 정정 전인 이관자 등)을
//      새 레코드로 중복 생성하지 않고 그 자리에서 고쳐 쓰기 위함.
//   2) 같은 현장 + 동일 hire_date의 레코드가 있으면(이미 종료된 과거 구간) 갱신한다.
//   3) 둘 다 없으면 새 employment_record로 추가한다 (같은 현장 재입사 등 진짜 새 구간).
export function mergeRosterRowsIntoWorkers(
  existing: TenureWorker[],
  input: { employmentRows: ParsedRosterRow[]; priorRows?: PriorRegistrationRow[] },
): { workers: TenureWorker[]; newWorkers: number; newRecords: number; priorMatches: number } {
  const workers = existing.map((w) => ({ ...w, records: w.records.map((r) => ({ ...r })), priorSites: [...(w.priorSites ?? [])] }));
  const byKey = new Map(workers.map((w) => [w.residentKey, w]));
  let newWorkers = 0;
  let newRecords = 0;
  let priorMatches = 0;

  const getOrCreateWorker = (name: string, residentFront6: string, birthDate: string): TenureWorker => {
    const residentKey = makeResidentKey(residentFront6, name);
    let worker = byKey.get(residentKey);
    if (!worker) {
      worker = { id: crypto.randomUUID(), residentKey, name, birthDate, records: [], priorSites: [] };
      byKey.set(residentKey, worker);
      workers.push(worker);
      newWorkers += 1;
    }
    if (!worker.birthDate && birthDate) worker.birthDate = birthDate;
    if (name && worker.name !== name) worker.name = name;
    return worker;
  };

  for (const row of input.employmentRows) {
    const worker = getOrCreateWorker(row.name, row.residentFront6, row.birthDate);
    const project = row.project as TenureProjectCode;
    const openMatch = worker.records.find((r) => r.project === project && !r.leaveDate);
    const closedMatch = worker.records.find((r) => r.project === project && r.hireDate === row.hireDate);
    const match = openMatch ?? closedMatch;
    if (match) {
      match.hireDate = row.hireDate || match.hireDate;
      match.leaveDate = row.leaveDate || match.leaveDate;
      match.erpNo = row.erpNo || match.erpNo;
      match.note = row.note || match.note;
    } else {
      worker.records.push({
        id: crypto.randomUUID(),
        project,
        hireDate: row.hireDate,
        leaveDate: row.leaveDate,
        erpNo: row.erpNo,
        note: row.note,
      });
      newRecords += 1;
    }
  }

  for (const row of input.priorRows ?? []) {
    const worker = getOrCreateWorker(row.name, row.residentFront6, row.birthDate);
    const project = row.project as TenureProjectCode;
    const sites = worker.priorSites ?? (worker.priorSites = []);
    if (!sites.includes(project)) {
      sites.push(project);
      priorMatches += 1;
    }
  }

  return { workers, newWorkers, newRecords, priorMatches };
}
