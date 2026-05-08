import { describe, expect, it } from "vitest";
import { formatAttendanceIssueLabel, getAttendanceIssuePresentation } from "./attendanceIssueDisplay";

describe("attendance issue display", () => {
  it("uses distinct labels for late, missing check, and missing punch-out", () => {
    expect(formatAttendanceIssueLabel("late", "06:40")).toBe("지각 06:40");
    expect(formatAttendanceIssueLabel("missingCheck")).toBe("미체크");
    expect(formatAttendanceIssueLabel("missingPunchOut")).toBe("미타각");
  });

  it("uses distinct visual tones for the three issue types", () => {
    expect(getAttendanceIssuePresentation("late").className).toContain("amber");
    expect(getAttendanceIssuePresentation("missingCheck").className).toContain("rose");
    expect(getAttendanceIssuePresentation("missingPunchOut").className).toContain("violet");
  });
});
