export type ElcdCompareStatus = "Y" | "N" | "착오" | "이름불일치" | "XERP출근미타각" | "타현장타각" | "미가입";

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
  /** 태각이 다른(이전) 프로젝트에서 이뤄진 경우 그 현장 라벨 */
  site?: string;
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
  소속현장?: string;
  elcdName?: string;
}

interface BuildElcdCompareRowsOptions {
  xerpRows: XerpCompareRow[];
  elcdRows: ElcdRow[];
  maskBirth: (value: string) => string;
  /** `성명|생년월일6자리` 키 집합. 여기 포함된 사람은 미타각 대신 "미가입"으로 분류 */
  unregisteredKeys?: Set<string>;
}

export function normBirth(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (d.length >= 13) return d.slice(0, 6);
  return d.length >= 8 ? d.slice(2, 8) : d.slice(0, 6);
}

/**
 * 주민번호 성별자리(생년월일 6자리 + 7번째 숫자)까지 확보 가능하면 7자리를 돌려준다.
 * 전체 주민번호(13자리) 또는 앞 7자리 이상이 들어올 때만 7자리, 그 외엔 6자리.
 */
export function normBirth7(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (d.length >= 13) return d.slice(0, 7);
  if (d.length === 7) return d;
  return normBirth(s);
}

/** 미가입 명단 등에서 사람을 식별하는 키 (`성명|생년월일6자리`) */
export function personKey(name: string, birth: string): string {
  return `${(name || "").replace(/\s+/g, "")}|${normBirth(birth || "")}`;
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
  unregisteredKeys,
}: BuildElcdCompareRowsOptions): CompareRow[] {
  const unregistered = unregisteredKeys ?? new Set<string>();
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

  // 주민번호 앞 6자리가 겹치는 XERP 인원 수 (2명 이상이면 6자리만으론 특정 불가)
  const xerpBirth6Counts = new Map<string, number>();
  xerpRows.forEach((row) => {
    const birthKey = normBirth(row.생년월일 || "");
    if (!birthKey) return;
    xerpBirth6Counts.set(birthKey, (xerpBirth6Counts.get(birthKey) ?? 0) + 1);
  });

  const usedBirthKeys = new Set<string>();
  const rows: CompareRow[] = [];

  xerpRows.forEach((xerpRow) => {
    const hit = tappedMap.get(toXerpKey(xerpRow));
    const wrongCompany = hit && !isHanseong(hit.company);
    const otherSite = hit?.site ? hit.site : "";
    const hasCheckIn = hasXerpCheckIn(xerpRow);
    const isUnregistered = unregistered.has(personKey(xerpRow.성명, xerpRow.생년월일));
    const base = {
      팀명: xerpRow.팀명,
      직종: xerpRow.직종,
      성명: xerpRow.성명,
      생년월일: maskBirth(xerpRow.생년월일),
      rawResidentNumber: xerpRow.생년월일,
    };

    // 프로젝트 이관 후 이전 현장 카드리더로 태각한 경우
    if (hit && otherSite) {
      rows.push({
        ...base,
        타각여부: "타현장타각",
        출근: hit.inTime ?? "",
        퇴근: hit.outTime ?? "",
        인증방식: hit.authMethod ?? "",
        소속현장: otherSite,
        소속업체: wrongCompany ? hit.company : undefined,
      });
      return;
    }

    if (!hit) {
      const birthKey = normBirth(xerpRow.생년월일);
      // 이미 다른 XERP 인원에게 배정된 태각 기록은 제외
      const birthMatches = (birthKey ? birthOnlyMap.get(birthKey) : undefined)
        ?.filter((row) => !usedBirthKeys.has(toElcdKey(row)));
      if (birthMatches?.length === 1) {
        const birthHit = birthMatches[0];
        const xerp7 = normBirth7(xerpRow.생년월일);
        const elcd7 = normBirth7(birthHit.birthday || "");
        const genderKnown = xerp7.length === 7 && elcd7.length === 7;
        const birth6Collision = (xerpBirth6Counts.get(birthKey) ?? 0) > 1;
        // 성별자리까지 알면 그걸로 확정, 모르면 6자리가 겹치지 않을 때만 허용
        const safeBirthMatch = genderKnown ? xerp7 === elcd7 : !birth6Collision;
        if (safeBirthMatch) {
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
    }

    if (!hasCheckIn && !hit) return;

    rows.push({
      ...base,
      타각여부: hit
        ? (wrongCompany ? "착오" : hasCheckIn ? "Y" : "XERP출근미타각")
        : isUnregistered ? "미가입" : "N",
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
