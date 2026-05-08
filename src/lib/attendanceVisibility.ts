import type { Employee, ParsedData } from "./parseExcel";
import type { ManualAttendanceOverride } from "./manualAttendanceOverrides";

interface AttendanceVisibilityOptions {
  selectedDate: string;
  monday: Date;
  manualAttendanceOverrides: ManualAttendanceOverride[];
  attendanceRoster?: { name: string }[];
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function recordKeyMatchesMonth(key: string, year: number, month: number): boolean {
  const [recordYear, recordMonth] = key.split("-").map(Number);
  return recordYear === year && recordMonth === month;
}

function annualLeaveKeyMatchesMonth(key: string, year: number, month: number): boolean {
  const [recordYear, recordMonth] = key.split("|").map(Number);
  return recordYear === year && recordMonth === month;
}

function overrideMatchesMonth(override: ManualAttendanceOverride, name: string, year: number, month: number): boolean {
  if (override.name !== name) return false;
  const [recordYear, recordMonth] = override.date.split("-").map(Number);
  return recordYear === year && recordMonth === month;
}

function hasVisibleAttendanceForMonth(
  data: ParsedData,
  employee: Employee,
  year: number,
  month: number,
  manualAttendanceOverrides: ManualAttendanceOverride[]
): boolean {
  if (Object.keys(employee.dailyRecords).some((key) => recordKeyMatchesMonth(key, year, month))) return true;
  if (Object.keys(data.annualLeaveMap[employee.name] ?? {}).some((key) => annualLeaveKeyMatchesMonth(key, year, month))) {
    return true;
  }
  return manualAttendanceOverrides.some((override) => overrideMatchesMonth(override, employee.name, year, month));
}

export function getVisibleAttendanceEmployees(
  data: ParsedData,
  { selectedDate, monday, manualAttendanceOverrides, attendanceRoster = [] }: AttendanceVisibilityOptions
): Employee[] {
  const [weekYear, weekMonth] = selectedDate.split("-").map(Number);
  let employees = data.employees.filter((employee) => employee.dataYear === weekYear && employee.dataMonth === weekMonth);
  if (employees.length === 0) employees = data.employees;
  const rosterNames = new Set(attendanceRoster.map((employee) => normalizeName(employee.name)));
  if (rosterNames.size > 0) {
    employees = employees.filter(
      (employee) => employee.team !== "한성_F" || rosterNames.has(normalizeName(employee.name))
    );
  }

  const mondayYear = monday.getFullYear();
  const mondayMonth = monday.getMonth() + 1;
  if (mondayYear !== weekYear || mondayMonth !== weekMonth) {
    const previousMonthEmployees = data.employees.filter(
      (employee) => employee.dataYear === mondayYear && employee.dataMonth === mondayMonth
    );
    if (previousMonthEmployees.length > 0) {
      employees = employees.map((employee) => {
        const previous = previousMonthEmployees.find((item) => item.name === employee.name && item.team === employee.team);
        if (!previous) return employee;
        return { ...employee, dailyRecords: { ...previous.dailyRecords, ...employee.dailyRecords } };
      });
    }
  }

  return employees.filter((employee) =>
    hasVisibleAttendanceForMonth(data, employee, weekYear, weekMonth, manualAttendanceOverrides)
  );
}
