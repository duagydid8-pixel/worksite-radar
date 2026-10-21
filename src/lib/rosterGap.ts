/**
 * XERP 공수 반영에 올라온 사람과 "기술인 및 관리자 명단"을 대조한다.
 *  - 명단에 아예 없는 사람 (= 공수 반영으로 처음 나타난 신규 인원)
 *  - 명단에는 있지만 주민번호·연락처·계좌처럼 XERP로는 조회되지 않는 개인정보가 빈 사람
 * 외주 팀은 기술인·관리자 명단 대상이 아니라 제외한다.
 */

export interface RosterPersonLite {
  이름?: string;
  주민번호?: string;
  연락처?: string;
  은행명?: string;
  계좌번호?: string;
  주소?: string;
  입사일?: string;
  퇴사일?: string;
}

export interface XerpPersonLite {
  성명: string;
  팀명: string;
  isWaeju?: boolean;
}

export const normalizePersonName = (name?: string): string => String(name ?? "").replace(/\s+/g, "").trim();

const digitsOnly = (value?: string) => String(value ?? "").replace(/\D/g, "");

/** 명단에 올릴 대상인가 (이름이 있고 외주가 아닌 행) */
export function isRosterTarget(row: XerpPersonLite): boolean {
  if (!normalizePersonName(row.성명)) return false;
  return !(row.isWaeju ?? String(row.팀명 ?? "").includes("외주"));
}

export interface UnregisteredPerson {
  성명: string;
  팀명: string;
}

/** 공수 반영에는 있는데 명단에 없는 사람 (이름 중복은 한 번만) */
export function findUnregistered(rows: XerpPersonLite[], roster: RosterPersonLite[]): UnregisteredPerson[] {
  const known = new Set(roster.map((r) => normalizePersonName(r.이름)).filter(Boolean));
  const found: UnregisteredPerson[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRosterTarget(row)) continue;
    const name = normalizePersonName(row.성명);
    if (known.has(name) || seen.has(name)) continue;
    seen.add(name);
    found.push({ 성명: row.성명.trim(), 팀명: String(row.팀명 ?? "").trim() });
  }
  return found;
}

/** 본사 제출·보험 신고에 필요한데 XERP 공수 자료에는 없는 개인정보 항목 */
export const PERSONAL_INFO_FIELDS = ["주민번호", "연락처", "은행명", "계좌번호", "주소"] as const;
export type PersonalInfoField = (typeof PERSONAL_INFO_FIELDS)[number];

/** 비어 있는(주민번호는 13자리가 안 되는) 개인정보 항목 */
export function missingPersonalInfo(person: RosterPersonLite): PersonalInfoField[] {
  const missing: PersonalInfoField[] = [];
  if (digitsOnly(person.주민번호).length < 13) missing.push("주민번호");
  if (digitsOnly(person.연락처).length < 9) missing.push("연락처");
  if (!String(person.은행명 ?? "").trim()) missing.push("은행명");
  if (digitsOnly(person.계좌번호).length < 8) missing.push("계좌번호");
  if (!String(person.주소 ?? "").trim()) missing.push("주소");
  return missing;
}

export interface IncompletePerson {
  이름: string;
  팀명: string;
  missing: PersonalInfoField[];
}

/** 이름이 같은 줄이 여러 개면 재직 중인 줄을 본다 */
function rosterByName(roster: RosterPersonLite[]): Map<string, RosterPersonLite> {
  const map = new Map<string, RosterPersonLite>();
  for (const person of roster) {
    const name = normalizePersonName(person.이름);
    if (!name) continue;
    const prev = map.get(name);
    if (!prev || (prev.퇴사일 && !person.퇴사일)) map.set(name, person);
  }
  return map;
}

/** 이번 공수 반영에 나온 사람 중 개인정보가 빈 사람 (퇴사자 제외) */
export function findIncompletePersonalInfo(rows: XerpPersonLite[], roster: RosterPersonLite[]): IncompletePerson[] {
  const byName = rosterByName(roster);
  const found: IncompletePerson[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRosterTarget(row)) continue;
    const name = normalizePersonName(row.성명);
    if (seen.has(name)) continue;
    const person = byName.get(name);
    if (!person || person.퇴사일) continue;
    const missing = missingPersonalInfo(person);
    if (!missing.length) continue;
    seen.add(name);
    found.push({ 이름: row.성명.trim(), 팀명: String(row.팀명 ?? "").trim(), missing });
  }
  return found;
}

/** "1996-12-01" / "19961201" / "961201" → "961201" (주민번호 앞자리) */
export function birthToJuminFront(value?: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 8) return digits.slice(2);
  if (digits.length === 6) return digits;
  return "";
}

/** 명단(기술인 및 관리자) 한 줄의 열 — NewEmployeeList와 같은 구조 */
export const ROSTER_FIELDS = [
  "현장구분", "이름", "주민번호", "연락처", "남여", "입사일", "퇴사일",
  "이관처", "신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소", "메모",
] as const;

export interface BuildRosterRowInput {
  성명: string;
  팀명?: string;
  입사일: string;
  생년월일?: string;
  단가?: string;
  메모?: string;
}

/** 공수 반영에서 찾은 신규 인원을 명단 한 줄로 만든다 (개인정보는 비워 두고 뒤에서 채운다) */
export function buildRosterRow(input: BuildRosterRowInput): Record<string, string> {
  const row = Object.fromEntries(ROSTER_FIELDS.map((f) => [f, ""])) as Record<string, string>;
  row.id = crypto.randomUUID();
  row.이름 = input.성명.trim();
  row.현장구분 = String(input.팀명 ?? "").trim();
  row.입사일 = input.입사일;
  const front = birthToJuminFront(input.생년월일);
  if (front) row.주민번호 = `${front}-`;
  if (input.단가) row.단가 = String(input.단가).trim();
  row.메모 = input.메모 ?? "";
  return row;
}
