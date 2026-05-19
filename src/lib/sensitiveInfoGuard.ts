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

export function detectSensitiveInfo(text: string): SensitiveInfoFinding[] {
  const source = text || "";
  const findings: SensitiveInfoFinding[] = [];

  const residentMatches = source.match(/\b\d{6}-[1-4]\d{6}\b/g) ?? [];
  if (residentMatches.length > 0) {
    findings.push({
      type: "resident-number",
      label: TYPE_LABELS["resident-number"],
      sample: sample(residentMatches[0]),
    });
  }

  const phoneMatches = source.match(/\b(?:01[016789]|02|0[3-6]\d)-?\d{3,4}-?\d{4}\b/g) ?? [];
  if (phoneMatches.length > 0) {
    findings.push({
      type: "phone-number",
      label: TYPE_LABELS["phone-number"],
      sample: sample(phoneMatches[0]),
    });
  }

  const numberMatches = source.matchAll(/\b\d{2,6}(?:-\d{2,6}){1,4}\b/g);
  for (const match of numberMatches) {
    const value = match[0];
    if (isBusinessRegistrationNumber(value)) continue;
    if (residentMatches.includes(value)) continue;
    if (phoneMatches.includes(value)) continue;
    if (!hasNearbyBankWord(source, match.index ?? 0)) continue;

    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 16) continue;

    findings.push({
      type: "bank-account",
      label: TYPE_LABELS["bank-account"],
      sample: sample(value),
    });
    break;
  }

  return uniqueByType(findings);
}

export function summarizeSensitiveInfoFindings(findings: SensitiveInfoFinding[]): string {
  return uniqueByType(findings).map((finding) => finding.label).join(", ");
}
