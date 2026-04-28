import * as XLSX from "xlsx";
import JSZip from "jszip";
import { isKoreanHoliday } from "./koreanHolidays";
import type { ScheduleData } from "./geminiService";
import type { LeaveDetail, Employee } from "./parseExcel";
import type { ManualAbsence } from "./manualAbsences";

export function isMonthlyWorker(jobTitle: string): boolean {
  return jobTitle.includes("관리자") || jobTitle === "차량운행";
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isSiteClosure(dateStr: string, schedule: ScheduleData | null): boolean {
  if (!schedule) return false;
  const daySchedule = schedule.schedule[dateStr];
  if (!daySchedule) return false;
  const zones = Object.values(daySchedule);
  if (zones.length === 0) return false;
  return zones.every((v) => v === "현장휴무" || v === "");
}

function getCellText(ws: XLSX.WorkSheet, row0: number, col0: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

function getCellNumber(ws: XLSX.WorkSheet, row0: number, col0: number): number {
  const cell = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })];
  if (!cell) return 0;
  const v = parseFloat(String(cell.v ?? "0").replace(/,/g, ""));
  return isNaN(v) ? 0 : v;
}

interface SheetLayout {
  headerRow: number;
  dayRow: number;
  dataStartRow: number;
  colJobTitle: number;
  colName: number;
  colDayStart: number;
}

function detectLayout(ws: XLSX.WorkSheet): SheetLayout | null {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = 0; r <= Math.min(range.e.r, 15); r++) {
    for (let c = 0; c <= Math.min(range.e.c, 20); c++) {
      if (getCellText(ws, r, c) === "직종") {
        const colJobTitle = c;
        const colName = c + 1;
        for (let dr = 1; dr <= 5; dr++) {
          const dayRow = r + dr;
          for (let dc = 0; dc <= range.e.c - 2; dc++) {
            const v0 = parseInt(getCellText(ws, dayRow, dc));
            const v1 = parseInt(getCellText(ws, dayRow, dc + 1));
            const v2 = parseInt(getCellText(ws, dayRow, dc + 2));
            if (isNaN(v0) || isNaN(v1) || isNaN(v2)) continue;
            if (v1 !== v0 + 1 || v2 !== v0 + 2) continue;
            if (v0 < 1 || v0 > 29) continue; // must be plausible day numbers
            const colDayStart = dc - (v0 - 1); // extrapolate column for day 1
            if (colDayStart <= colName) continue; // day cols must be after name col
            return { headerRow: r, dayRow, dataStartRow: dayRow + 1, colJobTitle, colName, colDayStart };
          }
        }
      }
    }
  }
  return null;
}

function detectYearMonth(ws: XLSX.WorkSheet): { year: number; month: number } {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
    for (let c = 0; c <= Math.min(range.e.c, 30); c++) {
      const text = getCellText(ws, r, c);
      const m = text.match(/(\d{4})년\s*(\d{1,2})월/);
      if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) };
    }
  }
  return { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
}

// 연차 조회 맵: 정규화된 이름 → Set<"YYYY|M|D">
function buildLeaveLookup(
  annualLeaveMap: Record<string, Record<string, boolean>>,
  leaveDetails: LeaveDetail[]
): Record<string, Set<string>> {
  const lookup: Record<string, Set<string>> = {};

  for (const [name, dates] of Object.entries(annualLeaveMap)) {
    const key = name.trim();
    if (!lookup[key]) lookup[key] = new Set();
    for (const dateKey of Object.keys(dates)) lookup[key].add(dateKey);
  }

  for (const d of leaveDetails) {
    const key = d.name.trim();
    if (!lookup[key]) lookup[key] = new Set();
    lookup[key].add(`${d.year}|${d.month}|${d.day}`);
  }

  return lookup;
}

// 결근 맵: 정규화된 이름 → Set<"YYYY|M|D">
function buildAbsenceMap(employees: Employee[]): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const emp of employees) {
    for (const [dateKey, rec] of Object.entries(emp.dailyRecords)) {
      if (rec.status !== "결근") continue;
      const norm = emp.name.trim();
      if (!map[norm]) map[norm] = new Set();
      // dateKey: "YYYY-M-D" → "YYYY|M|D"
      const parts = dateKey.split("-");
      if (parts.length === 3) {
        map[norm].add(`${parts[0]}|${parseInt(parts[1])}|${parseInt(parts[2])}`);
      }
    }
  }
  return map;
}

function buildManualAbsenceMap(absences: ManualAbsence[]): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const absence of absences) {
    const name = absence.name.trim();
    if (!name) continue;

    const m = absence.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;

    if (!map[name]) map[name] = new Set();
    map[name].add(`${parseInt(m[1])}|${parseInt(m[2])}|${parseInt(m[3])}`);
  }
  return map;
}

function buildEmployeeLookup(employees: Employee[]): Map<string, Employee> {
  const map = new Map<string, Employee>();
  for (const emp of employees) {
    const name = emp.name.trim();
    if (!name || map.has(name)) continue;
    map.set(name, emp);
  }
  return map;
}

function isPayrollWorkday(year: number, month: number, day: number, schedule: ScheduleData | null): boolean {
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 0 || dow === 6) return false;
  if (isKoreanHoliday(year, month, day)) return false;
  if (isSiteClosure(toDateStr(year, month, day), schedule)) return false;
  return true;
}

function isAttendanceNoCheck(emp: Employee, year: number, month: number, day: number): boolean {
  const rec = emp.dailyRecords[`${year}-${month}-${day}`];
  if (rec?.status === "결근") return true;
  if (!rec) return true;
  if (!rec.punchIn && !rec.punchOut) return true;
  if (!rec.punchIn) return true;
  if (!rec.punchOut && emp.team !== "한성_F") return true;
  return false;
}

function roundPayrollValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ── JSZip 기반 원본 XML 패치 (서식·조건부서식·테두리·셀병합 100% 보존) ──

async function getSheetXmlPaths(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";

  const nameToRid = new Map<string, string>();
  const ridToPath = new Map<string, string>();

  // sheet name → rId (두 가지 attribute 순서 모두 처리)
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)) {
    nameToRid.set(m[1], m[2]);
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\br:id="([^"]*)"[^>]*\bname="([^"]*)"/g)) {
    nameToRid.set(m[2], m[1]);
  }

  // rId → 파일 경로
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bTarget="([^"]*)"/g)) {
    const target = m[2];
    let fullPath: string;
    if (target.startsWith("/")) {
      fullPath = target.slice(1);
    } else {
      fullPath = "xl/" + target;
    }
    ridToPath.set(m[1], fullPath);
  }

  const result = new Map<string, string>();
  for (const [name, rid] of nameToRid) {
    const path = ridToPath.get(rid);
    if (path) result.set(name, path);
  }
  return result;
}

function makeNumericCellXml(addr: string, newValue: number, rowBlock: string): string {
  const target = XLSX.utils.decode_cell(addr);
  let nearestStyle = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const m of rowBlock.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>/g)) {
    const cellAddr = m[1];
    const cell = XLSX.utils.decode_cell(cellAddr);
    const distance = Math.abs(cell.c - target.c);
    if (distance >= nearestDistance) continue;
    const style = m[0].match(/\bs="([^"]*)"/)?.[1];
    if (!style) continue;
    nearestStyle = ` s="${style}"`;
    nearestDistance = distance;
  }

  return `<c r="${addr}"${nearestStyle}><v>${newValue}</v></c>`;
}

function insertMissingCell(xml: string, addr: string, newValue: number): string {
  const rowNum = addr.match(/\d+$/)?.[0];
  if (!rowNum) return xml;

  const rowOpenRe = new RegExp(`<row\\b[^>]*\\br="${rowNum}"[^>]*>`);
  const rowMatch = rowOpenRe.exec(xml);
  if (!rowMatch) return xml;

  const rowStart = rowMatch.index;
  const rowOpenEnd = rowStart + rowMatch[0].length;
  const rowClose = xml.indexOf("</row>", rowOpenEnd);
  if (rowClose === -1) return xml;

  const rowBlock = xml.substring(rowStart, rowClose + 6);
  const targetCol = XLSX.utils.decode_cell(addr).c;
  let insertAt = rowBlock.indexOf("</row>");

  for (const m of rowBlock.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>)/g)) {
    const cell = XLSX.utils.decode_cell(m[1]);
    if (cell.c > targetCol) {
      insertAt = m.index ?? insertAt;
      break;
    }
  }

  const newCell = makeNumericCellXml(addr, newValue, rowBlock);
  const newRowBlock = rowBlock.slice(0, insertAt) + newCell + rowBlock.slice(insertAt);
  return xml.substring(0, rowStart) + newRowBlock + xml.substring(rowClose + 6);
}

function modifySheetXml(xml: string, cellChanges: Map<string, number>): string {
  for (const [addr, newValue] of cellChanges) {
    const attrStr = `r="${addr}"`;
    const rPos = xml.indexOf(attrStr);
    if (rPos === -1) {
      xml = insertMissingCell(xml, addr, newValue);
      continue;
    }

    // <c 태그 시작점 찾기
    const cOpen = xml.lastIndexOf("<c ", rPos);
    if (cOpen === -1) continue;

    // </c> 닫힘 찾기
    const cClose = xml.indexOf("</c>", rPos);
    if (cClose === -1) {
      const selfClose = xml.indexOf("/>", rPos);
      if (selfClose === -1) continue;
      const cellBlock = xml.substring(cOpen, selfClose + 2);
      if (cellBlock.includes("<f>") || cellBlock.includes("<f ") || cellBlock.includes("<f\n") || cellBlock.includes("<f\t")) {
        continue;
      }
      const newBlock = cellBlock.replace(/\s*\/>$/, `><v>${newValue}</v></c>`);
      xml = xml.substring(0, cOpen) + newBlock + xml.substring(selfClose + 2);
      continue;
    }

    const cellBlock = xml.substring(cOpen, cClose + 4);

    // 수식 셀은 건드리지 않음
    if (cellBlock.includes("<f>") || cellBlock.includes("<f ") || cellBlock.includes("<f\n") || cellBlock.includes("<f\t")) {
      continue;
    }

    let newBlock: string;
    if (cellBlock.includes("<v>")) {
      newBlock = cellBlock.replace(/<v>[^<]*<\/v>/, `<v>${newValue}</v>`);
    } else {
      // <v> 없는 경우 (빈 셀) → 삽입
      newBlock = cellBlock.slice(0, -4) + `<v>${newValue}</v></c>`;
    }

    xml = xml.substring(0, cOpen) + newBlock + xml.substring(cClose + 4);
  }
  return xml;
}

export interface PayrollCorrection {
  name: string;
  jobTitle: string;
  sheetName: string;
  changes: { day: number; before: number; after: number; reason: string }[];
  totalBefore: number;
  totalAfter: number;
}

export interface PayrollResult {
  corrections: PayrollCorrection[];
  outputBuffer: ArrayBuffer;
  year: number;
  month: number;
}

export async function processPayroll(
  buffer: ArrayBuffer,
  annualLeaveMap: Record<string, Record<string, boolean>>,
  leaveDetails: LeaveDetail[],
  employees: Employee[],
  schedule: ScheduleData | null,
  manualAbsences: ManualAbsence[] = []
): Promise<PayrollResult> {
  const wb = XLSX.read(buffer, { type: "array", cellFormula: true });

  const leaveLookup = buildLeaveLookup(annualLeaveMap, leaveDetails);
  const absenceMap = buildAbsenceMap(employees);
  const manualAbsenceMap = buildManualAbsenceMap(manualAbsences);
  const employeeLookup = buildEmployeeLookup(employees);

  const corrections: PayrollCorrection[] = [];
  let year = 0;
  let month = 0;

  // sheetName → (A1주소 → 새 값)
  const allCellChanges = new Map<string, Map<string, number>>();

  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith("★") || sheetName.startsWith("비교")) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    if (!year) {
      const ym = detectYearMonth(ws);
      year = ym.year;
      month = ym.month;
    }

    const layout = detectLayout(ws);
    if (!layout) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const daysInMonth = new Date(year, month, 0).getDate();

    // 토요일 근무 여부 (해당 열에 0이 아닌 값이 하나라도 있으면 근무일)
    const saturdayHasWorkers = new Set<number>();
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(year, month - 1, day).getDay() !== 6) continue;
      const col = layout.colDayStart + (day - 1);
      for (let r = layout.dataStartRow; r <= range.e.r; r++) {
        if (getCellNumber(ws, r, col) > 0) { saturdayHasWorkers.add(day); break; }
      }
    }

    const sheetCellChanges = new Map<string, number>();

    for (let r = layout.dataStartRow; r <= range.e.r; r++) {
      const jobTitle = getCellText(ws, r, layout.colJobTitle);
      const name = getCellText(ws, r, layout.colName);
      if (!jobTitle || !name) continue;
      if (!isMonthlyWorker(jobTitle)) continue;

      const normName = name.trim();

      const dayValues: number[] = [];
      for (let day = 1; day <= 31; day++) {
        dayValues.push(day <= daysInMonth ? getCellNumber(ws, r, layout.colDayStart + (day - 1)) : 0);
      }

      const changes: { day: number; before: number; after: number; reason: string }[] = [];
      const newValues = [...dayValues];
      const employee = employeeLookup.get(normName);
      const unpaidDays = new Set<number>();
      const manualAbsenceDays = new Set<number>();

      for (let day = 1; day <= daysInMonth; day++) {
        if (dayValues[day - 1] <= 0) continue;
        const absenceKey = `${year}|${month}|${day}`;
        if (!manualAbsenceMap[normName]?.has(absenceKey)) continue;
        manualAbsenceDays.add(day);
        unpaidDays.add(day);
      }

      if (employee?.dataYear === year && employee.dataMonth === month) {
        for (let day = 1; day <= daysInMonth; day++) {
          if (dayValues[day - 1] <= 0) continue;
          if (!isPayrollWorkday(year, month, day, schedule)) continue;

          const leaveKey = `${year}|${month}|${day}`;
          if (leaveLookup[normName]?.has(leaveKey)) continue;
          if (!isAttendanceNoCheck(employee, year, month, day)) continue;

          unpaidDays.add(day);
        }
      }

      // ── Step 0: 수동 결근 및 근태현황 미타각/결근은 공수 차감 ───
      for (const day of unpaidDays) {
        const before = newValues[day - 1];
        if (before <= 0) continue;

        newValues[day - 1] = 0;
        changes.push({
          day,
          before,
          after: 0,
          reason: manualAbsenceDays.has(day) ? "결근(수동입력)" : "무급연차(미타각)",
        });
      }

      // ── Step 1: 연차 날짜 0 → 1 ──────────────────────────────
      for (let day = 1; day <= daysInMonth; day++) {
        if (newValues[day - 1] !== 0) continue;
        if (unpaidDays.has(day)) continue;

        const leaveKey = `${year}|${month}|${day}`;
        if (!leaveLookup[normName]?.has(leaveKey)) continue;

        const dow = new Date(year, month - 1, day).getDay();
        const dateStr = toDateStr(year, month, day);

        if (dow === 0) continue;                                     // 일요일
        if (isKoreanHoliday(year, month, day)) continue;            // 공휴일
        if (isSiteClosure(dateStr, schedule)) continue;              // 현장휴무
        if (dow === 6 && !saturdayHasWorkers.has(day)) continue;    // 근무 흔적 없는 토요일
        if (absenceMap[normName]?.has(leaveKey)) continue;          // 결근/미타각

        const after = 1;
        newValues[day - 1] = after;
        changes.push({ day, before: 0, after, reason: "연차" });
      }

      // ── Step 2: 총공수 < 25이면 기존 근무일 값 올리기 ────────
      // 주의: 0인 날(결근·미타각)은 건드리지 않음 — 값이 있는 날만 올림
      let total = newValues.reduce((s, v) => s + v, 0);
      const targetTotal = Math.max(0, 25 - unpaidDays.size);

      if (total < targetTotal) {
        const adjustable: { day: number; maxVal: number; cur: number }[] = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const cur = newValues[day - 1];
          if (cur <= 0) continue; // 0인 날은 건드리지 않음

          const dow = new Date(year, month - 1, day).getDay();
          const dateStr = toDateStr(year, month, day);

          if (dow === 0) continue;
          if (isKoreanHoliday(year, month, day)) continue;
          if (isSiteClosure(dateStr, schedule)) continue;

          let maxVal: number;
          if (dow === 6) {
            if (!saturdayHasWorkers.has(day)) continue;
            maxVal = 1;
          } else {
            maxVal = 2;
          }

          if (cur >= maxVal) continue;
          adjustable.push({ day, maxVal, cur });
        }

        // 현재 값이 낮은 날부터 올림
        adjustable.sort((a, b) => a.cur - b.cur);

        for (const { day, maxVal, cur } of adjustable) {
          if (total >= targetTotal) break;
          const needed = targetTotal - total;

          // 0.5 단위 증분 중 필요량 이내에서 최대로 올림
          const steps = [0.5, 1, 1.5, 2].filter((s) => s > cur && s <= maxVal);
          let after = cur;
          for (const s of steps) {
            if (s - cur <= needed + 0.001) after = s;
            else break;
          }
          if (after <= cur) continue;

          newValues[day - 1] = after;
          total += after - cur;
          changes.push({ day, before: cur, after, reason: "총공수 보정" });
        }
      }

      // ── Step 3: 총공수 > 목표치이면 기존 공수에서 차감 ─────────
      if (total > targetTotal) {
        const reducible: { day: number; cur: number }[] = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const cur = newValues[day - 1];
          if (cur <= 0) continue;
          if (unpaidDays.has(day)) continue;

          reducible.push({ day, cur });
        }

        reducible.sort((a, b) => b.cur - a.cur || b.day - a.day);

        for (const { day, cur } of reducible) {
          if (total <= targetTotal) break;

          const reduction = Math.min(cur, total - targetTotal);
          const after = roundPayrollValue(cur - reduction);
          if (after === cur) continue;

          newValues[day - 1] = after;
          total = roundPayrollValue(total - reduction);
          changes.push({ day, before: cur, after, reason: "총공수 25 초과 감산" });
        }
      }

      // 변경된 셀 기록
      for (const { day, after } of changes) {
        const addr = XLSX.utils.encode_cell({ r, c: layout.colDayStart + (day - 1) });
        sheetCellChanges.set(addr, after);
      }

      if (changes.length > 0) {
        corrections.push({
          name,
          jobTitle,
          sheetName,
          changes,
          totalBefore: dayValues.reduce((s, v) => s + v, 0),
          totalAfter: newValues.reduce((s, v) => s + v, 0),
        });
      }
    }

    if (sheetCellChanges.size > 0) allCellChanges.set(sheetName, sheetCellChanges);
  }

  // ── JSZip으로 원본 XML 직접 패치 ────────────────────────────
  const zip = await JSZip.loadAsync(buffer);
  const sheetPaths = await getSheetXmlPaths(zip);

  for (const [sheetName, cellChanges] of allCellChanges) {
    const xmlPath = sheetPaths.get(sheetName);
    if (!xmlPath) continue;

    const xmlContent = await zip.file(xmlPath)?.async("string");
    if (!xmlContent) continue;

    zip.file(xmlPath, modifySheetXml(xmlContent, cellChanges));
  }

  // calcChain 제거 → Excel이 열릴 때 수식 전체 재계산
  zip.remove("xl/calcChain.xml");

  // workbook.xml에 fullCalcOnLoad 설정
  const wbXmlContent = await zip.file("xl/workbook.xml")?.async("string");
  if (wbXmlContent) {
    const patched = wbXmlContent.replace(/<calcPr([^/]*)\/>/,
      (_, attrs) => `<calcPr${attrs} fullCalcOnLoad="1"/>`
    ).replace(/<calcPr([^/]*[^/])>/, (_, attrs) => `<calcPr${attrs} fullCalcOnLoad="1">`);
    zip.file("xl/workbook.xml", patched);
  }

  const outputBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { corrections, outputBuffer, year, month };
}
