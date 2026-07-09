import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/XerpWorkReflection.tsx"), "utf8");

describe("XerpWorkReflection XERP daily attendance import wiring", () => {
  it("uses the local daily attendance client", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload");
    expect(source).toContain("fetchLatestXerpDailyAttendanceFile");
    expect(source).toContain("decodeBase64Workbook");
  });

  it("adds a visible XERP import command to the workbook controls", () => {
    expect(source).toContain("handleXerpWorkImport");
    expect(source).toContain("XERP에서 가져오기");
  });

  it("uses the selected work date for the XERP query and loaded work date", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload(syncSite, workDate)");
    expect(source).toContain("processWorkbookBuffer(buffer, latest.file.fileName, workDate)");
    expect(source).toContain("const resolvedSite = forcedWorkDate ? syncSite : detectedSite");
  });
});
