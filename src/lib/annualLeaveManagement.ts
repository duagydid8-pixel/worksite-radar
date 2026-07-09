import * as XLSX from "xlsx";

export type LeaveUsageType = "연차" | "오전반차" | "오후반차";

export interface LeaveManagedEmployee {
  id: string;
  project: string;
  category: string;
  name: string;
  department: string;
  hireDate: string;
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
}

export interface RosterParseResult {
  employees: LeaveManagedEmployee[];
  errors: string[];
}

const REQUIRED_ROSTER_HEADERS = ["소속프로젝트", "구분", "이름", "부서", "입사일"] as const;

type RosterHeader = typeof REQUIRED_ROSTER_HEADERS[number];

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

  const match = text.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return "";
  return toDateKey(year, month, day);
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

function findHeaderRow(rows: unknown[][]): { rowIndex: number; columns: Record<RosterHeader, number> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
    const row = rows[rowIndex];
    const normalized = row.map(normalizeHeader);
    const columns = {} as Record<RosterHeader, number>;
    let found = 0;

    for (const header of REQUIRED_ROSTER_HEADERS) {
      const index = normalized.indexOf(normalizeHeader(header));
      if (index >= 0) {
        columns[header] = index;
        found++;
      }
    }

    if (found > 0) return { rowIndex, columns };
  }
  return null;
}

export function parseAnnualLeaveRosterWorkbook(buffer: ArrayBuffer, now = new Date().toISOString()): RosterParseResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) return { employees: [], errors: ["명단 시트를 찾을 수 없습니다."] };

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerInfo = findHeaderRow(rows);
  if (!headerInfo) {
    return {
      employees: [],
      errors: REQUIRED_ROSTER_HEADERS.map((header) => `필수 헤더가 없습니다: ${header}`),
    };
  }

  const missingHeaders = REQUIRED_ROSTER_HEADERS.filter((header) => headerInfo.columns[header] == null);
  if (missingHeaders.length > 0) {
    return {
      employees: [],
      errors: missingHeaders.map((header) => `필수 헤더가 없습니다: ${header}`),
    };
  }

  const employees: LeaveManagedEmployee[] = [];
  const errors: string[] = [];

  for (let rowIndex = headerInfo.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const hasAnyValue = row.some((cell) => normalizeText(cell) !== "");
    if (!hasAnyValue) continue;

    const project = normalizeText(row[headerInfo.columns["소속프로젝트"]]);
    const category = normalizeText(row[headerInfo.columns["구분"]]);
    const name = normalizeText(row[headerInfo.columns["이름"]]);
    const department = normalizeText(row[headerInfo.columns["부서"]]);
    const hireDate = parseRosterDate(row[headerInfo.columns["입사일"]]);
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
      sourceRow: displayRow,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { employees, errors };
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
    const accrued = calculateAccruedLeave(employee.hireDate, basisDate);
    const used = roundLeave(usedByEmployee.get(employee.id) ?? usedByEmployee.get(employee.name) ?? 0);
    return {
      employee,
      accrued,
      used,
      remaining: roundLeave(accrued - used),
    };
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function buildAnnualLeaveExportWorkbook(rows: LeaveStatusRow[], usages: LeaveUsage[]): XLSX.WorkBook {
  const statusRows: (string | number)[][] = [
    ["NO", "소속프로젝트", "구분", "이름", "부서", "입사일", "발생연차", "사용연차", "잔여연차"],
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
