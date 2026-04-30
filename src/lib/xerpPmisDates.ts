function isValidIsoDate(year: string, month: string, day: string): boolean {
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(year) &&
    date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day)
  );
}

function toIsoDate(year: string, month: string, day: string): string | null {
  if (!isValidIsoDate(year, month, day)) return null;
  return `${year}-${month}-${day}`;
}

export function extractXerpPmisDateFromFilename(filename: string): string | null {
  const name = filename.replace(/\.[^.]+$/, "");

  const separatedYear = name.match(/(?<!\d)(\d{4})[-./](\d{2})[-./](\d{2})(?!\d)/);
  if (separatedYear) {
    const [, year, month, day] = separatedYear;
    return toIsoDate(year, month, day);
  }

  const compactYear = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (compactYear) {
    const [, year, month, day] = compactYear;
    return toIsoDate(year, month, day);
  }

  const separatedShortYear = name.match(/(?<!\d)(\d{2})[-./](\d{2})[-./](\d{2})(?!\d)/);
  if (separatedShortYear) {
    const [, shortYear, month, day] = separatedShortYear;
    return toIsoDate(`20${shortYear}`, month, day);
  }

  return null;
}

export function upsertXerpPmisDateList(dates: string[], date: string): string[] {
  return [...new Set([...dates, date])].sort().reverse();
}
