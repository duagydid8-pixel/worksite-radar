import { describe, expect, it } from "vitest";
import { prepareAnnualLeavePayload } from "./firestoreService";

describe("annual leave Firestore payload", () => {
  it("serializes roster and usage without undefined fields", () => {
    const payload = prepareAnnualLeavePayload({
      employees: [
        {
          id: "e1",
          project: "P4-PH4",
          category: "현재직",
          name: "홍길동",
          department: "공무",
          hireDate: "2026-03-15",
          sourceRow: 2,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      usages: [
        {
          id: "u1",
          date: "2026-04-10",
          employeeId: "e1",
          employeeName: "홍길동",
          type: "연차",
          days: 1,
          memo: "",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        },
      ],
      uploadedAt: "2026-04-11T00:00:00.000Z",
    });

    expect(JSON.stringify(payload)).not.toContain("undefined");
    expect(payload.roster.employees[0].name).toBe("홍길동");
    expect(payload.usages.items[0].days).toBe(1);
  });
});
