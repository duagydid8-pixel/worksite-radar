export interface FinalWorkUnitsReviewState {
  flags: string[];
  memo: string;
}

export interface FinalWorkUnitsReviewMemoryRow {
  id: string;
  name: string;
  birthDate: string;
  team: string;
  date: string;
  status: string;
  statusLabel: string;
  gasanReason?: string;
  xerpPmisReason?: string;
  xerpPmisExtraUnits: number;
  evidenceSource: string;
  expectedWorkUnits: number | null;
  reflectedWorkUnits: number | null;
  missingWorkUnits: number;
  message: string;
}

export interface FinalWorkUnitsReviewMemoryEntry {
  id: string;
  site: string;
  month: string;
  savedAt: string;
  rowId: string;
  date: string;
  name: string;
  birthDate: string;
  team: string;
  status: string;
  statusLabel: string;
  workerKey: string;
  reasonKey: string;
  patternKey: string;
  flags: string[];
  memo: string;
  gasanReason: string;
  xerpPmisReason: string;
  xerpPmisExtraUnits: number;
  evidenceSource: string;
  expectedWorkUnits: number | null;
  reflectedWorkUnits: number | null;
  missingWorkUnits: number;
  message: string;
}

export interface FinalWorkUnitsReviewSuggestion {
  entry: FinalWorkUnitsReviewMemoryEntry;
  matchType: "same-worker" | "same-reason" | "similar-pattern";
  score: number;
}

export function normalizeFinalWorkUnitsReviewText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function numberKey(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.round(value * 1000) / 1000);
}

function buildWorkerKey(row: FinalWorkUnitsReviewMemoryRow): string {
  return `${normalizeFinalWorkUnitsReviewText(row.name)}|${normalizeFinalWorkUnitsReviewText(row.birthDate)}`;
}

function buildReasonKey(row: FinalWorkUnitsReviewMemoryRow): string {
  const reason = [row.gasanReason, row.xerpPmisReason]
    .map(normalizeFinalWorkUnitsReviewText)
    .filter(Boolean)
    .join("|");
  if (reason) return reason;
  const extraUnits = numberKey(row.xerpPmisExtraUnits);
  return extraUnits && extraUnits !== "0" ? `extra:${extraUnits}` : "";
}

function buildPatternKey(row: FinalWorkUnitsReviewMemoryRow): string {
  return [
    normalizeFinalWorkUnitsReviewText(row.status),
    buildReasonKey(row),
    `extra:${numberKey(row.xerpPmisExtraUnits)}`,
    `missing:${numberKey(row.missingWorkUnits)}`,
    normalizeFinalWorkUnitsReviewText(row.evidenceSource),
  ].join("|");
}

function cleanFlags(flags: string[] | undefined): string[] {
  return [...new Set((flags ?? []).map((flag) => flag.trim()).filter(Boolean))];
}

export function buildFinalWorkUnitsReviewMemoryEntries({
  site,
  month,
  savedAt,
  rows,
  reviews,
}: {
  site: string;
  month: string;
  savedAt: string;
  rows: FinalWorkUnitsReviewMemoryRow[];
  reviews: Record<string, FinalWorkUnitsReviewState>;
}): FinalWorkUnitsReviewMemoryEntry[] {
  return rows.flatMap((row) => {
    const review = reviews[row.id];
    const flags = cleanFlags(review?.flags);
    const memo = (review?.memo ?? "").trim();
    if (flags.length === 0 && !memo) return [];

    return [{
      id: `${site}:${month}:${row.id}`,
      site,
      month,
      savedAt,
      rowId: row.id,
      date: row.date,
      name: row.name,
      birthDate: row.birthDate,
      team: row.team,
      status: row.status,
      statusLabel: row.statusLabel,
      workerKey: buildWorkerKey(row),
      reasonKey: buildReasonKey(row),
      patternKey: buildPatternKey(row),
      flags,
      memo,
      gasanReason: row.gasanReason?.trim() ?? "",
      xerpPmisReason: row.xerpPmisReason?.trim() ?? "",
      xerpPmisExtraUnits: row.xerpPmisExtraUnits,
      evidenceSource: row.evidenceSource,
      expectedWorkUnits: row.expectedWorkUnits,
      reflectedWorkUnits: row.reflectedWorkUnits,
      missingWorkUnits: row.missingWorkUnits,
      message: row.message,
    }];
  });
}

export function mergeFinalWorkUnitsReviewMemory(
  existing: FinalWorkUnitsReviewMemoryEntry[],
  incoming: FinalWorkUnitsReviewMemoryEntry[],
  limit = 1000,
): FinalWorkUnitsReviewMemoryEntry[] {
  const byId = new Map<string, FinalWorkUnitsReviewMemoryEntry>();
  for (const entry of existing) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, limit);
}

export function findFinalWorkUnitsReviewSuggestion(
  row: FinalWorkUnitsReviewMemoryRow,
  entries: FinalWorkUnitsReviewMemoryEntry[],
): FinalWorkUnitsReviewSuggestion | null {
  const workerKey = buildWorkerKey(row);
  const reasonKey = buildReasonKey(row);
  const patternKey = buildPatternKey(row);
  const statusKey = normalizeFinalWorkUnitsReviewText(row.status);
  const evidenceKey = normalizeFinalWorkUnitsReviewText(row.evidenceSource);
  const extraKey = numberKey(row.xerpPmisExtraUnits);
  const missingKey = numberKey(row.missingWorkUnits);

  const scored = entries.flatMap((entry) => {
    const sameWorker = Boolean(workerKey && entry.workerKey === workerKey);
    const sameReason = Boolean(reasonKey && entry.reasonKey === reasonKey);
    const samePattern = entry.patternKey === patternKey;
    let score = 0;
    if (sameWorker) score += 100;
    if (sameReason) score += 60;
    if (normalizeFinalWorkUnitsReviewText(entry.status) === statusKey) score += 20;
    if (numberKey(entry.xerpPmisExtraUnits) === extraKey) score += 10;
    if (numberKey(entry.missingWorkUnits) === missingKey) score += 5;
    if (normalizeFinalWorkUnitsReviewText(entry.evidenceSource) === evidenceKey) score += 5;
    if (samePattern) score += 10;
    if (score < 75) return [];

    const matchType: FinalWorkUnitsReviewSuggestion["matchType"] = sameWorker
      ? "same-worker"
      : sameReason
        ? "same-reason"
        : "similar-pattern";
    return [{ entry, matchType, score }];
  });

  return scored.sort((left, right) => right.score - left.score || right.entry.savedAt.localeCompare(left.entry.savedAt))[0] ?? null;
}
