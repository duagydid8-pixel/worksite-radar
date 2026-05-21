import * as XLSX from "xlsx";

type CellValue = string | number | boolean | null | undefined;

export type FinalWorkUnitsStatus =
  | "missing-work-units"
  | "overtime-review"
  | "gasan-review"
  | "pmis-review"
  | "pmis-not-uploaded"
  | "electronic-card-reference"
  | "electronic-card-not-saved"
  | "normal";

export interface MonthlyXerpAttendanceRecord {
  site: string;
  team: string;
  name: string;
  birthDate: string;
  date: string;
  day: number;
  xerpIn: string;
  xerpOut: string;
  systemWorkUnits: number | null;
  workTime: string;
  gasanReason?: string;
}

export interface FinalWorkUnitsPmisPerson {
  name: string;
  firstIn: string;
  lastOut: string;
  inCount?: number;
  outCount?: number;
  totalEvents?: number;
}

export interface FinalWorkUnitsPmisData {
  dateLabel: string;
  persons: FinalWorkUnitsPmisPerson[];
}

export interface FinalWorkUnitsElectronicCardPerson {
  name: string;
  birthDate?: string;
  inTime: string;
  outTime: string;
  authMethod?: string;
}

export interface FinalWorkUnitsElectronicCardData {
  dateLabel: string;
  persons: FinalWorkUnitsElectronicCardPerson[];
}

export interface FinalWorkUnitsRow extends MonthlyXerpAttendanceRecord {
  id: string;
  status: FinalWorkUnitsStatus;
  statusLabel: string;
  statusTone: "danger" | "warning" | "info" | "success" | "muted";
  pmisIn: string;
  pmisOut: string;
  pmisEvents: number;
  pmisUploaded: boolean;
  electronicCardIn: string;
  electronicCardOut: string;
  electronicCardSaved: boolean;
  checks: string[];
  message: string;
}

export interface FinalWorkUnitsAnalysis {
  rows: FinalWorkUnitsRow[];
  summary: Record<FinalWorkUnitsStatus | "total" | "needsReview" | "evidenceMissing", number>;
}

export interface AnalyzeFinalWorkUnitsInput {
  monthlyRecords: MonthlyXerpAttendanceRecord[];
  pmisByDate?: Record<string, FinalWorkUnitsPmisData | null | undefined>;
  electronicCardByDate?: Record<string, FinalWorkUnitsElectronicCardData | null | undefined>;
  startDate: string;
  endDate: string;
}

function text(value: CellValue): string {
  return String(value ?? "").trim();
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function parseTimeMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseWorkUnits(value: CellValue): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function excelDateParts(serial: number): { year: number; month: number; day: number } {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseYearMonth(rows: CellValue[][]): { year: number; month: number } {
  for (const row of rows.slice(0, 8)) {
    for (const cell of row) {
      const value = text(cell);
      const match = value.match(/(\d{4})\D+(\d{1,2})/);
      if (match) return { year: Number(match[1]), month: Number(match[2]) };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parseDayHeader(value: CellValue): number | null {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1 && value <= 31) return value;
    const parts = excelDateParts(value);
    return parts.day;
  }
  const match = text(value).match(/^(\d{1,2})일$/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findHeaderRow(rows: CellValue[][]): number {
  return rows.findIndex((row) => row.some((cell) => text(cell) === "성명") && row.some((cell) => text(cell) === "구분"));
}

function isGasanReasonRow(value: CellValue): boolean {
  const label = text(value).replace(/\s+/g, "");
  return label.includes("가산") && label.includes("사유");
}

export function parseMonthlyXerpAttendance(buffer: ArrayBuffer): MonthlyXerpAttendanceRecord[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: "" });
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) return [];

  const { year, month } = parseYearMonth(rows);
  const headers = rows[headerIndex];
  const siteIndex = headers.findIndex((cell) => text(cell) === "현장명");
  const teamIndex = headers.findIndex((cell) => text(cell) === "팀명");
  const nameIndex = headers.findIndex((cell) => text(cell) === "성명");
  const birthIndex = headers.findIndex((cell) => text(cell) === "생년월일");
  const typeIndex = headers.findIndex((cell) => text(cell) === "구분");
  const dayColumns = headers
    .map((cell, index) => ({ day: parseDayHeader(cell), index }))
    .filter((item): item is { day: number; index: number } => item.day !== null);

  const records: MonthlyXerpAttendanceRecord[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const inRow = rows[rowIndex];
    if (text(inRow[typeIndex]) !== "출근" || !text(inRow[nameIndex])) continue;

    const outRow = rows[rowIndex + 1] ?? [];
    const unitsRow = rows[rowIndex + 2] ?? [];
    const workTimeRow = rows[rowIndex + 3] ?? [];
    const gasanReasonRow = rows[rowIndex + 4] ?? [];
    if (text(outRow[typeIndex]) !== "퇴근" || text(unitsRow[typeIndex]) !== "공수") continue;

    for (const { day, index } of dayColumns) {
      const xerpIn = text(inRow[index]);
      const xerpOut = text(outRow[index]);
      const systemWorkUnits = parseWorkUnits(unitsRow[index]);
      const workTime = text(workTimeRow[index]);
      const gasanReason = isGasanReasonRow(gasanReasonRow[typeIndex]) ? text(gasanReasonRow[index]) : "";
      if (!xerpIn && !xerpOut && systemWorkUnits === null && !workTime && !gasanReason) continue;

      records.push({
        site: text(inRow[siteIndex]),
        team: text(inRow[teamIndex]),
        name: text(inRow[nameIndex]),
        birthDate: text(inRow[birthIndex]),
        date: dateKey(year, month, day),
        day,
        xerpIn,
        xerpOut,
        systemWorkUnits,
        workTime,
        gasanReason,
      });
    }
  }

  return records;
}

function findPmisPerson(data: FinalWorkUnitsPmisData | null | undefined, name: string): FinalWorkUnitsPmisPerson | null {
  if (!data) return null;
  const key = normalizeName(name);
  return data.persons.find((person) => normalizeName(person.name) === key) ?? null;
}

function findElectronicCardPerson(
  data: FinalWorkUnitsElectronicCardData | null | undefined,
  record: MonthlyXerpAttendanceRecord
): FinalWorkUnitsElectronicCardPerson | null {
  if (!data) return null;
  const nameKey = normalizeName(record.name);
  const birthKey = record.birthDate.replace(/\D/g, "").slice(0, 6);
  return (
    data.persons.find((person) => normalizeName(person.name) === nameKey) ??
    data.persons.find((person) => birthKey && person.birthDate?.replace(/\D/g, "").slice(0, 6) === birthKey) ??
    null
  );
}

function hasTimes(record: MonthlyXerpAttendanceRecord): boolean {
  return Boolean(record.xerpIn || record.xerpOut);
}

function classifyRow(
  record: MonthlyXerpAttendanceRecord,
  pmisData: FinalWorkUnitsPmisData | null | undefined,
  electronicCardData: FinalWorkUnitsElectronicCardData | null | undefined
): Omit<FinalWorkUnitsRow, keyof MonthlyXerpAttendanceRecord | "id"> {
  const pmisPerson = findPmisPerson(pmisData, record.name);
  const electronicCardPerson = findElectronicCardPerson(electronicCardData, record);
  const pmisUploaded = Boolean(pmisData);
  const electronicCardSaved = Boolean(electronicCardData);
  const pmisIn = pmisPerson?.firstIn ?? "";
  const pmisOut = pmisPerson?.lastOut ?? "";
  const electronicCardIn = electronicCardPerson?.inTime ?? "";
  const electronicCardOut = electronicCardPerson?.outTime ?? "";
  const checks: string[] = [];

  const units = record.systemWorkUnits;
  const outMinutes = parseTimeMinutes(record.xerpOut);
  const missingUnits = hasTimes(record) && (units === null || units === 0);
  const overtimeNeedsReview = outMinutes !== null && outMinutes > 17 * 60 && (units === null || units <= 1);
  const hasGasanReason = Boolean(record.gasanReason?.trim());

  if (record.xerpIn) checks.push(`XERP 출근 ${record.xerpIn}`);
  if (record.xerpOut) {
    checks.push(`XERP 퇴근 ${record.xerpOut}`);
    checks.push(`퇴근 ${record.xerpOut}`);
  }
  if (pmisIn) checks.push(`PMIS 출근 ${pmisIn}`);
  if (pmisOut) checks.push(`PMIS 퇴근 ${pmisOut}`);
  if (electronicCardIn) checks.push(`전자카드 출근 ${electronicCardIn}`);
  if (electronicCardOut) checks.push(`전자카드 퇴근 ${electronicCardOut}`);
  if (hasGasanReason) checks.push(`가산사유 ${record.gasanReason}`);

  if (missingUnits) {
    return {
      status: "missing-work-units",
      statusLabel: "공수누락",
      statusTone: "danger",
      pmisIn,
      pmisOut,
      pmisEvents: pmisPerson?.totalEvents ?? 0,
      pmisUploaded,
      electronicCardIn,
      electronicCardOut,
      electronicCardSaved,
      checks,
      message: "출퇴근 시간이 있는데 시스템 공수가 0 또는 빈칸입니다.",
    };
  }

  if (hasGasanReason && (units === null || units <= 1)) {
    return {
      status: "gasan-review",
      statusLabel: "가산확인",
      statusTone: "warning",
      pmisIn,
      pmisOut,
      pmisEvents: pmisPerson?.totalEvents ?? 0,
      pmisUploaded,
      electronicCardIn,
      electronicCardOut,
      electronicCardSaved,
      checks,
      message: "가산사유가 있으므로 공수 반영 여부를 확인하세요.",
    };
  }

  if (overtimeNeedsReview) {
    return {
      status: "overtime-review",
      statusLabel: "연장확인",
      statusTone: "warning",
      pmisIn,
      pmisOut,
      pmisEvents: pmisPerson?.totalEvents ?? 0,
      pmisUploaded,
      electronicCardIn,
      electronicCardOut,
      electronicCardSaved,
      checks,
      message: "퇴근이 17:00 이후인데 시스템 공수가 1.0 이하입니다.",
    };
  }

  if (!pmisUploaded) {
    return {
      status: "pmis-not-uploaded",
      statusLabel: "PMIS미업로드",
      statusTone: "muted",
      pmisIn,
      pmisOut,
      pmisEvents: 0,
      pmisUploaded,
      electronicCardIn,
      electronicCardOut,
      electronicCardSaved,
      checks,
      message: "해당 날짜의 PMIS 기록이 아직 로드되지 않았습니다.",
    };
  }

  if (!pmisPerson && (units ?? 0) > 0) {
    return {
      status: electronicCardPerson ? "electronic-card-reference" : "pmis-review",
      statusLabel: electronicCardPerson ? "전자카드참고" : "PMIS확인",
      statusTone: electronicCardPerson ? "info" : "warning",
      pmisIn,
      pmisOut,
      pmisEvents: 0,
      pmisUploaded,
      electronicCardIn,
      electronicCardOut,
      electronicCardSaved,
      checks,
      message: electronicCardPerson
        ? "PMIS는 없지만 전자카드 출퇴근 시간이 있습니다."
        : "시스템 공수는 있으나 PMIS 출퇴근 기록이 없습니다.",
    };
  }

  return {
    status: "normal",
    statusLabel: "정상",
    statusTone: "success",
    pmisIn,
    pmisOut,
    pmisEvents: pmisPerson?.totalEvents ?? 0,
    pmisUploaded,
    electronicCardIn,
    electronicCardOut,
    electronicCardSaved,
    checks,
    message: "XERP와 증빙 시간이 크게 어긋나지 않습니다.",
  };
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function analyzeFinalWorkUnits({
  monthlyRecords,
  pmisByDate = {},
  electronicCardByDate = {},
  startDate,
  endDate,
}: AnalyzeFinalWorkUnitsInput): FinalWorkUnitsAnalysis {
  const rows = monthlyRecords
    .filter((record) => inRange(record.date, startDate, endDate))
    .map((record, index) => ({
      ...record,
      id: [
        record.date,
        normalizeName(record.team),
        normalizeName(record.name),
        record.birthDate.replace(/\D/g, ""),
        String(index),
      ].join("|"),
      ...classifyRow(record, pmisByDate[record.date], electronicCardByDate[record.date]),
    }));

  const gasanRows = rows.filter((row) => Boolean(row.gasanReason?.trim()));
  const summary = {
    total: rows.length,
    needsReview: rows.filter((row) => row.status !== "normal" && row.status !== "pmis-not-uploaded").length,
    evidenceMissing: rows.filter((row) => row.status === "pmis-review" || row.status === "pmis-not-uploaded").length,
    "missing-work-units": rows.filter((row) => row.status === "missing-work-units").length,
    "overtime-review": rows.filter((row) => row.status === "overtime-review").length,
    "gasan-review": gasanRows.length,
    "pmis-review": rows.filter((row) => row.status === "pmis-review").length,
    "pmis-not-uploaded": rows.filter((row) => row.status === "pmis-not-uploaded").length,
    "electronic-card-reference": rows.filter((row) => row.status === "electronic-card-reference").length,
    "electronic-card-not-saved": rows.filter((row) => row.status === "electronic-card-not-saved").length,
    normal: rows.filter((row) => row.status === "normal").length,
  };

  const priority: Record<FinalWorkUnitsStatus, number> = {
    "missing-work-units": 0,
    "gasan-review": 1,
    "overtime-review": 2,
    "pmis-review": 3,
    "electronic-card-reference": 4,
    "pmis-not-uploaded": 5,
    "electronic-card-not-saved": 6,
    normal: 7,
  };

  rows.sort((a, b) => priority[a.status] - priority[b.status] || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { rows, summary };
}

export function coercePmisData(value: unknown): FinalWorkUnitsPmisData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as { dateLabel?: unknown; persons?: unknown };
  if (typeof data.dateLabel !== "string" || !Array.isArray(data.persons)) return null;

  const persons = data.persons.flatMap((person) => {
    if (!person || typeof person !== "object") return [];
    const values = Object.values(person);
    const name = String(values[0] ?? "").trim();
    if (!name) return [];
    return [{
      name,
      firstIn: String(values[4] ?? "").trim(),
      lastOut: String(values[5] ?? "").trim(),
      inCount: Number(values[6] ?? 0),
      outCount: Number(values[7] ?? 0),
      totalEvents: Number(values[8] ?? 0),
    }];
  });

  return { dateLabel: data.dateLabel, persons };
}
