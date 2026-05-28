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

    expect(source).toContain("const memberTableSlot = (member: OrgMember | undefined, picIndex: number)");
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

  it("relayouts head-office template cards before replacing table and photo slots", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");
    const exportStart = source.indexOf("async function exportHeadOfficeTemplatePpt");
    const relayoutIndex = source.indexOf("slideXml = relayoutHeadOfficeTemplateSlide(slideXml);", exportStart);
    const framesIndex = source.indexOf("const originalTableFrames", relayoutIndex);

    expect(source).toContain("function relayoutHeadOfficeTemplateSlide");
    expect(source).toContain("slideXml = relayoutHeadOfficeTemplateSlide(slideXml);");
    expect(relayoutIndex).toBeGreaterThan(exportStart);
    expect(relayoutIndex).toBeLessThan(framesIndex);
    expect(source).toContain("buildHeadOfficeTemplateLayout");
    expect(source).toContain("createPhotoFrame");
    expect(source).toContain("replaceIndexedFrameTransforms");
    expect(source).toContain("function scaleTableDimensions");
  });

  it("writes head-office PPT role cells from app data instead of preserving template slot labels", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("return tableXml.replace(/<a:tc(?:\\s[^>]*)?>[\\s\\S]*?<\\/a:tc>/g");
    expect(source).toContain("member?.position ?? \"\"");
    expect(source).toContain("siteManager.role ?? \"현장소장\"");
    expect(source).not.toContain("const memberCells = (member?: OrgMember) => [\n    undefined,");
  });

  it("derives head-office PPT photo slots from the same slots used for table text", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("photoSlot?: { picIndex: number; photoUrl?: string }");
    expect(source).toContain("const photoSlots = tableSlots.flatMap");
    expect(source).not.toContain("const photoSlots: Array<{ picIndex: number; photoUrl?: string }> = [");
  });

  it("removes stale rotation from head-office PPT photo shapes", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function removePictureRotation");
    expect(source).toContain("return picXml.replace(/<a:xfrm[^>]*>/, \"<a:xfrm>\");");
    expect(source).toContain("setPictureFrameTransform");
    expect(source).toContain("replaceIndexedFrameTransforms(nextXml, PPT_PIC_REGEX, layout.picFrames, setPictureFrameTransform)");
    expect(source).toContain("return removePictureCrop(removePictureRotation(picXml));");
    expect(source).toContain("pic = normalizePictureShape(pic);");
  });

  it("clears every remaining title text run so the template date cannot be duplicated", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain('if (index >= values.length) return "<a:t></a:t>";');
    expect(source).toContain('slideXml = replaceShapeTextContaining(slideXml, "■ 조직도", [title]);');
    expect(source).not.toContain('slideXml = replaceShapeTextContaining(slideXml, "■ 조직도", [title, "", "", "", "", "", "", "", "", "", ""]);');
  });

  it("removes stale crop data from head-office PPT photo shapes", () => {
    const source = readFileSync("src/components/OrgChart.tsx", "utf8");

    expect(source).toContain("function removePictureCrop");
    expect(source).toContain('return picXml.replace(/<a:srcRect\\b[^>]*\\/>/g, "");');
    expect(source).toContain("function normalizePictureShape");
    expect(source).toContain("return removePictureCrop(removePictureRotation(picXml));");
    expect(source).toContain("return normalizePictureShape(setFrameTransform(picXml, frame));");
    expect(source).toContain("return normalizePictureShape(picXml).replace(/r:embed=\"[^\"]+\"/, `r:embed=\"${relationshipId}\"`);");
    expect(source).toContain("pic = normalizePictureShape(pic);");
  });
});
