import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AttendanceTable from "./AttendanceTable";
import type { Employee } from "@/lib/parseExcel";

function makeWeekDates(): Date[] {
  return Array.from({ length: 7 }, (_, index) => new Date(2026, 2, 30 + index));
}

describe("AttendanceTable weekly summary", () => {
  it("counts 이형우 late records after his hire date", () => {
    const employees: Employee[] = [
      {
        team: "한성_F",
        name: "이형우",
        jobTitle: "공사",
        rank: "수석",
        totalDays: 1,
        dataYear: 2026,
        dataMonth: 3,
        dailyRecords: {
          "2026-3-30": { punchIn: "06:40", punchOut: "17:10" },
        },
      },
    ];

    render(
      <AttendanceTable
        employees={employees}
        anomalyMap={new Map()}
        annualLeaveMap={{}}
        weekDates={makeWeekDates()}
        dataYear={2026}
        dataMonth={3}
        rowOrders={{}}
        onOrderChange={() => {}}
      />
    );

    expect(screen.getByText("지각 06:40")).toBeInTheDocument();
    expect(screen.getByText("지각 1")).toBeInTheDocument();
    expect(screen.queryByText("정상")).not.toBeInTheDocument();
  });
});
