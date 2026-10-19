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
  room?: string; // 어느 공지방에서 왔는지: "P4" | "P5" (예전 기록엔 없음)
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

/** 명단에서 못 찾았을 때: "홍길동 조퇴합니다", "이영희, 박민수 타각 안됨"처럼 문장 앞에 나온 이름을 추정한다. */
export function guessLeadingNames(text: string): string[] {
  const m = text.trim().match(/^((?:[가-힣]{2,4}\s*(?:님|씨|반장|기사|조장)?\s*[,·/]\s*)*[가-힣]{2,4})(?:\s*(?:님|씨|반장|기사|조장))?(?:은|는|이|가)?\s/);
  if (!m) return [];
  return m[1]
    .split(/[,·/]/)
    .map((n) => n.replace(/(님|씨|반장|기사|조장)$/, "").trim())
    .filter((n) => n.length >= 2 && n.length <= 4 && !NOT_NAMES.has(n));
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
    const category = CATEGORY_PRIORITY.find((k) => m.keys.includes(k));
    if (!category) continue;
    const rosterHits = findRosterNames(m.text, roster);
    const names = rosterHits.length ? rosterHits : guessLeadingNames(m.text);
    const date = resolveTargetDate(m.text, m.date);
    const cause = category === "punch" ? detectPunchCause(m.text) : "";
    const base = { date, msgDate: m.date, time: m.time, sender: m.sender, category, cause, text: m.text.slice(0, 300), source: "rule" as const };
    if (names.length === 0) events.push(makeEvent({ ...base, name: "" }));
    else for (const name of names) events.push(makeEvent({ ...base, name }));
  }
  return events;
}

/** 저장된 이벤트와 새 이벤트를 id 기준으로 합친다(새 것이 우선). */
export function mergeKakaoEvents(existing: KakaoEvent[], incoming: KakaoEvent[]): KakaoEvent[] {
  const map = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) map.set(e.id, e);
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
