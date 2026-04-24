export interface PerfectAttendanceRow {
  id?: string;
  팀명?: string;
  직종?: string;
  사번?: string;
  성명: string;
  xerp출근?: string;
  pmis출근?: string;
  공수합계AB?: string;
  가산사유?: string;
}

export type PerfectAttendanceDateMap = Record<string, PerfectAttendanceRow[]>;

export interface PerfectAttendancePerson {
  key: string;
  팀명: string;
  직종: string;
  사번: string;
  성명: string;
  출근인정일수: number;
  대상근무일수: number;
  결근일수: number;
  지각횟수: number;
  공수미달일수: number;
  예비군인정일수: number;
  예비군인정일자: string[];
  상세사유: string[];
}

export interface PerfectAttendanceResult {
  yearMonth: string;
  targetDates: string[];
  summary: {
    targetWorkDays: number;
    totalWorkers: number;
    perfectCount: number;
    failedCount: number;
    reserveForceCount: number;
  };
  perfect: PerfectAttendancePerson[];
  failed: PerfectAttendancePerson[];
}

export interface CalculatePerfectAttendanceInput {
  dateMap: PerfectAttendanceDateMap;
  yearMonth: string;
  saturdayWorkDates: string[];
  resignedNames: Set<string>;
}

const EXCLUDED_PERFECT_ATTENDANCE_TEAMS = new Set(["태화_F", "태화_W", "태화_S", "한성_F"]);

function isExcludedPerfectAttendanceTeam(row: PerfectAttendanceRow): boolean {
  return EXCLUDED_PERFECT_ATTENDANCE_TEAMS.has((row.팀명 ?? "").trim());
}

function isLateTime(timeStr: string): boolean {
  if (!timeStr) return false;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour > 7 || (hour === 7 && minute > 10);
}

function dateLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

function rowKey(row: PerfectAttendanceRow): string {
  return row.사번?.trim() || row.성명.trim();
}

function isReserveForce(row: PerfectAttendanceRow | null): boolean {
  return Boolean(row?.가산사유?.includes("예비군"));
}

function finalGongsu(row: PerfectAttendanceRow | null): number {
  if (!row) return 0;
  return Number.parseFloat(row.공수합계AB ?? "") || 0;
}

function buildTargetDates(
  yearMonth: string,
  dateMap: PerfectAttendanceDateMap,
  saturdayWorkDates: string[],
): string[] {
  const dates = new Set<string>();

  for (const date of Object.keys(dateMap)) {
    if (!date.startsWith(yearMonth)) continue;
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day >= 1 && day <= 5) dates.add(date);
  }

  for (const date of saturdayWorkDates) {
    if (!date.startsWith(yearMonth)) continue;
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 6) dates.add(date);
  }

  return [...dates].sort();
}

export function calculatePerfectAttendance(input: CalculatePerfectAttendanceInput): PerfectAttendanceResult {
  const targetDates = buildTargetDates(input.yearMonth, input.dateMap, input.saturdayWorkDates);
  const employeeMap = new Map<string, PerfectAttendanceRow>();
  const firstTargetDate = targetDates[0];

  if (firstTargetDate) {
    for (const row of input.dateMap[firstTargetDate] ?? []) {
      if (!row.성명) continue;
      if (isExcludedPerfectAttendanceTeam(row)) continue;
      const key = rowKey(row);
      if (!employeeMap.has(key)) employeeMap.set(key, row);
    }
  }

  const people: PerfectAttendancePerson[] = [];

  for (const [key, baseRow] of employeeMap) {
    const person: PerfectAttendancePerson = {
      key,
      팀명: baseRow.팀명 ?? "",
      직종: baseRow.직종 ?? "",
      사번: baseRow.사번 ?? "",
      성명: baseRow.성명,
      출근인정일수: 0,
      대상근무일수: targetDates.length,
      결근일수: 0,
      지각횟수: 0,
      공수미달일수: 0,
      예비군인정일수: 0,
      예비군인정일자: [],
      상세사유: [],
    };

    for (const date of targetDates) {
      const record = (input.dateMap[date] ?? []).find((row) => rowKey(row) === key) ?? null;

      if (!record) {
        person.결근일수++;
        person.상세사유.push(`${dateLabel(date)} 결근`);
        continue;
      }

      const reserveForce = isReserveForce(record);
      const gongsu = finalGongsu(record);
      const inTime = record.xerp출근 || record.pmis출근 || "";

      if (isLateTime(inTime)) {
        person.지각횟수++;
        person.상세사유.push(`${dateLabel(date)} 지각`);
      }

      if (reserveForce) {
        person.예비군인정일수++;
        person.예비군인정일자.push(dateLabel(date));
        person.출근인정일수++;
        continue;
      }

      if (gongsu >= 1) {
        person.출근인정일수++;
      } else {
        person.공수미달일수++;
        person.상세사유.push(`${dateLabel(date)} 공수 ${gongsu}`);
      }
    }

    people.push(person);
  }

  const perfect = people
    .filter((person) => person.결근일수 === 0 && person.지각횟수 === 0 && person.공수미달일수 === 0)
    .sort((a, b) => a.팀명.localeCompare(b.팀명) || a.성명.localeCompare(b.성명));
  const failed = people
    .filter((person) => person.결근일수 > 0 || person.지각횟수 > 0 || person.공수미달일수 > 0)
    .sort((a, b) => a.팀명.localeCompare(b.팀명) || a.성명.localeCompare(b.성명));

  return {
    yearMonth: input.yearMonth,
    targetDates,
    summary: {
      targetWorkDays: targetDates.length,
      totalWorkers: people.length,
      perfectCount: perfect.length,
      failedCount: failed.length,
      reserveForceCount: people.reduce((sum, person) => sum + person.예비군인정일수, 0),
    },
    perfect,
    failed,
  };
}
