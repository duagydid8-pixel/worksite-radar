import { describe, expect, it } from "vitest";
import { removeUndefinedFields } from "./firestoreAttendance";

describe("firestore attendance serialization", () => {
  it("removes undefined fields before sending attendance data to Firestore", () => {
    expect(
      removeUndefinedFields({
        employees: [
          {
            team: "한성_F",
            name: "홍길동",
            attendanceSource: undefined,
            dailyRecords: {
              "2026-5-8": {
                punchIn: "06:20",
                punchOut: undefined,
              },
            },
          },
        ],
        leaveEmployees: [
          undefined,
          {
            name: "김현채",
            dept: undefined,
            remaining: 5,
          },
        ],
      })
    ).toEqual({
      employees: [
        {
          team: "한성_F",
          name: "홍길동",
          dailyRecords: {
            "2026-5-8": {
              punchIn: "06:20",
            },
          },
        },
      ],
      leaveEmployees: [
        {
          name: "김현채",
          remaining: 5,
        },
      ],
    });
  });
});
