import React, { useMemo, useState, useEffect, useRef } from "react";
import { loadXerpWorkDateMapFS, subscribeScheduleFS } from "@/lib/firestoreService";
import { buildRecentHomeActivities } from "@/lib/recentHomeActivity";
import type { LeaveDetail } from "@/lib/parseExcel";
import {
  Loader2, CalendarDays,
  CheckCircle2, XCircle,
  ChevronLeft, ChevronRight,
  CloudUpload, HardHat,
  Wind, Droplets, Thermometer, TrendingDown, CalendarOff,
  Activity,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

function useCountUp(target: number, delayMs: number = 0): number {
  const [value, setValue] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (done.current || target === 0) return;
    done.current = true;
    const timer = setTimeout(() => {
      const steps = 30;
      const stepMs = 600 / steps;
      let step = 0;
      const id = setInterval(() => {
        step++;
        setValue(step >= steps ? target : Math.round((target / steps) * step));
        if (step >= steps) clearInterval(id);
      }, stepMs);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [target, delayMs]);

  return value;
}

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
  leaveDetails: LeaveDetail[];
}

const DAY_KO   = ["일","월","화","수","목","금","토"];
const WEEK_DAY = ["일","월","화","수","목","금","토"];

type WorkRow = { isNoRecord: boolean; isWaeju?: boolean; 성명: string };
function calcStats(rows: WorkRow[]) {
  const total   = rows.length;
  const present = rows.filter(r => !r.isNoRecord).length;
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-extrabold text-slate-900">{vy}년 {vm+1}월</span>
        <button onClick={next} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-2">
        {DAY_KO.map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-bold ${i===0?"text-rose-400":i===6?"text-sky-500":"text-slate-400"}`}>{d}</div>
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
              ${isToday ? "bg-slate-900 text-white font-extrabold shadow-sm" : ""}
              ${isSel   ? "bg-slate-100 text-slate-900 font-extrabold" : ""}
              ${!isToday && !isSel && col===0 ? "text-rose-400" : ""}
              ${!isToday && !isSel && col===6 ? "text-sky-400"  : ""}
              ${!isToday && !isSel && col!==0 && col!==6 ? "text-slate-600" : ""}
            `}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}

// ── 작업 유형 메타 ────────────────────────────────────
const TYPE_META: Record<string, { bg: string; text: string; border: string; label: string }> = {
  "조출":     { bg:"bg-violet-50",   text:"text-violet-700",  border:"border-violet-200",  label:"조출"  },
  "주간":     { bg:"bg-emerald-50",  text:"text-emerald-700", border:"border-emerald-200", label:"주간"  },
  "연장":     { bg:"bg-blue-50",     text:"text-blue-700",    border:"border-blue-200",    label:"연장"  },
  "야간":     { bg:"bg-orange-50",   text:"text-orange-700",  border:"border-orange-200",  label:"야간"  },
  "주말중식OT": { bg:"bg-amber-50", text:"text-amber-700", border:"border-amber-200", label:"중식OT" },
  "현장휴무": { bg:"bg-rose-50",     text:"text-rose-600",    border:"border-rose-200",    label:"휴무"  },
};
const IMPORTANT_SCHEDULE_TYPES = new Set(["연장", "야간", "주말중식OT"]);

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function getMonthStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

function getMonthCalendarDates(dateStr: string) {
  const monthStart = new Date(getMonthStart(dateStr) + "T00:00:00");
  const firstCell = new Date(monthStart);
  firstCell.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({length:42}, (_,i)=>{
    const d = new Date(firstCell); d.setDate(firstCell.getDate()+i);
    return toDateStr(d);
  });
}

// ── 월간 작업 달력 ───────────────────────────────────
const ScheduleCalendar = React.forwardRef<HTMLDivElement, { schedule: ScheduleData }>(
  ({ schedule }) => {
    const monthDates = useMemo(() => getMonthCalendarDates(schedule.weekStart), [schedule.weekStart]);
    const todayStr  = new Date().toISOString().slice(0,10);
    const monthStart = getMonthStart(schedule.weekStart);
    const [year, month] = monthStart.split("-").map(Number);

    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500">
            {year}년 {month}월
          </p>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
            {schedule.zones.length}개 구역
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="grid grid-cols-7 border-b border-slate-100 pb-1.5">
            {WEEK_DAY.map((day, i) => (
              <div key={day} className={`px-2 py-1.5 text-center text-[10px] font-extrabold ${i === 0 ? "text-rose-400" : i === 6 ? "text-sky-500" : "text-slate-400"}`}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDates.map((date, dateIdx)=>{
              const [,m,d] = date.split("-").map(Number);
              const typeEntries = schedule.zones
                .map((zone) => ({ zone, type: schedule.schedule[date]?.[zone] ?? "" }))
                .filter((entry) => entry.type);
              const dateObject = new Date(date + "T00:00:00");
              const isToday = date === todayStr;
              const isOutsideMonth = dateObject.getMonth() + 1 !== month;
              return (
                <div
                  key={date}
                  className={`hp-sched-cell min-h-[102px] border-b border-r border-slate-100 px-2 py-2 ${isToday ? "hp-sched-cell-today bg-slate-50 ring-1 ring-inset ring-slate-300" : "bg-white"} ${isOutsideMonth ? "opacity-35" : ""}`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className={`text-[11px] font-extrabold ${isToday ? "text-slate-950" : "text-slate-700"}`}>{m}/{d}</span>
                    {typeEntries.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">{typeEntries.length}</span>}
                  </div>
                  <div className="space-y-1">
                    {typeEntries.slice(0, 2).map(({ zone, type }, entryIdx) => {
                      const matchedMetas = Object.entries(TYPE_META).filter(([k]) => type.includes(k));
                      const memo = type.split("\n").find((line) => line.startsWith("메모:"))?.replace(/^메모:\s*/, "") ?? "";
                      const cellDelayMs = 780 + dateIdx * 12 + entryIdx * 40;
                      return (
                        <div key={`${date}-${zone}`} className="truncate rounded-md bg-slate-50 px-1.5 py-1 text-[9px] font-semibold text-slate-500">
                          <span className="mr-1 font-extrabold text-slate-600">{zone}</span>
                          {matchedMetas.slice(0, 2).map(([k, meta]) => {
                              const isImportant = IMPORTANT_SCHEDULE_TYPES.has(k);
                              return (
                                <span
                                  key={k}
                                  className={`hp-sched-chip mr-1 inline-flex items-center justify-center rounded border px-1 py-0.5 text-[9px] font-bold ${isImportant ? "hp-sched-chip-priority" : ""} ${meta.bg} ${meta.text} ${meta.border}`}
                                  style={{ animationDelay: `${cellDelayMs}ms` }}
                                >
                                  {meta.label}
                                </span>
                              );
                            })}
                          {matchedMetas.length > 2 && <span className="font-bold text-slate-400">+{matchedMetas.length - 2}</span>}
                          {!matchedMetas.length && memo && <span>{memo}</span>}
                        </div>
                      );
                    })}
                    {typeEntries.length > 2 && <div className="text-[9px] font-bold text-slate-400">+{typeEntries.length - 2}개 구역</div>}
                  </div>
                </div>
              );
            })}
          </div>
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

  useEffect(() => {
    const unsub = subscribeScheduleFS((d) => {
      setSchedule(d);
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
            <CalendarDays className="h-4.5 w-4.5 text-slate-700" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">월간 작업 일정</h3>
            {schedule && <p className="text-[11px] font-semibold text-slate-400">월 기준 구역별 작업 현황</p>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : !schedule ? (
        <div className="py-12 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <CalendarDays className="h-6 w-6 text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-400">
            {isAdmin ? "작업일정 탭에서 월간 작업 일정을 등록하세요." : "등록된 작업 일정이 없습니다."}
          </p>
        </div>
      ) : <ScheduleCalendar schedule={schedule} />}
    </div>
  );
}

// ── 날씨 코드 → 한국어·이모지 매핑 ──────────────────
function getWeatherInfo(code: number, isDay: number) {
  if (code === 0)               return { label:"맑음",      emoji: isDay ? "☀️" : "🌙", color:"text-amber-500",  bg:"bg-amber-50"  };
  if (code <= 2)                return { label:"구름 조금",  emoji:"⛅",                   color:"text-sky-500",    bg:"bg-sky-50"    };
  if (code === 3)               return { label:"흐림",       emoji:"☁️",                  color:"text-gray-500",   bg:"bg-gray-100"  };
  if (code <= 49)               return { label:"안개",       emoji:"🌫️",                  color:"text-gray-400",   bg:"bg-gray-100"  };
  if (code <= 59)               return { label:"이슬비",     emoji:"🌦️",                  color:"text-blue-400",   bg:"bg-blue-50"   };
  if (code <= 69)               return { label:"비",         emoji:"🌧️",                  color:"text-blue-500",   bg:"bg-blue-50"   };
  if (code <= 79)               return { label:"눈",         emoji:"❄️",                  color:"text-indigo-400", bg:"bg-indigo-50" };
  if (code <= 82)               return { label:"소나기",     emoji:"🌦️",                  color:"text-blue-500",   bg:"bg-blue-50"   };
  if (code <= 86)               return { label:"눈 소나기",  emoji:"🌨️",                  color:"text-indigo-400", bg:"bg-indigo-50" };
  if (code >= 95)               return { label:"뇌우",       emoji:"⛈️",                  color:"text-purple-500", bg:"bg-purple-50" };
  return                               { label:"알 수 없음", emoji:"🌡️",                  color:"text-gray-500",   bg:"bg-gray-100"  };
}

interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  isDay: number;
}

function WeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    // 평택시 좌표
    fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=36.9923&longitude=127.1124" +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
      "&timezone=Asia%2FSeoul"
    )
      .then(r => r.json())
      .then(data => {
        const c = data.current;
        setWeather({
          temp:        Math.round(c.temperature_2m),
          feelsLike:   Math.round(c.apparent_temperature),
          humidity:    c.relative_humidity_2m,
          windSpeed:   Math.round(c.wind_speed_10m * 10) / 10,
          weatherCode: c.weather_code,
          isDay:       c.is_day,
        });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const info = weather ? getWeatherInfo(weather.weatherCode, weather.isDay) : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-2xl bg-sky-50 flex items-center justify-center">
          <span className="text-base">🌤️</span>
        </div>
        <div>
          <p className="text-sm font-extrabold text-slate-900">현장 날씨</p>
          <p className="text-[11px] font-semibold text-slate-400">평택시 현재 기상</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중...
        </div>
      ) : error || !weather || !info ? (
        <div className="py-6 text-center text-xs font-semibold text-slate-400">날씨 정보를 가져올 수 없습니다.</div>
      ) : (
        <>
          {/* 메인 기온 */}
          <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-4xl font-extrabold tabular-nums text-slate-950">{weather.temp}°</p>
              <p className={`mt-0.5 text-sm font-extrabold ${info.color}`}>{info.label}</p>
            </div>
            <span className="select-none text-3xl">{info.emoji}</span>
          </div>
          {/* 세부 정보 3칸 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
              <Thermometer className="h-3.5 w-3.5 text-orange-400 mx-auto mb-1" />
              <p className="text-xs font-extrabold text-slate-800">{weather.feelsLike}°</p>
              <p className="text-[10px] font-semibold text-slate-400">체감</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
              <Droplets className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
              <p className="text-xs font-extrabold text-slate-800">{weather.humidity}%</p>
              <p className="text-[10px] font-semibold text-slate-400">습도</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
              <Wind className="h-3.5 w-3.5 text-teal-400 mx-auto mb-1" />
              <p className="text-xs font-extrabold text-slate-800">{weather.windSpeed}</p>
              <p className="text-[10px] font-semibold text-slate-400">m/s</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── 일일 출력인원 그래프 ──────────────────────────────
interface DailyPoint { date: string; label: string; present: number; total: number; isToday: boolean }

function DailyAttendanceChart({ dateMap }: { dateMap: Record<string, WorkRow[]> }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const data: DailyPoint[] = useMemo(() => {
    return Object.keys(dateMap)
      .sort()
      .slice(-14) // 최근 14일
      .map(date => {
        const rows = dateMap[date] as WorkRow[];
        const present = rows.filter(r => !r.isNoRecord).length;
        const [, m, d] = date.split("-").map(Number);
        return { date, label: `${m}/${d}`, present, total: rows.length, isToday: date === todayStr };
      });
  }, [dateMap, todayStr]);

  if (!data.length) return null;

  const maxVal = Math.max(...data.map(d => d.present), 1);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
            <HardHat className="h-4.5 w-4.5 text-slate-700" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">일일 출력인원</h3>
            <p className="text-[11px] font-semibold text-slate-400">최근 {data.length}일 출근 기준</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-extrabold tabular-nums text-slate-950">{data[data.length - 1].present}<span className="ml-0.5 text-xs font-semibold text-slate-400">명</span></p>
          <p className="text-[10px] font-semibold text-slate-400">최근일 출근</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={168}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="attendanceTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#0f172a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#64748b", fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            minTickGap={4}
            tickMargin={8}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8", fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            domain={[0, Math.ceil(maxVal * 1.15)]}
            allowDecimals={false}
            width={32}
          />
          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as DailyPoint;
              return (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                  <p className="mb-1 font-extrabold text-slate-800">{d.date}</p>
                  <p className="font-bold text-slate-900">출근 {d.present}명</p>
                  <p className="text-slate-400">전체 {d.total}명</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="present"
            stroke="#0f172a"
            strokeWidth={2.5}
            fill="url(#attendanceTrendFill)"
            dot={{ r: 3, strokeWidth: 2, stroke: "#0f172a", fill: "#ffffff" }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#0f172a", fill: "#ffffff" }}
            isAnimationActive={true}
            animationBegin={400}
            animationDuration={1400}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-6 rounded-full bg-slate-900" />
          <span className="text-[10px] font-semibold text-slate-400">출력 추세</span>
        </div>
        <div className="hidden">
          <span className="hidden" />
          <span className="text-[10px] font-semibold text-slate-400">이전 날짜</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-400">최근 14일</span>
      </div>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────
export default function HomePage({ lastUploadedAt, selectedDate, isAdmin, leaveDetails }: HomePageProps) {
  const today = new Date();
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 ${DAY_KO[today.getDay()]}요일`;

  const [xerpDateMap, setXerpDateMap] = useState<Record<string, WorkRow[]>>({});
  const [xerpLoaded,  setXerpLoaded]  = useState(false);

  useEffect(() => {
    loadXerpWorkDateMapFS().then(dm => {
      if (dm && typeof dm === "object") {
        // xerp_work_dates 각 날짜 entry의 rows 추출
        const mapped: Record<string, WorkRow[]> = {};
        for (const [date, entry] of Object.entries(dm)) {
          if (Array.isArray(entry.rows)) {
            mapped[date] = entry.rows as WorkRow[];
          }
        }
        setXerpDateMap(mapped);
      }
      setXerpLoaded(true);
    });
  }, []);

  const xerpRows = useMemo(() => {
    const dates = Object.keys(xerpDateMap).sort();
    return dates.length ? (xerpDateMap[dates[dates.length - 1]] ?? []) : [];
  }, [xerpDateMap]);

  const prevXerpRows = useMemo(() => {
    const dates = Object.keys(xerpDateMap).sort();
    return dates.length >= 2 ? (xerpDateMap[dates[dates.length - 2]] ?? []) : null;
  }, [xerpDateMap]);

  const stats = useMemo(() => calcStats(xerpRows), [xerpRows]);

  const decreased = useMemo(() => {
    if (!prevXerpRows) return null;
    const diff = prevXerpRows.length - xerpRows.length;
    return diff > 0 ? diff : 0;
  }, [prevXerpRows, xerpRows]);

  const latestXerpDate = useMemo(() => {
    const dates = Object.keys(xerpDateMap).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [xerpDateMap]);

  // 선택일 기준 당일 연차자 필터링
  const todayLeaveDetails = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return leaveDetails.filter(
      (item) => item.year === y && item.month === m && item.day === d
    );
  }, [leaveDetails, selectedDate]);

  const countTotal   = useCountUp(xerpLoaded ? stats.total   : 0, 330);
  const countPresent = useCountUp(xerpLoaded ? stats.present : 0, 450);
  const countAbsent  = useCountUp(xerpLoaded ? stats.absent  : 0, 570);
  const countDec     = useCountUp(xerpLoaded ? (decreased ?? 0) : 0, 690);

  const KPI = [
    { label:"총 기술인", value: countTotal,   sub:"공수반영 최근 기준",   icon:<HardHat className="h-5 w-5" />,      color:"text-slate-900",   iconBg:"bg-slate-100",   showDash: false },
    { label:"정상 출근", value: countPresent,  sub:"출근 기록 있음",      icon:<CheckCircle2 className="h-5 w-5" />, color:"text-emerald-600", iconBg:"bg-emerald-50",  showDash: false },
    { label:"결근",      value: countAbsent,   sub:"출근 기록 없음",      icon:<XCircle className="h-5 w-5" />,      color:"text-rose-500",    iconBg:"bg-rose-50",     showDash: false },
    { label:"감소인원",  value: countDec,      sub:"전일 대비 인원 감소", icon:<TrendingDown className="h-5 w-5" />, color:"text-amber-600",   iconBg:"bg-amber-50",    showDash: decreased === null },
  ];

  const recentActivities = useMemo(
    () =>
      buildRecentHomeActivities({
        lastAttendanceUploadedAt: lastUploadedAt,
        latestXerpDate,
        selectedDate,
        leaveCount: todayLeaveDetails.length,
      }),
    [lastUploadedAt, latestXerpDate, selectedDate, todayLeaveDetails.length]
  );

  return (
    <div className="ops-home p-4 md:p-5 max-w-[1500px] mx-auto min-h-full space-y-4">

      <section className="home-command-panel hp-anim-hero">
        <div className="home-command-title">
          <h1>P4 초순수 현장 관제</h1>
          <p>{dateLabel} 기준 현장 운영 현황</p>
        </div>
        <div className="home-command-meta">
          <div>
            <span>선택 기준일</span>
            <strong>{selectedDate.replaceAll("-", ".")}</strong>
          </div>
          <div>
            <span>공수 기준일</span>
            <strong>{latestXerpDate ? latestXerpDate.replaceAll("-", ".") : "미등록"}</strong>
          </div>
          <div>
            <span>근태 업데이트</span>
            <strong>{lastUploadedAt ?? "업로드 전"}</strong>
          </div>
        </div>
      </section>

      <section className="home-kpi-strip">
        {KPI.map((k, i) => {
          const showDash = !xerpLoaded || k.showDash;
          return (
            <div
              key={k.label}
              className={`home-kpi-card hp-anim-kpi-${i + 1}`}
            >
              <div className={`home-kpi-icon ${k.iconBg} ${k.color}`}>
                {k.icon}
              </div>
              <div>
                <p className="home-kpi-label">{k.label}</p>
                <p className={`home-kpi-value ${k.color}`}>
                  {showDash ? <span className="text-gray-300">—</span> : k.value}
                  {!showDash && <span>명</span>}
                </p>
                <p className="home-kpi-sub">{k.sub}</p>
              </div>
            </div>
          );
        })}
      </section>

      <div className="home-board-grid">
        <main className="home-board-main">
          <div className="hp-anim-sched">
            <WorkScheduleSection isAdmin={isAdmin} />
          </div>

          <div className="hp-anim-chart">
            {xerpLoaded && Object.keys(xerpDateMap).length > 0 ? (
              <DailyAttendanceChart dateMap={xerpDateMap} />
            ) : (
              <div className="home-empty-panel">
                <HardHat className="h-5 w-5 text-slate-400" />
                <span>출력인원 데이터가 아직 없습니다.</span>
              </div>
            )}
          </div>
        </main>

        <aside className="home-board-aside hp-anim-side">
          <div className="home-side-panel">
            <div className="home-side-heading">
              <div className="home-side-icon">
                <Activity className="h-4.5 w-4.5 text-slate-700" />
              </div>
              <div>
                <p>최근 처리 이력</p>
                <span>홈 기준 주요 업데이트</span>
              </div>
            </div>

            <div className="home-activity-list">
              {recentActivities.map((activity) => (
                <div key={activity.title} className="home-activity-row">
                  <span className="home-activity-dot" />
                  <div>
                    <strong>{activity.title}</strong>
                    <small>{activity.detail}</small>
                  </div>
                  <em>{activity.status}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="home-side-panel">
            <div className="home-side-heading">
              <div className="home-side-icon">
                <CloudUpload className="h-4.5 w-4.5 text-slate-700" />
              </div>
              <div>
                <p>데이터 현황</p>
                <span>근태 파일 업로드 상태</span>
              </div>
            </div>

            <div className="home-status-list">
              <div>
                <span>기술인 데이터</span>
                <strong className={xerpLoaded && stats.total > 0 ? "is-ok" : ""}>
                  {xerpLoaded && stats.total > 0 ? "로드됨" : "없음"}
                </strong>
              </div>
              <div>
                <span>최근 업데이트</span>
                <strong>{lastUploadedAt ?? "—"}</strong>
              </div>
              <div>
                <span>총 기술인</span>
                <strong>{xerpLoaded ? `${stats.total}명` : "—"}</strong>
              </div>
            </div>
          </div>

          <WeatherCard />

          <div className="home-side-panel">
            <div className="home-side-heading">
              <div className="home-side-icon home-side-icon-warn">
                <CalendarOff className="h-4.5 w-4.5 text-amber-600" />
              </div>
              <div>
                <p>당일 연차자</p>
                <span>{selectedDate} 기준</span>
              </div>
              <strong className="home-side-count">{todayLeaveDetails.length}명</strong>
            </div>
            <div className="home-leave-list">
              {todayLeaveDetails.length > 0 ? (
                todayLeaveDetails.map((item, i) => (
                  <div key={i}>
                    <span>{item.name}</span>
                    <small>{item.days !== 1 ? `${item.days}일` : "1일"}{item.reason ? ` · ${item.reason}` : ""}</small>
                  </div>
                ))
              ) : (
                <p>등록된 연차자가 없습니다.</p>
              )}
            </div>
          </div>

          <MiniCalendar selectedDate={selectedDate} />
        </aside>
      </div>
    </div>
  );
}
