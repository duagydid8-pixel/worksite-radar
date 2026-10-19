// XERP 공수 반영에서 저장한 날짜를 XERP & PMIS 화면 데이터로 바꾼다.
// 두 화면은 같은 XERP 일일출역집계 엑셀(0~22열 + Z열 가산사유)을 쓰므로,
// 원본 열은 그대로 옮기고 가산B·공수합계(A+B)·가산사유만 공수 반영 결과로 덮어쓴다.

const COLS = [
  "팀명", "직종", "사번", "성명", "생년월일",
  "xerp출근", "xerp퇴근", "pmis출근", "pmis퇴근",
  "조출", "오전", "오후", "연장", "야간", "철야", "점심", "공수합계A",
  "초과당일", "초과합계", "가산신청", "가산승인",
  "공수합계AB", "월누계",
] as const;

export type XerpPmisRowData = Record<(typeof COLS)[number] | "가산사유" | "id", string>;

export interface ReflectionAdjustment {
  rowIndex: number;
  xerpGongsuA: string;
  diff: number | null;
  reason: string;
}

const round2 = (n: number) => String(Math.round(n * 100) / 100);

export function buildXerpPmisRowsFromReflection(
  rawExcelRows: { rowIndex: number; cols: string[] }[],
  adjustments: ReflectionAdjustment[],
  makeId: () => string = () => crypto.randomUUID(),
): XerpPmisRowData[] {
  const byRow = new Map(adjustments.map((a) => [a.rowIndex, a]));
  return rawExcelRows.map((raw) => {
    const row = Object.fromEntries(COLS.map((c, i) => [c, (raw.cols[i] ?? "").trim()])) as XerpPmisRowData;
    row.id = makeId();
    row.가산사유 = (raw.cols[25] ?? "").trim();
    const adj = byRow.get(raw.rowIndex);
    if (adj) {
      if (adj.reason) row.가산사유 = adj.reason;
      if (adj.diff !== null) {
        row.가산신청 = round2(adj.diff);
        row.공수합계AB = round2((parseFloat(adj.xerpGongsuA) || 0) + adj.diff);
      }
    }
    return row;
  });
}
