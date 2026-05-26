import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OrgChart PPT export", () => {
  it("keeps regular PPT export editable instead of exporting a single chart image", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).not.toContain("fitImageIntoSlide");
    expect(source).not.toContain("imageSlide.addImage({ data: chartImage");
    expect(source).toContain("slide.addShape(rect");
    expect(source).toContain("slide.addText(`■ 조직도");
  });

  it("adds the employment color legend as editable PPT shapes", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("slide.addText(\"인원 구분\"");
    expect(source).toContain("MEMBER_BORDER_OPTIONS.forEach");
  });
});
