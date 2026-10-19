import { describe, expect, it } from "vitest";
import { buildXerpPmisRowsFromReflection } from "./xerpPmisFromReflection";

const cols = (name: string, a: string, reason = "") => {
  const c = Array.from({ length: 26 }, () => "");
  c[0] = "F팀"; c[3] = name; c[5] = "07:00"; c[6] = "18:30"; c[16] = a; c[21] = a; c[25] = reason;
  return c;
};

describe("buildXerpPmisRowsFromReflection", () => {
  it("copies the raw columns and overlays 가산B, 공수합계AB, 가산사유", () => {
    const rows = buildXerpPmisRowsFromReflection(
      [
        { rowIndex: 3, cols: cols("홍길동", "1") },
        { rowIndex: 4, cols: cols("김철수", "1", "기존사유") },
      ],
      [{ rowIndex: 3, xerpGongsuA: "1", diff: 0.25, reason: "연장근무(주간)" }],
      () => "id",
    );
    expect(rows[0]).toMatchObject({ 성명: "홍길동", xerp출근: "07:00", 공수합계A: "1", 가산신청: "0.25", 공수합계AB: "1.25", 가산사유: "연장근무(주간)" });
    expect(rows[1]).toMatchObject({ 성명: "김철수", 가산신청: "", 공수합계AB: "1", 가산사유: "기존사유" });
  });
});
