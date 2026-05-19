function normalizeResidentNumber(value: string): string {
  const trimmed = (value || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 13) return trimmed;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export function canCopyResidentNumber(value: string, isAdmin: boolean): boolean {
  if (!isAdmin) return false;
  return /^\d{6}-[1-4]\d{6}$/.test(normalizeResidentNumber(value));
}

export function displayResidentNumber(value: string, isAdmin: boolean): string {
  const normalized = normalizeResidentNumber(value);
  if (isAdmin) return normalized;
  if (/^\d{6}-[1-4]\d{6}$/.test(normalized)) return `${normalized.slice(0, 7)}******`;
  if (normalized.length >= 7) return `${normalized.slice(0, 6)}-******`;
  return normalized;
}
