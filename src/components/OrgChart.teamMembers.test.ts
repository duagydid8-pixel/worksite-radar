import { describe, expect, it } from "vitest";
import { buildHeadOfficeTopManagerSlots, splitOrgTeamMembersForDisplay } from "./OrgChart";

describe("OrgChart team member display split", () => {
  it("keeps additional leaders visible instead of dropping them", () => {
    const members = [
      { id: "leader-a", is_leader: true, sort_order: 0 },
      { id: "leader-b", is_leader: true, sort_order: 1 },
      { id: "member-c", is_leader: false, sort_order: 2 },
    ];

    const result = splitOrgTeamMembersForDisplay(members);

    expect(result.leader?.id).toBe("leader-a");
    expect(result.others.map((member) => member.id)).toEqual(["leader-b", "member-c"]);
  });
});

describe("Head-office org chart top manager slots", () => {
  const siteManager = {
    name: "서재근",
    role: "현장소장",
    phone: "010-2334-8915",
    email: "men1012@hscleantech.com",
    photo_url: "/org-chart-head-office/image4.png",
  };

  const pmManager = {
    name: "",
    role: "PM",
    phone: "",
    email: "",
    photo_url: "",
  };

  it("adds a visible PM slot next to the site manager for P5-PH1 head-office PPTs", () => {
    const slots = buildHeadOfficeTopManagerSlots({
      siteKey: "head-office-p5-ph1",
      siteManager,
      pmManager,
    });

    expect(slots).toHaveLength(2);
    expect(slots[0].cells[0]).toBe("현장소장");
    expect(slots[1].cells[0]).toBe("PM");
    expect(slots[1].visible).toBe(true);
  });

  it("keeps only the site manager slot for non-P5 head-office PPTs", () => {
    const slots = buildHeadOfficeTopManagerSlots({
      siteKey: "head-office-p4-ph4",
      siteManager,
      pmManager,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].cells[0]).toBe("현장소장");
  });
});
