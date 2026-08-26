import * as XLSX from "xlsx";

export type LeaveUsageType = "연차" | "오전반차" | "오후반차";

export interface LeaveManagedEmployee {
  id: string;
  project: string;
  category: string;
  name: string;
  department: string;
  hireDate: string;
  startingUsed?: number;
  startingCompLeave?: number;
  sourceRow: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveUsage {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  type: LeaveUsageType;
  days: 1 | 0.5;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveStatusRow {
  employee: LeaveManagedEmployee;
  accrued: number;
  used: number;
  remaining: number;
  compRemaining: number;
}

export interface RosterParseResult {
  employees: LeaveManagedEmployee[];
  errors: string[];
  basisDate?: string;
}

const REQUIRED_ROSTER_HEADERS = ["소속프로젝트", "구분", "이름", "부서", "입사일"] as const;

type RosterHeader = typeof REQUIRED_ROSTER_HEADERS[number];
type RosterColumn = RosterHeader | "사용연차" | "보상휴가";

const REQUIRED_IMPORT_HEADERS: RosterHeader[] = ["구분", "이름", "부서", "입사일"];
// 발생연차·잔여연차는 엑셀 값을 신뢰하지 않고 항상 입사일 기준으로 앱이 다시 계산한다.
// (같은 회사 엑셀이라도 담당자마다 발생연차 산정 방식이 달라 실제 값과 어긋나는 경우가 있었음)
const ROSTER_HEADER_ALIASES: Record<RosterColumn, string[]> = {
  소속프로젝트: ["소속프로젝트", "프로젝트", "소속현장", "현장"],
  구분: ["구분", "직종"],
  이름: ["이름", "성명", "성함"],
  부서: ["부서"],
  입사일: ["입사일"],
  사용연차: ["사용연차"],
  보상휴가: ["보상휴가", "보상연차"],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function excelSerialToUtcDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function parseRosterDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const dt = excelSerialToUtcDate(value);
    return toDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  const text = normalizeText(value);
  if (!text) return "";

  const match = text.match(/(\d{2}|\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return "";

  const yearValue = Number(match[1]);
  const year = match[1].length === 2 ? 2000 + yearValue : yearValue;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return "";
  return toDateKey(year, month, day);
}

function parseLeaveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 10) / 10;
  const text = normalizeText(value).replace(/,/g, "");
  if (!text || text === "-") return 0;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.round(numeric * 10) / 10 : undefined;
}

function makeEmployeeId(input: {
  project: string;
  category: string;
  name: string;
  department: string;
  hireDate: string;
}): string {
  const raw = [input.project, input.category, input.name, input.department, input.hireDate].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `leave-employee-${hash.toString(36)}`;
}

function findColumnIndex(normalizedRow: string[], column: RosterColumn): number {
  for (const alias of ROSTER_HEADER_ALIASES[column]) {
    const index = normalizedRow.indexOf(normalizeHeader(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function findHeaderRow(rows: unknown[][]): { rowIndex: number; columns: Partial<Record<RosterColumn, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
    const row = rows[rowIndex];
    const normalized = row.map(normalizeHeader);
    const columns: Partial<Record<RosterColumn, number>> = {};
    let found = 0;

    for (const header of Object.keys(ROSTER_HEADER_ALIASES) as RosterColumn[]) {
      const index = findColumnIndex(normalized, header);
      if (index >= 0) {
        columns[header] = index;
        found++;
      }
    }

    if (found > 0) return { rowIndex, columns };
  }
  return null;
}

function extractBasisDate(rows: unknown[][]): string | undefined {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
    const row = rows[rowIndex];
    const basisIndex = row.findIndex((cell) => normalizeHeader(cell) === "기준일");
    if (basisIndex < 0) continue;
    for (let colIndex = basisIndex + 1; colIndex < row.length; colIndex++) {
      const parsed = parseRosterDate(row[colIndex]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function cellText(row: unknown[], columns: Partial<Record<RosterColumn, number>>, column: RosterColumn): string {
  const index = columns[column];
  return index == null ? "" : normalizeText(row[index]);
}

function cellDate(row: unknown[], columns: Partial<Record<RosterColumn, number>>, column: RosterColumn): string {
  const index = columns[column];
  return index == null ? "" : parseRosterDate(row[index]);
}

function cellLeaveNumber(
  row: unknown[],
  columns: Partial<Record<RosterColumn, number>>,
  column: RosterColumn
): number | undefined {
  const index = columns[column];
  return index == null ? undefined : parseLeaveNumber(row[index]);
}

export function parseAnnualLeaveRosterWorkbook(buffer: ArrayBuffer, now = new Date().toISOString()): RosterParseResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) return { employees: [], errors: ["명단 시트를 찾을 수 없습니다."] };

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const basisDate = extractBasisDate(rows);
  const headerInfo = findHeaderRow(rows);
  if (!headerInfo) {
    return {
      employees: [],
      errors: REQUIRED_IMPORT_HEADERS.map((header) => `필수 헤더가 없습니다: ${header}`),
      basisDate,
    };
  }

  const missingHeaders = REQUIRED_IMPORT_HEADERS.filter((header) => headerInfo.columns[header] == null);
  if (missingHeaders.length > 0) {
    return {
      employees: [],
      errors: missingHeaders.map((header) => `필수 헤더가 없습니다: ${header}`),
      basisDate,
    };
  }

  const employees: LeaveManagedEmployee[] = [];
  const errors: string[] = [];

  for (let rowIndex = headerInfo.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const hasAnyValue = row.some((cell) => normalizeText(cell) !== "");
    if (!hasAnyValue) continue;

    const project = cellText(row, headerInfo.columns, "소속프로젝트");
    const category = cellText(row, headerInfo.columns, "구분");
    const name = cellText(row, headerInfo.columns, "이름");
    const department = cellText(row, headerInfo.columns, "부서");
    const hireDate = cellDate(row, headerInfo.columns, "입사일");
    const startingUsed = cellLeaveNumber(row, headerInfo.columns, "사용연차");
    const startingCompLeave = cellLeaveNumber(row, headerInfo.columns, "보상휴가");
    const displayRow = rowIndex + 1;

    if (!name) {
      errors.push(`${displayRow}행: 이름이 없습니다.`);
      continue;
    }

    if (!hireDate) {
      errors.push(`${displayRow}행: 입사일이 올바르지 않습니다.`);
      continue;
    }

    employees.push({
      id: makeEmployeeId({ project, category, name, department, hireDate }),
      project,
      category,
      name,
      department,
      hireDate,
      ...(startingUsed !== undefined ? { startingUsed } : {}),
      ...(startingCompLeave !== undefined ? { startingCompLeave } : {}),
      sourceRow: displayRow,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { employees, errors, basisDate };
}

function parseYearMonth(date: string): { year: number; month: number } | null {
  const match = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function calculateAccruedLeave(hireDate: string, basisDate: string): number {
  const hire = parseYearMonth(hireDate);
  const basis = parseYearMonth(basisDate);
  if (!hire || !basis) return 0;
  const months = (basis.year - hire.year) * 12 + (basis.month - hire.month) + 1;
  return Math.max(0, months);
}

export function getUsageDays(type: LeaveUsageType): 1 | 0.5 {
  return type === "연차" ? 1 : 0.5;
}

export function buildLeaveUsage(input: {
  date: string;
  employee: LeaveManagedEmployee;
  type: LeaveUsageType;
  memo: string;
  now?: string;
  id?: string;
}): LeaveUsage {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `leave-usage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    date: input.date,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    type: input.type,
    days: getUsageDays(input.type),
    memo: input.memo.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function roundLeave(value: number): number {
  return Math.round(value * 10) / 10;
}

export function deriveLeaveStatusRows(
  employees: LeaveManagedEmployee[],
  usages: LeaveUsage[],
  basisDate = new Date().toISOString().slice(0, 10)
): LeaveStatusRow[] {
  const usedByEmployee = new Map<string, number>();
  for (const usage of usages) {
    const key = usage.employeeId || usage.employeeName;
    usedByEmployee.set(key, (usedByEmployee.get(key) ?? 0) + usage.days);
  }

  return employees.map((employee) => {
    const newUsed = roundLeave(usedByEmployee.get(employee.id) ?? usedByEmployee.get(employee.name) ?? 0);
    // 보상휴가는 잔여 연차보다 먼저 소진한다: 새로 입력된 사용일수는 보상휴가 잔여분부터 차감한다.
    const compStarting = employee.startingCompLeave ?? 0;
    const compConsumed = Math.min(newUsed, compStarting);
    const annualConsumed = roundLeave(newUsed - compConsumed);
    const compRemaining = roundLeave(compStarting - compConsumed);

    // 발생연차는 엑셀에 적힌 값을 신뢰하지 않고 입사일 기준으로 항상 새로 계산한다.
    const accrued = calculateAccruedLeave(employee.hireDate, basisDate);
    const used = roundLeave((employee.startingUsed ?? 0) + annualConsumed);
    const remaining = roundLeave(accrued - used);

    return { employee, accrued, used, remaining, compRemaining };
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function buildAnnualLeaveExportWorkbook(rows: LeaveStatusRow[], usages: LeaveUsage[]): XLSX.WorkBook {
  const statusRows: (string | number)[][] = [
    ["NO", "소속프로젝트", "구분", "이름", "부서", "입사일", "발생연차", "사용연차", "잔여연차", "보상휴가"],
    ...rows.map((row, index) => [
      index + 1,
      row.employee.project,
      row.employee.category,
      row.employee.name,
      row.employee.department,
      row.employee.hireDate,
      row.accrued,
      row.used,
      row.remaining,
      row.compRemaining,
    ]),
  ];

  const usageRows: (string | number)[][] = [
    ["날짜", "이름", "구분", "사용일수", "메모"],
    ...usages.map((usage) => [usage.date, usage.employeeName, usage.type, usage.days, usage.memo]),
  ];

  const wb = XLSX.utils.book_new();
  const wsStatus = XLSX.utils.aoa_to_sheet(statusRows);
  wsStatus["!cols"] = [
    { wch: 4 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
  ];
  const wsUsages = XLSX.utils.aoa_to_sheet(usageRows);
  wsUsages["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 24 }];

  XLSX.utils.book_append_sheet(wb, wsStatus, "직원별 연차현황");
  XLSX.utils.book_append_sheet(wb, wsUsages, "연차 사용내역");
  return wb;
}

export function exportAnnualLeaveManagementExcel(rows: LeaveStatusRow[], usages: LeaveUsage[]): void {
  XLSX.writeFile(buildAnnualLeaveExportWorkbook(rows, usages), `연차관리_${todayStr()}.xlsx`);
}
