export interface PptOrgTeam {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface PptOrgMember {
  id: string;
  team_id: string;
  name: string;
  position: string;
  rank: string;
  phone: string;
  email: string;
  photo_url: string;
  is_leader: boolean;
  sort_order: number;
  border_color?: string;
}

export interface PptOrgManager {
  name: string;
  role: string;
  phone: string;
  email: string;
  photo_url: string;
}

export interface PptOrgData {
  orgSourceVersion: string;
  businessManager: PptOrgManager;
  siteManager: PptOrgManager;
  teams: PptOrgTeam[];
  members: PptOrgMember[];
}

const photo = (name: string) => `/org-chart-pptx/${name}`;
const headOfficePhoto = (name: string) => `/org-chart-head-office/${name}`;
export const PPT_ORG_VERSION = "ppt-2026-05-12";
export const HEAD_OFFICE_ORG_VERSION = "head-office-ppt-2026-05-06";
export const PPT_MEMBER_BORDER_COLORS: Record<string, string> = {
  전재현: "#00B050",
  정두용: "#00B050",
  이대용: "#00B050",
  박세일: "#00B050",
  이호기: "#00B050",
  이재호: "#00B050",
  이진식: "#00B050",
  곽희규: "#00B050",
  염효양: "#00B050",
  이중현: "#00B050",
  강태길: "#00B050",
  박시언: "#00B050",
  원영섭: "#00B050",
  양준용: "#00B050",
  박현아: "#00B050",
  양선우: "#00B050",
  오세현: "#FFFF00",
  윤근희: "#FFFF00",
  이형우: "#FFFF00",
  박재영: "#FFFF00",
  엄태원: "#FFFF00",
  조성진: "#FFFF00",
  전종수: "#FFFF00",
  김수형: "#FFFF00",
  박슬기: "#FFFF00",
  소영성: "#FFFF00",
  김가령: "#FFFF00",
  안형철: "#FFFF00",
  나경민: "#FFFF00",
  신동건: "#FFFF00",
  최윤창: "#FF0000",
  조용선: "#FF0000",
  신향모: "#FF0000",
  김솔임: "#FF0000",
  이효재: "#FF0000",
  김세철: "#FF0000",
  전명희: "#FF0000",
  전현진: "#FF0000",
};

export const PPT_ORG_DATA: PptOrgData = {
  orgSourceVersion: PPT_ORG_VERSION,
  businessManager: {
    name: "박정호",
    role: "사업 1본부 팀장",
    phone: "010-8768-6104",
    email: "p90902@hscleantech.com",
    photo_url: photo("image5.png"),
  },
  siteManager: {
    name: "서재근",
    role: "사업 1본부 현장 소장",
    phone: "010-2334-8915",
    email: "men1012@hscleantech.com",
    photo_url: photo("image4.png"),
  },
  teams: [
    { id: "ppt-team-construction", name: "공사팀", color: "#2563eb", sort_order: 0 },
    { id: "ppt-team-office", name: "공무팀", color: "#7c3aed", sort_order: 1 },
    { id: "ppt-team-quality", name: "품질팀", color: "#059669", sort_order: 2 },
    { id: "ppt-team-safety", name: "안전팀", color: "#dc2626", sort_order: 3 },
    { id: "ppt-team-design", name: "설계팀", color: "#d97706", sort_order: 4 },
  ],
  members: [
    { id: "ppt-construction-01", team_id: "ppt-team-construction", name: "전재현", position: "공사 팀장", rank: "수석", phone: "010-4542-8574", email: "jaehyun@hscleantech.com", photo_url: photo("image36.jpg"), is_leader: true, sort_order: 0 },
    { id: "ppt-construction-02", team_id: "ppt-team-construction", name: "최윤창", position: "공사 담당", rank: "수석", phone: "010-8921-8509", email: "yunchang8509@naver.com", photo_url: photo("image9.png"), is_leader: false, sort_order: 1 },
    { id: "ppt-construction-03", team_id: "ppt-team-construction", name: "엄태원", position: "공사 담당", rank: "수석", phone: "010-4044-3004", email: "utw3004@hscleantech.com", photo_url: photo("image6.png"), is_leader: false, sort_order: 2 },
    { id: "ppt-construction-04", team_id: "ppt-team-construction", name: "박시언", position: "공사 담당", rank: "수석", phone: "010-40144-7102", email: "siewon7102@hscleantech.com", photo_url: photo("image42-upright.png"), is_leader: false, sort_order: 3 },
    { id: "ppt-construction-05", team_id: "ppt-team-construction", name: "신향모", position: "공사 담당", rank: "수석", phone: "010-4016-9754", email: "shmo2000@naver.com", photo_url: photo("image41.png"), is_leader: false, sort_order: 4 },
    { id: "ppt-construction-06", team_id: "ppt-team-construction", name: "이효재", position: "공사 담당", rank: "수석", phone: "010-4932-7273", email: "liqhtfree@hscleantech.com", photo_url: photo("image7.jpg"), is_leader: false, sort_order: 5 },
    { id: "ppt-construction-07", team_id: "ppt-team-construction", name: "김세철", position: "공사 담당", rank: "책임", phone: "010-3338-1471", email: "last511@naver.com", photo_url: photo("image10.png"), is_leader: false, sort_order: 6 },
    { id: "ppt-construction-08", team_id: "ppt-team-construction", name: "양선우", position: "공사 서류", rank: "선임", phone: "010-4953-3359", email: "iosyhcc@hscleantech.com", photo_url: photo("image8.png"), is_leader: false, sort_order: 7 },
    { id: "ppt-construction-09", team_id: "ppt-team-construction", name: "나경민", position: "공사 서류", rank: "책임", phone: "010-6292-6465", email: "kyeongmin.na@hscleantech.com", photo_url: photo("image40.png"), is_leader: false, sort_order: 8 },

    { id: "ppt-office-01", team_id: "ppt-team-office", name: "정두용", position: "공무 팀장", rank: "수석", phone: "010-3499-5097", email: "dooyong@hscleantech.com", photo_url: photo("image11.png"), is_leader: true, sort_order: 0 },
    { id: "ppt-office-02", team_id: "ppt-team-office", name: "이재호", position: "공무 담당", rank: "수석", phone: "010-6566-4804", email: "hatbaz@hscleantech.com", photo_url: photo("image12.jpg"), is_leader: false, sort_order: 1 },
    { id: "ppt-office-03", team_id: "ppt-team-office", name: "이진식", position: "공무(자재)", rank: "책임", phone: "010-5037-5567", email: "jimsik@hscleantech.com", photo_url: photo("image13.png"), is_leader: false, sort_order: 2 },
    { id: "ppt-office-04", team_id: "ppt-team-office", name: "염효양", position: "관리 담당", rank: "선임", phone: "010-2467-3241", email: "duagydid@hscleantech.com", photo_url: photo("image14.png"), is_leader: false, sort_order: 3 },
    { id: "ppt-office-05", team_id: "ppt-team-office", name: "이중현", position: "차량 운행", rank: "선임", phone: "010-8695-8987", email: "wndgus77@nate.com", photo_url: photo("image39.jpg"), is_leader: false, sort_order: 4 },

    { id: "ppt-quality-01", team_id: "ppt-team-quality", name: "오세현", position: "품질 팀장", rank: "수석", phone: "010-3222-2664", email: "upwquality@hscleantech.com", photo_url: photo("image15.png"), is_leader: true, sort_order: 0 },
    { id: "ppt-quality-02", team_id: "ppt-team-quality", name: "이형우", position: "품질 담당", rank: "수석", phone: "010-2268-9990", email: "Nanlhweda@naver.com", photo_url: photo("image38.jpg"), is_leader: false, sort_order: 1 },
    { id: "ppt-quality-03", team_id: "ppt-team-quality", name: "박재영", position: "품질 담당", rank: "책임", phone: "010-9285-7676", email: "gudcjf1@naver.com", photo_url: photo("image16.png"), is_leader: false, sort_order: 2 },
    { id: "ppt-quality-04", team_id: "ppt-team-quality", name: "강태길", position: "품질 서류", rank: "책임", phone: "010-6480-2263", email: "taegil@hscleantech.com", photo_url: photo("image17.png"), is_leader: false, sort_order: 3 },
    { id: "ppt-quality-05", team_id: "ppt-team-quality", name: "박슬기", position: "품질 담당", rank: "선임", phone: "010-5062-3217", email: "seul3217@gmail.com", photo_url: photo("image37.jpeg"), is_leader: false, sort_order: 4 },
    { id: "ppt-quality-06", team_id: "ppt-team-quality", name: "김솔임", position: "FMCS 담당", rank: "선임", phone: "010-7797-7658", email: "a01077977658@gmail.com", photo_url: photo("image19.png"), is_leader: false, sort_order: 5 },
    { id: "ppt-quality-07", team_id: "ppt-team-quality", name: "안형철", position: "품질 담당", rank: "선임", phone: "010-8277-7514", email: "gudcjf1@naver.com", photo_url: photo("image18.jpg"), is_leader: false, sort_order: 6 },

    { id: "ppt-safety-01", team_id: "ppt-team-safety", name: "윤근희", position: "안전 팀장", rank: "수석", phone: "010-8008-2681", email: "ghyoon@hscleantech.com", photo_url: photo("image20.png"), is_leader: true, sort_order: 0 },
    { id: "ppt-safety-02", team_id: "ppt-team-safety", name: "곽희규", position: "안전 담당", rank: "책임", phone: "010-5865-4584", email: "haekyu@hscleantech.com", photo_url: photo("image21.png"), is_leader: false, sort_order: 1 },
    { id: "ppt-safety-03", team_id: "ppt-team-safety", name: "조성진", position: "안전 담당", rank: "책임", phone: "010-8778-8217", email: "tjdwls0901@naver.com", photo_url: photo("image22.png"), is_leader: false, sort_order: 2 },
    { id: "ppt-safety-04", team_id: "ppt-team-safety", name: "원영섭", position: "안전 담당", rank: "선임", phone: "010-7696-2269", email: "dudtjq122@hscleantech.com", photo_url: photo("image23.png"), is_leader: false, sort_order: 3 },
    { id: "ppt-safety-05", team_id: "ppt-team-safety", name: "조용선", position: "안전 담당", rank: "책임", phone: "010-5589-7228", email: "upwconst@hscleantech.com", photo_url: photo("image24-upright.png"), is_leader: false, sort_order: 4 },
    { id: "ppt-safety-06", team_id: "ppt-team-safety", name: "양준용", position: "안전 담당", rank: "선임", phone: "010-3020-8418", email: "did8418@naver.com", photo_url: photo("image25-upright.jpg"), is_leader: false, sort_order: 5 },
    { id: "ppt-safety-07", team_id: "ppt-team-safety", name: "전명희", position: "안전 담당", rank: "책임", phone: "010-7499-0174", email: "jmh97799@naver.com", photo_url: photo("image26.png"), is_leader: false, sort_order: 6 },
    { id: "ppt-safety-08", team_id: "ppt-team-safety", name: "전현진", position: "안전 담당", rank: "선임", phone: "010-2389-2142", email: "upwconst@hscleantech.com", photo_url: photo("image27.png"), is_leader: false, sort_order: 7 },

    { id: "ppt-design-01", team_id: "ppt-team-design", name: "이대용", position: "설계 팀장", rank: "수석", phone: "010-6213-3902", email: "daeyong@hscleantech.com", photo_url: photo("image28.jpeg"), is_leader: true, sort_order: 0 },
    { id: "ppt-design-02", team_id: "ppt-team-design", name: "박세일", position: "설계 담당", rank: "수석", phone: "010-9959-8992", email: "psw062@hscleantech.com", photo_url: photo("image29.jpeg"), is_leader: false, sort_order: 1 },
    { id: "ppt-design-03", team_id: "ppt-team-design", name: "이호기", position: "설계 담당", rank: "수석", phone: "010-9219-0036", email: "leehk@hscleantech.com", photo_url: photo("image30-ihogi.jpg"), is_leader: false, sort_order: 2 },
    { id: "ppt-design-04", team_id: "ppt-team-design", name: "전종수", position: "설계 담당", rank: "수석", phone: "010-2840-7163", email: "upwdesign@hscleantech.com", photo_url: photo("image31.jpeg"), is_leader: false, sort_order: 3 },
    { id: "ppt-design-05", team_id: "ppt-team-design", name: "김수형", position: "BIM실", rank: "수석", phone: "010-8959-5863", email: "upwdesign@hscleantech.com", photo_url: photo("image32.jpeg"), is_leader: false, sort_order: 4 },
    { id: "ppt-design-06", team_id: "ppt-team-design", name: "김가령", position: "BIM실", rank: "수석", phone: "010-9311-9760", email: "upwdesign@hscleantech.com", photo_url: photo("image33.png"), is_leader: false, sort_order: 5 },
    { id: "ppt-design-07", team_id: "ppt-team-design", name: "소영성", position: "설계 담당", rank: "책임", phone: "010-8501-6881", email: "soyy9999@naver.com", photo_url: photo("image34.png"), is_leader: false, sort_order: 6 },
    { id: "ppt-design-08", team_id: "ppt-team-design", name: "신동건", position: "설계 담당", rank: "선임", phone: "010-8747-6786", email: "dk9416@naver.com", photo_url: photo("image35.png"), is_leader: false, sort_order: 7 },
    { id: "ppt-design-09", team_id: "ppt-team-design", name: "박현아", position: "FMCS 담당", rank: "선임", phone: "010-6480-2263", email: "upwquality@hscleantech.com", photo_url: photo("image43.png"), is_leader: false, sort_order: 8 },
  ],
};

export function createPptOrgData(): PptOrgData {
  return {
    orgSourceVersion: PPT_ORG_DATA.orgSourceVersion,
    businessManager: { ...PPT_ORG_DATA.businessManager },
    siteManager: { ...PPT_ORG_DATA.siteManager },
    teams: PPT_ORG_DATA.teams.map((team) => ({ ...team })),
    members: PPT_ORG_DATA.members.map((member) => ({ ...member })),
  };
}

const headMember = (
  id: string,
  team_id: string,
  name: string,
  position: string,
  rank: string,
  phone: string,
  email: string,
  photo_url: string,
  sort_order: number,
  border_color = "#00B050",
  is_leader = false,
): PptOrgMember => ({
  id,
  team_id,
  name,
  position,
  rank,
  phone,
  email,
  photo_url,
  is_leader,
  sort_order,
  border_color,
});

export const HEAD_OFFICE_ORG_DATA: PptOrgData = {
  orgSourceVersion: HEAD_OFFICE_ORG_VERSION,
  businessManager: { name: "", role: "사업 1본부 팀장", phone: "", email: "", photo_url: "" },
  siteManager: {
    name: "서재근",
    role: "현장소장",
    phone: "010-2334-8915",
    email: "men1012@hscleantech.com",
    photo_url: headOfficePhoto("image4.png"),
  },
  teams: [
    { id: "head-team-construction", name: "공사 팀", color: "#2B3A67", sort_order: 0 },
    { id: "head-team-design", name: "설계 팀", color: "#2B3A67", sort_order: 1 },
    { id: "head-team-office", name: "공무 팀", color: "#2B3A67", sort_order: 2 },
    { id: "head-team-quality", name: "품질 팀", color: "#2B3A67", sort_order: 3 },
    { id: "head-team-safety", name: "안전 팀", color: "#2B3A67", sort_order: 4 },
  ],
  members: [
    headMember("head-construction-01", "head-team-construction", "전재현", "공사 팀장", "수석", "010-4542-8574", "jaehyun@hscleantech.com", headOfficePhoto("image5.jpg"), 0, "#00B050", true),
    headMember("head-construction-02", "head-team-construction", "박시언", "공사 담당", "수석", "010-4044-7102", "siewon7102@hscleantech.com", headOfficePhoto("image32.png"), 1),
    headMember("head-construction-03", "head-team-construction", "엄태원", "공사 담당", "수석", "010-4044-3004", "utw3004@hscleantech.com", headOfficePhoto("image29.png"), 2, "#FF0000"),
    headMember("head-construction-04", "head-team-construction", "나경민", "공사 서류 및 공정", "책임", "010-4953-3359", "iosyhcc@hscleantech.com", headOfficePhoto("image30.png"), 3, "#FFFF00"),
    headMember("head-construction-05", "head-team-construction", "양선우", "공사 서류 및 공정/로스 관리", "선임", "010-4953-3359", "iosyhcc@hscleantech.com", headOfficePhoto("image27.png"), 4),

    headMember("head-design-01", "head-team-design", "이대용", "설계 팀장", "수석", "010-6213-3902", "daeyong@hscleantech.com", headOfficePhoto("image6.jpeg"), 0, "#00B050", true),
    headMember("head-design-02", "head-team-design", "박세일", "설계 담당", "수석", "010-9959-8992", "psw062@hscleantech.com", headOfficePhoto("image7.jpeg"), 1),
    headMember("head-design-03", "head-team-design", "전종수", "설계 담당", "수석", "010-2840-7163", "jongsoo@hscleantech.com", headOfficePhoto("image8.jpeg"), 2, "#FFFF00"),
    headMember("head-design-04", "head-team-design", "이호기", "설계 담당", "수석", "010-2840-7163", "jongsoo@hscleantech.com", photo("image30-ihogi.jpg"), 3),
    headMember("head-design-05", "head-team-design", "소영성", "설계 담당", "책임", "010-8501-6881", "soyy99@hscleantech.com", headOfficePhoto("image10.png"), 4, "#FFFF00"),
    headMember("head-design-06", "head-team-design", "박현아", "설계 담당", "선임", "010-3470-0145", "hyunah@hscleantech.com", headOfficePhoto("image31.png"), 5),
    headMember("head-design-07", "head-team-design", "신동건", "설계 담당", "선임", "010-8747-6786", "donggeon@hscleantech.com", headOfficePhoto("image28.png"), 6, "#FFFF00"),

    headMember("head-office-01", "head-team-office", "정두용", "공무 팀장", "수석", "010-3499-5097", "dooyong@hscleantech.com", headOfficePhoto("image11.png"), 0, "#00B050", true),
    headMember("head-office-02", "head-team-office", "이재호", "공무 담당", "수석", "010-6566-4804", "hatbazi@hscleantech.com", headOfficePhoto("image12.jpg"), 1),
    headMember("head-office-03", "head-team-office", "이진식", "공무 담당", "책임", "010-5037-5567", "jinsik@hscleantech.com", headOfficePhoto("image13.png"), 2),
    headMember("head-office-04", "head-team-office", "염효양", "공무 담당", "선임", "010-2467-3241", "duagydid_@hscleantech.com", headOfficePhoto("image14.png"), 3),
    headMember("head-office-05", "head-team-office", "이중현", "차량 담당", "선임", "010-8695-8987", "wndgus77@nate.com", headOfficePhoto("image15.jpg"), 4, "#FFFF00"),

    headMember("head-quality-01", "head-team-quality", "오세현", "품질 팀장", "수석", "010-9322-2664", "ippon@hscleantech.com", headOfficePhoto("image16.png"), 0, "#FF0000", true),
    headMember("head-quality-02", "head-team-quality", "이형우", "품질 담당", "수석", "010-2268-9990", "Nanlhweda@naver.com", headOfficePhoto("image17.jpg"), 1, "#FF0000"),
    headMember("head-quality-03", "head-team-quality", "박재형", "품질 담당", "책임", "010-9285-7676", "upwquality@hscleantech.com", headOfficePhoto("image18.png"), 2, "#FF0000"),
    headMember("head-quality-04", "head-team-quality", "강태길", "품질 담당", "책임", "010-6480-2263", "taegil@hscleantech.com", headOfficePhoto("image19.png"), 3),
    headMember("head-quality-05", "head-team-quality", "안형철", "품질 담당", "선임", "010-8277-7514", "upwquality@hscleantech.com", headOfficePhoto("image20.jpg"), 4, "#FF0000"),
    headMember("head-quality-06", "head-team-quality", "박슬기", "품질 서류", "선임", "010-5062-3217", "sg3217@hscleantech.com", headOfficePhoto("image21.jpeg"), 5, "#FFFF00"),

    headMember("head-safety-01", "head-team-safety", "윤근희", "안전 팀장", "수석", "010-8008-2681", "ghyoon@hscleantech.com", headOfficePhoto("image22.png"), 0, "#00B050", true),
    headMember("head-safety-02", "head-team-safety", "곽희규", "안전 서류", "책임", "010-5865-4584", "heekyu@hscleantech.com", headOfficePhoto("image23.png"), 1),
    headMember("head-safety-03", "head-team-safety", "조성진", "안전 담당", "책임", "010-6575-9539", "upwsafety@hscleantech.com", headOfficePhoto("image24.png"), 2, "#FFFF00"),
    headMember("head-safety-04", "head-team-safety", "원영섭", "안전 담당", "책임", "010-7696-2269", "dudtjq122@hscleantech.com", headOfficePhoto("image25.png"), 3),
    headMember("head-safety-05", "head-team-safety", "양준용", "안전 담당", "선임", "010-3020-8418", "did8418@hscleantech.com", headOfficePhoto("image26.jpg"), 4),
  ],
};

export function createHeadOfficeOrgData(): PptOrgData {
  return {
    orgSourceVersion: HEAD_OFFICE_ORG_DATA.orgSourceVersion,
    businessManager: { ...HEAD_OFFICE_ORG_DATA.businessManager },
    siteManager: { ...HEAD_OFFICE_ORG_DATA.siteManager },
    teams: HEAD_OFFICE_ORG_DATA.teams.map((team) => ({ ...team })),
    members: HEAD_OFFICE_ORG_DATA.members.map((member) => ({ ...member })),
  };
}

export function getPptOrgTeamCounts(data = PPT_ORG_DATA): Record<string, number> {
  return data.teams.reduce<Record<string, number>>((counts, team) => {
    counts[team.name] = data.members.filter((member) => member.team_id === team.id).length;
    return counts;
  }, {});
}
