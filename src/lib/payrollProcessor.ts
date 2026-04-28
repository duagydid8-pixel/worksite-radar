import * as XLSX from "xlsx";
import { isKoreanHoliday } from "./koreanHolidays";
import type { ScheduleData } from "./geminiService";

// 월급제 직종 판별
export function isMonthlyWorker(jobTitle: string): boolean {
  return jobTitle.includes("관리자") || jobTitle === "차량운행";
}

// YYYY-MM-DD 형식 날짜 문자열 생성
function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 해당 날짜가 현장휴무인지 (ScheduleData의 schedule에서 모든 zone이 "현장휴무"이거나 "현장휴무" 포함)
function isSiteClosure(dateStr: string, schedule: ScheduleData | null): boolean {
  if (!schedule) return false;
  const daySchedule = schedule.schedule[dateStr];
  if (!daySchedule) return false;
  const zones = Object.values(daySchedule);
  if (zones.length === 0) return false;
  return zones.every((v) => v === "현장휴무" || v === "");
}

// 열 인덱스(0-based) → 셀 주소 헬퍼
function cellAddr(row0: number, col0: number): string {
  return XLSX.utils.encode_cell({ r: row0, c: col0 });
}

// 시트에서 특정 행/열의 텍스트 값 읽기
function getCellText(ws: XLSX.WorkSheet, row0: number, col0: number): string {
  const cell = ws[cellAddr(row0, col0)];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

// 시트에서 특정 행/열의 숫자 값 읽기
function getCellNumber(ws: XLSX.WorkSheet, row0: number, col0: number): number {
  const cell = ws[cellAddr(row0, col0)];
  if (!cell) return 0;
  const v = parseFloat(String(cell.v ?? "0").replace(/,/g, ""));
  return isNaN(v) ? 0 : v;
}

// 시트에서 값 셀(수식 없는 셀)만 수정
function setValueCell(ws: XLSX.WorkSheet, row0: number, col0: number, value: number): void {
  const addr = cellAddr(row0, col0);
  const cell = ws[addr];
  if (cell?.f) return; // 수식 셀은 건드리지 않음
  ws[addr] = { t: "n", v: value };
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

// 헤더 행 구조를 동적으로 탐지
interface SheetLayout {
  headerRow: number;   // 직종/성명이 있는 행 (0-based)
  dayRow: number;      // 1~31 날짜 번호가 있는 행 (0-based)
  dataStartRow: number;
  colJobTitle: number;
  colName: number;
  colDayStart: number; // day 1의 열 (0-based)
}

function detectLayout(ws: XLSX.WorkSheet): SheetLayout | null {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  // 헤더 행 탐색: "직종"이 있는 행 찾기
  for (let r = 0; r <= Math.min(range.e.r, 15); r++) {
    for (let c = 0; c <= Math.min(range.e.c, 20); c++) {
      if (getCellText(ws, r, c) === "직종") {
        const colJobTitle = c;
        const colName = c + 1;
        // 바로 다음 행에서 "1" 찾기 (날짜 행)
        for (let dr = 1; dr <= 5; dr++) {
          const dayRow = r + dr;
          for (let dc = 0; dc <= range.e.c; dc++) {
            if (getCellText(ws, dayRow, dc) === "1") {
              // 연속으로 2, 3 확인
              if (getCellText(ws, dayRow, dc + 1) === "2" && getCellText(ws, dayRow, dc + 2) === "3") {
                return {
                  headerRow: r,
                  dayRow,
                  dataStartRow: dayRow + 1,
                  colJobTitle,
                  colName,
                  colDayStart: dc,
                };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

// 연/월 탐지 (헤더 셀에서 "2026년 04월" 형태 파싱)
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

export function processPayroll(
  buffer: ArrayBuffer,
  annualLeaveMap: Record<string, Record<string, boolean>>,
  schedule: ScheduleData | null,
): PayrollResult {
  const wb = XLSX.read(buffer, { type: "array", cellFormula: true, bookVBA: true });

  const corrections: PayrollCorrection[] = [];
  let year = 0;
  let month = 0;

  for (const sheetName of wb.SheetNames) {
    // 비교 시트 등 건너뜀
    if (sheetName.startsWith("★") || sheetName.startsWith("비교")) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // 연/월 탐지 (첫 번째 시트에서만)
    if (!year) {
      const ym = detectYearMonth(ws);
      year = ym.year;
      month = ym.month;
    }

    const layout = detectLayout(ws);
    if (!layout) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

    // 해당 달의 일별 요일 정보 (1~31)
    const daysInMonth = new Date(year, month, 0).getDate();

    // 토요일에 다른 직원이 근무했는지 확인하기 위해 먼저 열별 합계 계산
    // colDayStart + (day-1) = day N의 열
    const saturdayHasWorkers = new Set<number>(); // 근무 흔적 있는 토요일 day번호
    for (let day = 1; day <= daysInMonth; day++) {
      const dow = new Date(year, month - 1, day).getDay();
      if (dow !== 6) continue;
      const col = layout.colDayStart + (day - 1);
      let anyWork = false;
      for (let r = layout.dataStartRow; r <= range.e.r; r++) {
        const v = getCellNumber(ws, r, col);
        if (v > 0) { anyWork = true; break; }
      }
      if (anyWork) saturdayHasWorkers.add(day);
    }

    // 각 데이터 행 처리
    for (let r = layout.dataStartRow; r <= range.e.r; r++) {
      const jobTitle = getCellText(ws, r, layout.colJobTitle);
      const name = getCellText(ws, r, layout.colName);
      if (!jobTitle || !name) continue;
      if (!isMonthlyWorker(jobTitle)) continue;

      // 현재 일별 공수 읽기
      const dayValues: number[] = [];
      for (let day = 1; day <= 31; day++) {
        const col = layout.colDayStart + (day - 1);
        dayValues.push(day <= daysInMonth ? getCellNumber(ws, r, col) : 0);
      }

      const changes: { day: number; before: number; after: number; reason: string }[] = [];
      const newValues = [...dayValues];

      // === 1단계: 연차 날짜 0 → 1 ===
      // annualLeaveMap key: "YYYY|M|D"
      for (let day = 1; day <= daysInMonth; day++) {
        if (newValues[day - 1] !== 0) continue;
        const leaveKey = `${year}|${month}|${day}`;
        if (!annualLeaveMap[name]?.[leaveKey]) continue;

        const dow = new Date(year, month - 1, day).getDay();
        const dateStr = toDateStr(year, month, day);
        if (dow === 0) continue; // 일요일 제외
        if (isKoreanHoliday(year, month, day)) continue;
        if (isSiteClosure(dateStr, schedule)) continue;
        if (dow === 6 && !saturdayHasWorkers.has(day)) continue;

        const maxVal = dow === 6 ? 1 : 1;
        newValues[day - 1] = maxVal;
        changes.push({ day, before: 0, after: maxVal, reason: "연차" });
      }

      // === 2단계: 총공수가 25 미만이면 평일/토요일 값 올리기 ===
      let total = newValues.reduce((s, v) => s + v, 0);

      if (total < 25) {
        // 조정 가능한 날짜 목록 (day, maxVal) — 낮은 현재값 우선 정렬
        const adjustable: { day: number; maxVal: number; cur: number }[] = [];
        for (let day = 1; day <= daysInMonth; day++) {
          const dow = new Date(year, month - 1, day).getDay();
          const dateStr = toDateStr(year, month, day);
          if (dow === 0) continue;
          if (isKoreanHoliday(year, month, day)) continue;
          if (isSiteClosure(dateStr, schedule)) continue;
          if (dow === 6) {
            if (!saturdayHasWorkers.has(day)) continue;
            if (newValues[day - 1] >= 1) continue;
            adjustable.push({ day, maxVal: 1, cur: newValues[day - 1] });
          } else {
            if (newValues[day - 1] >= 2) continue;
            adjustable.push({ day, maxVal: 2, cur: newValues[day - 1] });
          }
        }

        // 낮은 값부터 올리기
        adjustable.sort((a, b) => a.cur - b.cur);

        for (const { day, maxVal, cur } of adjustable) {
          if (total >= 25) break;
          const needed = Math.min(25 - total, maxVal - cur);
          if (needed <= 0) continue;
          const before = newValues[day - 1];
          // 0.5 단위 올림 (1, 1.5, 2)
          const steps = [0.5, 1, 1.5, 2];
          let after = before;
          for (const s of steps) {
            if (s > before && s <= maxVal && s - before <= needed + 0.01) {
              after = s;
            }
          }
          if (after === before) {
            after = Math.min(before + needed, maxVal);
          }
          const diff = after - before;
          if (diff <= 0) continue;
          newValues[day - 1] = after;
          total += diff;
          changes.push({ day, before, after, reason: "총공수 보정" });
        }
      }

      // 실제 셀 수정
      for (const { day, after } of changes) {
        setValueCell(ws, r, layout.colDayStart + (day - 1), after);
      }

      if (changes.length > 0) {
        const totalBefore = dayValues.reduce((s, v) => s + v, 0);
        const totalAfter = newValues.reduce((s, v) => s + v, 0);
        corrections.push({ name, jobTitle, sheetName, changes, totalBefore, totalAfter });
      }
    }
  }

  const outputBuffer = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
    cellFormula: true,
  }) as ArrayBuffer;

  return { corrections, outputBuffer, year, month };
}
