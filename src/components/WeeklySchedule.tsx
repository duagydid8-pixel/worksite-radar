import { useEffect, useMemo, useState } from "react";
import { loadScheduleFS, saveScheduleFS } from "@/lib/firestoreService";
import { toast } from "sonner";
import { CalendarDays, Loader2, Plus, Save, Trash2 } from "lucide-react";

interface ScheduleData {
  weekStart: string;
  zones: string[];
  schedule: Record<string, Record<string, string>>;
  uploadedAt?: string;
}

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const SHIFT_OPTIONS = [
  { key: "조출", label: "조출", time: "05:00~07:00", className: "border-violet-200 bg-violet-50 text-violet-700" },
  { key: "주간", label: "주간", time: "07:00~17:00", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "연장", label: "연장", time: "17:00~19:00", className: "border-blue-200 bg-blue-50 text-blue-700" },
  { key: "야간", label: "야간", time: "19:00~21:00", className: "border-orange-200 bg-orange-50 text-orange-700" },
  { key: "주말중식OT", label: "주말중식OT", time: "07:00~14:00", className: "border-amber-200 bg-amber-50 text-amber-700" },
];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getMonday(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export function getMonthStart(date = new Date()): string {
  return toDateStr(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function getWeekDates(weekStart: string): string[] {
  const start = new Date(`${getMonday(new Date(`${weekStart}T00:00:00`))}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDateStr(d);
  });
}

export function getMonthCalendarDates(monthStart: string): string[] {
  const month = new Date(`${monthStart}T00:00:00`);
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstCell = new Date(firstOfMonth);
  firstCell.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(firstCell);
    d.setDate(firstCell.getDate() + i);
    return toDateStr(d);
  });
}

function getMonthDates(monthStart: string): string[] {
  const month = new Date(`${monthStart}T00:00:00`);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(month);
    d.setDate(i + 1);
    return toDateStr(d);
  });
}

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatMonthLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export function formatDayLabel(date: string): string {
  return DAY_KO[new Date(`${date}T00:00:00`).getDay()];
}

function parseCell(value: string): { selected: Set<string>; memo: string } {
  const selected = new Set<string>();
  for (const option of SHIFT_OPTIONS) {
    if (value.includes(option.key)) selected.add(option.key);
  }
  const memoLine = value.split("\n").find((line) => line.startsWith("메모:"));
  return { selected, memo: memoLine ? memoLine.replace(/^메모:\s*/, "") : "" };
}

function buildCellValue(selected: Set<string>, memo: string): string {
  const parts = SHIFT_OPTIONS
    .filter((option) => selected.has(option.key))
    .map((option) => `${option.key} ${option.time}`);
  const cleanMemo = memo.trim();
  if (cleanMemo) parts.push(`메모: ${cleanMemo}`);
  return parts.join("\n");
}

function getShiftOption(key: string) {
  return SHIFT_OPTIONS.find((option) => option.key === key);
}

export function WeeklySchedule() {
  const [monthStart, setMonthStart] = useState(getMonthStart());
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [zones, setZones] = useState<string[]>(["작업구역 1"]);
  const [schedule, setSchedule] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const monthDates = useMemo(() => getMonthDates(monthStart), [monthStart]);
  const monthValue = monthStart.slice(0, 7);
  const selectedDateLabel = `${formatDateLabel(selectedDate)} ${formatDayLabel(selectedDate)}요일`;
  const boardColumns = useMemo(() => {
    return SHIFT_OPTIONS.map((shift) => {
      const cards = monthDates.flatMap((date) => {
        return zones.flatMap((zone) => {
          const parsed = parseCell(schedule[date]?.[zone] ?? "");
          if (!parsed.selected.has(shift.key)) return [];
          return [{ date, zone, memo: parsed.memo }];
        });
      });
      return { shift, cards };
    });
  }, [monthDates, schedule, zones]);

  useEffect(() => {
    loadScheduleFS().then((data) => {
      if (data?.weekStart && Array.isArray(data.zones)) {
        const nextMonthStart = getMonthStart(new Date(`${data.weekStart}T00:00:00`));
        setMonthStart(nextMonthStart);
        setSelectedDate(nextMonthStart);
        setZones(data.zones.length ? data.zones : ["작업구역 1"]);
        setSchedule(data.schedule ?? {});
      }
    }).finally(() => setLoading(false));
  }, []);

  const updateZoneName = (idx: number, nextName: string) => {
    setZones((prev) => {
      const oldName = prev[idx];
      const next = [...prev];
      next[idx] = nextName;
      setSchedule((current) => {
        const updated: Record<string, Record<string, string>> = {};
        for (const [date, byZone] of Object.entries(current)) {
          updated[date] = { ...byZone };
          if (oldName !== nextName && Object.prototype.hasOwnProperty.call(updated[date], oldName)) {
            updated[date][nextName] = updated[date][oldName];
            delete updated[date][oldName];
          }
        }
        return updated;
      });
      return next;
    });
  };

  const addZone = () => {
    setZones((prev) => [...prev, `작업구역 ${prev.length + 1}`]);
  };

  const deleteZone = (zone: string) => {
    if (zones.length <= 1) {
      toast.error("작업구역은 최소 1개 필요합니다.");
      return;
    }
    setZones((prev) => prev.filter((item) => item !== zone));
    setSchedule((current) => {
      const next: Record<string, Record<string, string>> = {};
      for (const [date, byZone] of Object.entries(current)) {
        next[date] = { ...byZone };
        delete next[date][zone];
      }
      return next;
    });
  };

  const updateCell = (date: string, zone: string, updater: (current: string) => string) => {
    setSchedule((current) => ({
      ...current,
      [date]: {
        ...(current[date] ?? {}),
        [zone]: updater(current[date]?.[zone] ?? ""),
      },
    }));
  };

  const toggleShift = (date: string, zone: string, key: string) => {
    updateCell(date, zone, (current) => {
      const parsed = parseCell(current);
      if (parsed.selected.has(key)) parsed.selected.delete(key);
      else parsed.selected.add(key);
      return buildCellValue(parsed.selected, parsed.memo);
    });
  };

  const updateMemo = (date: string, zone: string, memo: string) => {
    updateCell(date, zone, (current) => {
      const parsed = parseCell(current);
      return buildCellValue(parsed.selected, memo);
    });
  };

  const handleSave = async () => {
    const cleanZones = zones.map((zone) => zone.trim()).filter(Boolean);
    if (cleanZones.length === 0) {
      toast.error("작업구역을 입력해주세요.");
      return;
    }

    const data: ScheduleData = {
      weekStart: monthStart,
      zones: cleanZones,
      schedule,
      uploadedAt: new Date().toISOString(),
    };

    setSaving(true);
    try {
      await saveScheduleFS(data);
      window.dispatchEvent(new CustomEvent("schedule-updated", { detail: data }));
      toast.success("월간 작업 일정이 저장되었습니다.");
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 월간 작업 일정을 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">월간 작업 일정</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">{zones.length}개 구역</span>
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{formatMonthLabel(monthStart)} 작업 계획</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <input
                type="month"
                value={monthValue}
                onChange={(e) => {
                  const nextMonthStart = `${e.target.value}-01`;
                  setMonthStart(nextMonthStart);
                  setSelectedDate(nextMonthStart);
                }}
                className="bg-transparent outline-none"
              />
            </label>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {SHIFT_OPTIONS.map((option) => (
            <span key={option.key} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${option.className}`}>
              {option.label}
              <span className="font-medium opacity-70">{option.time}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-3 shadow-sm">
          <div className="grid min-w-[1120px] grid-cols-5 gap-3">
            {boardColumns.map(({ shift, cards }) => (
              <div key={shift.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{shift.label}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{shift.time}</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">{cards.length}</span>
                </div>

                <div className="max-h-[640px] space-y-2 overflow-y-auto p-2">
                  {cards.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs font-semibold text-slate-300">
                      일정 없음
                    </div>
                  ) : (
                    cards.map((card) => {
                      const dateObj = new Date(`${card.date}T00:00:00`);
                      const isSelected = card.date === selectedDate;
                      return (
                        <button
                          key={`${shift.key}-${card.date}-${card.zone}`}
                          type="button"
                          onClick={() => setSelectedDate(card.date)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className={`text-sm font-extrabold ${isSelected ? "text-white" : "text-slate-900"}`}>
                                {formatDateLabel(card.date)} {formatDayLabel(card.date)}
                              </div>
                              <div className={`mt-1 text-xs font-bold ${isSelected ? "text-white/80" : "text-slate-500"}`}>{card.zone}</div>
                            </div>
                            <span className={`text-[10px] font-bold ${isSelected ? "text-white/60" : "text-slate-400"}`}>{dateObj.getDate()}일</span>
                          </div>
                          {card.memo && (
                            <div className={`mt-2 truncate text-xs font-semibold ${isSelected ? "text-white/70" : "text-slate-400"}`}>{card.memo}</div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-xs font-bold text-muted-foreground">선택 날짜</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">{selectedDateLabel}</div>
          </div>

          <div className="space-y-3">
            {zones.map((zone) => {
              const parsed = parseCell(schedule[selectedDate]?.[zone] ?? "");
              const selectedKeys = SHIFT_OPTIONS.filter((option) => parsed.selected.has(option.key)).map((option) => option.key);
              return (
                <div key={`${selectedDate}-${zone}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 truncate text-sm font-extrabold text-slate-800" title={zone}>{zone}</div>
                  <div className="flex min-h-[28px] flex-wrap gap-1.5">
                    {selectedKeys.length === 0 ? (
                      <span className="text-xs font-semibold text-slate-300">일정 없음</span>
                    ) : (
                      selectedKeys.map((key) => {
                        const option = getShiftOption(key);
                        if (!option) return null;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleShift(selectedDate, zone, key)}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${option.className}`}
                            title="클릭하면 제거됩니다"
                          >
                            {option.label}
                            <span className="opacity-60">×</span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      toggleShift(selectedDate, zone, e.target.value);
                      e.currentTarget.value = "";
                    }}
                    className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none focus:border-slate-300"
                  >
                    <option value="">일정 추가</option>
                    {SHIFT_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label} {option.time}
                      </option>
                    ))}
                  </select>

                  <textarea
                    value={parsed.memo}
                    onChange={(e) => updateMemo(selectedDate, zone, e.target.value)}
                    placeholder="메모"
                    rows={2}
                    className="mt-2 min-h-[44px] w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-300"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-xs font-bold text-muted-foreground">작업구역</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {zones.map((zone, zoneIdx) => (
            <div key={`${zone}-${zoneIdx}`} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
              <input
                value={zone}
                onChange={(e) => updateZoneName(zoneIdx, e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-white px-2.5 py-2 text-sm font-bold text-slate-800 outline-none focus:border-slate-300"
              />
              <button
                onClick={() => deleteZone(zone)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-500 transition-colors hover:bg-rose-50"
                title="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={addZone}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Plus className="h-4 w-4" /> 작업구역 추가
      </button>
    </div>
  );
}
