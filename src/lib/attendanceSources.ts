import * as XLSX from "xlsx";
import type { Employee, ParsedData } from "./parseExcel";

type SheetCell = string | number | boolean | null | undefined;
type SheetRow = SheetCell[];

export interface AttendanceRosterEmployee {
  team: Employee["team"];
  name: string;
  jobTitle: string;
  rank: string;
  attendanceSource?: Employee["attendanceSource"];
}

interface SourcePunchRecord {
  name: string;
  dateKey: string;
  year: number;
  month: number;
  punchIn: string | null;
  punchOut: string | null;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function normalizeHeader(value: SheetCell): string {
  return String(value ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function excelSerialToUtcDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function parseDateParts(value: SheetCell): { year: number; month: number; day: number } | null {
  if (typeof value === "number") {
    const d = excelSerialToUtcDate(value);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }

  const text = String(value ?? "").trim();
  const match = text.match(/(\d{4})[.\-/\s]+(\d{1,2})(?:[.\-/\s]+(\d{1,2}))?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: match[3] ? Number(match[3]) : 1,
  };
}

function excelTimeToString(value: SheetCell): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateTime = trimmed.match(/(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (dateTime) return `${dateTime[1].padStart(2, "0")}:${dateTime[2]}`;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed.padStart(5, "0");
    return null;
  }
  if (typeof value === "number") {
    const fractional = value % 1;
    const timeOnly = fractional >= 0 ? fractional : fractional + 1;
    const totalMinutes = Math.round(timeOnly * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return null;
}

function getWorkbookRows(buffer: ArrayBuffer): { sheetName: string; rows: SheetRow[] }[] {
  const wb = XLSX.read(buffer, { type: "array" });
  return wb.SheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[sheetName], { header: 1, defval: "" }),
  }));
}

function getRows(buffer: ArrayBuffer, keyword: string): SheetRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames.find((name) => name.includes(keyword)) ?? wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[sheetName], { header: 1, defval: "" });
}

function parseTeam(value: SheetCell): Employee["team"] | null {
  const text = String(value ?? "").trim();
  if (text === "한성_F" || text.includes("한성")) return "한성_F";
  if (text.includes("현채")) return "현채";
  if (text === "태화_F" || text.includes("태화")) return "태화_F";
  return null;
}

function inferTeamFromSheet(sheetName: string): Employee["team"] | null {
  return parseTeam(sheetName);
}

function parseAttendanceSource(value: SheetCell): Employee["attendanceSource"] | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.includes("지문") || text.includes("finger")) return "fingerprint";
  if (text.includes("xerp")) return "xerp";
  return undefined;
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function isNameHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return normalized === "이름" || normalized === "성명" || normalized === "직원명" || normalized === "사원명" || normalized === "name";
}

function addRosterEmployee(
  roster: Map<string, AttendanceRosterEmployee>,
  employee: AttendanceRosterEmployee
): void {
  if (!employee.name) return;
  const key = normalizeName(employee.name);
  if (!key || roster.has(key)) return;
  roster.set(key, employee);
}

function parseHeaderRosterRows(sheetName: string, rows: SheetRow[], roster: Map<string, AttendanceRosterEmployee>): void {
  for (let headerRow = 0; headerRow < Math.min(rows.length, 10); headerRow++) {
    const headers = rows[headerRow].map(normalizeHeader);
    const nameIndex = findHeaderIndex(headers, ["이름", "성명", "직원명", "사원명", "name"]);
    if (nameIndex === -1) continue;

    const teamIndex = findHeaderIndex(headers, ["팀", "소속", "구분", "team"]);
    const jobTitleIndex = findHeaderIndex(headers, ["직책", "직종", "직무", "직위", "job"]);
    const rankIndex = findHeaderIndex(headers, ["직급", "rank"]);
    const sourceIndex = findHeaderIndex(headers, ["근태방식", "관리방식", "source"]);

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row[nameIndex] ?? "").trim();
      if (!name || normalizeHeader(name) === headers[nameIndex] || isNameHeader(name)) continue;

      const team = (teamIndex >= 0 ? parseTeam(row[teamIndex]) : null) ?? inferTeamFromSheet(sheetName) ?? "한성_F";
      const attendanceSource = sourceIndex >= 0 ? parseAttendanceSource(row[sourceIndex]) : undefined;
      addRosterEmployee(roster, {
        team,
        name,
        jobTitle: jobTitleIndex >= 0 ? String(row[jobTitleIndex] ?? "").trim() : "",
        rank: rankIndex >= 0 ? String(row[rankIndex] ?? "").trim() : "",
        ...(attendanceSource ? { attendanceSource } : {}),
      });
    }
    return;
  }
}

function parseKnownRosterRows(sheetName: string, rows: SheetRow[], roster: Map<string, AttendanceRosterEmployee>): void {
  const inferredTeam = inferTeamFromSheet(sheetName);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const xerpTeam = parseTeam(row[2]);
    const xerpName = String(row[3] ?? "").trim();
    if (xerpTeam && xerpName && !isNameHeader(xerpName)) {
      addRosterEmployee(roster, {
        team: xerpTeam,
        name: xerpName,
        jobTitle: String(row[4] ?? "").trim(),
        rank: "",
      });
      continue;
    }

    const listName = String(row[1] ?? "").trim();
    if (inferredTeam && listName && !isNameHeader(listName)) {
      addRosterEmployee(roster, {
        team: inferredTeam,
        name: listName,
        jobTitle: String(row[2] ?? "").trim(),
        rank: String(row[3] ?? "").trim(),
      });
    }
  }
}

export function parseAttendanceRosterFile(buffer: ArrayBuffer): AttendanceRosterEmployee[] {
  const roster = new Map<string, AttendanceRosterEmployee>();
  for (const { sheetName, rows } of getWorkbookRows(buffer)) {
    parseHeaderRosterRows(sheetName, rows, roster);
    parseKnownRosterRows(sheetName, rows, roster);
  }
  return [...roster.values()];
}

function parseFingerprintRecords(buffer: ArrayBuffer): SourcePunchRecord[] {
  const rows = getRows(buffer, "지문");
  const records = new Map<string, SourcePunchRecord>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = parseDateParts(row[0]);
    const name = String(row[2] ?? "").trim();
    if (!date || !name) continue;

    const punchIn = excelTimeToString(row[7]);
    const punchOut = excelTimeToString(row[8]);
    if (!punchIn && !punchOut) continue;

    const dateKey = `${date.year}-${date.month}-${date.day}`;
    const key = `${normalizeName(name)}|${dateKey}`;
    const existing = records.get(key);
    if (!existing) {
      records.set(key, { name, dateKey, year: date.year, month: date.month, punchIn, punchOut });
      continue;
    }

    if (punchIn && (!existing.punchIn || punchIn < existing.punchIn)) existing.punchIn = punchIn;
    if (punchOut && (!existing.punchOut || punchOut > existing.punchOut)) existing.punchOut = punchOut;
  }

  return [...records.values()];
}

function parseXerpEmployees(buffer: ArrayBuffer): { employees: Employee[]; dataYear: number; dataMonth: number } {
  const rows = getRows(buffer, "XERP");
  const employees: Employee[] = [];
  let dataYear = new Date().getFullYear();
  let dataMonth = new Date().getMonth() + 1;

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDateParts(row[0]);
    const team = parseTeam(row[2]);
    const name = String(row[3] ?? "").trim();
    if (!date || !name || !team) continue;

    dataYear = date.year;
    dataMonth = date.month;

    const dailyRecords: Employee["dailyRecords"] = {};
    for (let day = 1; day <= 31; day++) {
      const punchIn = excelTimeToString(row[8 + (day - 1) * 2]);
      const punchOut = excelTimeToString(row[9 + (day - 1) * 2]);
      if (punchIn || punchOut) {
        dailyRecords[`${date.year}-${date.month}-${day}`] = { punchIn, punchOut };
      }
    }

    employees.push({
      team,
      name,
      jobTitle: String(row[4] ?? "").trim(),
      rank: "",
      totalDays: Object.keys(dailyRecords).length,
      dataYear: date.year,
      dataMonth: date.month,
      attendanceSource: "xerp",
      dailyRecords,
    });
  }

  return { employees, dataYear, dataMonth };
}

function employeeFromRoster(rosterEmployee: AttendanceRosterEmployee, dataYear: number, dataMonth: number): Employee {
  return {
    team: rosterEmployee.team,
    name: rosterEmployee.name,
    jobTitle: rosterEmployee.jobTitle,
    rank: rosterEmployee.rank,
    totalDays: 0,
    dataYear,
    dataMonth,
    attendanceSource: rosterEmployee.attendanceSource,
    dailyRecords: {},
  };
}

function mergeEmployeeRecords(target: Employee, source: Employee): void {
  target.jobTitle = target.jobTitle || source.jobTitle;
  target.rank = target.rank || source.rank;
  target.attendanceSource = source.attendanceSource;
  target.dataYear = source.dataYear;
  target.dataMonth = source.dataMonth;
  target.dailyRecords = { ...target.dailyRecords, ...source.dailyRecords };
  target.totalDays = Object.keys(target.dailyRecords).length;
}

export function parseAttendanceSourceFiles(
  fingerprintBuffer: ArrayBuffer,
  xerpBuffer: ArrayBuffer,
  roster: AttendanceRosterEmployee[] = []
): ParsedData {
  const fingerprintRecords = parseFingerprintRecords(fingerprintBuffer);
  const { employees: xerpEmployees, dataYear, dataMonth } = parseXerpEmployees(xerpBuffer);
  const employees = roster.map((item) => employeeFromRoster(item, dataYear, dataMonth));
  const employeeByName = new Map(employees.map((employee) => [normalizeName(employee.name), employee]));

  for (const xerpEmployee of xerpEmployees) {
    const normalizedName = normalizeName(xerpEmployee.name);
    const existing = employeeByName.get(normalizedName);
    if (existing) {
      mergeEmployeeRecords(existing, xerpEmployee);
      continue;
    }

    if (roster.length === 0 && Object.keys(xerpEmployee.dailyRecords).length > 0) {
      employees.push(xerpEmployee);
      employeeByName.set(normalizedName, xerpEmployee);
    }
  }

  for (const record of fingerprintRecords) {
    const normalizedName = normalizeName(record.name);
    let employee = employeeByName.get(normalizedName);
    if (!employee) {
      if (roster.length > 0) continue;

      employee = {
        team: "한성_F",
        name: record.name,
        jobTitle: "",
        rank: "",
        totalDays: 0,
        dataYear: record.year,
        dataMonth: record.month,
        attendanceSource: "fingerprint",
        dailyRecords: {},
      };
      employees.push(employee);
      employeeByName.set(normalizedName, employee);
    }

    employee.dailyRecords[record.dateKey] = {
      punchIn: record.punchIn,
      punchOut: record.punchOut,
    };
    employee.attendanceSource = "fingerprint";
    employee.dataYear = record.year;
    employee.dataMonth = record.month;
    employee.totalDays = Object.keys(employee.dailyRecords).length;
  }

  return {
    employees,
    anomalies: [],
    annualLeaveMap: {},
    dataYear,
    dataMonth,
    leaveEmployees: [],
    leaveDetails: [],
  };
}
