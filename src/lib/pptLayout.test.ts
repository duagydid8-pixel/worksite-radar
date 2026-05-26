import { describe, expect, it } from "vitest";
import { fitImageIntoSlide, WIDE_PPT_SLIDE } from "./pptLayout";

describe("ppt image layout", () => {
  it("fills the available slide width for a wide org chart without distorting it", () => {
    const fit = fitImageIntoSlide({ width: 1280, height: 450 }, WIDE_PPT_SLIDE, 0.2);

    expect(fit.x).toBeCloseTo(0.2, 3);
    expect(fit.y).toBeCloseTo(0.2, 3);
    expect(fit.w).toBeCloseTo(12.933, 3);
    expect(fit.h).toBeCloseTo(4.547, 3);
  });

  it("constrains a tall image by slide height and centers it horizontally", () => {
    const fit = fitImageIntoSlide({ width: 800, height: 1600 }, WIDE_PPT_SLIDE, 0.2);

    expect(fit.h).toBeCloseTo(7.1, 3);
    expect(fit.w).toBeCloseTo(3.55, 3);
    expect(fit.x).toBeCloseTo(4.892, 3);
    expect(fit.y).toBeCloseTo(0.2, 3);
  });
});
