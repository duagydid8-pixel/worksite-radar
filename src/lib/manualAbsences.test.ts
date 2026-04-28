import { describe, expect, it } from "vitest";
import { expandDateRange } from "./manualAbsences";

describe("expandDateRange", () => {
  it("returns one date when only a start date is provided", () => {
    expect(expandDateRange("2026-04-08", "")).toEqual(["2026-04-08"]);
  });

  it("returns every date in an inclusive range", () => {
    expect(expandDateRange("2026-04-08", "2026-04-11")).toEqual([
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
      "2026-04-11",
    ]);
  });

  it("returns an empty list when the end date is before the start date", () => {
    expect(expandDateRange("2026-04-11", "2026-04-08")).toEqual([]);
  });
});

