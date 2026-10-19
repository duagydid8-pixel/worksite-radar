import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { loadKakaoEventsFS, loadXerpWorkDateMapAllSitesFS } from "@/lib/firestoreService";
import { EVENT_CATEGORY_LABELS, type KakaoEvent } from "@/lib/kakaoEvents";
import {
  Loader2,
  CheckCircle2, XCircle,
  ChevronLeft, ChevronRight,
  HardHat, ArrowRight, Lock,
  Wind, Droplets, Thermometer, PlusCircle,
  MessageSquare, Calculator, Database, Mail, Users,
} from "lucide-react";

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

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

type WorkRow = { isNoRecord: boolean; isWaeju?: boolean; needsUpdate?: boolean; 성명: string };
function calcStats(rows: WorkRow[]) {
  const total   = rows.length;
  const present = rows.filter(r => !r.isNoRecord).length;
  const gasan   = rows.filter(r => r.needsUpdate && !r.isWaeju).length;
  return { total, present, absent: total - present, gasan };
}

const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";

function CardHeading({ icon, title, sub, right }: { icon: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-slate-900">{title}</p>
        {sub && <p className="truncate text-[11px] font-semibold text-slate-400">{sub}</p>}
      </div>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
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
    <div className={`${cardClass} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={prev} aria-label="이전 달" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-extrabold text-slate-900">{vy}년 {vm+1}월</span>
        <button onClick={next} aria-label="다음 달" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-1.5 grid grid-cols-7">
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
          const tone = isToday ? "bg-slate-900 text-white font-extrabold shadow-sm"
            : isSel ? "bg-slate-100 text-slate-900 font-extrabold"
            : col === 0 ? "text-rose-400" : col === 6 ? "text-sky-400" : "text-slate-600";
          return <div key={idx} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-medium ${tone}`}>{day}</div>;
        })}
      </div>
    </div>
  );
}

// ── 날씨 (배너 안에 작게) ─────────────────────────────
function getWeatherInfo(code: number, isDay: number) {
  if (code === 0)  return { label: "맑음",      emoji: isDay ? "☀️" : "🌙" };
  if (code <= 2)   return { label: "구름 조금", emoji: "⛅" };
  if (code === 3)  return { label: "흐림",      emoji: "☁️" };
  if (code <= 49)  return { label: "안개",      emoji: "🌫️" };
  if (code <= 59)  return { label: "이슬비",    emoji: "🌦️" };
  if (code <= 69)  return { label: "비",        emoji: "🌧️" };
  if (code <= 79)  return { label: "눈",        emoji: "❄️" };
  if (code <= 82)  return { label: "소나기",    emoji: "🌦️" };
  if (code <= 86)  return { label: "눈 소나기", emoji: "🌨️" };
  if (code >= 95)  return { label: "뇌우",      emoji: "⛈️" };
  return             { label: "알 수 없음", emoji: "🌡️" };
}

interface WeatherData { temp: number; feelsLike: number; humidity: number; windSpeed: number; weatherCode: number; isDay: number }

function HeroWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

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
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <div className="flex items-center gap-2 text-xs text-white/70"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 날씨 불러오는 중</div>;
  if (state === "error" || !weather) return <div className="text-xs font-semibold text-white/60">날씨 정보를 가져올 수 없습니다</div>;
  const info = getWeatherInfo(weather.weatherCode, weather.isDay);
  return (
    <div className="flex items-center gap-4 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
      <span className="select-none text-3xl">{info.emoji}</span>
      <div>
        <p className="text-2xl font-extrabold leading-none tabular-nums">{weather.temp}°</p>
        <p className="mt-1 text-[11px] font-bold text-white/75">평택 · {info.label}</p>
      </div>
      <div className="ml-1 space-y-0.5 border-l border-white/15 pl-4 text-[11px] font-semibold text-white/75">
        <p className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> 체감 {weather.feelsLike}°</p>
        <p className="flex items-center gap-1"><Droplets className="h-3 w-3" /> 습도 {weather.humidity}%</p>
        <p className="flex items-center gap-1"><Wind className="h-3 w-3" /> 바람 {weather.windSpeed}m/s</p>
      </div>
    </div>
  );
}

// ── 오늘 근태 특이사항 (카톡 공지) ─────────────────────
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

  return (
    <div className={cardClass}>
      <CardHeading
        icon={<MessageSquare className="h-4 w-4" />}
        title="오늘 근태 특이사항"
        sub={`${selectedDate.replaceAll("-", ".")} · 카톡 공지 기준`}
        right={events && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-700">{events.length}건</span>}
      />
      <div className="max-h-[260px] overflow-y-auto px-5 py-3">
        {!isAdmin ? (
          <p className="py-4 text-center text-xs font-semibold text-slate-400">관리자 로그인 후 볼 수 있습니다.</p>
        ) : events === null ? (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중</p>
        ) : events.length === 0 ? (
          <p className="py-4 text-center text-xs font-semibold text-slate-400">저장된 카톡 근태 특이사항이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm font-bold text-slate-800">
                  {e.room && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{e.room}</span>}
                  {e.name || "이름 미확인"}
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-500">
                  {EVENT_CATEGORY_LABELS[e.category] ?? e.category}{e.cause ? ` · ${e.cause}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────
export default function HomePage({ selectedDate, isAdmin, onNavigate }: HomePageProps) {
  const today = new Date();
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 ${DAY_KO[today.getDay()]}요일`;

  const [xerpDateMap, setXerpDateMap] = useState<Record<string, WorkRow[]>>({});
  const [xerpLoaded,  setXerpLoaded]  = useState(false);

  useEffect(() => {
    loadXerpWorkDateMapAllSitesFS().then(dm => {
      if (dm && typeof dm === "object") {
        const mapped: Record<string, WorkRow[]> = {};
        for (const [date, entry] of Object.entries(dm)) {
          if (Array.isArray(entry.rows)) mapped[date] = entry.rows as WorkRow[];
        }
        setXerpDateMap(mapped);
      }
      setXerpLoaded(true);
    });
  }, []);

  const latestXerpDate = useMemo(() => {
    const dates = Object.keys(xerpDateMap).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [xerpDateMap]);
  const xerpRows = useMemo(() => (latestXerpDate ? xerpDateMap[latestXerpDate] ?? [] : []), [xerpDateMap, latestXerpDate]);
  const stats = useMemo(() => calcStats(xerpRows), [xerpRows]);

  const countTotal   = useCountUp(xerpLoaded ? stats.total   : 0, 200);
  const countPresent = useCountUp(xerpLoaded ? stats.present : 0, 300);
  const countAbsent  = useCountUp(xerpLoaded ? stats.absent  : 0, 400);
  const countGasan   = useCountUp(xerpLoaded ? stats.gasan   : 0, 500);

  const hasXerp = xerpLoaded && xerpRows.length > 0;
  const KPI = [
    { label: "출력 인원", value: countTotal,   sub: "공수 반영 명단",       icon: <HardHat className="h-5 w-5" />,      tone: "bg-blue-50 text-blue-700" },
    { label: "출근",      value: countPresent, sub: "출퇴근 기록 있음",      icon: <CheckCircle2 className="h-5 w-5" />, tone: "bg-emerald-50 text-emerald-700" },
    { label: "기록 없음", value: countAbsent,  sub: "XERP·PMIS 모두 없음",  icon: <XCircle className="h-5 w-5" />,      tone: "bg-rose-50 text-rose-600" },
    { label: "가산 필요", value: countGasan,   sub: "가산B 신청 대상",       icon: <PlusCircle className="h-5 w-5" />,   tone: "bg-amber-50 text-amber-700" },
  ];
  const emptyKpiText = !xerpLoaded ? "불러오는 중" : isAdmin ? "공수 반영 저장 전" : "관리자 로그인 후 표시";

  return (
    <div className="mx-auto min-h-full max-w-[1400px] space-y-5 p-4 md:p-6">
      {/* 배너 */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b1f4a] via-[#123477] to-[#1d4ed8] px-6 py-6 text-white shadow-lg md:px-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wide text-blue-200">한성크린텍 · 평택 현장</p>
            <h1 className="mt-1 text-2xl font-black md:text-3xl">초순수 현장 관제</h1>
            <p className="mt-1.5 text-sm font-semibold text-white/75">{dateLabel}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">기준일 {selectedDate.replaceAll("-", ".")}</span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">최근 공수 반영 {latestXerpDate ? latestXerpDate.replaceAll("-", ".") : "—"}</span>
              <span className={`rounded-full px-3 py-1 ring-1 ${isAdmin ? "bg-emerald-400/20 text-emerald-100 ring-emerald-300/30" : "bg-white/10 ring-white/15"}`}>{isAdmin ? "관리자" : "열람 전용"}</span>
            </div>
          </div>
          <HeroWeather />
        </div>
      </section>

      {/* 공수 반영 요약 */}
      <section>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-extrabold text-slate-800">공수 반영 요약</h2>
          <span className="text-[11px] font-semibold text-slate-400">{latestXerpDate ? `${latestXerpDate.replaceAll("-", ".")} 기준` : ""}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {KPI.map((k) => (
            <div key={k.label} className={`${cardClass} flex items-center gap-3.5 p-4`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${k.tone}`}>{k.icon}</span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-500">{k.label}</p>
                <p className="text-2xl font-black tabular-nums text-slate-900">
                  {hasXerp ? <>{k.value}<span className="ml-0.5 text-xs font-bold text-slate-400">명</span></> : <span className="text-slate-300">—</span>}
                </p>
                <p className="truncate text-[11px] font-semibold text-slate-400">{hasXerp ? k.sub : emptyKpiText}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* 바로가기 */}
        <section>
          <h2 className="mb-2 px-1 text-sm font-extrabold text-slate-800">바로가기</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {QUICK_LINKS.map(({ key, label, desc, icon: Icon, adminOnly }) => {
              const locked = adminOnly && !isAdmin;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onNavigate(key, adminOnly)}
                  className={`group flex items-center gap-3.5 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md ${locked ? "border-slate-200 opacity-80" : "border-slate-200"}`}
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${locked ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-700"}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-extrabold text-slate-900">
                      {label}{locked && <Lock className="h-3 w-3 text-slate-400" />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{desc}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" />
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-5">
          <KakaoTodayCard selectedDate={selectedDate} isAdmin={isAdmin} />
          <MiniCalendar selectedDate={selectedDate} />
        </aside>
      </div>
    </div>
  );
}
