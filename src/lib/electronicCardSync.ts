export interface ElectronicCardPerson {
  name: string;
  birthDate: string;
  inTime: string;
  outTime: string;
  authMethod: string;
  company: string;
}

export interface ElectronicCardDateData {
  dateLabel: string;
  persons: ElectronicCardPerson[];
}

export interface ElectronicCardNormalizedRow extends ElectronicCardPerson {
  date: string;
}

export interface CurrentMonthRange {
  startDate: string;
  endDate: string;
  startYmd: string;
  endYmd: string;
}

type ApiRow = Record<string, unknown>;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function compactDate(value: string): string {
  return value.replace(/-/g, "");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(row: ApiRow, keys: string[]): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

function normalizeDate(value: string): string {
  const raw = text(value);
  const compact = raw.replace(/\D/g, "");
  if (compact.length >= 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return "";
}

function normalizeTime(value: string): string {
  const match = text(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${pad2(Number(match[1]))}:${match[2]}`;
}

function normalizeBirth(value: string): string {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length >= 13) return digits.slice(0, 6);
  if (digits.length >= 8) return digits.slice(2, 8);
  return digits.slice(0, 6);
}

function rowDate(row: ApiRow): string {
  return normalizeDate(firstText(row, ["tagYmd", "lbrYmd", "wkYmd", "workYmd", "useYmd"]))
    || normalizeDate(firstText(row, ["gtwkDt", "workStrTm", "inTm", "strTm"]))
    || normalizeDate(firstText(row, ["lvwkDt", "workEndTm", "outTm", "endTm"]));
}

export function buildCurrentMonthRange(today = new Date()): CurrentMonthRange {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const startDate = formatDate(year, month, 1);
  const endDate = formatDate(year, month, day);
  return {
    startDate,
    endDate,
    startYmd: compactDate(startDate),
    endYmd: compactDate(endDate),
  };
}

export function normalizeElectronicCardApiRows(rows: unknown[]): ElectronicCardNormalizedRow[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as ApiRow;
    const name = firstText(row, ["custNm", "wkrNm", "nm", "workerNm", "name"]);
    const date = rowDate(row);
    if (!name || !date) return [];

    return [{
      name,
      birthDate: normalizeBirth(firstText(row, ["birthday", "brdt", "birthYmd", "rrno", "rrn"])),
      company: firstText(row, ["conm", "company", "osrccNm", "entrpsNm"]),
      date,
      inTime: normalizeTime(firstText(row, ["gtwkDt", "workStrTm", "inTm", "strTm", "inTime"])),
      outTime: normalizeTime(firstText(row, ["lvwkDt", "workEndTm", "outTm", "endTm", "outTime"])),
      authMethod: firstText(row, ["tagNm", "authMtdNm", "tagMtdNm", "tagMtdCd", "tagSeNm", "inOutNm"]),
    }];
  });
}

export function groupElectronicCardRowsByDate(rows: ElectronicCardNormalizedRow[]): Record<string, ElectronicCardDateData> {
  const byDate = new Map<string, Map<string, ElectronicCardPerson>>();

  for (const row of rows) {
    if (!row.date || !row.name) continue;
    const people = byDate.get(row.date) ?? new Map<string, ElectronicCardPerson>();
    const key = `${row.name.replace(/\s+/g, "")}|${normalizeBirth(row.birthDate)}`;
    const current = people.get(key);
    const next: ElectronicCardPerson = {
      name: current?.name || row.name,
      birthDate: current?.birthDate || normalizeBirth(row.birthDate),
      inTime: current?.inTime || row.inTime || "",
      outTime: current?.outTime || row.outTime || "",
      authMethod: current?.authMethod || row.authMethod || "",
      company: current?.company || row.company || "",
    };
    people.set(key, next);
    byDate.set(row.date, people);
  }

  return Object.fromEntries(
    [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateLabel, people]) => [
        dateLabel,
        {
          dateLabel,
          persons: [...people.values()].sort((a, b) =>
            (a.inTime || "99:99").localeCompare(b.inTime || "99:99") || a.name.localeCompare(b.name)
          ),
        },
      ])
  );
}

export function coerceElectronicCardData(value: unknown): ElectronicCardDateData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { dateLabel?: unknown; persons?: unknown };
  const dateLabel = text(raw.dateLabel);
  if (!dateLabel || !Array.isArray(raw.persons)) return null;

  const persons = raw.persons.flatMap((person) => {
    if (!person || typeof person !== "object") return [];
    const row = person as Record<string, unknown>;
    const name = text(row.name);
    if (!name) return [];
    return [{
      name,
      birthDate: normalizeBirth(text(row.birthDate ?? row.birthday)),
      inTime: normalizeTime(text(row.inTime)),
      outTime: normalizeTime(text(row.outTime)),
      authMethod: text(row.authMethod),
      company: text(row.company),
    }];
  });

  return { dateLabel, persons };
}
