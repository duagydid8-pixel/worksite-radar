import { describe, expect, it } from "vitest";
import {
  buildFinalWorkUnitsReviewMemoryEntries,
  findFinalWorkUnitsReviewSuggestion,
  mergeFinalWorkUnitsReviewMemory,
  type FinalWorkUnitsReviewMemoryRow,
} from "./finalWorkUnitsReviewMemory";

function row(overrides: Partial<FinalWorkUnitsReviewMemoryRow> = {}): FinalWorkUnitsReviewMemoryRow {
  return {
    id: "2026-05-13-worker-a",
    name: "Worker A",
    birthDate: "900101",
    team: "Team",
    date: "2026-05-13",
    status: "gasan-review",
    statusLabel: "가산사유",
    gasanReason: "야간 연장",
    xerpPmisReason: "",
    xerpPmisExtraUnits: 0.25,
    evidenceSource: "XERP",
    expectedWorkUnits: 1.25,
    reflectedWorkUnits: 1.25,
    missingWorkUnits: 0,
    message: "가산사유 확인 필요",
    ...overrides,
  };
}

describe("final work units review memory", () => {
  it("builds memory only from rows that have review flags or memo", () => {
    const entries = buildFinalWorkUnitsReviewMemoryEntries({
      site: "PH4",
      month: "2026-05",
      savedAt: "2026-05-22T00:00:00.000Z",
      rows: [row(), row({ id: "unreviewed", name: "Worker B" })],
      reviews: {
        "2026-05-13-worker-a": { flags: ["확인완료"], memo: "가산 반영 확인" },
        unreviewed: { flags: [], memo: "   " },
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      site: "PH4",
      month: "2026-05",
      rowId: "2026-05-13-worker-a",
      flags: ["확인완료"],
      memo: "가산 반영 확인",
      workerKey: "workera|900101",
    });
  });

  it("suggests the previous review for the same worker before similar patterns", () => {
    const entries = buildFinalWorkUnitsReviewMemoryEntries({
      site: "PH4",
      month: "2026-05",
      savedAt: "2026-05-22T00:00:00.000Z",
      rows: [
        row({ id: "same-worker", name: "Worker A", gasanReason: "야간 연장" }),
        row({ id: "same-reason", name: "Worker C", birthDate: "910101", gasanReason: "야간 연장" }),
      ],
      reviews: {
        "same-worker": { flags: ["확인완료"], memo: "같은 작업자 판단" },
        "same-reason": { flags: ["특이사항"], memo: "같은 사유 판단" },
      },
    });

    const suggestion = findFinalWorkUnitsReviewSuggestion(
      row({ id: "current", name: "Worker A", gasanReason: "야간 연장" }),
      entries,
    );

    expect(suggestion?.matchType).toBe("same-worker");
    expect(suggestion?.entry.memo).toBe("같은 작업자 판단");
  });

  it("can suggest a similar reviewed gasan pattern for another worker", () => {
    const entries = buildFinalWorkUnitsReviewMemoryEntries({
      site: "PH4",
      month: "2026-05",
      savedAt: "2026-05-22T00:00:00.000Z",
      rows: [row({ id: "reviewed", name: "Worker C", birthDate: "910101", gasanReason: "야간 연장" })],
      reviews: {
        reviewed: { flags: ["확인완료"], memo: "야간 연장은 사진 확인 후 반영" },
      },
    });

    const suggestion = findFinalWorkUnitsReviewSuggestion(
      row({ id: "current", name: "Worker D", birthDate: "920101", gasanReason: "야간 연장" }),
      entries,
    );

    expect(suggestion?.matchType).toBe("same-reason");
    expect(suggestion?.entry.memo).toBe("야간 연장은 사진 확인 후 반영");
  });

  it("merges incoming memory by id and keeps the newest entries first", () => {
    const existing = buildFinalWorkUnitsReviewMemoryEntries({
      site: "PH4",
      month: "2026-04",
      savedAt: "2026-04-30T00:00:00.000Z",
      rows: [row({ id: "old" })],
      reviews: { old: { flags: ["보류"], memo: "old" } },
    });
    const incoming = buildFinalWorkUnitsReviewMemoryEntries({
      site: "PH4",
      month: "2026-05",
      savedAt: "2026-05-22T00:00:00.000Z",
      rows: [row({ id: "new" })],
      reviews: { new: { flags: ["확인완료"], memo: "new" } },
    });

    const merged = mergeFinalWorkUnitsReviewMemory(existing, incoming, 1);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toContain("2026-05");
    expect(merged[0].memo).toBe("new");
  });
});
