import { describe, expect, it } from "vitest";
import { formatUploadTime, formatWeekRange, getLocalDateKey, getMonday, isLate } from "./attendanceDateUtils";

describe("attendance date utilities", () => {
  it("finds the Monday for a week", () => {
    const monday = getMonday(new Date(2026, 4, 6));

    expect(getLocalDateKey(monday)).toBe("2026-05-04");
  });

  it("formats a Monday-to-Sunday week range", () => {
    const monday = new Date(2026, 4, 4);

    expect(formatWeekRange(monday)).toBe("2026년 5월 4일(월) ~ 5월 10일(일)");
  });

  it("formats upload timestamps with zero-padded time", () => {
    const timestamp = new Date(2026, 4, 8, 9, 7).toISOString();

    expect(formatUploadTime(timestamp)).toBe("2026년 5월 8일 09:07");
  });

  it("classifies punch-in times after 06:30 as late", () => {
    expect(isLate("06:30")).toBe(false);
    expect(isLate("06:31")).toBe(true);
    expect(isLate("07:00")).toBe(true);
  });
});
