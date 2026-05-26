import type { FinalWorkUnitsAnalysis, FinalWorkUnitsRow, FinalWorkUnitsStatus } from "./finalWorkUnitsCheck";

export interface FinalWorkUnitsMonthSnapshot<TRow = unknown> {
  site: string;
  month: string;
  startDate: string;
  endDate: string;
  fileName: string;
  summary: Record<string, number>;
  rows: TRow[];
  reviews: Record<string, { flags: string[]; memo: string }>;
  rowCount: number;
  reviewCount: number;
}

export function finalWorkUnitsMonthKey(startDate: string, endDate: string): string | null {
  const startMonth = startDate.match(/^(\d{4}-\d{2})-\d{2}$/)?.[1] ?? "";
  const endMonth = endDate.match(/^(\d{4}-\d{2})-\d{2}$/)?.[1] ?? "";
  if (!startMonth || !endMonth || startMonth !== endMonth) return null;
  return startMonth;
}

export function chunkFinalWorkUnitsRows<T>(rows: T[], chunkSize = 250): T[][] {
  if (chunkSize <= 0) return [rows];
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

export function buildFinalWorkUnitsMonthSnapshot<TRow>({
  site,
  month,
  startDate,
  endDate,
  fileName,
  summary,
  rows,
  reviews,
}: Omit<FinalWorkUnitsMonthSnapshot<TRow>, "rowCount" | "reviewCount">): FinalWorkUnitsMonthSnapshot<TRow> {
  return {
    site,
    month,
    startDate,
    endDate,
    fileName,
    summary,
    rows,
    reviews,
    rowCount: rows.length,
    reviewCount: Object.keys(reviews).length,
  };
}

const FINAL_WORK_UNITS_STATUS_PRIORITY: Record<FinalWorkUnitsStatus, number> = {
  "missing-work-units": 0,
  "gasan-review": 1,
  "overtime-review": 2,
  "pmis-review": 3,
  "electronic-card-reference": 4,
  "pmis-not-uploaded": 5,
  "electronic-card-not-saved": 6,
  normal: 7,
};

function isFinalWorkUnitsStatus(value: unknown): value is FinalWorkUnitsStatus {
  return typeof value === "string" && value in FINAL_WORK_UNITS_STATUS_PRIORITY;
}

function isSavedFinalWorkUnitsRow(value: unknown): value is FinalWorkUnitsRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<FinalWorkUnitsRow>;
  return typeof row.id === "string" && typeof row.date === "string" && typeof row.name === "string" && isFinalWorkUnitsStatus(row.status);
}

function summarizeFinalWorkUnitsRows(rows: FinalWorkUnitsRow[]): FinalWorkUnitsAnalysis["summary"] {
  const gasanRows = rows.filter((row) => Boolean(row.gasanReason?.trim() || row.xerpPmisReason?.trim() || row.xerpPmisExtraUnits > 0));
  return {
    total: rows.length,
    needsReview: rows.filter((row) => row.status !== "normal" && row.status !== "pmis-not-uploaded").length,
    evidenceMissing: rows.filter((row) => row.status === "pmis-review" || row.status === "pmis-not-uploaded").length,
    "missing-work-units": rows.filter((row) => row.status === "missing-work-units").length,
    "overtime-review": rows.filter((row) => row.status === "overtime-review").length,
    "gasan-review": gasanRows.length,
    "pmis-review": rows.filter((row) => row.status === "pmis-review").length,
    "pmis-not-uploaded": rows.filter((row) => row.status === "pmis-not-uploaded").length,
    "electronic-card-reference": rows.filter((row) => row.status === "electronic-card-reference").length,
    "electronic-card-not-saved": rows.filter((row) => row.status === "electronic-card-not-saved").length,
    normal: rows.filter((row) => row.status === "normal").length,
  };
}

export function buildFinalWorkUnitsAnalysisFromSnapshot(
  snapshot: FinalWorkUnitsMonthSnapshot,
  startDate = snapshot.startDate,
  endDate = snapshot.endDate,
): FinalWorkUnitsAnalysis {
  const rows = snapshot.rows
    .filter(isSavedFinalWorkUnitsRow)
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .sort((a, b) => FINAL_WORK_UNITS_STATUS_PRIORITY[a.status] - FINAL_WORK_UNITS_STATUS_PRIORITY[b.status] || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return {
    rows,
    summary: summarizeFinalWorkUnitsRows(rows),
  };
}
