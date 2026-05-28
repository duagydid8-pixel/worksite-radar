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
  expectedWorkUnits: number | null;
  reflectedWorkUnits: number | null;
  missingWorkUnits: number;
  evidenceSource: string;
  autoReason: string;
  xerpPmisExtraUnits: number;
  xerpPmisReason: string;
  hasXerpPmisMatch: boolean;
  hasXerpPmisPhoto: boolean;
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
  xerpPmisByDate?: Record<string, unknown[] | null | undefined>;
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

function formatWorkUnits(value: number | null): string {
  if (value === null) return "";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function roundWorkUnits(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeFieldKey(key: string): string {
  return key.replace(/\s+/g, "").toLowerCase();
}

function recordValue(record: Record<string, unknown>, names: string[]): string {
  const normalizedNames = names.map(normalizeFieldKey);
  for (const [key, value] of Object.entries(record)) {
    if (!normalizedNames.includes(normalizeFieldKey(key))) continue;
    const textValue = text(value as CellValue);
    if (textValue && !["-", "—", "–", "기타"].includes(textValue.replace(/\s+/g, ""))) return textValue;
  }
  return "";
}

function parseWorkUnitsText(value: string): number | null {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOutMinutesForWorkUnits(value: string, pmisOut = ""): number | null {
  const minutes = parseTimeMinutes(value);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const nextHour = (hour + 1) * 60;
  if (minute >= 50) return nextHour;

  const pmisOutMinutes = parseTimeMinutes(pmisOut);
  const fastCheckoutShortage = nextHour - 10 - minutes;
  if (pmisOutMinutes !== null && pmisOutMinutes >= nextHour && fastCheckoutShortage >= 1 && fastCheckoutShortage <= 2) {
    return nextHour;
  }

  return hour * 60;
}

function isWeekendDate(date: string): boolean {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = parsed.getDay();
  return day === 0 || day === 6;
}

function standardStartMinutes(team: string): number {
  return team.includes("태화_S") ? 7 * 60 + 30 : 7 * 60;
}

function calculateExpectedWorkUnits(date: string, team: string, inTime: string, outTime: string, pmisOut = ""): number | null {
  const inMinutes = parseTimeMinutes(inTime);
  const outMinutes = roundOutMinutesForWorkUnits(outTime, pmisOut);
  if (inMinutes === null || outMinutes === null || outMinutes <= inMinutes) return null;

  if (isWeekendDate(date)) {
    const workStart = 8 * 60;
    const workEnd = 17 * 60;
    const workedMinutes = Math.max(0, Math.min(outMinutes, workEnd) - Math.max(inMinutes, workStart));
    if (workedMinutes >= 8 * 60) return 1;
    return roundWorkUnits((workedMinutes / 60) * 0.125);
  }

  const start = standardStartMinutes(team);
  const lunchEnd = 13 * 60;
  const standardEnd = 17 * 60;
  const morningUnits = inMinutes <= start ? 0.5 : 0;
  const afternoonUnits = (() => {
    if (inMinutes > lunchEnd) return 0;
    if (outMinutes >= standardEnd) return 0.5;
    if (outMinutes <= lunchEnd) return 0;
    const missingHours = Math.ceil((standardEnd - outMinutes) / 60);
    return Math.max(0, 0.5 - missingHours * 0.125);
  })();
  const overtimeUnits = outMinutes > standardEnd ? ((outMinutes - standardEnd) / 60) * 0.25 : 0;
  return roundWorkUnits(morningUnits + afternoonUnits + overtimeUnits);
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

function findXerpPmisEvidence(rows: unknown[] | null | undefined, record: MonthlyXerpAttendanceRecord) {
  const empty = {
    extraUnits: 0,
    reason: "",
    matched: false,
    hasPhoto: false,
  };
  if (!Array.isArray(rows)) return empty;

  const nameKey = normalizeName(record.name);
  const birthKey = record.birthDate.replace(/\D/g, "").slice(0, 6);
  const matched = rows.find((row) => {
    if (!row || typeof row !== "object") return false;
    const data = row as Record<string, unknown>;
    const rowName = recordValue(data, ["성명", "이름", "name"]);
    const rowBirth = recordValue(data, ["생년월일", "생년", "birthDate"]);
    return normalizeName(rowName) === nameKey || Boolean(birthKey && rowBirth.replace(/\D/g, "").slice(0, 6) === birthKey);
  });
  if (!matched || typeof matched !== "object") return empty;

  const data = matched as Record<string, unknown>;
  const extraCandidates = [
    parseWorkUnitsText(recordValue(data, ["가산신청", "가산 신청", "extraWork", "gasan"])),
    parseWorkUnitsText(recordValue(data, ["가산승인", "가산 승인", "approvedExtraWork"])),
  ].filter((value): value is number => value !== null && value > 0);
  const xerpPmisTotal = parseWorkUnitsText(recordValue(data, ["공수합계AB", "공수합계(A+B)", "공수합계"]));
  if (xerpPmisTotal !== null && record.systemWorkUnits !== null && xerpPmisTotal > record.systemWorkUnits) {
    extraCandidates.push(roundWorkUnits(xerpPmisTotal - record.systemWorkUnits));
  }

  const reason = recordValue(data, ["가산사유", "가산 사유", "gasanReason", "reason"]);
  const hasPhoto = Object.entries(data).some(([key, value]) => {
    const normalized = normalizeFieldKey(key);
    const looksLikePhoto = normalized.includes("사진") || normalized.includes("증빙") || normalized.includes("photo") || normalized.includes("image");
    return looksLikePhoto && Boolean(text(value as CellValue));
  });

  return {
    extraUnits: extraCandidates.length ? Math.max(...extraCandidates) : 0,
    reason,
    matched: true,
    hasPhoto,
  };
}

function hasTimes(record: MonthlyXerpAttendanceRecord): boolean {
  return Boolean(record.xerpIn || record.xerpOut);
}

function chooseEvidenceTime(
  kind: "in" | "out",
  record: MonthlyXerpAttendanceRecord,
  pmisPerson: FinalWorkUnitsPmisPerson | null,
  electronicCardPerson: FinalWorkUnitsElectronicCardPerson | null
): { value: string; source: string; fromFallback: boolean } {
  const xerpValue = kind === "in" ? record.xerpIn : record.xerpOut;
  if (xerpValue) return { value: xerpValue, source: "XERP", fromFallback: false };

  const pmisValue = kind === "in" ? pmisPerson?.firstIn : pmisPerson?.lastOut;
  if (pmisValue) return { value: pmisValue, source: "PMIS", fromFallback: true };

  const electronicCardValue = kind === "in" ? electronicCardPerson?.inTime : electronicCardPerson?.outTime;
  if (electronicCardValue) return { value: electronicCardValue, source: "전자카드", fromFallback: true };

  return { value: "", source: "", fromFallback: false };
}

function classifyRow(
  record: MonthlyXerpAttendanceRecord,
  pmisData: FinalWorkUnitsPmisData | null | undefined,
  electronicCardData: FinalWorkUnitsElectronicCardData | null | undefined,
  xerpPmisRows: unknown[] | null | undefined
): Omit<FinalWorkUnitsRow, keyof MonthlyXerpAttendanceRecord | "id"> {
  const pmisPerson = findPmisPerson(pmisData, record.name);
  const electronicCardPerson = findElectronicCardPerson(electronicCardData, record);
  const xerpPmisEvidence = findXerpPmisEvidence(xerpPmisRows, record);
  const pmisUploaded = Boolean(pmisData);
  const electronicCardSaved = Boolean(electronicCardData);
  const pmisIn = pmisPerson?.firstIn ?? "";
  const pmisOut = pmisPerson?.lastOut ?? "";
  const electronicCardIn = electronicCardPerson?.inTime ?? "";
  const electronicCardOut = electronicCardPerson?.outTime ?? "";
  const checks: string[] = [];

  const units = record.systemWorkUnits;
  const outMinutes = parseTimeMinutes(record.xerpOut);
  const selectedIn = chooseEvidenceTime("in", record, pmisPerson, electronicCardPerson);
  const selectedOut = chooseEvidenceTime("out", record, pmisPerson, electronicCardPerson);
  const expectedWorkUnits = calculateExpectedWorkUnits(record.date, record.team, selectedIn.value, selectedOut.value, pmisOut);
  const xerpPmisExtraUnits = xerpPmisEvidence.extraUnits;
  const reflectedWorkUnits = units === null ? null : roundWorkUnits(units);
  const missingWorkUnits =
    expectedWorkUnits !== null && reflectedWorkUnits !== null && expectedWorkUnits - reflectedWorkUnits > 0.001
      ? roundWorkUnits(expectedWorkUnits - reflectedWorkUnits)
      : 0;
  const missingUnits = missingWorkUnits > 0 || (hasTimes(record) && (units === null || units === 0));
  const overtimeNeedsReview = outMinutes !== null && outMinutes > 17 * 60 && (units === null || units <= 1);
  const xerpPmisReason = xerpPmisEvidence.reason;
  const hasGasanReason = Boolean(record.gasanReason?.trim() || xerpPmisReason);
  const fallbackSources = [selectedIn, selectedOut]
    .filter((item) => item.fromFallback)
    .map((item) => item.source);
  const evidenceSource = [...new Set(fallbackSources)].join(", ") || "XERP";
  const autoReason = [
    selectedIn.fromFallback ? `${selectedIn.source} 출근 증빙` : "",
    selectedOut.fromFallback ? `${selectedOut.source} 퇴근 증빙` : "",
    expectedWorkUnits !== null && expectedWorkUnits > 1 ? "연장근무" : "",
    missingWorkUnits > 0 ? "공수반영누락" : "",
  ].filter(Boolean).join(" / ");

  if (record.xerpIn) checks.push(`XERP 출근 ${record.xerpIn}`);
  if (record.xerpOut) {
    checks.push(`XERP 퇴근 ${record.xerpOut}`);
    checks.push(`퇴근 ${record.xerpOut}`);
  }
  if (pmisIn) checks.push(`${selectedIn.source === "PMIS" ? "PMIS 출근 증빙" : "PMIS 출근"} ${pmisIn}`);
  if (pmisOut) checks.push(`${selectedOut.source === "PMIS" ? "PMIS 퇴근 증빙" : "PMIS 퇴근"} ${pmisOut}`);
  if (electronicCardIn) checks.push(`${selectedIn.source === "전자카드" ? "전자카드 출근 증빙" : "전자카드 출근"} ${electronicCardIn}`);
  if (electronicCardOut) checks.push(`${selectedOut.source === "전자카드" ? "전자카드 퇴근 증빙" : "전자카드 퇴근"} ${electronicCardOut}`);
  if (expectedWorkUnits !== null) checks.push(`예상공수 ${formatWorkUnits(expectedWorkUnits)}`);
  if (reflectedWorkUnits !== null) checks.push(`반영공수 ${formatWorkUnits(reflectedWorkUnits)}`);
  if (missingWorkUnits > 0) checks.push(`부족공수 ${formatWorkUnits(missingWorkUnits)}`);
  if (xerpPmisExtraUnits > 0) checks.push(`XERP&PMIS 가산 ${formatWorkUnits(xerpPmisExtraUnits)}`);
  if (xerpPmisEvidence.hasPhoto) checks.push("사진증빙 있음");
  if (hasGasanReason) checks.push(`가산사유 ${record.gasanReason || xerpPmisReason}`);

  const baseDetails = {
    expectedWorkUnits,
    reflectedWorkUnits,
    missingWorkUnits,
    evidenceSource,
    autoReason,
    xerpPmisExtraUnits,
    xerpPmisReason,
    hasXerpPmisMatch: xerpPmisEvidence.matched,
    hasXerpPmisPhoto: xerpPmisEvidence.hasPhoto,
    pmisIn,
    pmisOut,
    pmisEvents: pmisPerson?.totalEvents ?? 0,
    pmisUploaded,
    electronicCardIn,
    electronicCardOut,
    electronicCardSaved,
    checks,
  };

  if (missingUnits) {
    return {
      status: "missing-work-units",
      statusLabel: "공수반영누락",
      statusTone: "danger",
      ...baseDetails,
      message:
        expectedWorkUnits !== null && reflectedWorkUnits !== null
          ? `예상 ${formatWorkUnits(expectedWorkUnits)}공 대비 반영 ${formatWorkUnits(reflectedWorkUnits)}공입니다.`
          : "출퇴근 시간이 있는데 시스템 공수가 0 또는 빈칸입니다.",
    };
  }

  if (hasGasanReason || xerpPmisExtraUnits > 0) {
    return {
      status: "gasan-review",
      statusLabel: "가산확인",
      statusTone: "warning",
      ...baseDetails,
      message: xerpPmisExtraUnits > 0
        ? "XERP&PMIS에 가산공수 또는 증빙이 있으므로 최종 반영 여부를 확인하세요."
        : "가산사유가 있으므로 공수 반영 여부를 확인하세요.",
    };
  }

  if (overtimeNeedsReview) {
    return {
      status: "overtime-review",
      statusLabel: "연장확인",
      statusTone: "warning",
      ...baseDetails,
      message: "퇴근이 17:00 이후인데 시스템 공수가 1.0 이하입니다.",
    };
  }

  if (!pmisUploaded) {
    return {
      status: "pmis-not-uploaded",
      statusLabel: "PMIS미업로드",
      statusTone: "muted",
      ...baseDetails,
      message: "해당 날짜의 PMIS 기록이 아직 로드되지 않았습니다.",
    };
  }

  if (!pmisPerson && (units ?? 0) > 0) {
    return {
      status: electronicCardPerson ? "electronic-card-reference" : "pmis-review",
      statusLabel: electronicCardPerson ? "전자카드참고" : "PMIS확인",
      statusTone: electronicCardPerson ? "info" : "warning",
      ...baseDetails,
      message: electronicCardPerson
        ? "PMIS는 없지만 전자카드 출퇴근 시간이 있습니다."
        : "시스템 공수는 있으나 PMIS 출퇴근 기록이 없습니다.",
    };
  }

  return {
    status: "normal",
    statusLabel: "정상",
    statusTone: "success",
    ...baseDetails,
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
  xerpPmisByDate = {},
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
      ...classifyRow(record, pmisByDate[record.date], electronicCardByDate[record.date], xerpPmisByDate[record.date]),
    }));

  const gasanRows = rows.filter((row) => Boolean(row.gasanReason?.trim() || row.xerpPmisReason?.trim() || row.xerpPmisExtraUnits > 0));
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

function coerceTimeText(value: unknown): string {
  const raw = text(value as CellValue);
  return /^\d{1,2}:\d{2}/.test(raw) ? raw : "";
}

function coerceCount(value: unknown): number | null {
  const raw = text(value as CellValue).replace(/,/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function coercePmisData(value: unknown): FinalWorkUnitsPmisData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as { dateLabel?: unknown; persons?: unknown };
  const dateLabel = text(data.dateLabel as CellValue);
  if (!dateLabel || !Array.isArray(data.persons)) return null;

  const persons = data.persons.flatMap((person) => {
    if (!person || typeof person !== "object") return [];
    if (Array.isArray(person)) {
      const name = text(person[0] as CellValue);
      if (!name) return [];
      const inCount = coerceCount(person[6]) ?? 0;
      const outCount = coerceCount(person[7]) ?? 0;
      return [{
        name,
        firstIn: coerceTimeText(person[4]),
        lastOut: coerceTimeText(person[5]),
        inCount,
        outCount,
        totalEvents: coerceCount(person[8]) ?? inCount + outCount,
      }];
    }

    const record = person as Record<string, unknown>;
    const values = Object.values(record);
    const name = recordValue(record, ["이름", "성명", "name", "workerName"]) || text(values[0] as CellValue);
    if (!name) return [];
    const firstIn =
      coerceTimeText(recordValue(record, ["처음IN", "처음 IN", "firstIn", "inTime", "출근", "pmisIn"])) ||
      coerceTimeText(values[4]);
    const lastOut =
      coerceTimeText(recordValue(record, ["마지막OUT", "마지막 OUT", "lastOut", "departureTime", "outTime", "퇴근", "pmisOut"])) ||
      coerceTimeText(values[5]);
    const inCount =
      coerceCount(recordValue(record, ["IN횟수", "IN이벤트", "inCount", "inEvents"])) ??
      coerceCount(values[6]) ??
      0;
    const outCount =
      coerceCount(recordValue(record, ["OUT횟수", "OUT이벤트", "outCount", "outEvents"])) ??
      coerceCount(values[7]) ??
      0;
    return [{
      name,
      firstIn,
      lastOut,
      inCount,
      outCount,
      totalEvents: coerceCount(recordValue(record, ["총이벤트", "totalEvents", "eventCount"])) ?? coerceCount(values[8]) ?? inCount + outCount,
    }];
  });

  return { dateLabel, persons };
}
