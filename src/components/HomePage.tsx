import React, { useMemo, useState, useEffect, useRef } from "react";
import { loadXerpFS, loadScheduleFS, saveScheduleFS } from "@/lib/firestoreService";
import { toast } from "sonner";
import {
  Loader2, CalendarDays, FileJson,
  Users, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight,
  Clock, CloudUpload, HardHat,
} from "lucide-react";

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

const DAY_KO   = ["일","월","화","수","목","금","토"];
const WEEK_DAY = ["월","화","수","목","금","토","일"];

type XerpRow = { xerp출근: string; pmis출근: string; 성명: string };
function calcStats(rows: XerpRow[]) {
  const total   = rows.length;
  const present = rows.filter(r => r.xerp출근.trim() || r.pmis출근.trim()).length;
  return { total, present, absent: total - present };
}

// ── 미니 달력 ─────────────────────────────────────────
function MiniCalendar({ selectedDate }: { selectedDate: string }) {
  const now = new Date();
  const [vy, setVy] = useState(now.getFullYear());
  const [vm, setVm] = useState(now.getMonth());

  const firstDay = new Date(vy, vm, 1).getDay();
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const prev = () => { if (vm === 0) { setVy(y=>y-1); setVm(11); } else setVm(m=>m-1); };
  const next = () => { if (vm === 11) { setVy(y=>y+1); setVm(0); } else setVm(m=>m+1); };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold text-gray-700">{vy}년 {vm+1}월</span>
        <button onClick={next} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-400">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-2">
        {DAY_KO.map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-semibold ${i===0?"text-rose-400":i===6?"text-sky-400":"text-gray-400"}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />;
          const col = idx % 7;
          const ds = `${vy}-${String(vm+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isToday = ds === todayStr;
          const isSel   = ds === selectedDate && !isToday;
          return (
            <div key={idx} className={`flex items-center justify-center h-7 w-7 mx-auto rounded-full text-[11px] font-medium transition-colors
              ${isToday ? "bg-primary text-white font-bold shadow-sm" : ""}
              ${isSel   ? "bg-primary/10 text-primary font-bold" : ""}
              ${!isToday && !isSel && col===0 ? "text-rose-400" : ""}
              ${!isToday && !isSel && col===6 ? "text-sky-400"  : ""}
              ${!isToday && !isSel && col!==0 && col!==6 ? "text-gray-600" : ""}
            `}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}

// ── 작업 유형 메타 ────────────────────────────────────
const TYPE_META: Record<string, { bg: string; text: string; border: string; label: string }> = {
  "주간":     { bg:"bg-emerald-50",  text:"text-emerald-700", border:"border-emerald-200", label:"주간"  },
  "연장":     { bg:"bg-blue-50",     text:"text-blue-700",    border:"border-blue-200",    label:"연장"  },
  "야간":     { bg:"bg-orange-50",   text:"text-orange-700",  border:"border-orange-200",  label:"야간"  },
  "현장휴무": { bg:"bg-rose-50",     text:"text-rose-600",    border:"border-rose-200",    label:"휴무"  },
};

function getWeekDates(ws: string) {
  const s = new Date(ws + "T00:00:00");
  return Array.from({length:7}, (_,i)=>{
    const d = new Date(s); d.setDate(s.getDate()+i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
}

// ── 주간 스케줄 테이블 ────────────────────────────────
const ScheduleCalendar = React.forwardRef<HTMLDivElement, { schedule: ScheduleData }>(
  ({ schedule }) => {
    const weekDates = useMemo(() => getWeekDates(schedule.weekStart), [schedule.weekStart]);
    const todayStr  = new Date().toISOString().slice(0,10);
    const [,wm,wd]  = schedule.weekStart.split("-").map(Number);
    const [,em,ed]  = weekDates[6].split("-").map(Number);

    const floorGroups = useMemo(() => {
      const f1: string[]=[], f3: string[]=[], ot: string[]=[];
      for (const z of schedule.zones) {
        if (z.startsWith("1층")) f1.push(z);
        else if (z.startsWith("3층")) f3.push(z);
        else ot.push(z);
      }
      const g: { label:string; zones:string[] }[] = [];
      if (f1.length) g.push({label:"1층",zones:f1});
      if (f3.length) g.push({label:"3층",zones:f3});
      if (ot.length) g.push({label:"기타",zones:ot});
      if (!g.length)  g.push({label:"",zones:schedule.zones});
      return g;
    }, [schedule.zones]);

    return (
      <div>
        <p className="text-xs text-gray-400 mb-3 font-medium">
          {wm}월 {wd}일 ~ {em}월 {ed}일
        </p>
        <div className="overflow-x-auto rounded-2xl border border-gray-100">
          <table className="w-full text-xs border-collapse" style={{minWidth:520}}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-gray-500 font-semibold py-3 px-4 w-28">구역</th>
                {weekDates.map((date,i)=>{
                  const [,m,d] = date.split("-").map(Number);
                  const isToday   = date === todayStr;
                  const isWeekend = i >= 5;
                  return (
                    <th key={date} className={`text-center py-3 px-2 ${isToday?"bg-primary/5":""}`} style={{minWidth:60}}>
                      <div className={`text-[11px] font-bold ${isToday?"text-primary":isWeekend?"text-sky-500":"text-gray-600"}`}>{m}/{d}</div>
                      <div className={`text-[10px] mt-0.5 ${isToday?"text-primary/60":isWeekend?"text-sky-400":"text-gray-400"}`}>({WEEK_DAY[i]})</div>
                      {isToday && <div className="w-1 h-1 rounded-full bg-primary mx-auto mt-0.5" />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {floorGroups.map(group => (
                <React.Fragment key={group.label}>
                  {group.label && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={8} className="py-1.5 px-4">
                        <span className="text-[10px] font-bold text-gray-400 tracking-widest">{group.label}</span>
                      </td>
                    </tr>
                  )}
                  {group.zones.map((zone,zi) => (
                    <tr key={zone} className={`border-b border-gray-50 last:border-0 ${zi%2===1?"bg-gray-50/30":"bg-white"}`}>
                      <td className="py-3 px-4 font-semibold text-gray-700 text-xs whitespace-nowrap">
                        {group.label ? zone.replace(/^[13]층\s*/,"") : zone}
                      </td>
                      {weekDates.map(date=>{
                        const type = schedule.schedule[date]?.[zone] ?? "";
                        const meta = TYPE_META[type];
                        const isToday = date === todayStr;
                        return (
                          <td key={date} className={`py-3 px-2 text-center ${isToday?"bg-primary/5":""}`}>
                            {meta ? (
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
                                {meta.label}
                              </span>
                            ) : <span className="text-gray-200">—</span>}
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
        <div className="mt-3 flex flex-wrap gap-3">
          {Object.entries(TYPE_META).map(([key,meta]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-md border ${meta.bg} ${meta.border}`} />
              <span className="text-[11px] text-gray-400">{key}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
);

// ── 작업일정 섹션 ──────────────────────────────────────
function WorkScheduleSection({ isAdmin }: { isAdmin: boolean }) {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading]   = useState(true);
  const jsonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadScheduleFS().then(d => { setSchedule(d); setLoading(false); });
  }, []);
  useEffect(() => {
    const fn = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setSchedule(d); };
    window.addEventListener("schedule-updated", fn);
    return () => window.removeEventListener("schedule-updated", fn);
  }, []);

  const handleJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    try {
      const json = JSON.parse(await file.text());
      if (!json.weekStart || !json.zones || !json.schedule) { toast.error("JSON 형식이 올바르지 않습니다."); return; }
      const data: ScheduleData = { ...json, uploadedAt: new Date().toISOString() };
      await saveScheduleFS(data); setSchedule(data); toast.success("작업 일정이 저장되었습니다.");
    } catch { toast.error("JSON 파일을 읽는 중 오류가 발생했습니다."); }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
            <CalendarDays className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-800">주간 작업 일정</h3>
            {schedule && <p className="text-[11px] text-gray-400">이번주 구역별 작업 현황</p>}
          </div>
        </div>
        {isAdmin && (
          <>
            <button onClick={() => jsonRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-colors shadow-sm">
              <FileJson className="h-3.5 w-3.5" /> JSON 업로드
            </button>
            <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={handleJson} />
          </>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : !schedule ? (
        <div className="py-12 text-center">
          <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <CalendarDays className="h-7 w-7 text-gray-300" />
          </div>
          <p className="text-sm text-gray-400">
            {isAdmin ? "JSON 파일을 업로드하면 작업 일정이 표시됩니다." : "등록된 작업 일정이 없습니다."}
          </p>
        </div>
      ) : <ScheduleCalendar schedule={schedule} />}
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────
export default function HomePage({ lastUploadedAt, selectedDate, isAdmin }: HomePageProps) {
  const today = new Date();
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 ${DAY_KO[today.getDay()]}요일`;

  const [xerpRows,  setXerpRows]  = useState<XerpRow[]>([]);
  const [xerpLoaded, setXerpLoaded] = useState(false);

  useEffect(() => {
    loadXerpFS().then(dm => {
      if (dm && typeof dm === "object") {
        const dates = Object.keys(dm).sort();
        if (dates.length) setXerpRows((dm[dates[dates.length-1]] ?? []) as XerpRow[]);
      }
      setXerpLoaded(true);
    });
  }, []);

  const stats = useMemo(() => calcStats(xerpRows), [xerpRows]);

  const KPI = [
    { label:"총 기술인", value: stats.total,   sub:"XERP 최근 기준", icon:<HardHat className="h-5 w-5" />,       color:"text-primary",    iconBg:"bg-primary/10"    },
    { label:"정상 출근", value: stats.present,  sub:"출근 기록 있음", icon:<CheckCircle2 className="h-5 w-5" />,  color:"text-emerald-600", iconBg:"bg-emerald-50"    },
    { label:"결근",      value: stats.absent,   sub:"출근 기록 없음", icon:<XCircle className="h-5 w-5" />,       color:"text-rose-500",    iconBg:"bg-rose-50"       },
  ];

  return (
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto" style={{ background: "#f8f8fb", minHeight: "100%" }}>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-5 items-start">

        {/* ── 메인 컬럼 ── */}
        <div className="space-y-5">

          {/* 히어로 카드 */}
          <div className="relative overflow-hidden rounded-3xl p-7"
            style={{ background: "linear-gradient(135deg, #fff8ed 0%, #ffecd2 50%, #ffe0b8 100%)" }}>
            {/* 장식 원 */}
            <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full opacity-30"
              style={{ background: "radial-gradient(circle, #ffb347 0%, transparent 70%)" }} />
            <div className="absolute right-16 bottom-0 w-32 h-32 rounded-full opacity-20"
              style={{ background: "radial-gradient(circle, #ff7043 0%, transparent 70%)" }} />

            <div className="relative z-10 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-amber-600/70 tracking-widest uppercase mb-1">평택 초순수 P4 현장</p>
                <h1 className="text-2xl font-bold text-gray-800 mb-1">현장 관리 시스템</h1>
                <p className="text-sm text-gray-500 font-medium">{dateLabel}</p>
                {lastUploadedAt && (
                  <div className="flex items-center gap-1.5 mt-3">
                    <div className="flex items-center gap-1.5 bg-white/60 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-white/80">
                      <Clock className="h-3 w-3 text-amber-600" />
                      <span className="text-[11px] font-semibold text-gray-600">최근 업데이트 · {lastUploadedAt}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="hidden sm:flex items-center justify-center w-20 h-20 rounded-3xl bg-white/40 backdrop-blur-sm border border-white/60 shadow-sm text-4xl select-none">
                🏗️
              </div>
            </div>
          </div>

          {/* KPI 카드 3개 */}
          <div className="grid grid-cols-3 gap-4">
            {KPI.map((k) => (
              <div key={k.label} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 rounded-2xl ${k.iconBg} flex items-center justify-center mb-4 ${k.color}`}>
                  {k.icon}
                </div>
                <p className={`text-3xl font-bold tabular-nums mb-0.5 ${k.color}`}>
                  {xerpLoaded ? k.value : <span className="text-gray-200">—</span>}
                </p>
                <p className="text-sm font-semibold text-gray-700">{k.label}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* 주간 작업 일정 */}
          <WorkScheduleSection isAdmin={isAdmin} />
        </div>

        {/* ── 우측 사이드바 ── */}
        <div className="space-y-4">
          {/* 미니 달력 */}
          <MiniCalendar selectedDate={selectedDate} />

          {/* 업로드 상태 카드 */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-2xl bg-blue-50 flex items-center justify-center">
                <CloudUpload className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">데이터 현황</p>
                <p className="text-[11px] text-gray-400">근태 파일 업로드 상태</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-xs text-gray-500">기술인 데이터</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${xerpLoaded && stats.total > 0 ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>
                  {xerpLoaded && stats.total > 0 ? "로드됨" : "없음"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <span className="text-xs text-gray-500">최근 업데이트</span>
                <span className="text-xs font-semibold text-gray-600 text-right max-w-[120px] leading-tight">
                  {lastUploadedAt ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-gray-500">총 기술인</span>
                <span className="text-xs font-bold text-primary">
                  {xerpLoaded ? `${stats.total}명` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 인력 현황 요약 카드 */}
          {xerpLoaded && stats.total > 0 && (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-2xl bg-violet-50 flex items-center justify-center">
                  <Users className="h-4.5 w-4.5 text-violet-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">인력 현황</p>
                  <p className="text-[11px] text-gray-400">최근 데이터 기준</p>
                </div>
              </div>
              {/* 출근율 바 */}
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-500 font-medium">출근율</span>
                  <span className="font-bold text-emerald-600">
                    {stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700"
                    style={{ width: stats.total > 0 ? `${Math.round(stats.present / stats.total * 100)}%` : "0%" }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-emerald-50 rounded-2xl p-3 text-center">
                  <p className="text-lg font-bold text-emerald-600">{stats.present}</p>
                  <p className="text-[10px] text-emerald-500 font-medium">출근</p>
                </div>
                <div className="bg-rose-50 rounded-2xl p-3 text-center">
                  <p className="text-lg font-bold text-rose-500">{stats.absent}</p>
                  <p className="text-[10px] text-rose-400 font-medium">결근</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
