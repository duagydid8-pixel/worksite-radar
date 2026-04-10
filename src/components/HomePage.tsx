import { useMemo, useState, useEffect, useRef } from "react";
import { ParsedData } from "@/lib/parseExcel";
import { loadXerpFS, loadScheduleFS, saveScheduleFS } from "@/lib/firestoreService";
import { analyzeScheduleImage, fileToBase64, hasGeminiKey, type ScheduleData } from "@/lib/geminiService";
import { toast } from "sonner";
import { Upload, Loader2, CalendarDays } from "lucide-react";

interface HomePageProps {
  data: ParsedData | null;
  lastUploadedAt: string | null;
  selectedDate: string;
  isAdmin: boolean;
}

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// ── 기술인 통계 (XERP&PMIS 가장 최근 날짜 기준) ────
interface TechStats { total: number; present: number; absent: number; }

type XerpRow = { xerp출근: string; pmis출근: string; 성명: string };

function calcTechStats(xerpRows: XerpRow[]): TechStats {
  const total   = xerpRows.length;
  const present = xerpRows.filter((r) => r.xerp출근.trim() !== "" || r.pmis출근.trim() !== "").length;
  const absent  = total - present;
  return { total, present, absent };
}

// ── 관리자 통계 (근태보고 기반) ────────────────────
function calcManagerStats(data: ParsedData | null) {
  if (!data) return { total: 0, present: 0, absent: 0, leave: 0 };
  const total  = data.employees.length;
  const absent = data.anomalies.filter((a) => a.결근 > 0).length;
  const leave  = data.anomalies.filter((a) => a.연차 > 0).length;
  return { total, present: Math.max(0, total - absent - leave), absent, leave };
}

// ── 통계 카드 행 컴포넌트 ──────────────────────────
type AnyStats = Record<string, number>;
interface StatRowProps {
  title: string;
  stats: AnyStats;
  loaded: boolean;
  cards: { label: string; icon: string; bg: string; key: string; sub: string }[];
}
function StatRow({ title, stats, loaded, cards }: StatRowProps) {
  return (
    <div>
      <h3 className="text-sm font-bold text-gray-500 mb-3 flex items-center gap-2">
        <span className="w-1 h-4 rounded-full inline-block" style={{ background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" }} />
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center text-lg mb-3`}>
              {card.icon}
            </div>
            <div className="text-3xl font-bold text-gray-800 mb-0.5">
              {loaded ? stats[card.key] : "—"}
            </div>
            <div className="text-xs text-gray-400 font-medium">{card.label}</div>
            {card.sub && <div className="text-[11px] text-gray-300 mt-1">{card.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 미니 달력 ──────────────────────────────────────
function MiniCalendar({ selectedDate }: { selectedDate: string }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 font-bold text-base leading-none">‹</button>
        <span className="text-sm font-bold text-gray-700">{viewYear}년 {viewMonth + 1}월</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 font-bold text-base leading-none">›</button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAY_KO.map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-semibold pb-1.5 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />;
          const cellStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday = cellStr === todayStr;
          const isSelected = cellStr === selectedDate && !isToday;
          const col = idx % 7;
          return (
            <div
              key={idx}
              className={`flex items-center justify-center h-7 w-7 mx-auto rounded-full text-xs font-medium
                ${isToday ? "text-white font-bold shadow-sm" : ""}
                ${isSelected ? "bg-blue-100 text-blue-700 font-bold" : ""}
                ${!isToday && !isSelected && col === 0 ? "text-red-400" : ""}
                ${!isToday && !isSelected && col === 6 ? "text-blue-400" : ""}
                ${!isToday && !isSelected && col !== 0 && col !== 6 ? "text-gray-600" : ""}
              `}
              style={isToday ? { background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" } : {}}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 작업 유형 스타일 ──────────────────────────────────
const TYPE_META: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  "주간":    { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200", dot: "bg-green-500",  label: "주간" },
  "연장":    { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200",  dot: "bg-blue-500",   label: "연장" },
  "야간":    { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200",dot: "bg-orange-500", label: "야간" },
  "현장휴무":{ bg: "bg-red-50",    text: "text-red-600",    border: "border-red-200",   dot: "bg-red-400",    label: "휴무" },
};

const WEEK_DAY_KO = ["월","화","수","목","금","토","일"];

function getWeekDates(weekStart: string): string[] {
  const start = new Date(weekStart + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ── 주간 캘린더 ──────────────────────────────────────
function ScheduleCalendar({ schedule }: { schedule: ScheduleData }) {
  const weekDates = useMemo(() => getWeekDates(schedule.weekStart), [schedule.weekStart]);
  const todayStr = new Date().toISOString().slice(0, 10);

  const [wy, wm, wd] = schedule.weekStart.split("-").map(Number);
  const endDate = weekDates[6];
  const [, em, ed] = endDate.split("-").map(Number);
  const rangeLabel = `${wy}년 ${wm}월 ${wd}일 ~ ${em}월 ${ed}일`;

  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">{rangeLabel}</p>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-gray-500 font-semibold py-2.5 px-4 w-28">구역</th>
              {weekDates.map((date, i) => {
                const [, m, d] = date.split("-").map(Number);
                const isToday = date === todayStr;
                const isWeekend = i >= 5;
                return (
                  <th key={date} className="text-center py-2.5 px-2" style={{ minWidth: 64 }}>
                    <div className={`text-[11px] font-bold ${isToday ? "text-purple-600" : isWeekend ? "text-blue-400" : "text-gray-600"}`}>
                      {m}/{d}
                    </div>
                    <div className={`text-[10px] font-normal mt-0.5 ${isToday ? "text-purple-400" : isWeekend ? "text-blue-300" : "text-gray-400"}`}>
                      ({WEEK_DAY_KO[i]})
                    </div>
                    {isToday && <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mx-auto mt-0.5" />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {schedule.zones.map((zone, zi) => (
              <tr key={zone} className={`border-b border-gray-50 last:border-0 ${zi % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}>
                <td className="py-3 px-4 font-semibold text-gray-700 text-xs whitespace-nowrap">{zone}</td>
                {weekDates.map((date) => {
                  const type = schedule.schedule[date]?.[zone] ?? "";
                  const meta = TYPE_META[type];
                  const isToday = date === todayStr;
                  return (
                    <td key={date} className={`py-3 px-2 text-center ${isToday ? "bg-purple-50/30" : ""}`}>
                      {meta ? (
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
                          {meta.label}
                        </span>
                      ) : (
                        <span className="text-gray-200 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 범례 */}
      <div className="mt-3 flex flex-wrap gap-3">
        {Object.entries(TYPE_META).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm border ${meta.bg} ${meta.border}`} />
            <span className="text-[11px] text-gray-500">{key}</span>
          </div>
        ))}
      </div>

      {schedule.uploadedAt && (
        <p className="mt-2 text-[11px] text-gray-300">
          업데이트: {new Date(schedule.uploadedAt).toLocaleString("ko-KR")}
        </p>
      )}
    </div>
  );
}

// ── 작업 일정 섹션 ────────────────────────────────────
function WorkScheduleSection({ isAdmin }: { isAdmin: boolean }) {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loadingFetch, setLoadingFetch] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiKeyAvailable = hasGeminiKey();

  useEffect(() => {
    loadScheduleFS().then((data) => {
      setSchedule(data);
      setLoadingFetch(false);
    });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 15 * 1024 * 1024) {
      toast.error("파일 크기는 15MB 이하여야 합니다.");
      return;
    }
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!supportedTypes.includes(file.type)) {
      toast.error("JPG, PNG, WebP, GIF 형식만 지원합니다.");
      return;
    }

    setAnalyzing(true);
    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeScheduleImage(base64, file.type);
      await saveScheduleFS(data);
      setSchedule(data);
      toast.success("작업 일정이 성공적으로 분석되었습니다.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          주간 작업 일정
        </h3>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {!apiKeyAvailable && (
              <span className="text-[11px] text-red-400 bg-red-50 px-2 py-0.5 rounded-md border border-red-100">
                API 키 미설정
              </span>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={analyzing || !apiKeyAvailable}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {analyzing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 분석 중...</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> 이미지 업로드</>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
          </div>
        )}
      </div>

      {/* 컨텐츠 */}
      {loadingFetch ? (
        <div className="flex items-center justify-center py-10 gap-2 text-gray-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : analyzing ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-gray-500">Gemini AI가 이미지를 분석하고 있습니다...</p>
          <p className="text-xs text-gray-300">잠시만 기다려 주세요 (10~30초)</p>
        </div>
      ) : !schedule ? (
        <div className="py-10 text-center">
          <CalendarDays className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {isAdmin ? "작업 일정 이미지를 업로드하면 자동으로 분석됩니다." : "등록된 작업 일정이 없습니다."}
          </p>
        </div>
      ) : (
        <ScheduleCalendar schedule={schedule} />
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────
export default function HomePage({ data, lastUploadedAt, selectedDate, isAdmin }: HomePageProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${DAY_KO[today.getDay()]})`;

  // XERP 데이터 로드 → 가장 최근 날짜 행 사용
  const [xerpRows, setXerpRows] = useState<XerpRow[]>([]);
  const [xerpLoaded, setXerpLoaded] = useState(false);

  useEffect(() => {
    loadXerpFS().then((dateMap) => {
      if (dateMap && typeof dateMap === "object") {
        const dates = Object.keys(dateMap).sort();
        if (dates.length > 0) {
          const latest = dates[dates.length - 1];
          setXerpRows((dateMap[latest] ?? []) as XerpRow[]);
        }
      }
      setXerpLoaded(true);
    });
  }, []);

  // 통계 계산
  const techStats    = useMemo(() => calcTechStats(xerpRows), [xerpRows]);
  const managerStats = useMemo(() => calcManagerStats(data), [data]);

  const TECH_CARDS = [
    { label: "총 기술인 수", key: "total",   icon: "⛑️", bg: "bg-blue-50",  sub: "XERP 최근 데이터 기준" },
    { label: "정상 출근",    key: "present", icon: "✅", bg: "bg-green-50", sub: "출근 기록 있는 인원" },
    { label: "결근자",       key: "absent",  icon: "❌", bg: "bg-red-50",   sub: "출근 기록 없음" },
  ];
  const MANAGER_CARDS = [
    { label: "총 관리자 수", key: "total",   icon: "👔", bg: "bg-blue-50",   sub: "근태보고 기준" },
    { label: "정상 출근",    key: "present", icon: "✅", bg: "bg-green-50",  sub: "결근·연차 제외" },
    { label: "결근자",       key: "absent",  icon: "❌", bg: "bg-red-50",    sub: "" },
    { label: "연차자",       key: "leave",   icon: "🌿", bg: "bg-purple-50", sub: "" },
  ];

  return (
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto space-y-5">
      {/* 상단 날짜 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">홈</h2>
        <span className="text-sm text-gray-400 font-medium">📅 {todayStr}</span>
      </div>

      {/* 웰컴 배너 */}
      <div
        className="rounded-2xl p-6 flex items-center justify-between relative overflow-hidden"
        style={{ background: "linear-gradient(135deg,#a8c8f8 0%,#c8b4f8 60%,#f8b4d0 100%)" }}
      >
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-[#1a2a6c] mb-1">안녕하세요! 👋</h2>
          <p className="text-sm text-[#3a4a8c]/80">오늘도 현장 관리 시스템에 오신 것을 환영합니다.</p>
          {lastUploadedAt && (
            <p className="text-xs text-[#3a4a8c]/60 mt-2">최근 업데이트: {lastUploadedAt}</p>
          )}
        </div>
        <span className="text-5xl relative z-10 select-none">🏗️</span>
        <div className="absolute w-48 h-48 rounded-full bg-white/15 -right-10 -top-16 pointer-events-none" />
        <div className="absolute w-28 h-28 rounded-full bg-white/10 right-20 -bottom-10 pointer-events-none" />
      </div>

      {/* 통계 + 달력 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 items-start">
        <div className="space-y-5">
          {/* 기술인 통계 */}
          <StatRow
            title="기술인"
            stats={techStats as AnyStats}
            loaded={xerpLoaded}
            cards={TECH_CARDS}
          />
          {/* 관리자 통계 */}
          <StatRow
            title="관리자"
            stats={managerStats}
            loaded={data !== null}
            cards={MANAGER_CARDS}
          />
        </div>

        {/* 미니 달력 */}
        <MiniCalendar selectedDate={selectedDate} />
      </div>

      {/* 작업 일정 */}
      <WorkScheduleSection isAdmin={isAdmin} />

    </div>
  );
}
