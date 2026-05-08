import { describe, expect, it } from "vitest";
import { classifyAttendanceFile, selectSourceFiles } from "../../scripts/attendance-folder-watcher.mjs";

describe("attendance folder watcher file selection", () => {
  it("classifies fingerprint and XERP Excel files", () => {
    expect(classifyAttendanceFile("2026-05-08 지문기록.xlsx")).toBe("fingerprint");
    expect(classifyAttendanceFile("XERP기록_20260508.xls")).toBe("xerp");
    expect(classifyAttendanceFile("명단.xlsx")).toBeNull();
    expect(classifyAttendanceFile("~$XERP기록.xlsx")).toBeNull();
  });

  it("selects the latest fingerprint and XERP files", () => {
    const selected = selectSourceFiles([
      { name: "old 지문기록.xlsx", fullPath: "old-f.xlsx", mtimeMs: 10, size: 1 },
      { name: "new 지문기록.xlsx", fullPath: "new-f.xlsx", mtimeMs: 20, size: 1 },
      { name: "old XERP기록.xlsx", fullPath: "old-x.xlsx", mtimeMs: 15, size: 1 },
      { name: "new XERP기록.xlsx", fullPath: "new-x.xlsx", mtimeMs: 30, size: 1 },
    ]);

    expect(selected.fingerprint?.name).toBe("new 지문기록.xlsx");
    expect(selected.xerp?.name).toBe("new XERP기록.xlsx");
    expect(selected.ready).toBe(true);
  });
});
