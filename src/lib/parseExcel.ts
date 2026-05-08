import * as XLSX from "xlsx";
import { parseAnnualLeaveWorkbookFromWorkbook } from "./annualLeaveWorkbook";

export interface Employee {
  team: "한성_F" | "태화_F" | "현채";
  name: string;
  jobTitle: string;
  rank: string;
  totalDays: number;
  dataYear: number;
  dataMonth: number;
  attendanceSource?: "fingerprint" | "xerp";
  dailyRecords: Record<string, {
    punchIn: string | null;
    punchOut: string | null;
    status?: "연차" | "오전반차" | "오후반차" | "결근";
  }>;
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
  hireDate: string;   // "YYYY-MM-DD"
  totalUsed: number;  // AL열: 총사용일수
  remaining: number;  // AM열: 잔여일수
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
  annualLeaveMap: Record<string, Record<string, boolean>>; // name -> "YYYY|M|D" -> true
  dataMonth: number;
  dataYear: number;
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
}

function extractTime(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;
  const s = String(val).trim();
  if (!s) return null;
  // "2026-02-02 06:05:00" → "06:05"
  const dtMatch = s.match(/(\d{2}):(\d{2}):\d{2}$/);
  if (dtMatch) return `${dtMatch[1]}:${dtMatch[2]}`;
  // "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  // Excel serial time
  if (typeof val === "number" && val < 1) {
    const totalMin = Math.round(val * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
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

function isAbsentMarker(val: any): boolean {
  return typeof val === "string" && val.trim().includes("결근");
}

function pickLatestSheet(wb: XLSX.WorkBook, keyword: string, exclude?: string): string | null {
  const matched = wb.SheetNames.filter(
    (s) => s.includes(keyword) && (!exclude || !s.includes(exclude))
  );
  if (!matched.length) return null;
  matched.sort((a, b) => b.localeCompare(a));
  return matched[0];
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: "array" });

  // === 1. Parse 한성 sheet (name list + job titles) ===
  let hSheetName = pickLatestSheet(wb, "P4한성", "누계");
  if (!hSheetName) hSheetName = pickLatestSheet(wb, "한성", "누계");

  const hanseongNames = new Map<string, { jobTitle: string; rank: string }>(); // name -> {jobTitle, rank}
  if (hSheetName) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[hSheetName], { header: 1, defval: "" });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[1] || "").trim();
      if (!name || name === "성명") continue;
      const jobTitle = String(r[2] || "").trim();
      const rank = String(r[3] || "").trim();
      hanseongNames.set(name, { jobTitle, rank });
    }
  }

  // === 2. Parse 연차 sheet ===
  const annualLeaveMap: Record<string, Record<string, boolean>> = {};
  const alSheet = wb.Sheets["연차"];
  if (alSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(alSheet, { header: 1, defval: "" });
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[3] || "").trim();
      if (!name) continue;
      const dateVal = r[4];
      let y: number, m: number, d: number;
      if (typeof dateVal === "number") {
        const dt = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        y = dt.getUTCFullYear();
        m = dt.getUTCMonth() + 1;
        d = dt.getUTCDate();
      } else if (typeof dateVal === "string") {
        const match = dateVal.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!match) continue;
        y = parseInt(match[1]);
        m = parseInt(match[2]);
        d = parseInt(match[3]);
      } else {
        continue;
      }
      const key = `${y}|${m}|${d}`;
      if (!annualLeaveMap[name]) annualLeaveMap[name] = {};
      annualLeaveMap[name][key] = true;
    }
  }

  // === 3. Parse 지문 기록 sheet (한성_F) ===
  const hanseongEmployees: Employee[] = [];
  const fingerSheet = wb.Sheets["지문 기록"];
  if (fingerSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(fingerSheet, { header: 1, defval: "" });
    // Group by name, aggregate daily records
    const empMap = new Map<string, Employee>();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const dateStr = String(r[0] || "").trim();
      const name = String(r[2] || "").trim();
      if (!name || !dateStr) continue;
      if (!hanseongNames.has(name)) continue;

      const punchIn = extractTime(r[7]);
      const punchOut = extractTime(r[8]);
      if (!punchIn && !punchOut) continue;

      const dateMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!dateMatch) continue;
      const year = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]);
      const day = parseInt(dateMatch[3]);
      const dayKey = `${year}-${month}-${day}`;

      if (!empMap.has(name)) {
        const info = hanseongNames.get(name);
        empMap.set(name, {
          team: "한성_F",
          name,
          jobTitle: info?.jobTitle || "",
          rank: info?.rank || "",
          totalDays: 0,
          dataYear: year,
          dataMonth: month,
          dailyRecords: {},
        });
      }
      const emp = empMap.get(name)!;
      // Update year/month to latest seen
      emp.dataYear = year;
      emp.dataMonth = month;

      // If multiple records for same day, keep earliest in / latest out
      if (!emp.dailyRecords[dayKey]) {
        emp.dailyRecords[dayKey] = { punchIn, punchOut };
      } else {
        const existing = emp.dailyRecords[dayKey];
        if (punchIn && (!existing.punchIn || punchIn < existing.punchIn)) {
          existing.punchIn = punchIn;
        }
        if (punchOut && (!existing.punchOut || punchOut > existing.punchOut)) {
          existing.punchOut = punchOut;
        }
      }
    }

    // Count totalDays per employee
    for (const emp of empMap.values()) {
      emp.totalDays = Object.keys(emp.dailyRecords).length;
      hanseongEmployees.push(emp);
    }
  }

  // === 4. Parse XERP 기록 sheet (한성_F + 태화_F) ===
  const xerpHanseongEmployees: Employee[] = [];
  const taehwaEmployees: Employee[] = [];
  let dataYear = 2026;
  let dataMonth = 3;
  const xerpHanseongNames = new Set<string>(); // track 한성_F names from XERP

  const xerpSheet = wb.Sheets["XERP 기록"];
  if (xerpSheet) {
    const xerpData: any[][] = XLSX.utils.sheet_to_json(xerpSheet, { header: 1, defval: "" });

    for (let r = 2; r < xerpData.length; r++) {
      const row = xerpData[r];
      if (!row || !row[3]) continue;

      const team = String(row[2] || "").trim();
      if (!team || team === "태화_W") continue;
      if (team !== "태화_F" && team !== "한성_F") continue;

      const name = String(row[3] || "").trim();
      if (!name) continue;

      // Parse date
      let empYear = dataYear;
      let empMonth = dataMonth;
      const dateVal = row[0];
      if (typeof dateVal === "number") {
        const utc = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        empYear = utc.getUTCFullYear();
        empMonth = utc.getUTCMonth() + 1;
      } else if (typeof dateVal === "string") {
        const match = String(dateVal).match(/(\d{4})-(\d{1,2})/);
        if (match) {
          empYear = parseInt(match[1]);
          empMonth = parseInt(match[2]);
        }
      }
      dataYear = empYear;
      dataMonth = empMonth;

      // For 한성_F: use job title + rank from 한성 sheet, for 태화_F: use XERP col[4]
      const hanseongInfo = hanseongNames.get(name);
      const jobTitle = team === "한성_F" ? (hanseongInfo?.jobTitle || String(row[4] || "").trim()) : String(row[4] || "").trim();
      const rank = team === "한성_F" ? (hanseongInfo?.rank || "") : "";
      const totalDays = typeof row[7] === "number" ? row[7] : parseInt(row[7]) || 0;

      const dailyRecords: Employee["dailyRecords"] = {};

      // Days 1~21
      for (let d = 1; d <= 21; d++) {
        const inIdx = 8 + (d - 1) * 2;
        const outIdx = 9 + (d - 1) * 2;
        const rawIn = row[inIdx];
        const rawOut = row[outIdx];
        // "연차" 텍스트 감지 → annualLeaveMap에 추가
        if (typeof rawIn === "string" && rawIn.trim().includes("연차")) {
          const leaveKey = `${empYear}|${empMonth}|${d}`;
          if (!annualLeaveMap[name]) annualLeaveMap[name] = {};
          annualLeaveMap[name][leaveKey] = true;
          continue;
        }
        if (isAbsentMarker(rawIn) || isAbsentMarker(rawOut)) {
          dailyRecords[`${empYear}-${empMonth}-${d}`] = { punchIn: null, punchOut: null, status: "결근" };
          continue;
        }
        const pIn = excelTimeToString(rawIn);
        const pOut = excelTimeToString(rawOut);
        if (pIn || pOut) {
          dailyRecords[`${empYear}-${empMonth}-${d}`] = { punchIn: pIn, punchOut: pOut };
        }
      }
      // Days 22~31 (22일이 누락되어 있었고 23~31은 컬럼이 2칸씩 앞당겨져 있었음)
      // 올바른 공식: inIdx = 8 + (d-1)*2  — 1~21과 동일한 연속 컬럼 레이아웃
      for (let d = 22; d <= 31; d++) {
        const inIdx = 8 + (d - 1) * 2;
        const outIdx = 9 + (d - 1) * 2;
        const rawIn = row[inIdx];
        const rawOut = row[outIdx];
        // "연차" 텍스트 감지 → annualLeaveMap에 추가
        if (typeof rawIn === "string" && rawIn.trim().includes("연차")) {
          const leaveKey = `${empYear}|${empMonth}|${d}`;
          if (!annualLeaveMap[name]) annualLeaveMap[name] = {};
          annualLeaveMap[name][leaveKey] = true;
          continue;
        }
        if (isAbsentMarker(rawIn) || isAbsentMarker(rawOut)) {
          dailyRecords[`${empYear}-${empMonth}-${d}`] = { punchIn: null, punchOut: null, status: "결근" };
          continue;
        }
        const pIn = excelTimeToString(rawIn);
        const pOut = excelTimeToString(rawOut);
        if (pIn || pOut) {
          dailyRecords[`${empYear}-${empMonth}-${d}`] = { punchIn: pIn, punchOut: pOut };
        }
      }

      if (team === "한성_F") {
        xerpHanseongNames.add(name);
        xerpHanseongEmployees.push({
          team: "한성_F",
          name,
          jobTitle,
          rank,
          totalDays,
          dataYear: empYear,
          dataMonth: empMonth,
          dailyRecords,
        });
      } else {
        taehwaEmployees.push({
          team: "태화_F",
          name,
          jobTitle,
          rank: "",
          totalDays,
          dataYear: empYear,
          dataMonth: empMonth,
          dailyRecords,
        });
      }
    }
  }

  // === 5. Parse 협력사 anomaly sheet ===
  const anomalies: AnomalyRecord[] = [];
  const cSheetName = pickLatestSheet(wb, "협력사");
  if (cSheetName) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[cSheetName], { header: 1, defval: "" });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[2] || "").trim();
      if (!name || name === "성명") continue;
      anomalies.push({
        name,
        지각: +r[6] || 0,
        결근: +r[7] || 0,
        반차: +r[8] || 0,
        연차: +r[9] || 0,
      });
    }
  }

  // === 6. Merge 한성_F: XERP takes priority over 지문 기록 for same name ===
  // Remove 지문 기록 employees that already exist in XERP 한성_F
  const filteredFingerEmployees = hanseongEmployees.filter(
    (emp) => !xerpHanseongNames.has(emp.name)
  );
  const fingerOnlyNames = new Set(filteredFingerEmployees.map((emp) => emp.name));

  // Determine dataYear/dataMonth
  if (xerpHanseongEmployees.length > 0) {
    dataYear = xerpHanseongEmployees[0].dataYear;
    dataMonth = xerpHanseongEmployees[0].dataMonth;
  } else if (filteredFingerEmployees.length > 0) {
    dataYear = filteredFingerEmployees[0].dataYear;
    dataMonth = filteredFingerEmployees[0].dataMonth;
  }

  const employees = [...xerpHanseongEmployees, ...filteredFingerEmployees, ...taehwaEmployees];

  // === 6b. Ensure all 한성 sheet names appear even with no attendance data ===
  const allEmployeeNames = new Set(employees.map((e) => e.name));
  for (const [name, info] of hanseongNames.entries()) {
    if (!allEmployeeNames.has(name)) {
      employees.push({
        team: "한성_F",
        name,
        jobTitle: info.jobTitle,
        rank: info.rank,
        totalDays: 0,
        dataYear,
        dataMonth,
        dailyRecords: {},
      });
    }
  }

  const parsedLeaveWorkbook = parseAnnualLeaveWorkbookFromWorkbook(wb, dataYear);
  const leaveEmployees = parsedLeaveWorkbook.leaveEmployees;
  const leaveDetails = parsedLeaveWorkbook.leaveDetails;

  // === 9. 연차_상세 날짜도 annualLeaveMap에 병합 (근태 캘린더 연차 표시) ===
  for (const detail of leaveDetails) {
    const key = `${detail.year}|${detail.month}|${detail.day}`;
    if (!annualLeaveMap[detail.name]) annualLeaveMap[detail.name] = {};
    annualLeaveMap[detail.name][key] = true;
  }

  for (const name of fingerOnlyNames) {
    delete annualLeaveMap[name];
  }

  return {
    employees,
    anomalies,
    annualLeaveMap,
    dataMonth,
    dataYear,
    leaveEmployees: leaveEmployees.filter((emp) => !fingerOnlyNames.has(emp.name)),
    leaveDetails: leaveDetails.filter((detail) => !fingerOnlyNames.has(detail.name)),
  };
}
