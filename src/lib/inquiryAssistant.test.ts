import { describe, expect, it } from "vitest";
import {
  buildKakaoReply,
  createKakaoConversationEntry,
  extractLatestKakaoMessages,
  findManualMatches,
  normalizeKakaoConversationEntries,
  normalizeManualEntries,
  type ManualEntry,
} from "./inquiryAssistant";

describe("extractLatestKakaoMessages", () => {
  it("keeps recent customer lines from exported KakaoTalk text", () => {
    const text = [
      "2026년 4월 30일 목요일",
      "[김철수] [오전 9:02] 오늘 연장 몇시간 들어갔나요?",
      "[나] [오전 9:03] 확인해보겠습니다.",
      "[박영희] [오전 9:04] 신규자 교육 장소도 알려주세요",
    ].join("\n");

    expect(extractLatestKakaoMessages(text, { myNames: ["나"] })).toEqual([
      "김철수: 오늘 연장 몇시간 들어갔나요?",
      "박영희: 신규자 교육 장소도 알려주세요",
    ]);
  });
});

describe("buildKakaoReply", () => {
  it("creates a copy-ready reply from inquiry text and matched manuals", () => {
    const manuals: ManualEntry[] = [
      { id: "1", title: "신규자 교육", keywords: ["신규자", "교육"], answer: "신규자 교육 장소는 현장 안전교육장입니다." },
    ];

    expect(buildKakaoReply("신규자 교육 장소 알려주세요", manuals)).toBe(
      "문의하신 내용 확인했습니다.\n신규자 교육 장소는 현장 안전교육장입니다.",
    );
  });

  it("falls back to a safe confirmation reply when no manual matches", () => {
    expect(buildKakaoReply("오늘 연장 몇시간인가요?", [])).toBe(
      "문의하신 내용 확인했습니다.\n정확히 확인한 뒤 바로 안내드리겠습니다.",
    );
  });
});

describe("normalizeManualEntries", () => {
  it("drops empty manual rows and normalizes comma-separated keywords", () => {
    expect(normalizeManualEntries([
      { id: "", title: " 신규자 ", keywords: ["신규자, 교육"], answer: " 장소 안내 " },
      { id: "", title: "", keywords: [""], answer: "" },
    ])).toEqual([
      { id: "manual-0", title: "신규자", keywords: ["신규자", "교육"], answer: "장소 안내" },
    ]);
  });
});

describe("findManualMatches", () => {
  it("matches manuals when any keyword appears in the inquiry text", () => {
    const manuals = normalizeManualEntries([
      { id: "1", title: "연장 문의", keywords: ["연장", "공수"], answer: "연장 공수는 확인 후 안내드립니다." },
      { id: "2", title: "식대 문의", keywords: ["식대"], answer: "식대는 급여대장에서 확인 가능합니다." },
    ]);

    expect(findManualMatches("오늘 연장 몇시간인가요?", manuals).map((entry) => entry.title)).toEqual(["연장 문의"]);
  });
});

describe("createKakaoConversationEntry", () => {
  it("stores loaded KakaoTalk content with extracted inquiry text", () => {
    const sourceText = [
      "[김철수] [오전 9:02] 오늘 연장 몇시간 들어갔나요?",
      "[나] [오전 9:03] 확인해보겠습니다.",
    ].join("\n");

    expect(createKakaoConversationEntry({ sourceText, fileName: "openchat.txt", now: "2026-04-30T01:00:00.000Z" })).toMatchObject({
      title: "openchat.txt",
      sourceText,
      inquiryText: "김철수: 오늘 연장 몇시간 들어갔나요?",
      importedAt: "2026-04-30T01:00:00.000Z",
    });
  });
});

describe("normalizeKakaoConversationEntries", () => {
  it("keeps valid saved conversations and drops empty entries", () => {
    expect(normalizeKakaoConversationEntries([
      {
        id: "",
        title: " 문의 ",
        importedAt: "2026-04-30T01:00:00.000Z",
        sourceText: " 원문 ",
        inquiryText: " 정리 ",
      },
      {
        id: "bad",
        title: "",
        importedAt: "",
        sourceText: "",
        inquiryText: "",
      },
    ])).toEqual([
      {
        id: "conversation-0",
        title: "문의",
        importedAt: "2026-04-30T01:00:00.000Z",
        sourceText: "원문",
        inquiryText: "정리",
        replyText: "",
      },
    ]);
  });
});
