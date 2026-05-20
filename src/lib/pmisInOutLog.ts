export interface LogRow {
  회사: string;
  범주: string;
  이름: string;
  일자: string;
  시간: string;
  구분: "IN" | "OUT" | string;
  출역형태: string;
  직종: string;
}

export interface Outing {
  outTime: string;
  inTime: string | null;
}

export interface PersonDetail {
  이름: string;
  범주: string;
  직종: string;
  firstIn: string | null;
  departureTime: string | null;
  outings: Outing[];
  hasUnreturnedOuting: boolean;
  totalEvents: number;
}

export interface FlaggedPmisOuting {
  이름: string;
  범주: string;
  직종: string;
  outTime: string;
  inTime: string | null;
  reasons: string[];
}

export interface PmisOutingShareRow {
  name: string;
  meta: string;
  outTime: string;
  inTime: string;
  reasonText: string;
}

function timeToMinutes(value: string | null | undefined): number | null {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isTechnicalWorker(detail: PersonDetail): boolean {
  const category = detail.범주.replace(/\s+/g, "");
  const job = detail.직종.replace(/\s+/g, "");
  return category.includes("기술인") && !job.includes("관리자");
}

export function computePersonDetails(logs: LogRow[]): PersonDetail[] {
  const byPerson = new Map<string, LogRow[]>();
  for (const log of logs) {
    if (!byPerson.has(log.이름)) byPerson.set(log.이름, []);
    byPerson.get(log.이름)!.push(log);
  }

  const result: PersonDetail[] = [];
  for (const [name, events] of byPerson) {
    events.sort((a, b) => a.시간.localeCompare(b.시간));
    const firstLog = events[0];
    let firstIn: string | null = null;
    let departureTime: string | null = null;
    const outings: Outing[] = [];
    let currentOutTime: string | null = null;

    for (let idx = 0; idx < events.length; idx++) {
      const e = events[idx];
      const isLastEvent = idx === events.length - 1;

      if (e.구분 === "IN") {
        if (firstIn === null) firstIn = e.시간;
        if (currentOutTime !== null) {
          outings.push({ outTime: currentOutTime, inTime: e.시간 });
          currentOutTime = null;
        }
        departureTime = null;
      } else if (e.구분 === "OUT") {
        if (isLastEvent) {
          departureTime = e.시간;
          currentOutTime = null;
        } else if (currentOutTime === null) {
          currentOutTime = e.시간;
        }
      }
    }

    const hasUnreturnedOuting = currentOutTime !== null;

    result.push({
      이름: name,
      범주: firstLog.범주,
      직종: firstLog.직종,
      firstIn,
      departureTime,
      outings,
      hasUnreturnedOuting,
      totalEvents: events.length,
    });
  }

  return result.sort((a, b) => (a.firstIn ?? "").localeCompare(b.firstIn ?? ""));
}

export function getFlaggedPmisOutings(details: PersonDetail[]): FlaggedPmisOuting[] {
  return details.flatMap((detail) => {
    if (!isTechnicalWorker(detail)) return [];

    return detail.outings.flatMap((outing) => {
      const outMin = timeToMinutes(outing.outTime);
      const inMin = timeToMinutes(outing.inTime);
      const reasons: string[] = [];

      if (outMin !== null && outMin < 11 * 60) reasons.push("11시 이전 출문");
      if (inMin !== null && inMin >= 13 * 60) reasons.push("13시 이후 복귀");
      if (reasons.length === 0) return [];

      return [{
        이름: detail.이름,
        범주: detail.범주,
        직종: detail.직종,
        outTime: outing.outTime,
        inTime: outing.inTime,
        reasons,
      }];
    });
  });
}

export function buildPmisOutingShareRows(rows: FlaggedPmisOuting[]): PmisOutingShareRow[] {
  return rows.map((row) => ({
    name: row.이름,
    meta: [row.범주, row.직종].filter(Boolean).join(" · "),
    outTime: row.outTime,
    inTime: row.inTime ?? "-",
    reasonText: row.reasons.join(" / "),
  }));
}
