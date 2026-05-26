import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OrgChart PPT export", () => {
  it("uses the rendered chart canvas for regular PPT layout fidelity", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("fitImageIntoSlide");
    expect(source).toContain("toPng(chartRef.current");
    expect(source).toContain("imageSlide.addImage({ data: chartImage");
  });
});
