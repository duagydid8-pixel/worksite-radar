export interface PayrollCellChange {
  day: number;
  before: number;
  after: number;
  reason: string;
}

export function removeTransientNoOpChanges(
  changes: PayrollCellChange[],
  originalValues: number[]
): PayrollCellChange[] {
  const finalValueByDay = new Map<number, number>();
  for (const change of changes) {
    finalValueByDay.set(change.day, change.after);
  }

  return changes.filter((change) => {
    const original = originalValues[change.day - 1] ?? 0;
    const final = finalValueByDay.get(change.day) ?? change.after;
    if (final !== original) return true;

    // Keep explicit no-op records such as manual absences on already blank cells.
    return change.before === change.after;
  });
}
