import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  analyzeFinalWorkUnits,
  parseMonthlyXerpAttendance,
  type FinalWorkUnitsPmisData,
} from "./finalWorkUnitsCheck";

function workbookBuffer(): ArrayBuffer {
  const rows = [
    [],
    ["월간 출퇴근 현황(2026년 05월)"],
    [],
    ["", "현장명", "팀명", "성명", "생년월일", "출역로그일수", "구분", "13일", "14일", "20일"],
    ["", "평택 P4-Ph4 초순수", "태화_F", "김세철", "900711", "3", "출근", "06:14", "06:12", "06:13"],
    ["", "", "", "", "", "", "퇴근", "18:53", "19:00", "17:00"],
    ["", "", "", "", "", "", "공수", "1.5", "1.5", "1"],
    ["", "", "", "", "", "", "근무시간", "12:39", "12:48", "10:47"],
    [],
    ["", "평택 P4-Ph4 초순수", "외주", "이강호", "860227", "2", "출근", "06:37", "", "06:40"],
    ["", "", "", "", "", "", "퇴근", "17:54", "", "17:12"],
    ["", "", "", "", "", "", "공수", "0", "", "0"],
    ["", "", "", "", "", "", "근무시간", "11:17", "", "10:32"],
    ["", "", "", "", "", "", "가산사유", "", "", "연장"],
    [],
    ["", "평택 P4-Ph4 초순수", "태화_F", "신향모", "901015", "1", "출근", "", "", "07:00"],
    ["", "", "", "", "", "", "퇴근", "", "", "17:00"],
    ["", "", "", "", "", "", "공수", "", "", "1"],
    ["", "", "", "", "", "", "근무시간", "", "", "10:00"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "월간출퇴근현황");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const pmis: FinalWorkUnitsPmisData = {
  dateLabel: "2026-05-20",
  persons: [
    {
      name: "김세철",
      firstIn: "06:12",
      lastOut: "17:03",
      inCount: 1,
      outCount: 1,
      totalEvents: 2,
    },
    {
      name: "이강호",
      firstIn: "06:41",
      lastOut: "17:09",
      inCount: 2,
      outCount: 2,
      totalEvents: 4,
    },
  ],
};

describe("parseMonthlyXerpAttendance", () => {
  it("parses person day rows from the monthly XERP workbook", () => {
    const records = parseMonthlyXerpAttendance(workbookBuffer());

    expect(records).toContainEqual(
      expect.objectContaining({
        name: "김세철",
        team: "태화_F",
        date: "2026-05-13",
        xerpIn: "06:14",
        xerpOut: "18:53",
        systemWorkUnits: 1.5,
        workTime: "12:39",
      })
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        name: "이강호",
        date: "2026-05-20",
        systemWorkUnits: 0,
        gasanReason: "연장",
      })
    );
  });
});

describe("analyzeFinalWorkUnits", () => {
  it("flags missing work units when XERP times and PMIS evidence exist", () => {
    const result = analyzeFinalWorkUnits({
      monthlyRecords: parseMonthlyXerpAttendance(workbookBuffer()),
      pmisByDate: { "2026-05-20": pmis },
      startDate: "2026-05-20",
      endDate: "2026-05-20",
    });

    const row = result.rows.find((item) => item.name === "이강호");
    expect(row?.status).toBe("missing-work-units");
    expect(row?.gasanReason).toBe("연장");
    expect(result.summary["gasan-review"]).toBe(1);
    expect(row?.pmisIn).toBe("06:41");
    expect(row?.pmisOut).toBe("17:09");
  });

  it("flags overtime review when XERP out is after 17:00 but system units are 1 or less", () => {
    const result = analyzeFinalWorkUnits({
      monthlyRecords: parseMonthlyXerpAttendance(workbookBuffer()),
      pmisByDate: {},
      startDate: "2026-05-13",
      endDate: "2026-05-13",
    });

    const row = result.rows.find((item) => item.name === "이강호");
    expect(row?.status).toBe("missing-work-units");
    expect(row?.checks).toContain("퇴근 17:54");
  });

  it("marks rows as PMIS not uploaded when no PMIS exists for the date", () => {
    const result = analyzeFinalWorkUnits({
      monthlyRecords: parseMonthlyXerpAttendance(workbookBuffer()),
      pmisByDate: {},
      startDate: "2026-05-14",
      endDate: "2026-05-14",
    });

    expect(result.rows.every((row) => row.status === "pmis-not-uploaded")).toBe(true);
  });

  it("returns normal rows when XERP and PMIS evidence are aligned", () => {
    const result = analyzeFinalWorkUnits({
      monthlyRecords: parseMonthlyXerpAttendance(workbookBuffer()),
      pmisByDate: { "2026-05-20": pmis },
      startDate: "2026-05-20",
      endDate: "2026-05-20",
    });

    const row = result.rows.find((item) => item.name === "김세철");
    expect(row?.status).toBe("normal");
  });
});
