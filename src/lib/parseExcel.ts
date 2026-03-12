import * as XLSX from "xlsx";

export interface Employee {
  team: string;
  name: string;
  jobTitle: string;
  totalDays: number;
  dataYear: number;
  dataMonth: number;
  dailyRecords: Record<number, { punchIn: string | null; punchOut: string | null }>;
}

export interface AnomalyRecord {
  name: string;
  미타각: number;
  지각: number;
  결근: number;
  반차: number;
  연차: number;
}

export interface ParsedData {
  employees: Employee[];
  anomalies: AnomalyRecord[];
  dataMonth: number;
  dataYear: number;
}

function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return null;
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed;
    return trimmed;
  }
  if (typeof val === "number") {
    const totalMinutes = Math.round(val * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return null;
}

function parseDateColumn(val: any): { year: number; month: number } | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number") {
    // Excel serial date → UTC to avoid timezone issues
    const utc = new Date(Math.round((val - 25569) * 86400 * 1000));
    return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1 };
  }
  if (typeof val === "string") {
    const match = val.match(/(\d{4})-(\d{1,2})/);
    if (match) return { year: parseInt(match[1]), month: parseInt(match[2]) };
  }
  return null;
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: "array" });

  const xerpSheet = wb.Sheets["XERP 기록"];
  if (!xerpSheet) throw new Error("'XERP 기록' 시트를 찾을 수 없습니다.");

  const xerpData: any[][] = XLSX.utils.sheet_to_json(xerpSheet, { header: 1, defval: "" });

  const employees: Employee[] = [];
  let dataYear = 2026;
  let dataMonth = 3;

  for (let r = 2; r < xerpData.length; r++) {
    const row = xerpData[r];
    if (!row || !row[3]) continue;

    const team = String(row[2] || "").trim();
    if (!team) continue;
    if (team === "태화_W") continue;

    const name = String(row[3] || "").trim();
    if (!name) continue;

    const dateInfo = parseDateColumn(row[0]);
    let empYear = dataYear;
    let empMonth = dataMonth;
    if (dateInfo) {
      empYear = dateInfo.year;
      empMonth = dateInfo.month;
      dataYear = dateInfo.year;
      dataMonth = dateInfo.month;
    }

    const jobTitle = String(row[4] || "").trim();
    const totalDays = typeof row[7] === "number" ? row[7] : parseInt(row[7]) || 0;

    const dailyRecords: Record<number, { punchIn: string | null; punchOut: string | null }> = {};

    for (let d = 1; d <= 21; d++) {
      const inIdx = 8 + (d - 1) * 2;
      const outIdx = 9 + (d - 1) * 2;
      const pIn = excelTimeToString(row[inIdx]);
      const pOut = excelTimeToString(row[outIdx]);
      if (pIn || pOut) {
        dailyRecords[d] = { punchIn: pIn, punchOut: pOut };
      }
    }

    for (let d = 23; d <= 31; d++) {
      const inIdx = 50 + (d - 23) * 2;
      const outIdx = 51 + (d - 23) * 2;
      const pIn = excelTimeToString(row[inIdx]);
      const pOut = excelTimeToString(row[outIdx]);
      if (pIn || pOut) {
        dailyRecords[d] = { punchIn: pIn, punchOut: pOut };
      }
    }

    employees.push({ team, name, jobTitle, totalDays, dataYear: empYear, dataMonth: empMonth, dailyRecords });
  }

  // Parse anomaly sheets - pick latest year sheets
  const anomalies: AnomalyRecord[] = [];

  function pickLatest(keyword: string): string | null {
    const matched = wb.SheetNames.filter(s => s.includes(keyword) && !s.includes("누계"));
    if (!matched.length) return null;
    matched.sort((a, b) => b.localeCompare(a));
    return matched[0];
  }

  const cSheet = pickLatest("협력사");
  let hSheet = pickLatest("P4한성");
  if (!hSheet) hSheet = pickLatest("한성");

  if (cSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[cSheet], { header: 1, defval: "" });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[2] || "").trim();
      if (!name || name === "성명") continue;
      anomalies.push({ name, 미타각: +r[5] || 0, 지각: +r[6] || 0, 결근: +r[7] || 0, 반차: +r[8] || 0, 연차: +r[9] || 0 });
    }
  }

  if (hSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[hSheet], { header: 1, defval: "" });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[1] || "").trim();
      if (!name || name === "성명") continue;
      anomalies.push({ name, 미타각: +r[4] || 0, 지각: +r[5] || 0, 결근: +r[6] || 0, 반차: +r[7] || 0, 연차: +r[8] || 0 });
    }
  }

  return { employees, anomalies, dataMonth, dataYear };
}
