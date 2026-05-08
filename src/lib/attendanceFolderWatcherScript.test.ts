import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyAttendanceFile, scanWatchDir, selectSourceFiles } from "../../scripts/attendance-folder-watcher.mjs";

describe("attendance folder watcher file selection", () => {
  it("classifies fingerprint and XERP Excel files", () => {
    expect(classifyAttendanceFile("2026-05-08 지문기록.xlsx")).toBe("fingerprint");
    expect(classifyAttendanceFile("XERP기록_20260508.xls")).toBe("xerp");
    expect(classifyAttendanceFile("명단.xlsx")).toBe("roster");
    expect(classifyAttendanceFile("~$XERP기록.xlsx")).toBeNull();
  });

  it("selects the latest fingerprint, XERP, and roster files", () => {
    const selected = selectSourceFiles([
      { name: "old 지문기록.xlsx", fullPath: "old-f.xlsx", mtimeMs: 10, size: 1 },
      { name: "new 지문기록.xlsx", fullPath: "new-f.xlsx", mtimeMs: 20, size: 1 },
      { name: "old XERP기록.xlsx", fullPath: "old-x.xlsx", mtimeMs: 15, size: 1 },
      { name: "new XERP기록.xlsx", fullPath: "new-x.xlsx", mtimeMs: 30, size: 1 },
      { name: "old 명단.xlsx", fullPath: "old-r.xlsx", mtimeMs: 5, size: 1 },
      { name: "new 명단.xlsx", fullPath: "new-r.xlsx", mtimeMs: 35, size: 1 },
    ]);

    expect(selected.fingerprint?.name).toBe("new 지문기록.xlsx");
    expect(selected.xerp?.name).toBe("new XERP기록.xlsx");
    expect(selected.roster?.name).toBe("new 명단.xlsx");
    expect(selected.ready).toBe(true);
  });

  it("classifies monthly files by their parent folder names", () => {
    expect(classifyAttendanceFile("5월.xlsx", "C:\\근태\\지문기록\\5월.xlsx")).toBe("fingerprint");
    expect(classifyAttendanceFile("4월.xlsx", "C:\\근태\\XERP기록\\4월.xlsx")).toBe("xerp");
  });

  it("scans nested fingerprint and XERP folders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "attendance-watch-"));
    try {
      await mkdir(path.join(dir, "지문기록"));
      await mkdir(path.join(dir, "XERP기록"));
      await writeFile(path.join(dir, "근태 명단.xlsx"), "");
      await writeFile(path.join(dir, "지문기록", "5월.xlsx"), "");
      await writeFile(path.join(dir, "XERP기록", "4월.xlsx"), "");

      const status = await scanWatchDir(dir);

      expect(status.ready).toBe(true);
      expect(status.fingerprint?.fullPath).toContain("지문기록");
      expect(status.xerp?.fullPath).toContain("XERP기록");
      expect(status.roster?.name).toBe("근태 명단.xlsx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
