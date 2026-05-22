import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ElcdComparePage saved electronic-card dates", () => {
  it("loads saved electronic-card dates and uses saved date data as compare input", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/ElcdComparePage.tsx"), "utf8");

    expect(source).toContain("listElectronicCardDatesFS");
    expect(source).toContain("loadElectronicCardFS");
    expect(source).toContain("coerceElectronicCardData");
    expect(source).toContain("savedElcdDates");
    expect(source).toContain("setElcdFileName(`${date} 저장 전자카드");
    expect(source).toContain("void loadXerp()");
  });
});
