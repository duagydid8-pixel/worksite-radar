import { describe, expect, it } from "vitest";
import { extractXerpPmisDateFromFilename, upsertXerpPmisDateList } from "./xerpPmisDates";

describe("extractXerpPmisDateFromFilename", () => {
  it("reads compact dates from XERP/PMIS export filenames", () => {
    expect(extractXerpPmisDateFromFilename("일일출력_20260316_평택 P4-Ph4 초순수.xlsx")).toBe("2026-03-16");
  });

  it("reads two digit year dates from export filenames", () => {
    expect(extractXerpPmisDateFromFilename("XERP_PMIS_26.04.01.xlsx")).toBe("2026-04-01");
  });

  it("rejects impossible calendar dates", () => {
    expect(extractXerpPmisDateFromFilename("XERP_PMIS_2026-02-31.xlsx")).toBeNull();
  });
});

describe("upsertXerpPmisDateList", () => {
  it("adds a newly saved date and keeps dates unique in newest first order", () => {
    expect(upsertXerpPmisDateList(["2026-04-01", "2026-03-29"], "2026-04-02")).toEqual([
      "2026-04-02",
      "2026-04-01",
      "2026-03-29",
    ]);
  });

  it("moves an existing saved date into normalized newest first order", () => {
    expect(upsertXerpPmisDateList(["2026-03-29", "2026-04-02", "2026-04-01"], "2026-04-01")).toEqual([
      "2026-04-02",
      "2026-04-01",
      "2026-03-29",
    ]);
  });
});
