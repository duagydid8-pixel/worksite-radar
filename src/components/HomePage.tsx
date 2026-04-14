import React, { useMemo, useState, useEffect, useRef } from "react";
import { loadXerpFS, loadScheduleFS, saveScheduleFS } from "@/lib/firestoreService";
import { toast } from "sonner";
import { Loader2, CalendarDays, FileJson, Users, CheckCircle2, XCircle, ChevronLeft, ChevronRight } from "lucide-react";

interface ScheduleData {
  weekStart: string;
  zones: string[];
  schedule: Record<string, Record<string, string>>;
  uploadedAt?: string;
}

interface HomePageProps {
  lastUploadedAt: string | null;
  selectedDate: string;
  isAdmin: boolean;
}

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_DAY_KO = ["월", "화", "수", "목", "금", "토", "일"];

type XerpRow = { xerp출근: string; pmis출근: string; 성명: string };

function calcTechStats(rows: XerpRow[]) {
  const total   = rows.length;
  const present = rows.filter((r) => r.xerp출근.trim() !== "" || r.pmis출근.trim() !== "").length;
  return { total, present, absent: total - present };
}

// ── 미니 달력 ─────────────────────────────────────────
function MiniCalendar({ selectedDate }: { selectedDate: string }) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const prev = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1); };
  const next = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1); };

  return (
    <div className="bg-white border border-border rounded-2xl p-5 shadow-sm h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold text-foreground">{viewYear}년 {viewMonth + 1}월</span>
        <button onClick={next} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_KO.map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-bold ${i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : "text-muted-foreground"}`}>{d}</div>
        ))}
      </div>

      {/* 날짜 */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />;
          const col = idx % 7;
          const cellStr = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isToday    = cellStr === todayStr;
          const isSelected = cellStr === selectedDate && !isToday;
          return (
            <div key={idx} className={`flex items-center justify-center h-7 w-7 mx-auto rounded-full text-xs transition-colors
              ${isToday    ? "bg-primary text-primary-foreground font-bold shadow-sm" : ""}
              ${isSelected ? "bg-primary/10 text-primary font-bold" : ""}
              ${!isToday && !isSelected && col === 0 ? "text-rose-400" : ""}
              ${!isToday && !isSelected && col === 6 ? "text-sky-400" : ""}
              ${!isToday && !isSelected && col !== 0 && col !== 6 ? "text-foreground" : ""}
            `}>
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 작업 유형 스타일 ──────────────────────────────────
const TYPE_META: Record<string, { bg: string; text: string; border: string; label: string }> = {
  "주간":    { bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-200", label: "주간" },
  "연장":    { bg: "bg-blue-50",     text: "text-blue-700",    border: "border-blue-200",    label: "연장" },
  "야간":    { bg: "bg-orange-50",   text: "text-orange-700",  border: "border-orange-200",  label: "야간" },
  "현장휴무":{ bg: "bg-rose-50",     text: "text-rose-600",    border: "border-rose-200",    label: "휴무" },
};

function getWeekDates(weekStart: string): string[] {
  const start = new Date(weekStart + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
}

// ── 주간 스케줄 캘린더 ────────────────────────────────
const ScheduleCalendar = React.forwardRef<HTMLDivElement, { schedule: ScheduleData }>(
  ({ schedule }, _ref) => {
    const weekDates = useMemo(() => getWeekDates(schedule.weekStart), [schedule.weekStart]);
    const todayStr = new Date().toISOString().slice(0, 10);

    const [wy, wm, wd] = schedule.weekStart.split("-").map(Number);
    const [, em, ed]   = weekDates[6].split("-").map(Number);
    const rangeLabel   = `${wy}년 ${wm}월 ${wd}일 ~ ${em}월 ${ed}일`;

    const floorGroups = useMemo(() => {
      const floor1: string[] = [], floor3: string[] = [], other: string[] = [];
      for (const z of schedule.zones) {
        if (z.startsWith("1층")) floor1.push(z);
        else if (z.startsWith("3층")) floor3.push(z);
        else other.push(z);
      }
      const groups: { label: string; zones: string[] }[] = [];
      if (floor1.length) groups.push({ label: "1층", zones: floor1 });
      if (floor3.length) groups.push({ label: "3층", zones: floor3 });
      if (other.length)  groups.push({ label: "기타", zones: other });
      if (!groups.length) groups.push({ label: "", zones: schedule.zones });
      return groups;
    }, [schedule.zones]);

    return (
      <div>
        <p className="text-xs text-muted-foreground mb-3 font-medium">{rangeLabel}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="text-left text-foreground font-semibold py-2.5 px-4 w-28">구역</th>
                {weekDates.map((date, i) => {
                  const [, m, d] = date.split("-").map(Number);
                  const isToday   = date === todayStr;
                  const isWeekend = i >= 5;
                  return (
                    <th key={date} className={`text-center py-2.5 px-2 ${isToday ? "bg-primary/10" : ""}`} style={{ minWidth: 64 }}>
                      <div className={`text-[11px] font-bold ${isToday ? "text-primary" : isWeekend ? "text-sky-500" : "text-foreground"}`}>
                        {m}/{d}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${isToday ? "text-primary/70" : isWeekend ? "text-sky-400" : "text-muted-foreground"}`}>
                        ({WEEK_DAY_KO[i]})
                      </div>
                      {isToday && <div className="w-1.5 h-1.5 rounded-full bg-primary mx-auto mt-0.5" />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {floorGroups.map((group) => (
                <React.Fragment key={`floor-${group.label}`}>
                  {group.label && (
                    <tr className="bg-muted/50">
                      <td colSpan={8} className="py-1.5 px-4">
                        <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                          <span className="w-1 h-3 rounded-full bg-primary inline-block opacity-60" />
                          {group.label}
                        </span>
                      </td>
                    </tr>
                  )}
                  {group.zones.map((zone, zi) => (
                    <tr key={zone} className={`border-b border-border/50 last:border-0 ${zi % 2 === 1 ? "bg-muted/20" : "bg-white"}`}>
                      <td className="py-3 px-4 font-semibold text-foreground text-xs whitespace-nowrap">
                        {group.label ? zone.replace(/^[13]층\s*/, "") : zone}
                      </td>
                      {weekDates.map((date) => {
                        const type = schedule.schedule[date]?.[zone] ?? "";
                        const meta = TYPE_META[type];
                        const isToday = date === todayStr;
                        return (
                          <td key={date} className={`py-3 px-2 text-center ${isToday ? "bg-primary/5" : ""}`}>
                            {meta ? (
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
                                {meta.label}
                              </span>
                            ) : (
                              <span className="text-border text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* 범례 */}
        <div className="mt-3 flex flex-wrap gap-3">
          {Object.entries(TYPE_META).map(([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm border ${meta.bg} ${meta.border}`} />
              <span className="text-[11px] text-muted-foreground">{key}</span>
            </div>
          ))}
        </div>

        {schedule.uploadedAt && (
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            업데이트: {new Date(schedule.uploadedAt).toLocaleString("ko-KR")}
          </p>
        )}
      </div>
    );
  }
);

// ── 작업 일정 섹션 ────────────────────────────────────
function WorkScheduleSection({ isAdmin }: { isAdmin: boolean }) {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loadingFetch, setLoadingFetch] = useState(true);
  const jsonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadScheduleFS().then((data) => { setSchedule(data); setLoadingFetch(false); });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setSchedule(detail);
    };
    window.addEventListener("schedule-updated", handler);
    return () => window.removeEventListener("schedule-updated", handler);
  }, []);

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.weekStart || !json.zones || !json.schedule) {
        toast.error("JSON 형식이 올바르지 않습니다.");
        return;
      }
      const data: ScheduleData = { weekStart: json.weekStart, zones: json.zones, schedule: json.schedule, uploadedAt: new Date().toISOString() };
      await saveScheduleFS(data);
      setSchedule(data);
      toast.success("작업 일정이 저장되었습니다.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "JSON 파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">주간 작업 일정</h3>
          </div>
        </div>
        {isAdmin && (
          <>
            <button
              onClick={() => jsonRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <FileJson className="h-3.5 w-3.5" /> JSON 업로드
            </button>
            <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
          </>
        )}
      </div>

      {loadingFetch ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : !schedule ? (
        <div className="py-12 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "JSON 파일을 업로드하면 작업 일정이 표시됩니다." : "등록된 작업 일정이 없습니다."}
          </p>
          {isAdmin && (
            <div className="mt-4 p-4 bg-muted/50 rounded-xl text-left max-w-md mx-auto border border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-2">📋 JSON 형식 예시:</p>
              <pre className="text-[10px] text-muted-foreground overflow-x-auto whitespace-pre">{`{
  "weekStart": "2026-04-13",
  "zones": ["1층 A구역", "3층 A구역"],
  "schedule": {
    "2026-04-13": { "1층 A구역": "주간" }
  }
}`}</pre>
            </div>
          )}
        </div>
      ) : (
        <ScheduleCalendar schedule={schedule} />
      )}
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────
export default function HomePage({ lastUploadedAt, selectedDate, isAdmin }: HomePageProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 (${DAY_KO[today.getDay()]})`;

  const [xerpRows, setXerpRows] = useState<XerpRow[]>([]);
  const [xerpLoaded, setXerpLoaded] = useState(false);

  useEffect(() => {
    loadXerpFS().then((dateMap) => {
      if (dateMap && typeof dateMap === "object") {
        const dates = Object.keys(dateMap).sort();
        if (dates.length > 0) setXerpRows((dateMap[dates[dates.length - 1]] ?? []) as XerpRow[]);
      }
      setXerpLoaded(true);
    });
  }, []);

  const stats = useMemo(() => calcTechStats(xerpRows), [xerpRows]);

  const KPI = [
    {
      label: "총 기술인",
      value: stats.total,
      sub: "XERP 최근 기준",
      icon: <Users className="h-5 w-5 text-primary" />,
      iconBg: "bg-primary/10",
      valueColor: "text-foreground",
    },
    {
      label: "정상 출근",
      value: stats.present,
      sub: "출근 기록 있음",
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      iconBg: "bg-emerald-50",
      valueColor: "text-emerald-600",
    },
    {
      label: "결근",
      value: stats.absent,
      sub: "출근 기록 없음",
      icon: <XCircle className="h-5 w-5 text-rose-500" />,
      iconBg: "bg-rose-50",
      valueColor: "text-rose-500",
    },
  ];

  return (
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto space-y-5">

      {/* 히어로 배너 */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0f172a] px-8 py-7 flex items-center justify-between shadow-lg">
        {/* 배경 그래픽 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute -bottom-16 right-24 w-48 h-48 rounded-full bg-violet-500/15 blur-2xl" />
          <div className="absolute top-4 right-56 w-24 h-24 rounded-full bg-sky-400/10 blur-xl" />
        </div>

        <div className="relative z-10">
          <p className="text-xs font-semibold text-slate-400 mb-1 tracking-widest uppercase">평택 초순수 P4 현장</p>
          <h1 className="text-2xl font-bold text-white mb-1">현장 관리 시스템</h1>
          <p className="text-sm text-slate-400">{todayStr}</p>
          {lastUploadedAt && (
            <p className="text-xs text-slate-500 mt-2">마지막 업데이트 · {lastUploadedAt}</p>
          )}
        </div>

        <div className="relative z-10 text-5xl select-none hidden sm:block">🏗️</div>
      </div>

      {/* KPI 카드 + 미니달력 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 items-start">

        {/* KPI 3개 */}
        <div className="grid grid-cols-3 gap-4">
          {KPI.map((k) => (
            <div key={k.label} className="bg-white border border-border rounded-2xl p-5 shadow-sm">
              <div className={`w-10 h-10 rounded-xl ${k.iconBg} flex items-center justify-center mb-4`}>
                {k.icon}
              </div>
              <p className={`text-3xl font-bold tabular-nums mb-0.5 ${k.valueColor}`}>
                {xerpLoaded ? k.value : <span className="text-muted-foreground/40">—</span>}
              </p>
              <p className="text-sm font-semibold text-foreground">{k.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
            </div>
          ))}
        </div>

        {/* 미니 달력 */}
        <MiniCalendar selectedDate={selectedDate} />
      </div>

      {/* 주간 작업 일정 */}
      <WorkScheduleSection isAdmin={isAdmin} />

    </div>
  );
}
