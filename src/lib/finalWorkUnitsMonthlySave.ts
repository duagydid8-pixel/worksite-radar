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
