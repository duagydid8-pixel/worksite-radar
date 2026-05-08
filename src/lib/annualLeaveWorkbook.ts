import * as XLSX from "xlsx";
import type { LeaveDetail, LeaveEmployee, ParsedData } from "./parseExcel";

export interface AnnualLeaveWorkbookData {
  annualLeaveMap: Record<string, Record<string, boolean>>;
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
}

function excelSerialToUtcDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function excelSerialToDateString(serial: number): string {
  const dt = excelSerialToUtcDate(serial);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseHireDate(value: unknown): string {
  if (typeof value === "number" && value > 0) return excelSerialToDateString(value);
  if (typeof value === "string") {
    const match = value.match(/(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    }
  }
  return "";
}

function parseMonthDay(value: unknown, defaultYear: number): { year: number; month: number; day: number } | null {
  let year = defaultYear;
  let month = 0;

  if (typeof value === "number" && value > 31) {
    const dt = excelSerialToUtcDate(value);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }

  if (typeof value === "number" && value >= 1 && value <= 12) {
    month = value;
  } else if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    const fullDate = text.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
    if (fullDate) {
      return { year: Number(fullDate[1]), month: Number(fullDate[2]), day: Number(fullDate[3]) };
    }
    const yearMonth = text.match(/(\d{4})[^\d]+(\d{1,2})/);
    if (yearMonth) {
      year = Number(yearMonth[1]);
      month = Number(yearMonth[2]);
    } else {
      const monthOnly = text.match(/(\d{1,2})/);
      if (monthOnly) month = Number(monthOnly[1]);
    }
  }

  if (month < 1 || month > 12) return null;
  return { year, month, day: 0 };
}

function parseDay(value: unknown, current: { year: number; month: number; day: number }): { year: number; month: number; day: number } {
  if (typeof value === "number") {
    if (value >= 1 && value <= 31) return { ...current, day: value };
    if (value > 31) {
      const dt = excelSerialToUtcDate(value);
      return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
    }
  }

  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    const fullDate = text.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
    if (fullDate) {
      return { year: Number(fullDate[1]), month: Number(fullDate[2]), day: Number(fullDate[3]) };
    }
    const parsed = Number.parseInt(text, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 31) return { ...current, day: parsed };
  }

  return current;
}

export function parseAnnualLeaveWorkbookFromWorkbook(wb: XLSX.WorkBook, defaultYear: number): AnnualLeaveWorkbookData {
  const leaveEmployees: LeaveEmployee[] = [];
  const leaveEmpSheetName = wb.SheetNames.find((name) => name.includes("현채직") || name.includes("현재직"));
  const leaveEmpSheet = leaveEmpSheetName ? wb.Sheets[leaveEmpSheetName] : null;
  if (leaveEmpSheet) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(leaveEmpSheet, { header: 1, defval: "" });
    for (let i = 7; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row[2] || "").trim();
      if (!name) continue;
      leaveEmployees.push({
        name,
        dept: String(row[3] || "").trim(),
        hireDate: parseHireDate(row[4]),
        totalUsed: typeof row[37] === "number" ? row[37] : Number.parseFloat(String(row[37])) || 0,
        remaining: typeof row[38] === "number" ? row[38] : Number.parseFloat(String(row[38])) || 0,
      });
    }
  }

  const leaveDetails: LeaveDetail[] = [];
  const leaveDetailSheetName = wb.SheetNames.find((name) => name.includes("상세") || name.includes("연차_상세"));
  const leaveDetailSheet = leaveDetailSheetName ? wb.Sheets[leaveDetailSheetName] : null;
  if (leaveDetailSheet) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(leaveDetailSheet, { header: 1, defval: "" });
    let lastName = "";
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      const rawName = String(row[4] || "").trim();
      if (rawName) lastName = rawName;
      const name = lastName;
      if (!name) continue;

      const monthDay = parseMonthDay(row[1], defaultYear);
      if (!monthDay) continue;
      const date = parseDay(row[2], monthDay);
      if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) continue;

      const daysRaw = row[5];
      leaveDetails.push({
        year: date.year,
        month: date.month,
        day: date.day,
        name,
        days: typeof daysRaw === "number" ? daysRaw : Number.parseFloat(String(daysRaw)) || 1,
        reason: String(row[6] || "").trim(),
      });
    }
  }

  leaveDetails.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  const annualLeaveMap: Record<string, Record<string, boolean>> = {};
  for (const detail of leaveDetails) {
    const key = `${detail.year}|${detail.month}|${detail.day}`;
    annualLeaveMap[detail.name] = {
      ...(annualLeaveMap[detail.name] ?? {}),
      [key]: true,
    };
  }

  return { annualLeaveMap, leaveEmployees, leaveDetails };
}

export function parseAnnualLeaveWorkbook(buffer: ArrayBuffer, defaultYear = new Date().getFullYear()): AnnualLeaveWorkbookData {
  return parseAnnualLeaveWorkbookFromWorkbook(XLSX.read(buffer, { type: "array" }), defaultYear);
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

export function filterAnnualLeaveData(
  leaveData: AnnualLeaveWorkbookData,
  excludedNames: Set<string> = new Set()
): AnnualLeaveWorkbookData {
  const normalizedExcludedNames = new Set([...excludedNames].map(normalizeName));
  const keepName = (name: string) => !normalizedExcludedNames.has(normalizeName(name));
  return {
    annualLeaveMap: Object.fromEntries(
      Object.entries(leaveData.annualLeaveMap).filter(([name]) => keepName(name))
    ),
    leaveEmployees: leaveData.leaveEmployees.filter((employee) => keepName(employee.name)),
    leaveDetails: leaveData.leaveDetails.filter((detail) => keepName(detail.name)),
  };
}

export function mergeAnnualLeaveData(
  data: ParsedData,
  leaveData: AnnualLeaveWorkbookData,
  excludedNames: Set<string> = new Set()
): ParsedData {
  const filteredLeaveData = filterAnnualLeaveData(leaveData, excludedNames);
  const namesToReplace = new Set([
    ...data.leaveEmployees.map((employee) => employee.name),
    ...data.leaveDetails.map((detail) => detail.name),
    ...filteredLeaveData.leaveEmployees.map((employee) => employee.name),
    ...filteredLeaveData.leaveDetails.map((detail) => detail.name),
    ...Object.keys(filteredLeaveData.annualLeaveMap),
  ]);

  const annualLeaveMap: ParsedData["annualLeaveMap"] = {};
  for (const [name, dates] of Object.entries(data.annualLeaveMap)) {
    if (!namesToReplace.has(name)) annualLeaveMap[name] = { ...dates };
  }
  for (const [name, dates] of Object.entries(filteredLeaveData.annualLeaveMap)) {
    annualLeaveMap[name] = { ...dates };
  }

  return {
    ...data,
    annualLeaveMap,
    leaveEmployees: filteredLeaveData.leaveEmployees,
    leaveDetails: filteredLeaveData.leaveDetails,
  };
}
