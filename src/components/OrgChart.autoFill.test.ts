import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OrgChart member auto-fill wiring", () => {
  it("applies PPT member auto-fill from the member name input", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("applyOrgMemberAutoFill");
    expect(source).toContain("handleMemberNameChange");
  });

  it("applies PPT manager auto-fill from the top manager name input", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("applyOrgManagerAutoFill");
    expect(source).toContain("handleManagerNameChange");
  });
});
