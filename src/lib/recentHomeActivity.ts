export interface RecentHomeActivityInput {
  lastAttendanceUploadedAt: string | null;
  latestXerpDate: string | null;
  selectedDate: string;
  leaveCount: number;
}

export interface RecentHomeActivity {
  title: string;
  detail: string;
  status: "완료" | "확인" | "대기";
}

function formatDateLabel(date: string): string {
  return date.replaceAll("-", ".");
}

export function buildRecentHomeActivities(input: RecentHomeActivityInput): RecentHomeActivity[] {
  return [
    {
      title: "근태 파일 업데이트",
      detail: input.lastAttendanceUploadedAt ?? "업로드 전",
      status: input.lastAttendanceUploadedAt ? "완료" : "대기",
    },
    {
      title: "XERP 공수 기준",
      detail: input.latestXerpDate ? formatDateLabel(input.latestXerpDate) : "미등록",
      status: input.latestXerpDate ? "확인" : "대기",
    },
    {
      title: "연차 현황 점검",
      detail: `${formatDateLabel(input.selectedDate)} · ${input.leaveCount > 0 ? `${input.leaveCount}명` : "없음"}`,
      status: "확인",
    },
  ];
}
