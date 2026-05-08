export type AttendanceIssueType = "late" | "missingCheck" | "missingPunchOut";

interface AttendanceIssuePresentation {
  label: string;
  className: string;
  summaryClassName: string;
}

const PRESENTATION: Record<AttendanceIssueType, AttendanceIssuePresentation> = {
  late: {
    label: "지각",
    className: "border-amber-300 bg-amber-100 text-amber-900 ring-1 ring-amber-200",
    summaryClassName: "border-amber-300 bg-amber-100 text-amber-900",
  },
  missingCheck: {
    label: "미체크",
    className: "border-rose-300 bg-rose-100 text-rose-800 ring-1 ring-rose-200",
    summaryClassName: "border-rose-300 bg-rose-100 text-rose-800",
  },
  missingPunchOut: {
    label: "미타각",
    className: "border-violet-300 bg-violet-100 text-violet-800 ring-1 ring-violet-200",
    summaryClassName: "border-violet-300 bg-violet-100 text-violet-800",
  },
};

export function getAttendanceIssuePresentation(type: AttendanceIssueType): AttendanceIssuePresentation {
  return PRESENTATION[type];
}

export function formatAttendanceIssueLabel(type: AttendanceIssueType, detail?: string | number): string {
  const label = getAttendanceIssuePresentation(type).label;
  return detail === undefined || detail === "" ? label : `${label} ${detail}`;
}
