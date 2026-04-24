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

export function WeeklySchedule() {
  const [weekStart, setWeekStart] = useState(getMonday());
  const [zones, setZones] = useState<string[]>(["작업구역 1"]);
  const [schedule, setSchedule] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

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
      const clean = nextName;
      const next = [...prev];
      next[idx] = clean;
      setSchedule((current) => {
        const updated: Record<string, Record<string, string>> = {};
        for (const [date, byZone] of Object.entries(current)) {
          updated[date] = { ...byZone };
          if (oldName !== clean && Object.prototype.hasOwnProperty.call(updated[date], oldName)) {
            updated[date][clean] = updated[date][oldName];
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">주간 작업 일정</h2>
          <p className="text-xs text-muted-foreground mt-1">달력 기준으로 작업구역별 일정을 직접 입력합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground">
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-white p-3">
        {SHIFT_OPTIONS.map((option) => (
          <span key={option.key} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${option.className}`}>
            {option.label}
            <span className="font-medium opacity-70">{option.time}</span>
          </span>
        ))}
      </div>

      <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full min-w-[1120px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              <th className="sticky left-0 z-20 w-52 bg-muted px-3 py-3 text-left font-bold text-muted-foreground">작업구역</th>
              {weekDates.map((date, idx) => {
                const d = new Date(`${date}T00:00:00`);
                return (
                  <th key={date} className="min-w-[132px] border-l border-border/60 px-2 py-3 text-center">
                    <div className={`font-bold ${idx >= 5 ? "text-sky-600" : "text-slate-700"}`}>
                      {d.getMonth() + 1}/{d.getDate()}
                    </div>
                    <div className={`mt-0.5 text-[10px] ${idx >= 5 ? "text-sky-400" : "text-muted-foreground"}`}>
                      {DAY_KO[idx]}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {zones.map((zone, zoneIdx) => (
              <tr key={`${zone}-${zoneIdx}`} className="border-b border-border/60 last:border-0">
                <td className="sticky left-0 z-10 bg-white px-3 py-3 align-top shadow-[1px_0_0_0_rgba(226,232,240,0.8)]">
                  <div className="flex items-center gap-2">
                    <input
                      value={zone}
                      onChange={(e) => updateZoneName(zoneIdx, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-2 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <button
                      onClick={() => deleteZone(zone)}
                      className="rounded-lg border border-rose-200 p-2 text-rose-500 transition-colors hover:bg-rose-50"
                      title="작업구역 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
                {weekDates.map((date) => {
                  const parsed = parseCell(schedule[date]?.[zone] ?? "");
                  return (
                    <td key={`${date}-${zone}`} className="border-l border-border/60 p-2 align-top">
                      <div className="flex max-h-[158px] flex-col gap-1.5 overflow-y-auto pr-1">
                        {SHIFT_OPTIONS.map((option) => {
                          const selected = parsed.selected.has(option.key);
                          return (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => toggleShift(date, zone, option.key)}
                              className={`rounded-md border px-2 py-1 text-left text-[11px] font-bold transition-colors ${
                                selected ? option.className : "border-border bg-white text-muted-foreground hover:bg-muted/50"
                              }`}
                            >
                              <span className="block">{option.label}</span>
                              <span className="block text-[10px] font-medium opacity-70">{option.time}</span>
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        value={parsed.memo}
                        onChange={(e) => updateMemo(date, zone, e.target.value)}
                        placeholder="수기 입력"
                        rows={2}
                        className="mt-2 w-full resize-none rounded-md border border-border px-2 py-1.5 text-[11px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={addZone}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted/50"
      >
        <Plus className="h-4 w-4" /> 작업구역 추가
      </button>
    </div>
  );
}
