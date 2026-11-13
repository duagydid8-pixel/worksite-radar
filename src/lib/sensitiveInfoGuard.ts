export type SensitiveInfoType = "resident-number" | "phone-number" | "bank-account";

export interface SensitiveInfoFinding {
  type: SensitiveInfoType;
  label: string;
  sample: string;
}

const TYPE_LABELS: Record<SensitiveInfoType, string> = {
  "resident-number": "주민번호",
  "phone-number": "전화번호",
  "bank-account": "계좌번호",
};

const BANK_WORDS = [
  "은행",
  "계좌",
  "예금주",
  "입금",
  "출금",
  "농협",
  "국민",
  "신한",
  "우리",
  "하나",
  "기업",
  "카카오",
  "토스",
  "새마을",
  "우체국",
  "수협",
  "대구",
  "부산",
  "광주",
  "전북",
  "경남",
];

function uniqueByType(findings: SensitiveInfoFinding[]): SensitiveInfoFinding[] {
  const seen = new Set<SensitiveInfoType>();
  return findings.filter((finding) => {
    if (seen.has(finding.type)) return false;
    seen.add(finding.type);
    return true;
  });
}

function isBusinessRegistrationNumber(value: string): boolean {
  return /^\d{3}-\d{2}-\d{5}$/.test(value);
}

function hasNearbyBankWord(text: string, index: number): boolean {
  const nearby = text.slice(Math.max(0, index - 24), index + 48);
  return BANK_WORDS.some((word) => nearby.includes(word));
}

function sample(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 8)}...`;
}

const RESIDENT_RE = /\b\d{6}-[1-4]\d{6}\b/g;
const PHONE_RE = /\b(?:01[016789]|02|0[3-6]\d)-?\d{3,4}-?\d{4}\b/g;
const GROUPED_DIGITS_RE = /\b\d{2,6}(?:-\d{2,6}){1,4}\b/g;

interface SensitiveSpan {
  start: number;
  end: number;
  type: SensitiveInfoType;
  value: string;
}

/**
 * 민감정보로 보이는 구간을 위치째로 찾는다.
 * 주민번호 → 전화번호 → 계좌번호 순으로 잡고, 앞에서 이미 잡은 구간과 겹치면 건너뛴다.
 */
function collectSensitiveSpans(source: string): SensitiveSpan[] {
  const spans: SensitiveSpan[] = [];
  const overlaps = (start: number, end: number) =>
    spans.some((span) => start < span.end && end > span.start);

  const push = (type: SensitiveInfoType, value: string, start: number) => {
    const end = start + value.length;
    if (overlaps(start, end)) return;
    spans.push({ start, end, type, value });
  };

  for (const match of source.matchAll(RESIDENT_RE)) {
    push("resident-number", match[0], match.index ?? 0);
  }
  for (const match of source.matchAll(PHONE_RE)) {
    push("phone-number", match[0], match.index ?? 0);
  }
  for (const match of source.matchAll(GROUPED_DIGITS_RE)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (isBusinessRegistrationNumber(value)) continue;
    if (!hasNearbyBankWord(source, start)) continue;

    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 16) continue;

    push("bank-account", value, start);
  }

  return spans.sort((a, b) => a.start - b.start);
}

export function detectSensitiveInfo(text: string): SensitiveInfoFinding[] {
  const source = text || "";
  return uniqueByType(
    collectSensitiveSpans(source).map((span) => ({
      type: span.type,
      label: TYPE_LABELS[span.type],
      sample: sample(span.value),
    })),
  );
}

/** 외부로 보내기 전에 민감정보 자리를 가릴 때 쓰는 대체 문구 */
export const SENSITIVE_PLACEHOLDERS: Record<SensitiveInfoType, string> = {
  "resident-number": "[주민번호]",
  "phone-number": "[전화번호]",
  "bank-account": "[계좌번호]",
};

export interface SensitiveInfoRedaction {
  /** 민감정보를 대체 문구로 바꾼 본문 */
  text: string;
  /** 가린 항목 종류 (종류별 1건) */
  findings: SensitiveInfoFinding[];
  /** 실제로 가린 개수 */
  redactedCount: number;
}

/**
 * 본문에서 주민번호·전화번호·계좌번호를 대체 문구로 바꾼다.
 * 외부 서비스(AI 등)로 원문을 보내기 전에 거는 용도. 날짜·이름·근태 문구는 그대로 남아
 * 분석 정확도에는 영향이 없다.
 */
export function redactSensitiveInfo(text: string): SensitiveInfoRedaction {
  const source = text || "";
  const spans = collectSensitiveSpans(source);
  if (spans.length === 0) return { text: source, findings: [], redactedCount: 0 };

  let redacted = "";
  let cursor = 0;
  for (const span of spans) {
    redacted += source.slice(cursor, span.start) + SENSITIVE_PLACEHOLDERS[span.type];
    cursor = span.end;
  }
  redacted += source.slice(cursor);

  return {
    text: redacted,
    findings: uniqueByType(
      spans.map((span) => ({ type: span.type, label: TYPE_LABELS[span.type], sample: sample(span.value) })),
    ),
    redactedCount: spans.length,
  };
}

export function summarizeSensitiveInfoFindings(findings: SensitiveInfoFinding[]): string {
  return uniqueByType(findings).map((finding) => finding.label).join(", ");
}
