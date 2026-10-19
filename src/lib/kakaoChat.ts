export interface KakaoMessage {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  sender: string;
  text: string;
  images?: string[];
}

export interface KakaoParseResult {
  chatTitle: string;
  messages: KakaoMessage[];
  systemCount: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

function to24h(ampm: string, h: number, m: number): string {
  let hour = h % 12;
  if (ampm === "오후") hour += 12;
  return `${pad(hour)}:${pad(m)}`;
}

// PC: 2024년 3월 5일 오후 2:30, 홍길동 : 내용   /  모바일: 2024. 3. 5. 오후 2:30, 홍길동 : 내용
const LINE_RE = /^(\d{4})(?:년|\.)\s*(\d{1,2})(?:월|\.)\s*(\d{1,2})(?:일|\.)?\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s([\s\S]*)$/;
const SYSTEM_LINE_RE = /^(\d{4})(?:년|\.)\s*(\d{1,2})(?:월|\.)\s*(\d{1,2})(?:일|\.)?\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+)$/;
// 구버전 모바일: [홍길동] [오후 2:30] 내용
const OLD_LINE_RE = /^\[(.+?)\]\s\[(오전|오후)\s(\d{1,2}):(\d{2})\]\s([\s\S]*)$/;
const DATE_HEADER_RE = /^-{3,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*?-{3,}$/;
const DATE_HEADER_PLAIN_RE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*[월화수수목금토]요일$/;

export function parseKakaoChat(raw: string): KakaoParseResult {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const messages: KakaoMessage[] = [];
  let systemCount = 0;
  let chatTitle = "";
  let currentDate = "";
  let last: KakaoMessage | null = null;

  for (const line of lines) {
    if (!chatTitle) {
      const t = line.match(/^(.+?)\s*님과 카카오톡 대화$/) ?? line.match(/^(.+?)\s*카카오톡 대화$/);
      if (t) { chatTitle = t[1].trim(); continue; }
    }
    if (/^저장한 날짜\s*:/.test(line)) continue;

    const header = line.match(DATE_HEADER_RE) ?? line.match(DATE_HEADER_PLAIN_RE);
    if (header) {
      currentDate = `${header[1]}-${pad(+header[2])}-${pad(+header[3])}`;
      last = null;
      continue;
    }

    const m = line.match(LINE_RE);
    if (m) {
      const date = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
      last = { date, time: to24h(m[4], +m[5], +m[6]), sender: m[7].trim(), text: m[8] };
      currentDate = date;
      messages.push(last);
      continue;
    }

    const old = line.match(OLD_LINE_RE);
    if (old && currentDate) {
      last = { date: currentDate, time: to24h(old[2], +old[3], +old[4]), sender: old[1].trim(), text: old[5] };
      messages.push(last);
      continue;
    }

    if (SYSTEM_LINE_RE.test(line)) {
      systemCount++;
      last = null;
      continue;
    }

    if (last && line !== undefined) {
      last.text += `\n${line}`;
    }
  }

  for (const msg of messages) msg.text = msg.text.replace(/\n+$/, "");
  return { chatTitle, messages, systemCount };
}

export const URL_RE = /https?:\/\/[^\s]+/g;

export function isMediaMessage(text: string): boolean {
  return /^(사진|동영상|이모티콘|파일|음성메시지|삭제된 메시지입니다\.?)(\s*\d*장?)?$/.test(text.trim()) || /^사진 \d+장$/.test(text.trim());
}

export function isFileMessage(text: string): boolean {
  return /^파일\s*:/.test(text.trim());
}

export interface KakaoFilter {
  sender: string; // "" = 전체
  keyword: string;
  from: string;
  to: string;
  onlyLinks: boolean;
  onlyFiles: boolean;
  hideMedia: boolean;
}

export function filterKakaoMessages(messages: KakaoMessage[], f: KakaoFilter): KakaoMessage[] {
  const kw = f.keyword.trim().toLowerCase();
  return messages.filter((m) => {
    if (f.sender && m.sender !== f.sender) return false;
    if (f.from && m.date < f.from) return false;
    if (f.to && m.date > f.to) return false;
    if (kw && !m.text.toLowerCase().includes(kw)) return false;
    if (f.onlyLinks && !(m.text.match(URL_RE)?.length)) return false;
    if (f.onlyFiles && !isFileMessage(m.text)) return false;
    if (f.hideMedia && isMediaMessage(m.text)) return false;
    return true;
  });
}

export function summarizeKakao(messages: KakaoMessage[]) {
  const bySender = new Map<string, number>();
  const byDate = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  let links = 0;
  let files = 0;
  let media = 0;
  for (const m of messages) {
    bySender.set(m.sender, (bySender.get(m.sender) ?? 0) + 1);
    byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1);
    byHour[+m.time.slice(0, 2)]++;
    links += m.text.match(URL_RE)?.length ?? 0;
    if (isFileMessage(m.text)) files++;
    if (isMediaMessage(m.text)) media++;
  }
  return {
    senders: [...bySender.entries()].sort((a, b) => b[1] - a[1]),
    dates: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    byHour,
    links,
    files,
    media,
  };
}

export function formatKakaoText(messages: KakaoMessage[]): string {
  const out: string[] = [];
  let day = "";
  for (const m of messages) {
    if (m.date !== day) {
      day = m.date;
      out.push(`\n■ ${day}`);
    }
    out.push(`[${m.time}] ${m.sender}: ${m.text}`);
  }
  return out.join("\n").trim();
}

// ── 근태 관련 중요 메시지 추리기 ─────────────────────────
export interface AttendanceCategory {
  key: string;
  label: string;
  pattern: RegExp;
}

const PROBLEM_RE = /오류|에러|장애|안\s*됨|안\s*돼|안됩|안되|불가|못\s*(했|함|해|찍|하)|미타각|누락|미처리|지연|실패|꺼져|먹통|확인\s*불가/;
const PUNCH_RE = /타각|태그|XERP|X-ERP|ERP|PMIS|전자카드|출퇴근\s*기록|출근\s*기록|퇴근\s*기록|단말기|카드\s*(인식|찍)/i;

export const ATTENDANCE_CATEGORIES: AttendanceCategory[] = [
  { key: "resign", label: "퇴사", pattern: /퇴사|퇴직|그만\s*(두|둡|뒀)|사직|계약\s*종료|계약\s*만료/ },
  { key: "early", label: "조퇴", pattern: /조퇴|일찍\s*(퇴근|귀가|가)|먼저\s*(퇴근|귀가)|중도\s*퇴근/ },
  { key: "leave", label: "연차·반차·휴가", pattern: /연차|반차|휴가|대휴|경조|병가|공가|휴무/ },
  { key: "absent", label: "결근·불참", pattern: /결근|불참|출근\s*(못|불가|안)|안\s*나(와|옵|왔)|무단/ },
  { key: "late", label: "지각·외출", pattern: /지각|늦게\s*출근|늦(을|어|습)|외출|병원|조기\s*퇴근/ },
  { key: "trip", label: "출장·교육·이관", pattern: /출장|외근|파견|이관|전배|교육|TBM|특별교육|안전교육/ },
  { key: "newbie", label: "입사·신규", pattern: /입사|신규자|신입|투입/ },
];

export const PUNCH_PROBLEM_CATEGORY = { key: "punch", label: "XERP·타각 문제" } as const;

export interface ImportantOptions {
  enabled: string[]; // category keys
  extraKeywords: string[];
}

export interface ImportantMessage extends KakaoMessage {
  tags: string[]; // 표시용 라벨
  keys: string[];
  reason: string; // 한 줄 사유 (예: 교육으로 인한 타각 불가)
}

export function classifyMessage(msg: KakaoMessage, opts: ImportantOptions): ImportantMessage | null {
  const text = msg.text;
  if (isMediaMessage(text)) return null;
  const tags: string[] = [];
  const keys: string[] = [];
  const add = (key: string, label: string) => {
    if (opts.enabled.includes(key) && !keys.includes(key)) { keys.push(key); tags.push(label); }
  };

  const hasPunch = PUNCH_RE.test(text);
  const hasProblem = PROBLEM_RE.test(text);
  const punchProblem = hasPunch && hasProblem;
  if (punchProblem) add(PUNCH_PROBLEM_CATEGORY.key, PUNCH_PROBLEM_CATEGORY.label);
  for (const c of ATTENDANCE_CATEGORIES) if (c.pattern.test(text)) add(c.key, c.label);
  const extra = opts.extraKeywords.filter((k) => k && text.includes(k));
  if (extra.length) { keys.push("extra"); tags.push(`키워드: ${extra.slice(0, 2).join(", ")}`); }

  if (keys.length === 0) return null;

  let reason = "";
  if (punchProblem) {
    if (/교육/.test(text)) reason = "교육으로 인한 타각 문제";
    else if (/XERP|X-ERP|ERP|PMIS|시스템|오류|에러|장애/i.test(text)) reason = "XERP/시스템 오류로 인한 타각 문제";
    else reason = "타각 문제";
  }
  return { ...msg, tags, keys, reason };
}

export function pickImportant(messages: KakaoMessage[], opts: ImportantOptions): ImportantMessage[] {
  return messages.flatMap((m) => {
    const r = classifyMessage(m, opts);
    return r ? [r] : [];
  });
}

export function categoryCounts(messages: KakaoMessage[], opts: ImportantOptions): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of pickImportant(messages, opts)) for (const k of m.keys) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}
