import { describe, expect, it } from "vitest";
import { filterKakaoMessages, parseKakaoChat, summarizeKakao } from "./kakaoChat";

const PC = `현장팀 님과 카카오톡 대화
저장한 날짜 : 2026-10-19 10:00:00

--------------- 2026년 10월 18일 일요일 ---------------
2026년 10월 18일 오후 2:30, 홍길동 : 내일 안전교육입니다
참석 부탁드립니다
2026년 10월 18일 오후 2:31, 김철수 : https://example.com 확인
2026년 10월 18일 오후 2:32, 박영희님이 들어왔습니다.
2026년 10월 19일 오전 12:05, 김철수 : 사진`;

const MOBILE = `2026. 10. 18. 오전 9:10, 홍길동 : 안녕하세요`;
const OLD = `--------------- 2026년 10월 18일 일요일 ---------------
[홍길동] [오후 1:05] 구버전 형식`;

describe("parseKakaoChat", () => {
  it("parses PC export with multiline and system lines", () => {
    const r = parseKakaoChat(PC);
    expect(r.chatTitle).toBe("현장팀");
    expect(r.messages).toHaveLength(3);
    expect(r.messages[0]).toMatchObject({ date: "2026-10-18", time: "14:30", sender: "홍길동", text: "내일 안전교육입니다\n참석 부탁드립니다" });
    expect(r.messages[2]).toMatchObject({ date: "2026-10-19", time: "00:05" });
    expect(r.systemCount).toBe(1);
  });
  it("parses mobile and old formats", () => {
    expect(parseKakaoChat(MOBILE).messages[0]).toMatchObject({ date: "2026-10-18", time: "09:10" });
    expect(parseKakaoChat(OLD).messages[0]).toMatchObject({ date: "2026-10-18", time: "13:05", sender: "홍길동" });
  });
  it("filters and summarizes", () => {
    const { messages } = parseKakaoChat(PC);
    const base = { sender: "", keyword: "", from: "", to: "", onlyLinks: false, onlyFiles: false, hideMedia: false };
    expect(filterKakaoMessages(messages, { ...base, onlyLinks: true })).toHaveLength(1);
    expect(filterKakaoMessages(messages, { ...base, sender: "홍길동" })).toHaveLength(1);
    expect(summarizeKakao(messages).senders[0]).toEqual(["김철수", 2]);
  });
});

import { ATTENDANCE_CATEGORIES, PUNCH_PROBLEM_CATEGORY, pickImportant } from "./kakaoChat";
describe("pickImportant", () => {
  const enabled = [...ATTENDANCE_CATEGORIES.map((c) => c.key), PUNCH_PROBLEM_CATEGORY.key];
  it("keeps attendance-related messages with reasons and drops chatter", () => {
    const { messages } = parseKakaoChat(`--------------- 2026년 10월 18일 일요일 ---------------
[팀장] [오후 1:05] 홍길동 오늘 몸이 안좋아서 조퇴합니다
[동료] [오후 1:06] ㅋㅋㅋ
[동료] [오후 1:07] 김철수 안전교육 때문에 XERP 타각 못했습니다
[동료] [오후 1:08] 이영희 XERP 오류로 퇴근 타각 안됨
[동료] [오후 1:09] 박민수 이번달까지 퇴사입니다
[동료] [오후 1:10] 점심 뭐먹지`);
    const r = pickImportant(messages, { enabled, extraKeywords: [] });
    expect(r).toHaveLength(4);
    expect(r[0].tags).toEqual(["조퇴"]);
    expect(r[1].reason).toBe("교육으로 인한 타각 문제");
    expect(r[2].reason).toBe("XERP/시스템 오류로 인한 타각 문제");
    expect(r[3].tags).toEqual(["퇴사"]);
  });
});
