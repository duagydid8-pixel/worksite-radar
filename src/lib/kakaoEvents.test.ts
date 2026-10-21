import { describe, expect, it } from "vitest";
import { parseKakaoChat } from "./kakaoChat";
import {
  applyCauseToGasanReason,
  chatKeyOf,
  crossCheckKakaoWithXerp,
  extractKakaoEvents,
  findRosterNames,
  guessKakaoRoom,
  guessLeadingNames,
  isNotPersonnelChange,
  mergeKakaoEvents,
  messageMonths,
  resolveTargetDate,
  summarizeEventsByPerson,
} from "./kakaoEvents";

const CHAT = `--------------- 2026년 10월 18일 일요일 ---------------
[반장] [오후 1:05] 홍길동 몸이 안좋아서 조퇴합니다
[반장] [오후 1:06] ㅋㅋㅋ
[반장] [오후 1:07] 김 철수 안전교육 때문에 XERP 타각 못했습니다
[반장] [오후 1:08] 이영희, 박민수 XERP 오류로 퇴근 타각 안됨
[반장] [오후 1:09] 최지훈 내일 연차입니다
[반장] [오후 1:10] 정우성 이번달까지 퇴사입니다`;

const ROSTER = ["홍길동", "김철수", "이영희", "박민수", "최지훈", "정우성", "홍길"];

describe("kakao events", () => {
  it("extracts one event per roster name with category, cause and target date", () => {
    const events = extractKakaoEvents(parseKakaoChat(CHAT).messages, ROSTER);
    const brief = events.map((e) => `${e.date} ${e.name} ${e.category} ${e.cause}`.trim());
    expect(brief).toEqual([
      "2026-10-18 홍길동 early",
      "2026-10-18 김철수 punch 안전교육",
      "2026-10-18 이영희 punch xerp 오류",
      "2026-10-18 박민수 punch xerp 오류",
      "2026-10-19 최지훈 leave",
      "2026-10-18 정우성 resign",
    ]);
  });

  it("prefers the longer name and ignores spacing", () => {
    expect(findRosterNames("홍길동 조퇴", ["홍길", "홍길동"])).toEqual(["홍길동"]);
    expect(findRosterNames("김 철수 교육", ["김철수"])).toEqual(["김철수"]);
  });

  it("guesses leading names when the roster has no match", () => {
    expect(guessLeadingNames("홍길동 몸이 안좋아서 조퇴합니다")).toEqual(["홍길동"]);
    expect(guessLeadingNames("이영희, 박민수 XERP 오류로 타각 안됨")).toEqual(["이영희", "박민수"]);
    expect(guessLeadingNames("홍길동님 내일 연차")).toEqual(["홍길동"]);
    expect(guessLeadingNames("내일 전원 안전교육")).toEqual([]);
    expect(extractKakaoEvents(parseKakaoChat(CHAT).messages, []).map((e) => e.name)).toEqual(["홍길동", "", "이영희", "박민수", "최지훈", "정우성"]);
  });

  it("resolves relative and explicit dates", () => {
    expect(resolveTargetDate("모레 휴가", "2026-10-30")).toBe("2026-11-01");
    expect(resolveTargetDate("10월 25일 연차", "2026-10-18")).toBe("2026-10-25");
    expect(resolveTargetDate("1/3 연차", "2026-12-28")).toBe("2027-01-03");
    expect(resolveTargetDate("08:30 지각", "2026-10-18")).toBe("2026-10-18");
  });

  it("prefixes the gasan reason with the kakao cause", () => {
    expect(applyCauseToGasanReason("출근미타각(주간)", "안전교육")).toBe("안전교육으로 인한 출근미타각(주간)");
    expect(applyCauseToGasanReason("xerp 승인대기로 인한 퇴근미타각(주간)", "xerp 오류")).toBe("xerp 오류로 인한 퇴근미타각(주간)");
    expect(applyCauseToGasanReason("", "교육")).toBe("교육으로 인한 공수미반영(주간)");
  });

  it("cross-checks against XERP rows", () => {
    const events = extractKakaoEvents(parseKakaoChat(CHAT).messages, ROSTER);
    const issues = crossCheckKakaoWithXerp(
      events,
      {
        "2026-10-18": [
          { 성명: "홍길동", xerpIn: "07:00", xerpOut: "17:30" },
          { 성명: "김철수", xerpIn: "", xerpOut: "17:00" },
          { 성명: "강감찬", xerpIn: "07:00", xerpOut: "" },
          { 성명: "을지문덕", xerpIn: "", xerpOut: "", pmisIn: "", pmisOut: "" },
          { 성명: "이순신", xerpIn: "", xerpOut: "", pmisIn: "06:58", pmisOut: "17:10" },
        ],
        "2026-10-19": [{ 성명: "최지훈", xerpIn: "06:55", xerpOut: "17:05" }],
        "2026-10-20": [{ 성명: "정우성", xerpIn: "06:50", xerpOut: "" }],
      },
      new Set(["2026-10-18"]),
    );
    expect(issues.map((i) => `${i.date} ${i.name} ${i.kind}`)).toEqual([
      "2026-10-18 강감찬 no-reason",
      "2026-10-18 이순신 no-reason",
      "2026-10-18 홍길동 conflict",
      "2026-10-19 최지훈 conflict",
      "2026-10-20 정우성 conflict",
    ]);
  });

  it("guesses the room from the chat title", () => {
    expect(guessKakaoRoom("P4 현장 공지방")).toBe("P4");
    expect(guessKakaoRoom("KakaoTalk_P5PH1_공지.txt")).toBe("P5");
    expect(guessKakaoRoom("현장 공지")).toBeNull();
    expect(messageMonths(parseKakaoChat(CHAT).messages)).toEqual(["2026-10"]);
  });

  it("merges by id and summarizes per person", () => {
    const events = extractKakaoEvents(parseKakaoChat(CHAT).messages, ROSTER);
    expect(mergeKakaoEvents(events, events)).toHaveLength(events.length);
    const summary = summarizeEventsByPerson(events);
    expect(summary.find((s) => s.name === "홍길동")?.counts).toEqual({ early: 1 });
  });

  it("대화방 키는 방 이름을 쓰고, 이름이 없으면 파일명에서 꾸밈을 뗀다", () => {
    expect(chatKeyOf("P4 PH4  공지방", "KakaoTalk_Chat_아무개.txt")).toBe("P4 PH4 공지방");
    expect(chatKeyOf("", "KakaoTalk_Chat_P4 PH2 공지방.txt")).toBe("P4 PH2 공지방");
    expect(chatKeyOf("", "KakaoTalkChats (1).txt")).toBe("");
    // 같은 방을 날짜만 바꿔 내려받아도 같은 방으로 본다
    expect(chatKeyOf("", "P4공지방_20261021.txt")).toBe(chatKeyOf("", "P4공지방_20261022.zip"));
    // 서로 다른 P4 방은 다른 키
    expect(chatKeyOf("P4 PH4 공지방")).not.toBe(chatKeyOf("P4 PH2 공지방"));
  });

  it("퇴사 말만 나온 공지는 퇴사로 잡지 않는다", () => {
    const notResign = [
      "금일 퇴사자는 없습니다",
      "퇴사 안 합니다",
      "퇴사자 명단 언제까지 제출하나요?",
      "퇴사 처리 절차 문의드립니다",
      "홍길동 퇴사 예정 아님",
    ];
    for (const text of notResign) expect(isNotPersonnelChange(text, "resign")).toBe(true);

    const realResign = [
      "홍길동 금일자로 퇴사합니다",
      "김철수 10월 31일 퇴사 처리 부탁드립니다",
      "이영희 계약 종료로 금일 퇴사",
    ];
    for (const text of realResign) expect(isNotPersonnelChange(text, "resign")).toBe(false);

    // 퇴사·입사 외의 분류는 이 검사를 적용하지 않는다
    expect(isNotPersonnelChange("조퇴 안 합니다", "early")).toBe(false);
  });

  it("퇴사 말이 섞여도 실제 사유는 그대로 잡는다", () => {
    const chat = `--------------- 2026년 10월 20일 화요일 ---------------
[반장] [오후 1:05] 홍길동 조퇴합니다. 금일 퇴사자는 없습니다
[반장] [오후 1:06] 김철수 금일자로 퇴사합니다`;
    const events = extractKakaoEvents(parseKakaoChat(chat).messages, ROSTER);
    expect(events.find((e) => e.name === "홍길동")?.category).toBe("early");
    expect(events.find((e) => e.name === "김철수")?.category).toBe("resign");
  });
});
