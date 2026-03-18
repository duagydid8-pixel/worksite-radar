import * as XLSX from "xlsx";

export interface Employee {
  team: "한성_F" | "태화_F";
  name: string;
  jobTitle: string;
  totalDays: number;
  dataYear: number;
  dataMonth: number;
  dailyRecords: Record<string, { punchIn: string | null; punchOut: string | null }>;
}

export interface AnomalyRecord {
  name: string;
  지각: number;
  결근: number;
  반차: number;
  연차: number;
}

export interface LeaveEmployee {
  name: string;
  dept: string;
  hireDate: string;
  totalUsed: number;
  remaining: number;
}

export interface LeaveDetail {
  year: number;
  month: number;
  day: number;
  name: string;
  days: number;
  reason: string;
}

export interface ParsedData {
  employees: Employee[];
  anomalies: AnomalyRecord[];
  annualLeaveMap: Record<string, Record<string, boolean>>;
  dataMonth: number;
  dataYear: number;
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
}

function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed;
    // "HH:MM:SS" → "HH:MM"
    const hms = trimmed.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
    if (hms) return `${hms[1].padStart(2, "0")}:${hms[2]}`;
    return trimmed;
  }
  if (typeof val === "number" && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return null;
}

/** Pick the latest sheet matching keyword (optionally excluding another keyword) */
function pickLatestSheet(wb: XLSX.WorkBook, keyword: string, exclude?: string): string | null {
  const matched = wb.SheetNames.filter(
    (s) => s.includes(keyword) && (!exclude || !s.includes(exclude))
  );
  if (!matched.length) return null;
  matched.sort((a, b) => b.localeCompare(a));
  return matched[0];
}

/** Extract year and month from sheet name like "26년02월_P4한성" → { year: 2026, month: 2 } */
function extractYearMonthFromSheetName(name: string): { year: number; month: number } | null {
  // "26년02월" or "2026년02월"
  const m = name.match(/(\d{2,4})년(\d{1,2})월/);
  if (!m) return null;
  let year = parseInt(m[1]);
  if (year < 100) year += 2000;
  return { year, month: parseInt(m[2]) };
}

/** Find the column index in header row where daily data starts (look for "1일" pattern) */
function findDayStartCol(headerRow: any[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const val = String(headerRow[i] || "").trim();
    if (val.match(/^1일/) || val === "1일출근") return i;
  }
  return -1;
}

/** Find column indices for anomaly fields from header row */
function findAnomalyColumns(headerRow: any[]): {
  미타: number; 지각: number; 결근: number; 반차: number; 연차: number;
} {
  const result = { 미타: -1, 지각: -1, 결근: -1, 반차: -1, 연차: -1 };
  for (let i = 0; i < headerRow.length; i++) {
    const val = String(headerRow[i] || "").trim();
    if (val.includes("미타")) result.미타 = i;
    else if (val.includes("지각")) result.지각 = i;
    else if (val.includes("결근")) result.결근 = i;
    else if (val.includes("반차")) result.반차 = i;
    else if (val === "연차") result.연차 = i;
  }
  return result;
}

interface MonthlySheetConfig {
  team: "한성_F" | "태화_F";
  nameCol: number;   // column index for 성명
  jobCol: number;    // column index for 직종
}

function parseMonthlySheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  config: MonthlySheetConfig,
  year: number,
  month: number,
  annualLeaveMap: Record<string, Record<string, boolean>>,
): { employees: Employee[]; anomalies: AnomalyRecord[] } {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { employees: [], anomalies: [] };

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (rows.length < 4) return { employees: [], anomalies: [] };

  // Row 3 (index 2) = header
  const headerRow = rows[2];
  const dayStartCol = findDayStartCol(headerRow);
  const anomCols = findAnomalyColumns(headerRow);

  console.log(`[parseExcel] Sheet "${sheetName}": dayStartCol=${dayStartCol}, anomCols=`, anomCols);

  if (dayStartCol < 0) {
    console.warn(`[parseExcel] Could not find daily columns in "${sheetName}"`);
    return { employees: [], anomalies: [] };
  }

  // Determine max day from header (count pairs of 출근/퇴근)
  let maxDay = 0;
  for (let d = 1; d <= 31; d++) {
    const colIdx = dayStartCol + (d - 1) * 2;
    if (colIdx >= headerRow.length) break;
    const hVal = String(headerRow[colIdx] || "").trim();
    if (hVal.match(new RegExp(`^${d}일`))) {
      maxDay = d;
    } else {
      break;
    }
  }
  if (maxDay === 0) maxDay = 31; // fallback

  const employees: Employee[] = [];
  const anomalies: AnomalyRecord[] = [];

  // Row 4+ (index 3+) = data
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[config.nameCol] || "").trim();
    if (!name) continue;
    // Skip if it looks like a header or summary row
    if (name === "성명" || name === "합계" || name === "소계") continue;

    const jobTitle = String(row[config.jobCol] || "").trim();
    const dailyRecords: Record<string, { punchIn: string | null; punchOut: string | null }> = {};
    let totalDays = 0;

    for (let d = 1; d <= maxDay; d++) {
      const inIdx = dayStartCol + (d - 1) * 2;
      const outIdx = inIdx + 1;
      const inVal = row[inIdx];
      const outVal = row[outIdx];

      // Check if cell contains "연차" text
      const inStr = String(inVal || "").trim();
      const outStr = String(outVal || "").trim();
      const isLeave = inStr === "연차" || outStr === "연차";

      if (isLeave) {
        // Mark in annualLeaveMap
        if (!annualLeaveMap[name]) annualLeaveMap[name] = {};
        annualLeaveMap[name][`${year}|${month}|${d}`] = true;
        // Don't add to dailyRecords — leave badge will show from annualLeaveMap
        continue;
      }

      const pIn = excelTimeToString(inVal);
      const pOut = excelTimeToString(outVal);
      if (pIn || pOut) {
        dailyRecords[`${year}-${month}-${d}`] = { punchIn: pIn, punchOut: pOut };
        totalDays++;
      }
    }

    employees.push({
      team: config.team,
      name,
      jobTitle,
      totalDays,
      dataYear: year,
      dataMonth: month,
      dailyRecords,
    });

    // Extract anomaly data
    anomalies.push({
      name,
      지각: anomCols.지각 >= 0 ? (+row[anomCols.지각] || 0) : 0,
      결근: anomCols.결근 >= 0 ? (+row[anomCols.결근] || 0) : 0,
      반차: anomCols.반차 >= 0 ? (+row[anomCols.반차] || 0) : 0,
      연차: anomCols.연차 >= 0 ? (+row[anomCols.연차] || 0) : 0,
    });
  }

  return { employees, anomalies };
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: "array" });
  console.log("[parseExcel] Sheet names:", wb.SheetNames);

  const annualLeaveMap: Record<string, Record<string, boolean>> = {};

  // === 1. Find & parse P4한성 monthly sheet ===
  const hanseongSheet = pickLatestSheet(wb, "P4한성");
  let dataYear = 2026;
  let dataMonth = 3;

  if (hanseongSheet) {
    const ym = extractYearMonthFromSheetName(hanseongSheet);
    if (ym) { dataYear = ym.year; dataMonth = ym.month; }
    console.log(`[parseExcel] 한성 sheet: "${hanseongSheet}" → ${dataYear}년 ${dataMonth}월`);
  }

  const hanseongResult = hanseongSheet
    ? parseMonthlySheet(wb, hanseongSheet, { team: "한성_F", nameCol: 1, jobCol: 2 }, dataYear, dataMonth, annualLeaveMap)
    : { employees: [], anomalies: [] };

  // === 2. Find & parse P4협력사 monthly sheet ===
  const taehwaSheet = pickLatestSheet(wb, "P4협력사");
  let taehwaYear = dataYear;
  let taehwaMonth = dataMonth;

  if (taehwaSheet) {
    const ym = extractYearMonthFromSheetName(taehwaSheet);
    if (ym) { taehwaYear = ym.year; taehwaMonth = ym.month; }
    console.log(`[parseExcel] 협력사 sheet: "${taehwaSheet}" → ${taehwaYear}년 ${taehwaMonth}월`);
  }

  const taehwaResult = taehwaSheet
    ? parseMonthlySheet(wb, taehwaSheet, { team: "태화_F", nameCol: 2, jobCol: 3 }, taehwaYear, taehwaMonth, annualLeaveMap)
    : { employees: [], anomalies: [] };

  // Use 한성 year/month as primary; fallback to 태화
  if (!hanseongSheet && taehwaSheet) {
    dataYear = taehwaYear;
    dataMonth = taehwaMonth;
  }

  const employees = [...hanseongResult.employees, ...taehwaResult.employees];
  const anomalies = [...hanseongResult.anomalies, ...taehwaResult.anomalies];

  // === 3. Parse 연차 sheet (A=소속, D=이름, E=날짜) ===
  const alSheet = wb.Sheets["연차"];
  if (alSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(alSheet, { header: 1, defval: "" });
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[3] || "").trim();
      if (!name) continue;
      const dateVal = r[4];
      let y: number | null = null, m: number | null = null, d: number | null = null;
      if (typeof dateVal === "number" && dateVal > 100) {
        const dt = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
      } else if (typeof dateVal === "string") {
        const match = dateVal.trim().match(/(\d{4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
        if (match) { y = parseInt(match[1]); m = parseInt(match[2]); d = parseInt(match[3]); }
      }
      if (y === null || m === null || d === null) continue;
      if (m < 1 || m > 12 || d < 1 || d > 31) continue;
      if (!annualLeaveMap[name]) annualLeaveMap[name] = {};
      annualLeaveMap[name][`${y}|${m}|${d}`] = true;
    }
  }

  // === 4. Parse 연차_현채직 sheet (직원 목록 + 입사일 + 사용/잔여일수) ===
  const leaveEmployees: LeaveEmployee[] = [];
  const leaveEmpSheetName = wb.SheetNames.find(s => s.includes("현채직") || s.includes("현재직"));
  const leaveEmpSheet = leaveEmpSheetName ? wb.Sheets[leaveEmpSheetName] : null;
  if (leaveEmpSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(leaveEmpSheet, { header: 1, defval: "" });
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[2] || "").trim();
      if (!name) continue;
      const dept = String(r[3] || "").trim();
      let hireDate = "";
      const hireDateVal = r[4];
      if (typeof hireDateVal === "number" && hireDateVal > 0) {
        const dt = new Date(Math.round((hireDateVal - 25569) * 86400 * 1000));
        hireDate = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
      } else if (typeof hireDateVal === "string") {
        const match = hireDateVal.match(/(\d{4})[.\-\/년](\d{1,2})[.\-\/월](\d{1,2})/);
        if (match) hireDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      }
      const totalUsed = typeof r[37] === "number" ? r[37] : parseFloat(String(r[37])) || 0;
      const remaining = typeof r[38] === "number" ? r[38] : parseFloat(String(r[38])) || 0;
      leaveEmployees.push({ name, dept, hireDate, totalUsed, remaining });
    }
  }

  // === 5. Parse 연차_상세 sheet (연차 사용 내역) ===
  const leaveDetails: LeaveDetail[] = [];
  const leaveDetailSheetName = wb.SheetNames.find(s => s.includes("상세") || s.includes("연차_상세"));
  const leaveDetailSheet = leaveDetailSheetName ? wb.Sheets[leaveDetailSheetName] : null;
  if (leaveDetailSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(leaveDetailSheet, { header: 1, defval: "" });
    let lastName = "";
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const rawName = String(r[4] || "").trim();
      if (rawName) lastName = rawName;
      const name = lastName;
      if (!name) continue;

      const monthVal = r[1];
      const dayVal = r[2];
      let year = dataYear, month = 0, day = 0;

      if (typeof monthVal === "number" && monthVal > 1000) {
        const dt = new Date(Math.round((monthVal - 25569) * 86400 * 1000));
        year = dt.getUTCFullYear(); month = dt.getUTCMonth() + 1; day = dt.getUTCDate();
      } else if (typeof monthVal === "number" && monthVal >= 1 && monthVal <= 12) {
        month = monthVal;
      } else if (typeof monthVal === "string" && monthVal.trim()) {
        const s = monthVal.trim();
        const fullDate = s.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
        if (fullDate) { year = parseInt(fullDate[1]); month = parseInt(fullDate[2]); day = parseInt(fullDate[3]); }
        else {
          const yearMonth = s.match(/(\d{4})[^\d]+(\d{1,2})/);
          if (yearMonth) { year = parseInt(yearMonth[1]); month = parseInt(yearMonth[2]); }
          else { const mOnly = s.match(/(\d{1,2})/); if (mOnly) month = parseInt(mOnly[1]); }
        }
      }

      if (typeof dayVal === "number") {
        if (dayVal >= 1 && dayVal <= 31) day = dayVal;
        else if (dayVal > 31) {
          const dt = new Date(Math.round((dayVal - 25569) * 86400 * 1000));
          year = dt.getUTCFullYear(); month = dt.getUTCMonth() + 1; day = dt.getUTCDate();
        }
      } else if (typeof dayVal === "string" && dayVal.trim()) {
        const fullDate = dayVal.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
        if (fullDate) { year = parseInt(fullDate[1]); month = parseInt(fullDate[2]); day = parseInt(fullDate[3]); }
        else { const parsed = parseInt(dayVal); if (!isNaN(parsed) && parsed >= 1 && parsed <= 31) day = parsed; }
      }

      if (month < 1 || month > 12 || day < 1 || day > 31) continue;

      const daysRaw = r[5];
      const daysUsed = typeof daysRaw === "number" ? daysRaw : parseFloat(String(daysRaw)) || 1;
      const reason = String(r[6] || "").trim();
      leaveDetails.push({ year, month, day, name, days: daysUsed, reason });
    }
  }
  leaveDetails.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  // === 6. Merge 연차_상세 dates into annualLeaveMap ===
  for (const detail of leaveDetails) {
    if (!annualLeaveMap[detail.name]) annualLeaveMap[detail.name] = {};
    const totalDays = Math.ceil(detail.days);
    for (let offset = 0; offset < totalDays; offset++) {
      const dt = new Date(detail.year, detail.month - 1, detail.day + offset);
      const key = `${dt.getFullYear()}|${dt.getMonth() + 1}|${dt.getDate()}`;
      annualLeaveMap[detail.name][key] = true;
    }
  }

  return { employees, anomalies, annualLeaveMap, dataMonth, dataYear, leaveEmployees, leaveDetails };
}
