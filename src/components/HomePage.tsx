import React, { useMemo, useState, useEffect, useRef } from "react";
import { ParsedData } from "@/lib/parseExcel";
import { loadXerpFS, loadScheduleFS, saveScheduleFS } from "@/lib/firestoreService";
import { toast } from "sonner";
import { Loader2, CalendarDays, FileJson } from "lucide-react";

interface ScheduleData {
  weekStart: string;
  zones: string[];
  schedule: Record<string, Record<string, string>>;
  uploadedAt?: string;
}

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
function calcManagerStats(data: ParsedData | null, selectedDate: string) {
  if (!data) return { total: 0, present: 0, absent: 0, leave: 0 };
  const [weekYear, weekMonth] = selectedDate.split("-").map(Number);

  // selectedDate 기준 월 필터링 → 없으면 전체
  let emps = data.employees.filter((e) => e.dataYear === weekYear && e.dataMonth === weekMonth);
  if (emps.length === 0) emps = data.employees;

  // 이름+팀 기준 중복 제거
  const seen = new Set<string>();
  const unique = emps.filter((e) => {
    const key = `${e.name}__${e.team}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const total  = unique.length;
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

  // Group zones by floor
  const floorGroups = useMemo(() => {
    const groups: { label: string; zones: string[] }[] = [];
    const floor1: string[] = [];
    const floor3: string[] = [];
    const other: string[] = [];

    for (const zone of schedule.zones) {
      if (zone.startsWith("1층")) floor1.push(zone);
      else if (zone.startsWith("3층")) floor3.push(zone);
      else other.push(zone);
    }

    if (floor1.length > 0) groups.push({ label: "1층", zones: floor1 });
    if (floor3.length > 0) groups.push({ label: "3층", zones: floor3 });
    if (other.length > 0) groups.push({ label: "기타", zones: other });
    if (groups.length === 0) groups.push({ label: "", zones: schedule.zones });

    return groups;
  }, [schedule.zones]);

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
          {floorGroups.map((group) => (
              <React.Fragment key={`floor-${group.label}`}>
                {group.label && (
                  <tr key={`group-${group.label}`} className="bg-gray-50/70">
                    <td colSpan={8} className="py-2 px-4">
                      <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1.5">
                        <span className="w-1 h-3 rounded-full inline-block" style={{ background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" }} />
                        {group.label}
                      </span>
                    </td>
                  </tr>
                )}
                {group.zones.map((zone, zi) => (
                  <tr key={zone} className={`border-b border-gray-50 last:border-0 ${zi % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}>
                    <td className="py-3 px-4 font-semibold text-gray-700 text-xs whitespace-nowrap">
                      {group.label ? zone.replace(/^[13]층\s*/, "") : zone}
                    </td>
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
  const jsonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadScheduleFS().then((data) => {
      setSchedule(data);
      setLoadingFetch(false);
    });
  }, []);

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // Validate and normalize JSON structure
      if (!json.weekStart || !json.zones || !json.schedule) {
        toast.error("JSON 형식이 올바르지 않습니다. weekStart, zones, schedule 필드가 필요합니다.");
        return;
      }

      const data: ScheduleData = {
        weekStart: json.weekStart,
        zones: json.zones,
        schedule: json.schedule,
        uploadedAt: new Date().toISOString(),
      };

      await saveScheduleFS(data);
      setSchedule(data);
      toast.success("작업 일정(JSON)이 저장되었습니다.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "JSON 파일을 읽는 중 오류가 발생했습니다.");
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
            <button
              onClick={() => jsonRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <FileJson className="h-3.5 w-3.5" /> JSON 업로드
            </button>
            <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
          </div>
        )}
      </div>

      {/* 컨텐츠 */}
      {loadingFetch ? (
        <div className="flex items-center justify-center py-10 gap-2 text-gray-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : !schedule ? (
        <div className="py-10 text-center">
          <CalendarDays className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {isAdmin ? "작업 일정 이미지 또는 JSON 파일을 업로드하면 자동으로 표시됩니다." : "등록된 작업 일정이 없습니다."}
          </p>
          {isAdmin && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl text-left max-w-md mx-auto">
              <p className="text-xs font-semibold text-gray-500 mb-2">📋 JSON 형식 예시:</p>
              <pre className="text-[10px] text-gray-400 overflow-x-auto whitespace-pre">{`{
  "weekStart": "2026-04-13",
  "zones": ["1층 A구역", "1층 B구역", "3층 A구역", "3층 B구역"],
  "schedule": {
    "2026-04-13": {
      "1층 A구역": "주간",
      "3층 A구역": "야간"
    }
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
  const managerStats = useMemo(() => calcManagerStats(data, selectedDate), [data, selectedDate]);

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
            stats={techStats as unknown as AnyStats}
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
