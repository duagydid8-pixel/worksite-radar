export type ElcdCompareStatus = "Y" | "N" | "착오" | "이름불일치" | "XERP출근미타각";

export interface XerpCompareRow {
  id?: string;
  팀명: string;
  직종: string;
  사번?: string;
  성명: string;
  생년월일: string;
  xerp출근?: string;
  xerp퇴근?: string;
  pmis출근?: string;
  pmis퇴근?: string;
  [key: string]: string | undefined;
}

export interface ElcdRow {
  name: string;
  birthday: string;
  company?: string;
  inTime?: string;
  outTime?: string;
  authMethod?: string;
}

export interface CompareRow {
  팀명: string;
  직종: string;
  성명: string;
  생년월일: string;
  rawResidentNumber?: string;
  타각여부: ElcdCompareStatus;
  출근: string;
  퇴근: string;
  인증방식: string;
  소속업체?: string;
  elcdName?: string;
}

interface BuildElcdCompareRowsOptions {
  xerpRows: XerpCompareRow[];
  elcdRows: ElcdRow[];
  maskBirth: (value: string) => string;
}

export function normBirth(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (d.length >= 13) return d.slice(0, 6);
  return d.length >= 8 ? d.slice(2, 8) : d.slice(0, 6);
}

function hasXerpCheckIn(row: XerpCompareRow): boolean {
  return String(row.xerp출근 ?? "").trim() !== "";
}

function isHanseong(company?: string): boolean {
  return !company || company.includes("한성크린텍") || company.includes("한성");
}

function toElcdKey(row: ElcdRow): string {
  return `${row.name || ""}|${normBirth(row.birthday || "")}`;
}

function toXerpKey(row: XerpCompareRow): string {
  return `${row.성명 || ""}|${normBirth(row.생년월일 || "")}`;
}

export function buildElcdCompareRows({
  xerpRows,
  elcdRows,
  maskBirth,
}: BuildElcdCompareRowsOptions): CompareRow[] {
  const tappedMap = new Map<string, ElcdRow>();
  elcdRows.forEach((row) => {
    const key = toElcdKey(row);
    const existing = tappedMap.get(key);
    if (existing) {
      tappedMap.set(key, {
        ...existing,
        company: existing.company || row.company,
        inTime: existing.inTime || row.inTime,
        outTime: existing.outTime || row.outTime,
        authMethod: existing.authMethod || row.authMethod,
      });
    } else {
      tappedMap.set(key, row);
    }
  });

  const xerpKeys = new Set(xerpRows.map(toXerpKey));

  const nameMatchedElcdKeys = new Set<string>();
  xerpRows.forEach((row) => {
    const hit = tappedMap.get(toXerpKey(row));
    if (hit) nameMatchedElcdKeys.add(toElcdKey(hit));
  });

  const birthOnlyMap = new Map<string, ElcdRow[]>();
  elcdRows.forEach((row) => {
    if (nameMatchedElcdKeys.has(toElcdKey(row))) return;
    const birthKey = normBirth(row.birthday || "");
    if (!birthKey) return;
    const rows = birthOnlyMap.get(birthKey) ?? [];
    rows.push(row);
    birthOnlyMap.set(birthKey, rows);
  });

  const usedBirthKeys = new Set<string>();
  const rows: CompareRow[] = [];

  xerpRows.forEach((xerpRow) => {
    const hit = tappedMap.get(toXerpKey(xerpRow));
    const wrongCompany = hit && !isHanseong(hit.company);
    const hasCheckIn = hasXerpCheckIn(xerpRow);
    const base = {
      팀명: xerpRow.팀명,
      직종: xerpRow.직종,
      성명: xerpRow.성명,
      생년월일: maskBirth(xerpRow.생년월일),
      rawResidentNumber: xerpRow.생년월일,
    };

    if (!hit) {
      const birthKey = normBirth(xerpRow.생년월일);
      const birthMatches = birthKey ? birthOnlyMap.get(birthKey) : undefined;
      if (birthMatches?.length === 1) {
        const birthHit = birthMatches[0];
        usedBirthKeys.add(toElcdKey(birthHit));
        rows.push({
          ...base,
          타각여부: hasCheckIn ? "이름불일치" : "XERP출근미타각",
          출근: birthHit.inTime ?? "",
          퇴근: birthHit.outTime ?? "",
          인증방식: birthHit.authMethod ?? "",
          elcdName: birthHit.name,
        });
        return;
      }
    }

    if (!hasCheckIn && !hit) return;

    rows.push({
      ...base,
      타각여부: hit ? (wrongCompany ? "착오" : hasCheckIn ? "Y" : "XERP출근미타각") : "N",
      출근: hit?.inTime ?? "",
      퇴근: hit?.outTime ?? "",
      인증방식: hit?.authMethod ?? "",
      소속업체: wrongCompany ? hit!.company : undefined,
    });
  });

  const extraTappers: CompareRow[] = elcdRows
    .filter((row) => {
      const key = toElcdKey(row);
      return row.name && !xerpKeys.has(key) && !usedBirthKeys.has(key);
    })
    .map((row) => ({
      팀명: "미등록",
      직종: "—",
      성명: row.name,
      생년월일: maskBirth(row.birthday || ""),
      rawResidentNumber: row.birthday || "",
      타각여부: "Y",
      출근: row.inTime ?? "",
      퇴근: row.outTime ?? "",
      인증방식: row.authMethod ?? "",
    }));

  return [...rows, ...extraTappers];
}
