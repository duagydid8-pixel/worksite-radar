import { describe, expect, it } from "vitest";
import {
  buildCurrentMonthRange,
  coerceElectronicCardData,
  groupElectronicCardRowsByDate,
  normalizeElectronicCardApiRows,
} from "./electronicCardSync";
import { getElectronicCardDocIds } from "./firestoreService";

describe("electronicCardSync", () => {
  it("builds a current-month range through the provided today date", () => {
    expect(buildCurrentMonthRange(new Date("2026-05-21T09:00:00+09:00"))).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-21",
      startYmd: "20260501",
      endYmd: "20260521",
    });
  });

  it("normalizes EUM API rows and derives tag date plus times", () => {
    const rows = normalizeElectronicCardApiRows([
      {
        custNm: "홍길동",
        birthday: "900101",
        lbrYmd: "20260521",
        gtwkDt: "2026-05-21 06:58:12",
        lvwkDt: "2026-05-21 17:04:55",
        tagNm: "전자카드",
        conm: "한성크린텍(주)",
      },
    ]);

    expect(rows).toEqual([
      {
        name: "홍길동",
        birthDate: "900101",
        company: "한성크린텍(주)",
        date: "2026-05-21",
        inTime: "06:58",
        outTime: "17:04",
        authMethod: "전자카드",
      },
    ]);
  });

  it("groups duplicate rows by date and worker without losing in/out times", () => {
    const grouped = groupElectronicCardRowsByDate([
      { name: "홍길동", birthDate: "900101", date: "2026-05-21", inTime: "06:58", outTime: "", authMethod: "전자카드" },
      { name: "홍길동", birthDate: "900101", date: "2026-05-21", inTime: "", outTime: "17:04", authMethod: "" },
    ]);

    expect(grouped["2026-05-21"]).toEqual({
      dateLabel: "2026-05-21",
      persons: [
        { name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04", authMethod: "전자카드", company: "" },
      ],
    });
  });

  it("tags rows with a site label and lets a same-site tap clear it in grouping", () => {
    const extra = normalizeElectronicCardApiRows([
      { custNm: "김이관", birthday: "900101", lbrYmd: "20260521", gtwkDt: "2026-05-21 06:58:00" },
    ], "[P4 Ph2] 이전현장");
    expect(extra[0].site).toBe("[P4 Ph2] 이전현장");

    const onlyOtherSite = groupElectronicCardRowsByDate([
      { name: "김이관", birthDate: "900101", date: "2026-05-21", inTime: "06:58", outTime: "", authMethod: "", company: "", site: "[P4 Ph2] 이전현장" },
    ]);
    expect(onlyOtherSite["2026-05-21"].persons[0].site).toBe("[P4 Ph2] 이전현장");

    const alsoThisSite = groupElectronicCardRowsByDate([
      { name: "김이관", birthDate: "900101", date: "2026-05-21", inTime: "06:58", outTime: "", authMethod: "", company: "", site: "[P4 Ph2] 이전현장" },
      { name: "김이관", birthDate: "900101", date: "2026-05-21", inTime: "", outTime: "17:00", authMethod: "", company: "" },
    ]);
    expect(alsoThisSite["2026-05-21"].persons[0].site).toBeUndefined();
  });

  it("coerces Firestore data into final-work-unit electronic-card data", () => {
    expect(coerceElectronicCardData({
      dateLabel: "2026-05-21",
      persons: [{ name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04" }],
    })).toEqual({
      dateLabel: "2026-05-21",
      persons: [{ name: "홍길동", birthDate: "900101", inTime: "06:58", outTime: "17:04", authMethod: "", company: "" }],
    });
  });
});

describe("electronic-card Firestore document ids", () => {
  it("uses the PH4 date-indexed prefix by default", () => {
    expect(getElectronicCardDocIds("PH4", "2026-05-21")).toEqual({
      prefix: "electronic_card_ph4",
      dateDocId: "electronic_card_ph4_2026-05-21",
      indexDocId: "electronic_card_ph4_index",
    });
  });
});
