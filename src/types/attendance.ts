export interface Employee {
  team: "한성_F" | "태화_F";
  name: string;
  jobTitle: string;
  rank: string;
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

export interface ParsedData {
  employees: Employee[];
  anomalies: AnomalyRecord[];
  annualLeaveMap: Record<string, Record<string, boolean>>;
  dataMonth: number;
  dataYear: number;
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
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
