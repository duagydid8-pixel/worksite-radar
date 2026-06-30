import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/XerpPmisTable.tsx"), "utf8");

describe("XerpPmisTable XERP daily attendance import wiring", () => {
  it("uses the local daily attendance client", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload");
    expect(source).toContain("fetchLatestXerpDailyAttendanceFile");
    expect(source).toContain("decodeBase64Workbook");
  });

  it("does not enable the XERP import button for P5-PH1", () => {
    expect(source).toContain('site !== "P5PH1"');
    expect(source).toContain("canUseXerpDailyImport");
  });

  it("uses uploadDate for the XERP query and saved date", () => {
    expect(source).toContain("requestXerpDailyAttendanceDownload(xerpSite, uploadDate)");
    expect(source).toContain("[uploadDate]: imported");
    expect(source).toContain("setSelectedDate(uploadDate)");
  });

  it("adds a visible XERP import command near the PMIS upload controls", () => {
    expect(source).toContain("XERP 가져오기");
    expect(source).toContain("handleXerpDailyImport");
  });
});
