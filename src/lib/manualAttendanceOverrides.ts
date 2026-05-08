import type { Employee, ParsedData } from "./parseExcel";

export type ManualAttendanceStatus = "연차" | "오전반차" | "오후반차" | "결근";

export interface ManualAttendanceOverride {
  id: string;
  date: string;
  name: string;
  status: ManualAttendanceStatus;
  note?: string;
  createdAt: string;
}

export interface ManualAttendanceRosterEmployee {
  team: Employee["team"];
  name: string;
  jobTitle?: string;
  rank?: string;
  attendanceSource?: Employee["attendanceSource"];
}

function parseDateKey(date: string): { year: number; month: number; day: number; recordKey: string; leaveKey: string } | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return {
    year,
    month,
    day,
    recordKey: `${year}-${month}-${day}`,
    leaveKey: `${year}|${month}|${day}`,
  };
}

export function applyManualAttendanceOverrides(
  data: ParsedData,
  overrides: ManualAttendanceOverride[],
  roster: ManualAttendanceRosterEmployee[] = []
): ParsedData {
  const next: ParsedData = {
    ...data,
    employees: data.employees.map((employee) => ({
      ...employee,
      dailyRecords: { ...employee.dailyRecords },
    })),
    annualLeaveMap: Object.fromEntries(
      Object.entries(data.annualLeaveMap).map(([name, dates]) => [name, { ...dates }])
    ),
    leaveDetails: [...data.leaveDetails],
  };

  for (const override of overrides) {
    const date = parseDateKey(override.date);
    if (!date) continue;

    let employee = next.employees.find((item) => item.name === override.name);
    if (!employee) {
      const rosterEmployee = roster.find((item) => item.name === override.name);
      if (rosterEmployee) {
        employee = {
          team: rosterEmployee.team,
          name: rosterEmployee.name,
          jobTitle: rosterEmployee.jobTitle ?? "",
          rank: rosterEmployee.rank ?? "",
          totalDays: 0,
          dataYear: date.year,
          dataMonth: date.month,
          attendanceSource: rosterEmployee.attendanceSource,
          dailyRecords: {},
        };
        next.employees.push(employee);
      }
    }
    if (!employee) continue;

    next.leaveDetails = next.leaveDetails.filter(
      (detail) =>
        detail.name !== override.name ||
        detail.year !== date.year ||
        detail.month !== date.month ||
        detail.day !== date.day
    );

    const existingRecord = employee.dailyRecords[date.recordKey] ?? { punchIn: null, punchOut: null };

    if (override.status === "연차") {
      next.annualLeaveMap[override.name] = {
        ...(next.annualLeaveMap[override.name] ?? {}),
        [date.leaveKey]: true,
      };
      employee.dailyRecords[date.recordKey] = { punchIn: null, punchOut: null, status: "연차" };
      employee.totalDays = Object.keys(employee.dailyRecords).length;
      next.leaveDetails.push({ ...date, name: override.name, days: 1, reason: override.note || "수동 연차" });
      continue;
    }

    if (next.annualLeaveMap[override.name]) {
      delete next.annualLeaveMap[override.name][date.leaveKey];
      if (Object.keys(next.annualLeaveMap[override.name]).length === 0) delete next.annualLeaveMap[override.name];
    }

    if (override.status === "결근") {
      employee.dailyRecords[date.recordKey] = { punchIn: null, punchOut: null, status: "결근" };
      employee.totalDays = Object.keys(employee.dailyRecords).length;
      continue;
    }

    employee.dailyRecords[date.recordKey] = {
      punchIn: existingRecord.punchIn,
      punchOut: existingRecord.punchOut,
      status: override.status,
    };
    employee.totalDays = Object.keys(employee.dailyRecords).length;
    next.leaveDetails.push({ ...date, name: override.name, days: 0.5, reason: override.note || override.status });
  }

  next.leaveDetails.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  return next;
}
