import { describe, expect, it } from "vitest";
import { buildRecentHomeActivities } from "./recentHomeActivity";

describe("buildRecentHomeActivities", () => {
  it("summarizes known home update sources in display order", () => {
    expect(
      buildRecentHomeActivities({
        lastAttendanceUploadedAt: "08:10",
        latestXerpDate: "2026-05-13",
        selectedDate: "2026-05-13",
        leaveCount: 2,
      })
    ).toEqual([
      { title: "근태 파일 업데이트", detail: "08:10", status: "완료" },
      { title: "XERP 공수 기준", detail: "2026.05.13", status: "확인" },
      { title: "연차 현황 점검", detail: "2026.05.13 · 2명", status: "확인" },
    ]);
  });

  it("uses quiet fallback text when data is missing", () => {
    expect(
      buildRecentHomeActivities({
        lastAttendanceUploadedAt: null,
        latestXerpDate: null,
        selectedDate: "2026-05-13",
        leaveCount: 0,
      })
    ).toEqual([
      { title: "근태 파일 업데이트", detail: "업로드 전", status: "대기" },
      { title: "XERP 공수 기준", detail: "미등록", status: "대기" },
      { title: "연차 현황 점검", detail: "2026.05.13 · 없음", status: "확인" },
    ]);
  });
});
