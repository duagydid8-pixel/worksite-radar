import { describe, expect, it } from "vitest";
import {
  buildCertificateRows,
  createCertificateTableHtml,
  createCertificateTableText,
  createMailSubject,
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
  it("creates the requested mail subject format", () => {
    expect(createMailSubject("재직증명서", "2026-04-27")).toBe(
      "평택 P4 초순수 재직증명서요청의 件_2026.04.27",
    );
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
