import React, { useMemo, useState, useEffect, useRef } from "react";
import { loadKakaoEventsFS, loadXerpWorkDateMapAllSitesFS, subscribeScheduleFS } from "@/lib/firestoreService";
import { EVENT_CATEGORY_LABELS, type KakaoEvent } from "@/lib/kakaoEvents";
import {
  Loader2, CalendarDays,
  CheckCircle2, XCircle,
  ChevronLeft, ChevronRight,
  HardHat, ArrowRight, Lock,
  Wind, Droplets, Thermometer, PlusCircle,
  MessageSquare, Calculator, Database, Mail, Users,
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
  selectedDate: string;
  isAdmin: boolean;
  /** 바로가기 카드 클릭 시 해당 메뉴로 이동 */
  onNavigate: (key: string, adminOnly: boolean) => void;
}

// 홈 바로가기 — key는 Index의 메뉴 키
const QUICK_LINKS = [
  { key: "카톡정리", label: "카톡 대화 정리", desc: "공지방 파일로 조퇴·퇴사·타각 문제 정리", icon: MessageSquare, adminOnly: false },
  { key: "XERP공수반영", label: "XERP 공수 반영", desc: "가산B·가산사유 계산 후 저장", icon: Calculator, adminOnly: true },
  { key: "XERP&PMIS", label: "XERP & PMIS", desc: "날짜별 출퇴근·공수 기록과 월별 통계", icon: Database, adminOnly: true },
  { key: "신규자명단", label: "기술인 및 관리자 명단", desc: "입사·퇴사·이관 관리", icon: Users, adminOnly: true },
  { key: "조직도송부", label: "본사 송부용", desc: "조직도 PPT·본사 메일·PDF 분리", icon: Mail, adminOnly: false },
] as const;

const DAY_KO   = ["일","월","화","수","목","금","토"];
const WEEK_DAY = ["일","월","화","수","목","금","토"];

type WorkRow = { isNoRecord: boolean; isWaeju?: boolean; needsUpdate?: boolean; 성명: string };
function calcStats(rows: WorkRow[]) {
  const total   = rows.length;
  const present = rows.filter(r => !r.isNoRecord).length;
  const gasan   = rows.filter(r => r.needsUpdate && !r.isWaeju).length;
  return { total, present, absent: total - present, gasan };
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

function getMonthDates(dateStr: string) {
  const monthStart = new Date(getMonthStart(dateStr) + "T00:00:00");
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  return Array.from({length:daysInMonth}, (_,i)=>{
    const d = new Date(monthStart); d.setDate(i + 1);
    return toDateStr(d);
  });
}

// ── 월간 작업 칸반 ───────────────────────────────────
const ScheduleCalendar = React.forwardRef<HTMLDivElement, { schedule: ScheduleData }>(
  ({ schedule }) => {
    const monthDates = useMemo(() => getMonthDates(schedule.weekStart), [schedule.weekStart]);
    const monthStart = getMonthStart(schedule.weekStart);
    const [year, month] = monthStart.split("-").map(Number);
    const boardColumns = useMemo(() => {
      return Object.entries(TYPE_META).map(([key, meta]) => {
        const cards = monthDates.flatMap((date) => {
          return schedule.zones.flatMap((zone) => {
            const value = schedule.schedule[date]?.[zone] ?? "";
            if (!value.includes(key)) return [];
            const memo = value.split("\n").find((line) => line.startsWith("메모:"))?.replace(/^메모:\s*/, "") ?? "";
            return [{ date, zone, memo }];
          });
        });
        return { key, meta, cards };
      });
    }, [monthDates, schedule]);

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

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="grid min-w-0 grid-cols-6 gap-1.5">
            {boardColumns.map((column) => (
              <div key={column.key} className="min-w-0 rounded-lg border border-slate-200 bg-white">
                <div className="flex min-w-0 items-center justify-between gap-1 border-b border-slate-100 px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className={`h-2 w-2 shrink-0 rounded-full border ${column.meta.bg} ${column.meta.border}`} />
                    <span className="truncate text-[11px] font-extrabold text-slate-800">{column.meta.label}</span>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{column.cards.length}</span>
                </div>
                <div className="max-h-[calc(100dvh-430px)] min-h-[110px] space-y-1.5 overflow-y-auto p-1.5">
                  {column.cards.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-200 px-1 py-5 text-center text-[10px] font-semibold text-slate-300">일정 없음</div>
                  ) : column.cards.map((card) => {
                    const [,m,d] = card.date.split("-").map(Number);
                    return (
                      <div key={`${column.key}-${card.date}-${card.zone}`} className="rounded-md border border-slate-100 bg-slate-50 px-1.5 py-1.5">
                        <div className="flex min-w-0 items-center justify-between gap-1">
                          <span className="shrink-0 text-[11px] font-extrabold text-slate-900">{m}/{d}</span>
                          <span className="min-w-0 truncate text-[10px] font-bold text-slate-500">{card.zone}</span>
                        </div>
                        {card.memo && <div className="mt-1 truncate text-[10px] font-semibold text-slate-400">{card.memo}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
function KakaoTodayCard({ selectedDate, isAdmin }: { selectedDate: string; isAdmin: boolean }) {
  const [events, setEvents] = useState<KakaoEvent[] | null>(null);
  useEffect(() => {
    if (!isAdmin || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) { setEvents(null); return; }
    let cancelled = false;
    loadKakaoEventsFS<KakaoEvent>(selectedDate.slice(0, 7)).then((list) => {
      if (!cancelled) setEvents(list.filter((e) => e.date === selectedDate));
    });
    return () => { cancelled = true; };
  }, [isAdmin, selectedDate]);
  if (!isAdmin || events === null) return null;
  return (
    <div className="home-side-panel">
      <div className="home-side-heading">
        <div className="home-side-icon home-side-icon-warn">
          <MessageSquare className="h-4.5 w-4.5 text-amber-600" />
        </div>
        <div>
          <p>오늘 근태 특이사항</p>
          <span>{selectedDate} · 카톡 공지 기준</span>
        </div>
        <strong className="home-side-count">{events.length}건</strong>
      </div>
      <div className="home-leave-list">
        {events.length > 0 ? (
          events.map((e) => (
            <div key={e.id}>
              <span>{e.room ? `[${e.room}] ` : ""}{e.name || "이름 미확인"}</span>
              <small>{EVENT_CATEGORY_LABELS[e.category] ?? e.category}{e.cause ? ` · ${e.cause}` : ""}</small>
            </div>
          ))
        ) : (
          <p>저장된 카톡 근태 특이사항이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

export default function HomePage({ selectedDate, isAdmin, onNavigate }: HomePageProps) {
  const today = new Date();
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 ${DAY_KO[today.getDay()]}요일`;

  const [xerpDateMap, setXerpDateMap] = useState<Record<string, WorkRow[]>>({});
  const [xerpLoaded,  setXerpLoaded]  = useState(false);

  useEffect(() => {
    loadXerpWorkDateMapAllSitesFS().then(dm => {
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

  const stats = useMemo(() => calcStats(xerpRows), [xerpRows]);

  const latestXerpDate = useMemo(() => {
    const dates = Object.keys(xerpDateMap).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [xerpDateMap]);

  const countTotal   = useCountUp(xerpLoaded ? stats.total   : 0, 330);
  const countPresent = useCountUp(xerpLoaded ? stats.present : 0, 450);
  const countAbsent  = useCountUp(xerpLoaded ? stats.absent  : 0, 570);
  const countGasan   = useCountUp(xerpLoaded ? stats.gasan   : 0, 690);

  const hasXerp = xerpLoaded && xerpRows.length > 0;
  const basisLabel = latestXerpDate ? `${latestXerpDate.slice(5).replace("-", "/")} 공수 반영 기준` : "";
  const KPI = [
    { label: "출력 인원", value: countTotal,   sub: basisLabel,              icon: <HardHat className="h-5 w-5" /> },
    { label: "출근",      value: countPresent, sub: "출퇴근 기록 있음",       icon: <CheckCircle2 className="h-5 w-5" /> },
    { label: "기록 없음", value: countAbsent,  sub: "XERP·PMIS 모두 없음",    icon: <XCircle className="h-5 w-5" /> },
    { label: "가산 필요", value: countGasan,   sub: "가산B 신청 대상",        icon: <PlusCircle className="h-5 w-5" /> },
  ];
  const emptyKpiText = !xerpLoaded ? "불러오는 중" : isAdmin ? "공수 반영 저장 전" : "관리자 로그인 후 표시";

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
            <span>최근 공수 반영</span>
            <strong>{latestXerpDate ? latestXerpDate.replaceAll("-", ".") : "—"}</strong>
          </div>
          <div>
            <span>접속 상태</span>
            <strong>{isAdmin ? "관리자" : "열람 전용"}</strong>
          </div>
        </div>
      </section>

      <section className="home-quick-grid hp-anim-hero">
        {QUICK_LINKS.map(({ key, label, desc, icon: Icon, adminOnly }) => {
          const locked = adminOnly && !isAdmin;
          return (
            <button key={key} type="button" onClick={() => onNavigate(key, adminOnly)} className={`home-quick-card${locked ? " is-locked" : ""}`}>
              <span className="home-quick-icon"><Icon className="h-4 w-4" /></span>
              <span className="home-quick-copy">
                <strong>{label}{locked && <Lock className="ml-1 inline h-3 w-3 text-slate-400" />}</strong>
                <small>{desc}</small>
              </span>
              <ArrowRight className="home-quick-arrow h-4 w-4" />
            </button>
          );
        })}
      </section>

      <section className="home-kpi-strip">
        {KPI.map((k, i) => (
          <div key={k.label} className={`home-kpi-card hp-anim-kpi-${i + 1}`}>
            <div className="home-kpi-icon">{k.icon}</div>
            <div>
              <p className="home-kpi-label">{k.label}</p>
              <p className="home-kpi-value">
                {hasXerp ? <>{k.value}<span>명</span></> : <span className="text-gray-300">—</span>}
              </p>
              <p className="home-kpi-sub">{hasXerp ? k.sub : emptyKpiText}</p>
            </div>
          </div>
        ))}
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
                <span>{isAdmin ? "XERP 공수 반영을 저장하면 날짜별 출력 인원이 표시됩니다." : "관리자 로그인 후 출력 인원 추이를 볼 수 있습니다."}</span>
              </div>
            )}
          </div>
        </main>

        <aside className="home-board-aside hp-anim-side">
          <KakaoTodayCard selectedDate={selectedDate} isAdmin={isAdmin} />

          <WeatherCard />

          <MiniCalendar selectedDate={selectedDate} />
        </aside>
      </div>
    </div>
  );
}
