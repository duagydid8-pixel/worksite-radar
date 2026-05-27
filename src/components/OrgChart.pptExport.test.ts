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

  it("uses populated head-office seed data only for P4-PH4", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).not.toContain("isHeadOfficeTemplate ? createHeadOfficeOrgData() : createBlankOrgData()");
    expect(source).toContain('activeSite.key === "head-office-p4-ph4" ? createHeadOfficeOrgData() : createBlankOrgData()');
    expect(source).toContain("isSavedHeadOfficeSeedData");
    expect(source).toContain('activeSite.key !== "head-office-p4-ph4"');
    expect(source).toContain('activeSite.key === "head-office-p4-ph4" ? handleApplyHeadOfficeOrg : handleApplyBlankOrg');
    expect(source).toContain("hasFilledSiteManager(siteManager)");
  });

  it("clears stale head-office template photos when a PPT slot has no replacement image", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function applyPicSlots");
    expect(source).toContain('relationshipId ? replacePicEmbed(picXml, relationshipId) : ""');
    expect(source).toContain("removeUnusedSlideImageRelationships(zip, relXml, slideXml)");
    expect(source).not.toContain("if (relationshipId) slideXml = replacePicAtIndex(slideXml, slot.picIndex, relationshipId)");
  });

  it("does not export default site manager placeholder values in blank head-office PPTs", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("const hasSiteManager = hasFilledSiteManager(siteManager);");
    expect(source).toContain('hasSiteManager ? spacedKoreanName(siteManager.name) : ""');
    expect(source).toContain('{ picIndex: 0, photoUrl: hasSiteManager ? siteManager.photo_url : "" }');
  });

  it("removes head-office PPT table frames for people that are not in the list", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("const memberTableSlot = (member?: OrgMember)");
    expect(source).toContain("visible: Boolean(member)");
    expect(source).toContain('return slot.visible === false ? "" : replaceTableCellTexts(tableXml, slot.cells);');
    expect(source).not.toContain("{ cells: memberCells(design[0]) }");
  });

  it("removes stale head-office PPT marker text shapes from the original template", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function removeHeadOfficeMarkerShapes");
    expect(source).toContain("PPT_SHAPE_REGEX");
    expect(source).toContain("isHeadOfficeMarkerText(plainText)");
    expect(source).toContain("slideXml = removeHeadOfficeMarkerShapes(slideXml);");
    expect(source).not.toContain("/<p:sp[\\s\\S]*?<\\/p:sp>/g");
  });

  it("recreates head-office PPT markers for checked 3rd and local members", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function extractHeadOfficeMarkerShapes");
    expect(source).toContain("function appendHeadOfficeMarkerShapes");
    expect(source).toContain("const originalMarkerShapes = extractHeadOfficeMarkerShapes(slideXml);");
    expect(source).toContain("getHeadOfficeMarkerText(slot.member)");
    expect(source).toContain("member: member");
    expect(source).toContain("slideXml = appendHeadOfficeMarkerShapes(");
  });

  it("keeps generated head-office PPT blob URLs alive long enough for browser download", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function downloadGeneratedBlob");
    expect(source).toContain("setTimeout(() => {");
    expect(source).toContain("URL.revokeObjectURL(url)");
    expect(source).toContain("downloadGeneratedBlob(blob, `조직도_사업1팀_평택_${activeSite.label}_초순수현장_${titleDate}.pptx`)");
    expect(source).not.toContain("URL.revokeObjectURL(link.href)");
  });
});
