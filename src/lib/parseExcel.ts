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
  hireDate: string; // "YYYY-MM-DD"
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

  const hanseongNames = new Map<string, string>(); // name -> jobTitle
  if (hSheetName) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[hSheetName], { header: 1, defval: "" });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[1] || "").trim();
      if (!name || name === "성명") continue;
      const jobTitle = String(r[2] || "").trim();
      hanseongNames.set(name, jobTitle);
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
        empMap.set(name, {
          team: "한성_F",
          name,
          jobTitle: hanseongNames.get(name) || "",
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

      // For 한성_F: use job title from 한성 sheet, for 태화_F: use XERP col[4]
      const jobTitle = team === "한성_F" ? (hanseongNames.get(name) || String(row[4] || "").trim()) : String(row[4] || "").trim();
      const totalDays = typeof row[7] === "number" ? row[7] : parseInt(row[7]) || 0;

      const dailyRecords: Record<string, { punchIn: string | null; punchOut: string | null }> = {};

      // Days 1~21
      for (let d = 1; d <= 21; d++) {
        const inIdx = 8 + (d - 1) * 2;
        const outIdx = 9 + (d - 1) * 2;
        const pIn = excelTimeToString(row[inIdx]);
        const pOut = excelTimeToString(row[outIdx]);
        if (pIn || pOut) {
          dailyRecords[`${empYear}-${empMonth}-${d}`] = { punchIn: pIn, punchOut: pOut };
        }
      }
      // Days 23~31
      for (let d = 23; d <= 31; d++) {
        const inIdx = 50 + (d - 23) * 2;
        const outIdx = 51 + (d - 23) * 2;
        const pIn = excelTimeToString(row[inIdx]);
        const pOut = excelTimeToString(row[outIdx]);
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

  // Determine dataYear/dataMonth
  if (xerpHanseongEmployees.length > 0) {
    dataYear = xerpHanseongEmployees[0].dataYear;
    dataMonth = xerpHanseongEmployees[0].dataMonth;
  } else if (filteredFingerEmployees.length > 0) {
    dataYear = filteredFingerEmployees[0].dataYear;
    dataMonth = filteredFingerEmployees[0].dataMonth;
  }

  const employees = [...xerpHanseongEmployees, ...filteredFingerEmployees, ...taehwaEmployees];

  // === 7. Parse 연차_현채직 sheet (직원 목록 + 입사일) ===
  const leaveEmployees: LeaveEmployee[] = [];
  const leaveEmpSheetName = wb.SheetNames.find(s => s.includes("현채직") || s.includes("현재직"));
  const leaveEmpSheet = leaveEmpSheetName ? wb.Sheets[leaveEmpSheetName] : null;
  if (leaveEmpSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(leaveEmpSheet, { header: 1, defval: "" });
    for (let i = 7; i < rows.length; i++) { // 8행부터 (0-indexed: 7)
      const r = rows[i];
      const name = String(r[2] || "").trim(); // C열 (index 2)
      if (!name) continue;
      const dept = String(r[3] || "").trim(); // D열 (index 3)
      // E열 (index 4) = 입사일: Excel serial 또는 문자열
      let hireDate = "";
      const hireDateVal = r[4];
      if (typeof hireDateVal === "number" && hireDateVal > 0) {
        const dt = new Date(Math.round((hireDateVal - 25569) * 86400 * 1000));
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const d = String(dt.getUTCDate()).padStart(2, "0");
        hireDate = `${y}-${m}-${d}`;
      } else if (typeof hireDateVal === "string") {
        const match = hireDateVal.match(/(\d{4})[.\-\/년](\d{1,2})[.\-\/월](\d{1,2})/);
        if (match) {
          hireDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
        }
      }
      leaveEmployees.push({ name, dept, hireDate });
    }
  }

  // === 8. Parse 연차_상세 sheet (연차 사용 내역) ===
  const leaveDetails: LeaveDetail[] = [];
  const leaveDetailSheet = wb.Sheets["연차_상세"];
  if (leaveDetailSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(leaveDetailSheet, { header: 1, defval: "" });
    let lastName = ""; // 병합 셀 대비: 마지막 이름 유지
    for (let i = 3; i < rows.length; i++) { // 4행부터 (0-indexed: 3)
      const r = rows[i];

      // E열 (index 4) = 이름: 병합 셀이면 빈 값이므로 마지막 이름 이어받음
      const rawName = String(r[4] || "").trim();
      if (rawName) lastName = rawName;
      const name = lastName;
      if (!name) continue;

      // B열 (index 1) = 사용월, C열 (index 2) = 사용일
      const monthVal = r[1];
      const dayVal = r[2];
      let year = dataYear, month = 0, day = 0;

      if (typeof monthVal === "number" && monthVal > 1000) {
        // Excel 날짜 시리얼: 연·월·일 모두 추출
        const dt = new Date(Math.round((monthVal - 25569) * 86400 * 1000));
        year = dt.getUTCFullYear();
        month = dt.getUTCMonth() + 1;
        day = dt.getUTCDate();
      } else if (typeof monthVal === "number" && monthVal >= 1 && monthVal <= 12) {
        month = monthVal;
      } else if (typeof monthVal === "string" && monthVal.trim()) {
        const s = monthVal.trim();
        // 전체 날짜: "2026-03-03", "2026.03.03", "2026년 3월 3일" 등
        const fullDate = s.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
        if (fullDate) {
          year = parseInt(fullDate[1]);
          month = parseInt(fullDate[2]);
          day = parseInt(fullDate[3]); // B열에서 일까지 추출
        } else {
          // 연월: "2026-03", "2026년 3월"
          const yearMonth = s.match(/(\d{4})[^\d]+(\d{1,2})/);
          if (yearMonth) { year = parseInt(yearMonth[1]); month = parseInt(yearMonth[2]); }
          else {
            // 월만: "3", "3월"
            const mOnly = s.match(/(\d{1,2})/);
            if (mOnly) month = parseInt(mOnly[1]);
          }
        }
      }

      // C열 day가 유효한 숫자면 덮어쓰기
      if (typeof dayVal === "number" && dayVal >= 1 && dayVal <= 31) {
        day = dayVal;
      } else if (typeof dayVal === "string" && dayVal.trim()) {
        const parsed = parseInt(dayVal);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 31) day = parsed;
      }

      if (month < 1 || month > 12 || day < 1 || day > 31) continue;

      const daysRaw = r[5]; // F열 (index 5) = 사용일수
      const daysUsed = typeof daysRaw === "number" ? daysRaw : parseFloat(String(daysRaw)) || 1;
      const reason = String(r[6] || "").trim(); // G열 (index 6) = 사유

      leaveDetails.push({ year, month, day, name, days: daysUsed, reason });
    }
  }
  // 날짜순 정렬
  leaveDetails.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  return { employees, anomalies, annualLeaveMap, dataMonth, dataYear, leaveEmployees, leaveDetails };
}
