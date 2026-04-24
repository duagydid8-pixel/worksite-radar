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

const DAY_KO = ["월", "화", "수", "목", "금", "토", "일"];
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

function getMonday(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

function getWeekDates(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDateStr(d);
  });
}

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
  const [weekStart, setWeekStart] = useState(getMonday());
  const [zones, setZones] = useState<string[]>(["작업구역 1"]);
  const [schedule, setSchedule] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekRange = `${formatDateLabel(weekDates[0])} - ${formatDateLabel(weekDates[6])}`;

  useEffect(() => {
    loadScheduleFS().then((data) => {
      if (data?.weekStart && Array.isArray(data.zones)) {
        setWeekStart(data.weekStart);
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
      weekStart,
      zones: cleanZones,
      schedule,
      uploadedAt: new Date().toISOString(),
    };

    setSaving(true);
    try {
      await saveScheduleFS(data);
      window.dispatchEvent(new CustomEvent("schedule-updated", { detail: data }));
      toast.success("주간 일정이 저장되었습니다.");
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 주간 일정을 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">주간 작업 일정</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">{zones.length}개 구역</span>
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{weekRange} 작업 계획</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-3 shadow-sm">
        <div className="min-w-[1240px] space-y-2">
          <div className="grid grid-cols-[190px_repeat(7,minmax(142px,1fr))] gap-2 px-1">
            <div className="px-2 py-2 text-xs font-bold text-muted-foreground">작업구역</div>
            {weekDates.map((date, idx) => (
              <div key={date} className="rounded-lg border border-white bg-white px-2 py-2 text-center shadow-sm">
                <div className={`text-sm font-bold ${idx >= 5 ? "text-sky-600" : "text-slate-800"}`}>{formatDateLabel(date)}</div>
                <div className={`text-[10px] font-semibold ${idx >= 5 ? "text-sky-400" : "text-muted-foreground"}`}>{DAY_KO[idx]}</div>
              </div>
            ))}
          </div>

          {zones.map((zone, zoneIdx) => (
            <div
              key={`${zone}-${zoneIdx}`}
              className="grid grid-cols-[190px_repeat(7,minmax(142px,1fr))] gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
            >
              <div className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
                <input
                  value={zone}
                  onChange={(e) => updateZoneName(zoneIdx, e.target.value)}
                  className="w-full rounded-md border border-transparent bg-white px-2.5 py-2 text-sm font-bold text-slate-800 outline-none focus:border-slate-300"
                />
                <button
                  onClick={() => deleteZone(zone)}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-rose-200 px-2 py-1.5 text-xs font-bold text-rose-500 transition-colors hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 삭제
                </button>
              </div>

              {weekDates.map((date) => {
                const parsed = parseCell(schedule[date]?.[zone] ?? "");
                const selectedKeys = SHIFT_OPTIONS.filter((option) => parsed.selected.has(option.key)).map((option) => option.key);
                return (
                  <div key={`${date}-${zone}`} className="flex min-h-[150px] flex-col rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:border-slate-300">
                    <div className="flex min-h-[54px] flex-wrap content-start gap-1.5">
                      {selectedKeys.length === 0 ? (
                        <span className="flex h-7 items-center rounded-md border border-dashed border-slate-200 px-2 text-[11px] font-semibold text-slate-300">일정 없음</span>
                      ) : (
                        selectedKeys.map((key) => {
                          const option = getShiftOption(key);
                          if (!option) return null;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggleShift(date, zone, key)}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${option.className}`}
                              title="클릭하면 제거됩니다"
                            >
                              {option.label}
                              <span className="text-[10px] opacity-60">×</span>
                            </button>
                          );
                        })
                      )}
                    </div>

                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        toggleShift(date, zone, e.target.value);
                        e.currentTarget.value = "";
                      }}
                      className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-600 outline-none focus:border-slate-300 focus:bg-white"
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
                      onChange={(e) => updateMemo(date, zone, e.target.value)}
                      placeholder="메모"
                      rows={2}
                      className="mt-2 min-h-[44px] w-full flex-1 resize-none rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] outline-none focus:border-slate-300 focus:bg-white"
                    />
                  </div>
                );
              })}
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
