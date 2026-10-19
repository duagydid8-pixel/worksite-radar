// F팀 XERP 미타각 현황 — 출근확인서(서지) 작성 대상
// XERP & PMIS에 올라온 날짜별 원본 기록으로 집계한다(공수 반영을 했는지와 상관없이).

export interface PunchRowLite {
  팀명: string;
  성명: string;
  xerp출근: string;
  xerp퇴근: string;
  pmis출근?: string;
  pmis퇴근?: string;
}

export type MissingKind = "출근" | "퇴근" | "출퇴근";

export interface FTeamMissingDate {
  date: string;
  missing: MissingKind;
  /** PMIS에도 출퇴근 기록이 전혀 없음 (출근하지 않았을 수 있음) */
  noPmis: boolean;
}

export interface FTeamMissingPerson {
  name: string;
  team: string;
  missingDates: FTeamMissingDate[];
}

/** 팀명에 "F"가 들어간 팀 (기술인 팀은 제외) */
export function isFTeam(팀명: string): boolean {
  return 팀명.includes("F") && !팀명.includes("기술인");
}

// XERP & PMIS 화면과 같은 기준: 칸에 값이 있으면 기록이 있는 것 (시각이 엑셀 숫자로 들어와도 기록으로 본다)
const hasTime = (v?: unknown) => {
  const text = String(v ?? "").trim();
  return text !== "" && !/^[-—–]+$/.test(text) && text !== "0";
};
const normalizeName = (name: string) => name.replace(/\s+/g, "");

/**
 * month(YYYY-MM)의 1일부터 upTo(YYYY-MM-DD, 포함)까지 F팀에서 XERP 출근 또는 퇴근이 비어 있는 날을 사람별로 모은다.
 */
export function buildFTeamMissingPunchReport(
  dateMap: Record<string, PunchRowLite[]>,
  month: string,
  upTo?: string,
): FTeamMissingPerson[] {
  const byPerson = new Map<string, FTeamMissingPerson>();
  const dates = Object.keys(dateMap)
    .filter((d) => d.startsWith(month) && (!upTo || d <= upTo))
    .sort();
  for (const date of dates) {
    // 같은 사람이 그날 여러 줄로 들어와 있으면 합쳐서 본다 (한 줄에라도 기록이 있으면 있는 것)
    const day = new Map<string, { name: string; team: string; xIn: boolean; xOut: boolean; pmis: boolean }>();
    for (const r of dateMap[date] ?? []) {
      const team = String(r.팀명 ?? "").trim();
      const name = String(r.성명 ?? "").trim();
      if (!name || !isFTeam(team)) continue;
      const key = normalizeName(name);
      const cur = day.get(key) ?? { name, team, xIn: false, xOut: false, pmis: false };
      cur.xIn ||= hasTime(r.xerp출근);
      cur.xOut ||= hasTime(r.xerp퇴근);
      cur.pmis ||= hasTime(r.pmis출근) || hasTime(r.pmis퇴근);
      day.set(key, cur);
    }
    for (const [key, p] of day) {
      if (p.xIn && p.xOut) continue;
      if (!byPerson.has(key)) byPerson.set(key, { name: p.name, team: p.team, missingDates: [] });
      byPerson.get(key)!.missingDates.push({
        date,
        missing: !p.xIn && !p.xOut ? "출퇴근" : !p.xIn ? "출근" : "퇴근",
        noPmis: !p.pmis,
      });
    }
  }
  return [...byPerson.values()].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}
