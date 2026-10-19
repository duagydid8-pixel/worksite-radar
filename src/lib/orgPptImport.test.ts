import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOrgPptx } from "./orgPptImport";
import { HEAD_OFFICE_ORG_DATA } from "./pptOrgData";

describe("parseOrgPptx", () => {
  it("reads the head-office template into teams, members and the site manager", async () => {
    const buffer = readFileSync(resolve(process.cwd(), "public/org-chart-pptx/head-office-original.pptx"));
    const result = await parseOrgPptx(new Uint8Array(buffer));

    expect(result.siteManager).toMatchObject({ name: "서재근", phone: "010-2334-8915", email: "men1012@hscleantech.com" });
    // 원본 양식에는 설계 팀이 남아 있다 (앱 기본 데이터는 설계 제외)
    expect(result.teams.map((t) => t.name)).toEqual(["공사 팀", "설계 팀", "공무 팀", "품질 팀", "안전 팀"]);

    const teamName = (id: string) => result.teams.find((t) => t.id === id)?.name;
    const expectedTeam = (id: string) => HEAD_OFFICE_ORG_DATA.teams.find((t) => t.id === id)?.name;
    const got = result.members.filter((m) => teamName(m.team_id) !== "설계 팀").map((m) => `${teamName(m.team_id)}|${m.name}`).sort();
    const want = HEAD_OFFICE_ORG_DATA.members.map((m) => `${expectedTeam(m.team_id)}|${m.name}`).sort();
    expect(got).toEqual(want);

    const leader = result.members.find((m) => m.name === "전재현");
    expect(leader).toMatchObject({ rank: "수석", is_leader: true, phone: "010-4542-8574", email: "jaehyun@hscleantech.com" });
    expect(result.members.find((m) => m.name === "엄태원")?.border_color).toBe("#FF0000");
    expect(result.members.find((m) => m.name === "나경민")?.border_color).toBe("#FFFF00");
    expect(Object.keys(result.photos).length).toBeGreaterThan(20);
  });
});
