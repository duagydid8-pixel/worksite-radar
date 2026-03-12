import * as XLSX from "xlsx";

export interface Employee {
  team: string;
  name: string;
  jobTitle: string;
  totalDays: number;
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
  dataMonth: number; // 1-12
  dataYear: number;
}

function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return null;
    // Already formatted like "06:00"
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) return trimmed;
    return trimmed;
  }
  if (typeof val === "number") {
    // Excel time fraction (0-1 = 0:00 - 24:00)
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
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(val);
    if (date) return { year: date.y, month: date.m };
  }
  if (typeof val === "string") {
    // YYYY-MM-DD or YYYY-MM
    const match = val.match(/(\d{4})-(\d{1,2})/);
    if (match) return { year: parseInt(match[1]), month: parseInt(match[2]) };
  }
  return null;
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: "array" });

  // Parse XERP 기록 sheet
  const xerpSheet = wb.Sheets["XERP 기록"];
  if (!xerpSheet) throw new Error("'XERP 기록' 시트를 찾을 수 없습니다.");

  const xerpData: any[][] = XLSX.utils.sheet_to_json(xerpSheet, { header: 1, defval: "" });

  const employees: Employee[] = [];
  let dataYear = 2026;
  let dataMonth = 1;

  for (let r = 2; r < xerpData.length; r++) {
    const row = xerpData[r];
    if (!row || row.length < 5) continue;

    const team = String(row[2] || "").trim();
    if (!team) continue;
    // Exclude 태화_W
    if (team === "태화_W") continue;

    const name = String(row[3] || "").trim();
    if (!name) continue;

    const dateInfo = parseDateColumn(row[0]);
    if (dateInfo) {
      dataYear = dateInfo.year;
      dataMonth = dateInfo.month;
    }

    const jobTitle = String(row[4] || "").trim();
    const totalDays = typeof row[7] === "number" ? row[7] : parseFloat(row[7]) || 0;

    const dailyRecords: Record<number, { punchIn: string | null; punchOut: string | null }> = {};

    // Days 1-21: index 8+(d-1)*2 (in), 9+(d-1)*2 (out)
    for (let d = 1; d <= 21; d++) {
      const inIdx = 8 + (d - 1) * 2;
      const outIdx = 9 + (d - 1) * 2;
      const pIn = excelTimeToString(row[inIdx]);
      const pOut = excelTimeToString(row[outIdx]);
      if (pIn || pOut) {
        dailyRecords[d] = { punchIn: pIn, punchOut: pOut };
      }
    }

    // Days 23-31: index 50+(d-23)*2 (in), 51+(d-23)*2 (out)
    for (let d = 23; d <= 31; d++) {
      const inIdx = 50 + (d - 23) * 2;
      const outIdx = 51 + (d - 23) * 2;
      const pIn = excelTimeToString(row[inIdx]);
      const pOut = excelTimeToString(row[outIdx]);
      if (pIn || pOut) {
        dailyRecords[d] = { punchIn: pIn, punchOut: pOut };
      }
    }

    employees.push({ team, name, jobTitle, totalDays, dailyRecords });
  }

  // Parse anomaly sheets
  const anomalies: AnomalyRecord[] = [];

  for (const sheetName of wb.SheetNames) {
    const isHyupryuksa = sheetName.includes("협력사");
    const isHanseong = sheetName.includes("한성") && !sheetName.includes("누계");

    if (!isHyupryuksa && !isHanseong) continue;

    const sheet = wb.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    for (let r = 4; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;

      let name: string, 미타각: number, 지각: number, 결근: number, 반차: number, 연차: number;

      if (isHyupryuksa) {
        name = String(row[2] || "").trim();
        미타각 = Number(row[5]) || 0;
        지각 = Number(row[6]) || 0;
        결근 = Number(row[7]) || 0;
        반차 = Number(row[8]) || 0;
        연차 = Number(row[9]) || 0;
      } else {
        name = String(row[1] || "").trim();
        미타각 = Number(row[4]) || 0;
        지각 = Number(row[5]) || 0;
        결근 = Number(row[6]) || 0;
        반차 = Number(row[7]) || 0;
        연차 = Number(row[8]) || 0;
      }

      if (!name) continue;
      anomalies.push({ name, 미타각, 지각, 결근, 반차, 연차 });
    }
  }

  return { employees, anomalies, dataMonth, dataYear };
}
