import { describe, expect, it } from "vitest";
import {
  buildCertificateRows,
  createExtraWorkMailBody,
  createExtraWorkMailSubject,
  createCertificateTableHtml,
  createCertificateTableText,
  createMailBody,
  createMailSubject,
  createOrgChartMailBody,
  createOrgChartMailSubject,
  formatYearMonthKorean,
  getExtraWorkProjectLabel,
  getOrgChartProjectLabel,
  getRequestSitePhrase,
  MAIL_REQUEST_MENU_OPTIONS,
  resolveCertificateName,
  splitNames,
  SITE_OPTIONS,
} from "./headOfficeMail";

const employees = [
  {
    이름: "조성진",
    주민번호: "940901-1",
    주소: "충청남도 천안시 서북구 한들3로 78-19",
    입사일: "2025-11-01",
  },
  {
    이름: "김철수",
    주민번호: "900101-1",
    주소: "경기도 평택시",
    입사일: "2024.03.15",
  },
];

describe("head office mail helpers", () => {
  it("defines the head office mail sub menus", () => {
    expect(MAIL_REQUEST_MENU_OPTIONS).toEqual([
      { label: "증명서", value: "certificate" },
      { label: "조직도", value: "orgChart" },
      { label: "가산공수", value: "extraWork" },
    ]);
  });

  it("creates the requested mail subject format", () => {
    expect(createMailSubject("재직증명서", "2026-04-27")).toBe(
      "평택 P4-PH4 초순수 현장 재직증명서요청의 件_2026.04.27",
    );
    expect(createMailSubject("재직증명서", "2026-04-27", SITE_OPTIONS[2].value)).toBe(
      "평택 P5-PH1 초순수 현장 재직증명서요청의 件_2026.04.27",
    );
  });

  it("creates the org chart send mail subject and body", () => {
    expect(createOrgChartMailSubject("2026-05-06")).toBe(
      "[초순수파트] 사업1팀_P4-PH4 초순수 현장 조직도 송부의 件_26.05.06",
    );
    expect(createOrgChartMailBody("2026-05-06")).not.toContain("수신 : 수신처 제외");
    expect(createOrgChartMailBody("2026-05-06")).not.toContain("참조 : 참조처 제외");
    expect(createOrgChartMailBody("2026-05-06")).not.toContain("발신 : 염효양 사원/초순수파트");
    expect(createOrgChartMailBody("2026-05-06")).toContain("2026년 5월 P4-PH4 초순수 현장 조직도 송부드립니다.");
  });

  it("creates the org chart send mail for the selected project", () => {
    expect(getOrgChartProjectLabel(SITE_OPTIONS[2].value)).toBe("P5-PH1 초순수 현장");
    expect(createOrgChartMailSubject("2026-05-06", SITE_OPTIONS[2].value)).toBe(
      "[초순수파트] 사업1팀_P5-PH1 초순수 현장 조직도 송부의 件_26.05.06",
    );
    expect(createOrgChartMailBody("2026-05-06", SITE_OPTIONS[1].value)).toContain(
      "2026년 5월 P4-PH2 초순수 현장 조직도 송부드립니다.",
    );
  });

  it("creates the extra work payment evidence mail for the selected project and month", () => {
    expect(getExtraWorkProjectLabel(SITE_OPTIONS[0].value)).toBe("P4 PH4 초순수");
    expect(formatYearMonthKorean("2026-04", true)).toBe("26년 04월");
    expect(createExtraWorkMailSubject("2026-05-11", "2026-04", SITE_OPTIONS[0].value)).toBe(
      "평택 P4 PH4 초순수_26년 04월 XERP 가산공수 지급 증빙자료 송부의 件_2026.05.11",
    );
    expect(createExtraWorkMailBody("2026-04", SITE_OPTIONS[1].value)).toContain(
      "2026년 04월 P4 PH2 초순수 현장 XERP 가산공수 지급 증빙자료를 첨부드리오니 확인 부탁드립니다.",
    );
  });

  it("creates the request body using selected site and certificate", () => {
    expect(createMailBody("재직증명서", SITE_OPTIONS[0].value)).toBe(
      [
        "안녕하세요. 사업1본부 초순수파트 염효양 사원입니다.",
        "",
        "업무에 노고가 많으십니다.",
        "",
        "평택 P4-PH4 초순수 현장 재직증명서 요청드립니다.",
      ].join("\n"),
    );
  });

  it("converts selected site value into body site phrase", () => {
    expect(getRequestSitePhrase(SITE_OPTIONS[2].value)).toBe("평택 P5-PH1 초순수 현장");
  });

  it("uses custom certificate name when 기타 is selected", () => {
    expect(resolveCertificateName("기타", "급여명세서")).toBe("급여명세서");
  });

  it("splits typed names by whitespace, commas, and new lines", () => {
    expect(splitNames("조성진, 김철수\n박영희")).toEqual(["조성진", "김철수", "박영희"]);
  });

  it("builds certificate rows from employee data and selected site", () => {
    const result = buildCertificateRows(["조성진", "없는사람"], employees, SITE_OPTIONS[0].value);

    expect(result.rows).toEqual([
      {
        no: 1,
        name: "조성진",
        residentNo: "940901-1",
        address: "충청남도 천안시 서북구 한들3로 78-19",
        siteName: "사업팀[삼성전자 평택 P4-PH4 초순수 현장]",
        joinDate: "2025.11.01",
        note: "",
        found: true,
      },
      {
        no: 2,
        name: "없는사람",
        residentNo: "",
        address: "",
        siteName: "사업팀[삼성전자 평택 P4-PH4 초순수 현장]",
        joinDate: "",
        note: "",
        found: false,
      },
    ]);
    expect(result.missingNames).toEqual(["없는사람"]);
  });

  it("creates a copyable text table with certificate title", () => {
    const { rows } = buildCertificateRows(["조성진"], employees, SITE_OPTIONS[0].value);

    expect(createCertificateTableText("재직증명서", rows)).toContain("재직증명서");
    expect(createCertificateTableText("재직증명서", rows)).toContain("NO.\t성명\t주민번호\t주소\t현장명\t입사일\t비고");
  });

  it("creates a copyable html table with the same columns", () => {
    const { rows } = buildCertificateRows(["조성진"], employees, SITE_OPTIONS[0].value);
    const html = createCertificateTableHtml("재직증명서", rows);

    expect(html).toContain("<strong>재직증명서</strong>");
    expect(html).toContain(">NO.</th>");
    expect(html).toContain("조성진");
  });
});
