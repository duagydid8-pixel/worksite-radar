import { ATTENDANCE_CATEGORIES, PUNCH_PROBLEM_CATEGORY, pickImportant, type KakaoMessage } from "./kakaoChat";

/**
 * 카톡 공지방 메시지에서 뽑아낸 "누가 / 언제 / 무슨 근태 사유" 한 건.
 * 원문 전체가 아니라 이 이벤트만 클라우드에 저장한다.
 */
export interface KakaoEvent {
  id: string;
  date: string; // 대상일 (YYYY-MM-DD) — "내일 조퇴" 같은 표현은 다음날로 잡는다
  msgDate: string;
  time: string;
  sender: string;
  name: string; // 명단과 맞춘 이름, 못 찾으면 ""
  category: string; // punch | resign | early | leave | absent | late | trip | newbie
  cause: string; // 타각 문제 원인: "안전교육" | "교육" | "xerp 오류" | "xerp 승인대기" | ""
  text: string;
  source: "rule" | "ai";
  room?: string; // 어느 현장 그룹인지: "P4" | "P5" (예전 기록엔 없음)
  chat?: string; // 어느 카톡 대화방에서 왔는지 (P4 공지방이 여러 개라 방마다 구분, 예전 기록엔 없음)
  edited?: boolean; // 사람이 직접 이름을 적어 고친 기록 — 같은 파일을 다시 올려도 덮어쓰지 않는다
}

/**
 * 카톡 대화방을 구분하는 키. 대화방 이름이 있으면 그대로, 없으면 파일명에서
 * 내보내기가 붙이는 꾸밈("KakaoTalk_Chat_", "(1)", 끝에 붙은 날짜)을 떼고 쓴다.
 */
export function chatKeyOf(chatTitle?: string, fileName?: string): string {
  const title = (chatTitle ?? "").replace(/\s+/g, " ").trim();
  if (title) return title;
  return (fileName ?? "")
    .replace(/\.(txt|zip)$/i, "")
    .replace(/^KakaoTalk[_ ]?Chats?[_ ]?/i, "")
    .replace(/[_ ]?\(\d+\)$/, "")
    .replace(/[_ ]?\d{4}[-_.]?\d{2}[-_.]?\d{2}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const KAKAO_ROOMS = [
  { key: "P4", label: "P4 공지방", sites: ["PH4", "PH2"] },
  { key: "P5", label: "P5 공지방", sites: ["P5PH1"] },
] as const;
export type KakaoRoomKey = (typeof KAKAO_ROOMS)[number]["key"];

/** 대화방 이름/파일명으로 공지방을 추정한다. 모르면 null. */
export function guessKakaoRoom(name: string): KakaoRoomKey | null {
  const s = name.toUpperCase().replace(/\s+/g, "");
  const p5 = /P-?5|5공장|5PH/.test(s);
  const p4 = /P-?4|4공장|PH4|PH2/.test(s);
  if (p5 && !p4) return "P5";
  if (p4 && !p5) return "P4";
  return null;
}

/** 메시지에 있는 달(YYYY-MM) 목록, 오래된 순. */
export function messageMonths(messages: KakaoMessage[]): string[] {
  return [...new Set(messages.map((m) => m.date.slice(0, 7)).filter(Boolean))].sort();
}

export const EVENT_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  [PUNCH_PROBLEM_CATEGORY, ...ATTENDANCE_CATEGORIES].map((c) => [c.key, c.label]),
);

// 한 메시지가 여러 분류에 걸리면 이 순서로 대표 분류를 정한다
const CATEGORY_PRIORITY = ["punch", "resign", "absent", "leave", "early", "late", "trip", "newbie"];

const pad = (n: number) => String(n).padStart(2, "0");

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 메시지 안의 날짜 표현으로 대상일을 정한다. 없으면 메시지 날짜. */
export function resolveTargetDate(text: string, msgDate: string): string {
  if (/모레/.test(text)) return shiftDate(msgDate, 2);
  if (/내일|익일|명일/.test(text)) return shiftDate(msgDate, 1);
  if (/어제|전일/.test(text)) return shiftDate(msgDate, -1);
  const m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? text.match(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/);
  if (m) {
    const month = +m[1];
    const day = +m[2];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const msgYear = +msgDate.slice(0, 4);
      const msgMonth = +msgDate.slice(5, 7);
      // 12월에 "1월 3일"이라고 하면 다음 해
      const year = msgMonth === 12 && month === 1 ? msgYear + 1 : msgYear;
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  return msgDate;
}

export function detectPunchCause(text: string): string {
  if (/안전\s*교육/.test(text)) return "안전교육";
  if (/교육|TBM/.test(text)) return "교육";
  if (/승인\s*대기|승인\s*안|미승인|신규/.test(text)) return "xerp 승인대기";
  if (/XERP|X-ERP|ERP|시스템|오류|에러|장애|단말기|먹통|인식/i.test(text)) return "xerp 오류";
  return "";
}

// 명단(퇴사일·입사일)을 건드리는 분류는 말만 나와도 잡으면 안 되니,
// 아니라고 하는 말·묻는 말·서류 이야기는 사람 변동으로 보지 않는다.
const NOT_HAPPENING_RE = /(퇴사|퇴직|사직|입사|신규자|신입|투입)\s*(자|예정|처리|일)?\s*(는|은|가|이|도)?\s*(없|무|아님|아닙|아니|안\s*(함|합|해|했)|않)/;
const ASKING_RE = /\?|어떻게|무엇|언제까지|방법|절차|문의|여쭤|되나요|될까요|인가요|있나요|없나요|맞나요|할까요|하나요|가능한가|알려\s*주/;
const PAPERWORK_RE = /(퇴사|입사)\s*(자\s*)?(명단|서류|신고|관련\s*문의|처리\s*(방법|절차))|퇴사율|정산\s*방법/;

/** @멘션으로 여러 명을 부르는 단체 공지인지 (건강검진 대상자 공지 등) — 사람별 근태가 아니다 */
export function isBroadcastNotice(text: string): boolean {
  const mentions = text.match(/@[가-힣A-Za-z]/g)?.length ?? 0;
  return mentions >= 5 || (mentions >= 3 && text.length > 120);
}

/** 명단에 반영하는 분류(퇴사·입사)인데 실제 변동이 아닌 말인지 */
export function isNotPersonnelChange(text: string, category: string): boolean {
  if (category !== "resign" && category !== "newbie") return false;
  return NOT_HAPPENING_RE.test(text) || ASKING_RE.test(text) || PAPERWORK_RE.test(text) || isBroadcastNotice(text);
}

/** 카톡이 자동으로 붙이는 입·퇴장 줄. 이름 추정에서 빼야 본인 공지와 섞이지 않는다. */
const SYSTEM_LINE_RE = /[가-힣A-Za-z0-9._-]{2,14}님(이|을)\s*(나갔습니다|들어왔습니다|초대했습니다|내보냈습니다|입장했습니다|퇴장했습니다)\.?/g;
export function stripSystemLines(text: string): string {
  return text.replace(SYSTEM_LINE_RE, " ").replace(/\s+/g, " ").trim();
}

/** 문장 속에서 명단에 있는 이름을 찾는다(긴 이름 우선, 중복 제거). */
export function findRosterNames(text: string, roster: string[]): string[] {
  const compact = normalizeName(text);
  const found: string[] = [];
  const sorted = [...new Set(roster.map(normalizeName).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  let rest = compact;
  for (const name of sorted) {
    if (rest.includes(name)) {
      found.push(name);
      rest = rest.split(name).join("·");
    }
  }
  return found;
}

const NOT_NAMES = new Set(["내일", "오늘", "금일", "명일", "모레", "어제", "전원", "현장", "공지", "필독", "알림", "안내", "오전", "오후", "금주", "이번", "다음", "전체", "작업", "신규", "교육", "안전", "연차", "반차", "조퇴", "퇴사", "결근", "지각", "출근", "퇴근", "타각", "확인", "부탁", "네", "넵"]);

// "금일부로", "내일자로"처럼 때를 가리키는 말은 이름이 아니다
const WHEN_WORD_RE = /^(금일|오늘|명일|내일|모레|어제|익일|당일|전일|전날|금주|차주|이번|다음|주말|월말|월초)/;
const WHEN_TAIL_RE = /(부로|자로|부터|까지|이후|이전|현재|기준|경에|께)$/;
/** 문장 앞의 "금일부로", "내일 " 같은 때 표현을 떼어 낸다. */
const LEADING_WHEN_RE = /^(금일|오늘|명일|내일|모레|어제|익일|당일|전일|전날|금주|차주)\s*(부로|자로|부터|까지|에|은|는)?[\s,]*/;

/** 명단에서 못 찾았을 때: "홍길동 조퇴합니다", "이영희, 박민수 타각 안됨"처럼 문장 앞에 나온 이름을 추정한다. */
export function guessLeadingNames(text: string): string[] {
  const m = text.trim().replace(LEADING_WHEN_RE, "").match(/^((?:[가-힣]{2,4}\s*(?:님|씨|반장|기사|조장)?\s*[,·/]\s*)*[가-힣]{2,4})(?:\s*(?:님|씨|반장|기사|조장))?(?:은|는|이|가)?\s/);
  if (!m) return [];
  return m[1]
    .split(/[,·/]/)
    .map((n) => n.replace(/(님|씨|반장|기사|조장)$/, "").trim())
    .filter((n) => n.length >= 2 && n.length <= 4 && !NOT_NAMES.has(n) && !WHEN_WORD_RE.test(n) && !WHEN_TAIL_RE.test(n));
}

// "퇴사합니다"처럼 본인이 직접 알리는 말 — 문장에 다른 이름이 없으면 보낸 사람이 당사자다
const SELF_REPORT_RE = /(퇴사|퇴직|사직|조퇴|연차|반차|휴가|결근|지각|외출|입사|출근|복귀)\s*(하겠습니다|하겠음|하려고|합니다|했습니다|하였습니다|할게요|할께요|드립니다|입니다|이요|예정입니다|예정이요)/;
export function isSelfReport(text: string): boolean {
  return SELF_REPORT_RE.test(text);
}

/** 보낸 사람 표시에서 이름만 뽑는다. "구서윤8408-2775" → "구서윤", "홍길동 반장" → "홍길동" */
export function senderPersonName(sender: string, roster: string[] = []): string {
  const compact = normalizeName(sender);
  const hit = [...new Set(roster.map(normalizeName).filter((n) => n.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .find((n) => compact.includes(n));
  if (hit) return hit;
  const lead = compact.match(/^[가-힣]{2,4}/)?.[0] ?? "";
  return lead && !NOT_NAMES.has(lead) && !WHEN_WORD_RE.test(lead) ? lead : "";
}

function eventId(e: Omit<KakaoEvent, "id">): string {
  const raw = `${e.msgDate}|${e.time}|${e.sender}|${e.name}|${e.category}|${e.text.slice(0, 40)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `k${(h >>> 0).toString(36)}`;
}

export function makeEvent(e: Omit<KakaoEvent, "id">): KakaoEvent {
  return { ...e, id: eventId(e) };
}

/** 키워드 규칙으로 근태 이벤트를 추출한다. */
export function extractKakaoEvents(messages: KakaoMessage[], roster: string[]): KakaoEvent[] {
  const enabled = CATEGORY_PRIORITY;
  const events: KakaoEvent[] = [];
  for (const m of pickImportant(messages, { enabled, extraKeywords: [] })) {
    // 퇴사·입사 말이 나왔지만 실제 변동이 아니면 그 분류는 건너뛰고 다음 분류로 본다
    // (예: "조퇴합니다. 퇴사자는 없습니다" → 조퇴로만 잡는다)
    const category = CATEGORY_PRIORITY.filter((k) => m.keys.includes(k)).find((k) => !isNotPersonnelChange(m.text, k));
    if (!category) continue;
    // 카톡 자동 입퇴장 줄("○○님이 나갔습니다")은 빼고 본문으로만 이름을 찾는다
    const body = stripSystemLines(m.text);
    const rosterHits = findRosterNames(body, roster);
    let names = rosterHits.length ? rosterHits : guessLeadingNames(body);
    // 본문에 이름이 없고 "퇴사합니다"처럼 본인이 알리는 말이면 보낸 사람이 당사자
    if (!names.length && isSelfReport(body)) {
      const self = senderPersonName(m.sender, roster);
      if (self) names = [self];
    }
    // 여러 명을 부르는 단체 공지는 사람별 근태가 아니라 공지 — 한 줄로만 남긴다
    if (names.length >= 4 && isBroadcastNotice(m.text)) names = [];
    const date = resolveTargetDate(m.text, m.date);
    const cause = category === "punch" ? detectPunchCause(m.text) : "";
    const base = { date, msgDate: m.date, time: m.time, sender: m.sender, category, cause, text: m.text.slice(0, 300), source: "rule" as const };
    if (names.length === 0) events.push(makeEvent({ ...base, name: "" }));
    else for (const name of names) events.push(makeEvent({ ...base, name }));
  }
  return events;
}

/** 어느 카톡 메시지에서 나온 기록인지 — 같은 메시지를 다시 정리하면 옛 기록을 갈아끼우기 위한 키 */
export function messageKeyOf(e: Pick<KakaoEvent, "msgDate" | "time" | "sender" | "text">): string {
  return `${e.msgDate}|${e.time}|${e.sender}|${e.text.slice(0, 40)}`;
}

/**
 * 저장된 이벤트와 새 이벤트를 합친다.
 * 같은 메시지에서 다시 뽑은 기록은 새 것으로 갈아끼운다(정리 규칙이 좋아지면 옛 결과가 남지 않게).
 * 사람이 직접 이름을 고친 기록(edited)은 그대로 둔다.
 */
export function mergeKakaoEvents(existing: KakaoEvent[], incoming: KakaoEvent[]): KakaoEvent[] {
  const redone = new Set(incoming.map(messageKeyOf));
  const map = new Map(existing.filter((e) => e.edited || !redone.has(messageKeyOf(e))).map((e) => [e.id, e]));
  for (const e of incoming) if (!map.get(e.id)?.edited) map.set(e.id, e);
  return [...map.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ── 가산사유 연결 ─────────────────────────────────────
const CAUSE_PREFIX: Record<string, string> = {
  안전교육: "안전교육으로 인한 ",
  교육: "교육으로 인한 ",
  "xerp 오류": "xerp 오류로 인한 ",
  "xerp 승인대기": "xerp 승인대기로 인한 ",
};

const ANY_PREFIX_RE = /^.*?로 인한\s*/;

/** 공수 반영 행의 가산사유 앞에 카톡 원인을 붙인다. 이미 다른 원인이 붙어 있으면 바꾼다. */
export function applyCauseToGasanReason(reason: string, cause: string): string {
  const prefix = CAUSE_PREFIX[cause];
  if (!prefix) return reason;
  const body = reason.replace(ANY_PREFIX_RE, "").trim() || "공수미반영(주간)";
  return `${prefix}${body}`;
}

export function causePrefix(cause: string): string {
  return CAUSE_PREFIX[cause] ?? "";
}

// ── 실제 기록과 대조 ──────────────────────────────────
export interface XerpRowLite {
  성명: string;
  팀명?: string;
  xerpIn: string;
  xerpOut: string;
  pmisIn?: string;
  pmisOut?: string;
  isNoRecord?: boolean;
  가산사유?: string;
}

export interface CrossCheckIssue {
  date: string;
  name: string;
  kind: "conflict" | "no-reason";
  message: string;
  eventId?: string;
}

const toMin = (t?: string) => {
  const m = (t ?? "").match(/(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
};

/**
 * 카톡에서 말한 내용과 XERP 기록이 어긋나는 경우, 그리고 XERP에는 문제가 있는데
 * 카톡에 아무 사유가 없는 경우를 찾는다. 시각은 XERP를 먼저 보고 없으면 PMIS를 본다.
 * @param chatDates 카톡 대화가 있었던 날짜(이 날짜만 "사유 없음"을 검사한다)
 */
export function crossCheckKakaoWithXerp(
  events: KakaoEvent[],
  xerpByDate: Record<string, XerpRowLite[]>,
  chatDates: Set<string>,
): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = [];
  const findRow = (date: string, name: string) =>
    xerpByDate[date]?.find((r) => normalizeName(r.성명) === normalizeName(name));

  for (const e of events) {
    if (!e.name) continue;
    const row = findRow(e.date, e.name);
    if (!row) continue;
    const inMin = toMin(row.xerpIn) ?? toMin(row.pmisIn);
    const outMin = toMin(row.xerpOut) ?? toMin(row.pmisOut);
    const label = EVENT_CATEGORY_LABELS[e.category] ?? e.category;
    if (e.category === "early" && outMin !== null && outMin >= 17 * 60) {
      issues.push({ date: e.date, name: e.name, kind: "conflict", eventId: e.id, message: `카톡은 조퇴인데 퇴근 기록이 ${row.xerpOut || row.pmisOut}로 정상입니다.` });
    }
    if ((e.category === "absent" || (e.category === "leave" && !/반차/.test(e.text))) && inMin !== null) {
      issues.push({ date: e.date, name: e.name, kind: "conflict", eventId: e.id, message: `카톡은 ${label}인데 출근 기록(${row.xerpIn || row.pmisIn})이 있습니다.` });
    }
  }

  for (const e of events.filter((x) => x.category === "resign" && x.name)) {
    for (const [date, rows] of Object.entries(xerpByDate)) {
      if (date <= e.date) continue;
      const row = rows.find((r) => normalizeName(r.성명) === normalizeName(e.name));
      if (row && (row.xerpIn || row.pmisIn)) {
        issues.push({ date, name: e.name, kind: "conflict", eventId: e.id, message: `${e.date} 퇴사로 공지됐는데 ${date}에 출근 기록이 있습니다.` });
        break;
      }
    }
  }

  const covered = new Set(events.filter((e) => e.name).map((e) => `${e.date}|${normalizeName(e.name)}`));
  for (const [date, rows] of Object.entries(xerpByDate)) {
    if (!chatDates.has(date)) continue;
    for (const r of rows) {
      // XERP·PMIS 둘 다 기록이 전혀 없으면 출근 안 한 사람이라 사유를 따지지 않는다
      if (r.isNoRecord || (!r.xerpIn && !r.xerpOut && !r.pmisIn && !r.pmisOut)) continue;
      const missingIn = !r.xerpIn;
      const missingOut = !r.xerpOut;
      if (!missingIn && !missingOut) continue;
      if (covered.has(`${date}|${normalizeName(r.성명)}`)) continue;
      const what = missingIn && missingOut ? "출퇴근 미타각" : missingIn ? "출근 미타각" : "퇴근 미타각";
      const pmis = [r.pmisIn && `출근 ${r.pmisIn}`, r.pmisOut && `퇴근 ${r.pmisOut}`].filter(Boolean).join(", ");
      issues.push({ date, name: r.성명, kind: "no-reason", message: `XERP ${what}${pmis ? ` (PMIS ${pmis})` : ""}인데 카톡에 사유가 없습니다.` });
    }
  }
  return issues.sort((a, b) => (a.date + a.name).localeCompare(b.date + b.name));
}

// ── 월간 이력 ─────────────────────────────────────────
export function summarizeEventsByPerson(events: KakaoEvent[]) {
  const map = new Map<string, Record<string, number>>();
  for (const e of events) {
    const name = e.name || "(이름 미확인)";
    const row = map.get(name) ?? {};
    row[e.category] = (row[e.category] ?? 0) + 1;
    map.set(name, row);
  }
  return [...map.entries()]
    .map(([name, counts]) => ({ name, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}
