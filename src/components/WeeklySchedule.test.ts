import { describe, expect, it } from "vitest";
import { formatDayLabel, getMonthCalendarDates, getMonthRange, getMonthStart } from "./WeeklySchedule";

describe("monthly schedule date helpers", () => {
  it("normalizes any selected date to the first day of that month", () => {
    expect(getMonthStart(new Date("2026-05-22T00:00:00"))).toBe("2026-05-01");
    expect(getMonthStart(new Date("2026-05-24T00:00:00"))).toBe("2026-05-01");
  });

  it("builds a six-row month calendar around May 2026", () => {
    const dates = getMonthCalendarDates("2026-05-22");

    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe("2026-04-26");
    expect(dates).toContain("2026-05-22");
    expect(dates[41]).toBe("2026-06-06");
  });

  it("labels May 22, 2026 as Friday", () => {
    expect(formatDayLabel("2026-05-22")).toBe("금");
  });

  it("builds the selectable date range for a month", () => {
    expect(getMonthRange("2026-05-01")).toEqual({ min: "2026-05-01", max: "2026-05-31" });
  });
});
