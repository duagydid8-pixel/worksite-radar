import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OrgChart member auto-fill wiring", () => {
  it("applies PPT member auto-fill from the member name input", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("applyOrgMemberAutoFill");
    expect(source).toContain("buildOrgMemberAutoFillSources");
    expect(source).toContain("handleMemberNameChange");
  });

  it("applies PPT manager auto-fill from the top manager name input", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("applyOrgManagerAutoFill");
    expect(source).toContain("handleManagerNameChange");
  });

  it("shows a compact border-color legend inside the org chart export area", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("인원 구분");
    expect(source).toContain("MEMBER_BORDER_OPTIONS.map");
  });

  it("links regular org-chart and head-office rosters as auto-fill fallbacks", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("linkedOrgData");
    expect(source).toContain("fallbackMembers:");
    expect(source).toContain("...HEAD_OFFICE_ORG_DATA.members");
    expect(source).toContain("...PPT_ORG_DATA.members");
  });

  it("lets users select local, Taehwa, and 3rd markers separately", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain('label: "현채"');
    expect(source).toContain('label: "태화"');
    expect(source).toContain('label: "3rd"');
    expect(source).toContain('marker: "(현채)"');
    expect(source).toContain('marker: "(태화)"');
    expect(source).toContain('marker: "(3rd)"');
    expect(source).toContain("function getMemberMarkerText");
  });

  it("keeps the head-office team delete button visible without hover", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain('className="group min-w-0"');
    expect(source).toContain('aria-label={`${team.name} 삭제`}');
    expect(source).not.toContain('isHeadOfficeTemplate ? "hidden group-hover:block" : ""');
  });
});
