import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAttendanceRosterFile, parseAttendanceSourceFiles, preserveAnnualLeaveData } from "./attendanceSources";

function writeWorkbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("parseAttendanceSourceFiles", () => {
  it("parses a separate roster file into attendance roster candidates", () => {
    const roster = writeWorkbook({
      "명단": [
        ["팀", "이름", "직책", "직급"],
        ["한성_F", "김명단", "관리자", "반장"],
        ["태화_F", "박명단", "직원", ""],
      ],
    });

    expect(parseAttendanceRosterFile(roster)).toEqual([
      { team: "한성_F", name: "김명단", jobTitle: "관리자", rank: "반장" },
      { team: "태화_F", name: "박명단", jobTitle: "직원", rank: "" },
    ]);
  });

  it("uses 한성직원 and 태화 sheet names as teams in a two-sheet roster file", () => {
    const roster = writeWorkbook({
      "한성직원": [
        ["", "직원명", "직책", "직급"],
        ["", "김한성", "관리자", "반장"],
      ],
      "태화": [
        ["", "직원명", "직책", "직급"],
        ["", "박태화", "직원", ""],
      ],
    });

    expect(parseAttendanceRosterFile(roster)).toEqual([
      { team: "한성_F", name: "김한성", jobTitle: "관리자", rank: "반장" },
      { team: "태화_F", name: "박태화", jobTitle: "직원", rank: "" },
    ]);
  });

  it("parses the current roster shape with 현장명, 성명, 직종, and 직급 columns", () => {
    const roster = writeWorkbook({
      "태화&현채": [
        ["NO", "현장명", "성명", "직종", "직급"],
        ["", "", "", "", ""],
        [1, "태화", "신향모", "공사", "수석"],
        [8, "현채", "소영성", "설계", "책임"],
      ],
      "한성 직원": [
        ["", "", "", "", ""],
        ["NO", "현장명", "성명", "직종", "구분"],
        ["", "", "", "", ""],
        [1, "한성", "서재근", "소장", "수석"],
      ],
    });

    expect(parseAttendanceRosterFile(roster)).toEqual([
      { team: "태화_F", name: "신향모", jobTitle: "공사", rank: "수석" },
      { team: "현채", name: "소영성", jobTitle: "설계", rank: "책임" },
      { team: "한성_F", name: "서재근", jobTitle: "소장", rank: "수석" },
    ]);
  });

  it("uses 현채명단 sheet name as separate 현채 roster employees", () => {
    const roster = writeWorkbook({
      "현채명단": [
        ["", "직원명", "직책", "직급"],
        ["", "최현채", "직원", ""],
      ],
    });

    expect(parseAttendanceRosterFile(roster)).toEqual([
      { team: "현채", name: "최현채", jobTitle: "직원", rank: "" },
    ]);
  });

  it("keeps the roster team when 현채 roster employees match XERP records", () => {
    const roster = [
      { team: "현채" as const, name: "최현채", jobTitle: "직원", rank: "" },
    ];
    const fingerprint = writeWorkbook({
      "지문기록": [["date", "", "name", "", "", "", "", "in", "out"]],
    });
    const xerp = writeWorkbook({
      "XERP 기록": [
        ["header"],
        ["header"],
        ["2026-05-01", "", "태화_F", "최현채", "직원", "", "", "", "06:20", "17:10"],
      ],
    });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp, roster);

    expect(parsed.employees[0]).toMatchObject({
      team: "현채",
      name: "최현채",
      dailyRecords: {
        "2026-5-1": { punchIn: "06:20", punchOut: "17:10" },
      },
    });
  });

  it("parses monthly XERP files whose rows are employees and columns are days", () => {
    const roster = [
      { team: "태화_F" as const, name: "신향모", jobTitle: "공사", rank: "" },
      { team: "현채" as const, name: "소영성", jobTitle: "설계", rank: "" },
    ];
    const fingerprint = writeWorkbook({
      "지문기록": [
        ["근무일자", "", "이름", "", "", "", "", "출근시간", "퇴근시간"],
        ["2026-05-08", "", "서재근", "", "", "", "", "06:20", "17:10"],
      ],
    });
    const xerp = writeWorkbook({
      Sheet1: [
        ["현장명", "팀명", "성명", "직종", "생년월일", "전화번호", "출역로그", "1일", "", "2일", "", "3일", "", "4일", "", "5일", ""],
        ["평택 P4-Ph4 초순수", "태화_F", "신향모", "공사관리자", "", "", 2, "", "", "", "", "", "", "06:09", "14:07", "06:27", "17:29"],
        ["평택 P4-Ph4 초순수", "현채", "소영성", "설계관리자", "", "", 1, "", "", "06:18", "17:15"],
      ],
    });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp, roster);

    const taehwa = parsed.employees.find((employee) => employee.name === "신향모");
    const localHire = parsed.employees.find((employee) => employee.name === "소영성");

    expect(taehwa).toMatchObject({
      team: "태화_F",
      attendanceSource: "xerp",
      dailyRecords: {
        "2026-5-4": { punchIn: "06:09", punchOut: "14:07" },
        "2026-5-5": { punchIn: "06:27", punchOut: "17:29" },
      },
    });
    expect(localHire).toMatchObject({
      team: "현채",
      attendanceSource: "xerp",
      dailyRecords: {
        "2026-5-2": { punchIn: "06:18", punchOut: "17:15" },
      },
    });
  });

  it("uses the separate roster as manual candidates without requiring punch records", () => {
    const roster = [
      { team: "한성_F" as const, name: "김명단", jobTitle: "관리자", rank: "반장" },
      { team: "태화_F" as const, name: "박기록", jobTitle: "직원", rank: "" },
    ];
    const fingerprint = writeWorkbook({
      "지문기록": [["date", "", "name", "", "", "", "", "in", "out"]],
    });
    const xerp = writeWorkbook({
      "XERP 기록": [
        ["header"],
        ["header"],
        ["2026-05-01", "", "태화_F", "박기록", "직원", "", "", "", "06:20", "17:10"],
      ],
    });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp, roster);

    const rosterOnly = parsed.employees.find((employee) => employee.name === "김명단");
    const xerpRecord = parsed.employees.find((employee) => employee.name === "박기록");

    expect(rosterOnly).toMatchObject({
      team: "한성_F",
      name: "김명단",
      jobTitle: "관리자",
      rank: "반장",
      dailyRecords: {},
    });
    expect(xerpRecord?.dailyRecords["2026-5-1"]).toEqual({ punchIn: "06:20", punchOut: "17:10" });
  });

  it("roster filters 한성_F only — 태화/현채 XERP employees always included", () => {
    const roster = [
      { team: "한성_F" as const, name: "Roster Worker", jobTitle: "관리자", rank: "" },
    ];
    const fingerprint = writeWorkbook({
      "지문기록": [
        ["date", "", "name", "", "", "", "", "in", "out"],
        ["2026-05-08", "", "Roster Worker", "", "", "", "", "06:20", "17:10"],
        ["2026-05-08", "", "Outside Finger", "", "", "", "", "06:20", "17:10"],
      ],
    });
    const xerp = writeWorkbook({
      "XERP 기록": [
        ["header"],
        ["header"],
        ["2026-05-01", "", "한성_F", "Roster Worker", "관리자", "", "", "", "06:20", "17:10"],
        ["2026-05-01", "", "태화_F", "Outside Xerp", "직원", "", "", "", "06:20", "17:10"],
      ],
    });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp, roster);

    // 한성_F 명단 외 지문기록(Outside Finger)은 제외, 태화_F는 명단 무관하게 포함
    expect(parsed.employees.map((employee) => employee.name)).toEqual(["Roster Worker", "Outside Xerp"]);
    expect(parsed.employees[0].dailyRecords).toMatchObject({
      "2026-5-1": { punchIn: "06:20", punchOut: "17:10" },
      "2026-5-8": { punchIn: "06:20", punchOut: "17:10" },
    });
    expect(parsed.employees[1].team).toBe("태화_F");
  });

  it("matches fingerprint punch records to XERP employees by name and date", () => {
    const fingerprint = writeWorkbook({
      "지문 기록": [
        ["date", "", "name", "", "", "", "", "in", "out"],
        ["2026-05-08", "", "홍길동", "", "", "", "", "2026-05-08 06:31:00", ""],
      ],
    });
    const xerp = writeWorkbook({
      "XERP 기록": [
        ["header"],
        ["header"],
        ["2026-05-01", "", "한성_F", "홍길동", "관리자"],
        ["2026-05-01", "", "태화_F", "김철수", "직원", "", "", "", "06:20", ""],
      ],
    });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp);

    const hanseong = parsed.employees.find((employee) => employee.name === "홍길동");
    const taehwa = parsed.employees.find((employee) => employee.name === "김철수");

    expect(hanseong?.dailyRecords["2026-5-8"]).toEqual({ punchIn: "06:31", punchOut: null });
    expect(hanseong?.attendanceSource).toBe("fingerprint");
    expect(taehwa?.dailyRecords["2026-5-1"]).toEqual({ punchIn: "06:20", punchOut: null });
    expect(taehwa?.attendanceSource).toBe("xerp");
  });

  it("creates a fingerprint-only employee when the name is missing from XERP", () => {
    const fingerprint = writeWorkbook({
      "지문 기록": [
        ["date", "", "name", "", "", "", "", "in", "out"],
        ["2026-05-08", "", "신규자", "", "", "", "", "06:20", "17:10"],
      ],
    });
    const xerp = writeWorkbook({ "XERP 기록": [["header"], ["header"]] });

    const parsed = parseAttendanceSourceFiles(fingerprint, xerp);

    expect(parsed.employees[0]).toMatchObject({
      team: "한성_F",
      name: "신규자",
      attendanceSource: "fingerprint",
      dailyRecords: {
        "2026-5-8": { punchIn: "06:20", punchOut: "17:10" },
      },
    });
  });

  it("preserves annual leave records when attendance source files are re-parsed for the same month", () => {
    const nextAttendanceData = parseAttendanceSourceFiles(
      writeWorkbook({
        "지문기록": [
          ["근무일자", "", "이름", "", "", "", "", "출근시간", "퇴근시간"],
          ["2026-05-08", "", "서재근", "", "", "", "", "06:20", "17:10"],
        ],
      }),
      writeWorkbook({
        "XERP 기록": [
          ["현장명", "팀명", "성명", "직종", "생년월일", "전화번호", "출역로그", "1일", ""],
          ["평택 P4-Ph4 초순수", "태화_F", "신향모", "공사관리자", "", "", 1, "06:09", "14:07"],
        ],
      }),
      [{ team: "태화_F" as const, name: "신향모", jobTitle: "공사", rank: "" }]
    );
    const previousData = {
      ...nextAttendanceData,
      annualLeaveMap: { 신향모: { "2026|5|8": true } },
      leaveEmployees: [{ name: "신향모", dept: "태화", hireDate: "2026-01-01", totalUsed: 1, remaining: 9 }],
      leaveDetails: [{ year: 2026, month: 5, day: 8, name: "신향모", days: 1, reason: "연차" }],
    };

    expect(preserveAnnualLeaveData(nextAttendanceData, previousData)).toMatchObject({
      annualLeaveMap: { 신향모: { "2026|5|8": true } },
      leaveEmployees: [{ name: "신향모" }],
      leaveDetails: [{ year: 2026, month: 5, day: 8, name: "신향모" }],
    });
  });
});
