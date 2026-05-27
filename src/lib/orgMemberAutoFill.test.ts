import { describe, expect, it } from "vitest";
import { PPT_MEMBER_BORDER_COLORS, PPT_ORG_DATA } from "./pptOrgData";
import {
  applyOrgManagerAutoFill,
  applyOrgMemberAutoFill,
  buildOrgMemberAutoFillSources,
  buildOrgManagerAutoFillSources,
  findUniqueOrgMemberAutoFill,
  type OrgMemberAutoFillSource,
  type OrgManagerAutoFillDraft,
  type OrgMemberAutoFillDraft,
} from "./orgMemberAutoFill";

const blankMember: OrgMemberAutoFillDraft = {
  id: "new-member",
  team_id: "current-team",
  name: "이름 입력",
  position: "담당자",
  rank: "사원",
  phone: "",
  email: "",
  photo_url: "",
  is_leader: false,
  sort_order: 3,
  border_color: "#00B050",
};

const memberSource = (name: string, position: string): OrgMemberAutoFillSource => ({
  name,
  position,
  rank: "staff",
  phone: "",
  email: "",
  photo_url: "",
  is_leader: false,
  border_color: "#00B050",
});

describe("org member auto-fill", () => {
  it("fills PPT member details by exact name while preserving current team placement", () => {
    const filled = applyOrgMemberAutoFill(blankMember, "전재현", PPT_ORG_DATA.members, PPT_MEMBER_BORDER_COLORS);

    expect(filled).toMatchObject({
      id: "new-member",
      team_id: "current-team",
      sort_order: 3,
      name: "전재현",
      position: "공사 팀장",
      rank: "수석",
      phone: "010-4542-8574",
      email: "jaehyun@hscleantech.com",
      photo_url: "/org-chart-pptx/image36.jpg",
      is_leader: true,
      border_color: "#00B050",
    });
  });

  it("matches names even when the typed value contains spaces", () => {
    const match = findUniqueOrgMemberAutoFill("전 재 현", PPT_ORG_DATA.members);

    expect(match?.name).toBe("전재현");
  });

  it("leaves existing details alone when the typed name is not a unique PPT member", () => {
    const filled = applyOrgMemberAutoFill(
      { ...blankMember, position: "직접 입력", phone: "010-0000-0000" },
      "동명이인",
      [
        { ...blankMember, id: "a", team_id: "a", name: "동명이인", position: "A", sort_order: 0 },
        { ...blankMember, id: "b", team_id: "b", name: "동명이인", position: "B", sort_order: 1 },
      ],
      PPT_MEMBER_BORDER_COLORS,
    );

    expect(filled).toMatchObject({
      name: "동명이인",
      position: "직접 입력",
      phone: "010-0000-0000",
      team_id: "current-team",
    });
  });

  it("links member auto-fill sources while keeping the current roster as priority", () => {
    const sources = buildOrgMemberAutoFillSources({
      primaryMembers: [
        memberSource("Same Name", "primary roster"),
        memberSource("Same Name", "duplicate primary roster"),
        memberSource("Primary Only", "primary only"),
      ],
      fallbackMembers: [memberSource("Same Name", "fallback roster"), memberSource("Fallback Only", "fallback only")],
    });

    expect(sources.map((source) => `${source.name}:${source.position}`)).toEqual([
      "Same Name:primary roster",
      "Primary Only:primary only",
      "Fallback Only:fallback only",
    ]);

    expect(applyOrgMemberAutoFill(blankMember, "Same Name", sources).position).toBe("primary roster");
    expect(applyOrgMemberAutoFill(blankMember, "Fallback Only", sources).position).toBe("fallback only");
  });

  it("fills top manager details by name from PPT manager records", () => {
    const manager: OrgManagerAutoFillDraft = {
      name: "사업 1본부 팀장",
      role: "사업 1본부 팀장",
      phone: "",
      email: "",
      photo_url: "",
    };

    const filled = applyOrgManagerAutoFill(manager, "박정호", [
      PPT_ORG_DATA.businessManager,
      PPT_ORG_DATA.siteManager,
    ]);

    expect(filled).toEqual({
      name: "박정호",
      role: "사업 1본부 팀장",
      phone: "010-8768-6104",
      email: "p90902@hscleantech.com",
      photo_url: "/org-chart-pptx/image5.png",
    });
  });

  it("includes PPT members as top manager auto-fill sources for promoted site managers", () => {
    const sources = buildOrgManagerAutoFillSources({
      primaryManagers: [PPT_ORG_DATA.businessManager, PPT_ORG_DATA.siteManager],
      primaryMembers: PPT_ORG_DATA.members,
    });

    const manager: OrgManagerAutoFillDraft = {
      name: "현장소장",
      role: "사업 1본부 현장 소장",
      phone: "",
      email: "",
      photo_url: "",
    };
    const filled = applyOrgManagerAutoFill(manager, "전재현", sources);

    expect(filled).toMatchObject({
      name: "전재현",
      role: "사업 1본부 현장 소장",
      phone: "010-4542-8574",
      email: "jaehyun@hscleantech.com",
      photo_url: "/org-chart-pptx/image36.jpg",
    });
  });

  it("does not add an undefined role when a member is used as a manager source", () => {
    const sources = buildOrgManagerAutoFillSources({
      primaryManagers: [],
      primaryMembers: PPT_ORG_DATA.members,
    });

    const filled = applyOrgManagerAutoFill(
      { name: "현장소장", phone: "", email: "", photo_url: "" },
      "전재현",
      sources,
    );

    expect(Object.prototype.hasOwnProperty.call(filled, "role")).toBe(false);
  });
});
