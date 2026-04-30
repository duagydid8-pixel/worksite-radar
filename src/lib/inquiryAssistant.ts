export interface ManualEntry {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
}

export interface ExtractKakaoOptions {
  myNames?: string[];
  limit?: number;
}

const DEFAULT_MY_NAMES = ["나", "본인", "한성", "관리자"];

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseKakaoLine(line: string): { sender: string; message: string } | null {
  const bracketed = line.match(/^\[([^\]]+)]\s+\[[^\]]+]\s+(.+)$/);
  if (bracketed) {
    return { sender: cleanLine(bracketed[1]), message: cleanLine(bracketed[2]) };
  }

  const commaStyle = line.match(/^([^,]+),\s*(?:오전|오후)?\s*\d{1,2}:\d{2},\s*(.+)$/);
  if (commaStyle) {
    return { sender: cleanLine(commaStyle[1]), message: cleanLine(commaStyle[2]) };
  }

  return null;
}

function isSystemLine(line: string): boolean {
  return (
    /^\d{4}년\s+\d{1,2}월\s+\d{1,2}일/.test(line) ||
    /^-+\s*.+\s*-+$/.test(line) ||
    line.includes("님이 들어왔습니다") ||
    line.includes("님이 나갔습니다")
  );
}

export function extractLatestKakaoMessages(text: string, options: ExtractKakaoOptions = {}): string[] {
  const myNames = new Set([...(options.myNames ?? []), ...DEFAULT_MY_NAMES].map((name) => name.trim()).filter(Boolean));
  const limit = options.limit ?? 12;

  const parsed = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isSystemLine(line))
    .map(parseKakaoLine)
    .filter((line): line is { sender: string; message: string } => Boolean(line))
    .filter((line) => !myNames.has(line.sender))
    .filter((line) => line.message.length > 0)
    .map((line) => `${line.sender}: ${line.message}`);

  return parsed.slice(-limit);
}

function normalizeKeywords(keywords: string[]): string[] {
  return [...new Set(
    keywords
      .flatMap((keyword) => keyword.split(","))
      .map((keyword) => cleanLine(keyword))
      .filter(Boolean),
  )];
}

export function normalizeManualEntries(entries: ManualEntry[]): ManualEntry[] {
  return entries.flatMap((entry, index) => {
    const title = cleanLine(entry.title);
    const answer = entry.answer.trim();
    const keywords = normalizeKeywords(entry.keywords);
    if (!title || !answer) return [];
    return [{
      id: entry.id || `manual-${index}`,
      title,
      keywords,
      answer,
    }];
  });
}

export function findManualMatches(text: string, manuals: ManualEntry[]): ManualEntry[] {
  const normalizedText = text.replace(/\s+/g, "").toLowerCase();
  return normalizeManualEntries(manuals).filter((entry) =>
    entry.keywords.some((keyword) => normalizedText.includes(keyword.replace(/\s+/g, "").toLowerCase())),
  );
}

export function buildKakaoReply(inquiryText: string, manuals: ManualEntry[]): string {
  const matches = findManualMatches(inquiryText, manuals);
  const lines = ["문의하신 내용 확인했습니다."];

  if (matches.length === 0) {
    lines.push("정확히 확인한 뒤 바로 안내드리겠습니다.");
    return lines.join("\n");
  }

  for (const match of matches) {
    lines.push(match.answer.trim());
  }

  return lines.join("\n");
}
