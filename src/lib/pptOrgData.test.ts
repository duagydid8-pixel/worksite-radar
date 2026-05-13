import { describe, expect, it } from "vitest";
import { PPT_MEMBER_BORDER_COLORS, PPT_ORG_DATA, getPptOrgTeamCounts } from "./pptOrgData";

describe("PPT_ORG_DATA", () => {
  it("matches the 2026-05-12 PPT organization counts", () => {
    expect(PPT_ORG_DATA.orgSourceVersion).toBe("ppt-2026-05-12");
    expect(PPT_ORG_DATA.members).toHaveLength(38);
    expect(PPT_ORG_DATA.members.length + 2).toBe(40);
    expect(PPT_ORG_DATA.teams).toHaveLength(5);
    expect(getPptOrgTeamCounts()).toEqual({
      "공사팀": 9,
      "공무팀": 5,
      "품질팀": 7,
      "안전팀": 8,
      "설계팀": 9,
    });
  });

  it("includes the top business manager and site manager from the PPT", () => {
    expect(PPT_ORG_DATA.businessManager).toMatchObject({
      name: "박정호",
      role: "사업 1본부 팀장",
      phone: "010-8768-6104",
      email: "p90902@hscleantech.com",
      photo_url: "/org-chart-pptx/image5.png",
    });
    expect(PPT_ORG_DATA.siteManager).toMatchObject({
      name: "서재근",
      role: "사업 1본부 현장 소장",
      phone: "010-2334-8915",
      email: "men1012@hscleantech.com",
      photo_url: "/org-chart-pptx/image4.png",
    });
  });

  it("keeps available PPT portraits on mapped members", () => {
    expect(PPT_ORG_DATA.members.find((member) => member.name === "전재현")?.photo_url).toBe("/org-chart-pptx/image36.jpg");
    expect(PPT_ORG_DATA.members.find((member) => member.name === "오세현")?.photo_url).toBe("/org-chart-pptx/image15.png");
    expect(PPT_ORG_DATA.members.find((member) => member.name === "이대용")?.photo_url).toBe("/org-chart-pptx/image28.jpeg");
    expect(PPT_ORG_DATA.members.find((member) => member.name === "박시언")?.photo_url).toBe("/org-chart-pptx/image42-upright.png");
    expect(PPT_ORG_DATA.members.find((member) => member.name === "이호기")?.photo_url).toBe("/org-chart-pptx/image30-ihogi.jpg");
  });

  it("uses the PPT border color legend for member employment categories", () => {
    expect(PPT_MEMBER_BORDER_COLORS.전재현).toBe("#00B050");
    expect(PPT_MEMBER_BORDER_COLORS.엄태원).toBe("#FFFF00");
    expect(PPT_MEMBER_BORDER_COLORS.최윤창).toBe("#FF0000");
    expect(Object.keys(PPT_MEMBER_BORDER_COLORS)).toHaveLength(PPT_ORG_DATA.members.length);
  });
});
