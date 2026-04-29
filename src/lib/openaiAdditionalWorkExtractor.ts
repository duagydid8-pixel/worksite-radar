import type { AdditionalWorkEntry } from "./additionalWorkProcessor";

export interface VisionRow {
  name?: unknown;
  trade?: unknown;
  date?: unknown;
  units?: unknown;
}

export interface VisionExtractImage {
  dataUrl: string;
  label?: string;
}

export interface VisionExtractResult {
  rows: AdditionalWorkEntry[];
  rawText: string;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactName(value: unknown): string {
  return cleanText(value).replace(/\s+/g, "");
}

function compactTrade(value: unknown): string {
  return cleanText(value).replace(/\s+/g, "");
}

function normalizeDate(value: unknown): string {
  const text = cleanText(value);
  const match = text.match(/(20\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeUnits(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const text = cleanText(value).replace(",", ".");
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed === 100) return 1;
  if (parsed === 200) return 2;
  return parsed;
}

export function normalizeVisionRows(rows: unknown): AdditionalWorkEntry[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as VisionRow;
    const name = compactName(record.name);
    const trade = compactTrade(record.trade);
    const units = normalizeUnits(record.units);
    const date = normalizeDate(record.date);

    if (!name || !trade || units === null) return [];
    return [{ name, trade, units, sourceLine: date }];
  });
}

export function parseVisionFunctionResult(value: unknown): AdditionalWorkEntry[] {
  if (typeof value === "string") {
    try {
      return parseVisionFunctionResult(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return normalizeVisionRows(record.rows);
}

export function buildAdditionalWorkVisionPrompt(knownNames: string[] = []): string {
  const names = knownNames
    .map((name) => name.replace(/\s+/g, "").trim())
    .filter(Boolean)
    .slice(0, 400);

  return [
    "You are extracting rows from a Korean construction additional work request form.",
    "Return only JSON matching this shape: {\"rows\":[{\"name\":\"\",\"trade\":\"\",\"date\":\"YYYY-MM-DD\",\"units\":1.0}]}",
    "Extract only real worker rows. Ignore headers, totals, signatures, attachment text, and reasons.",
    "Required fields per row are name, trade, date, and units. Use numeric units like 1, 1.5, or 2.",
    "Common trades include 공구장, 유도원, 신호수, 조공, 배관, 용접, PE, 배관-PP, 도비.",
    "If a name is split with spaces, join the syllables. If a row has no readable name, skip it.",
    names.length > 0 ? `Known employee names for correction: ${names.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export async function extractAdditionalWorkWithVision(
  images: VisionExtractImage[],
  knownNames: string[]
): Promise<VisionExtractResult> {
  if (images.length === 0) {
    throw new Error("Vision 추출에 보낼 이미지가 없습니다.");
  }

  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("extract-additional-work", {
    body: {
      images,
      knownNames,
      prompt: buildAdditionalWorkVisionPrompt(knownNames),
    },
  });

  if (error) {
    throw new Error(error.message || "OpenAI Vision 추출 함수 호출에 실패했습니다.");
  }

  const rows = parseVisionFunctionResult(data);
  const rawText = typeof data?.rawText === "string" ? data.rawText : JSON.stringify(data ?? {}, null, 2);
  return { rows, rawText };
}
