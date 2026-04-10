import { useMemo, useState } from "react";
import { ParsedData } from "@/lib/parseExcel";

interface HomePageProps {
  data: ParsedData | null;
  lastUploadedAt: string | null;
  selectedDate: string;
}

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function calcStats(data: ParsedData | null) {
  if (!data) return { total: 0, present: 0, absent: 0, leave: 0 };
  const total = data.employees.length;
  const absentSet = new Set(data.anomalies.filter((a) => a.결근 > 0).map((a) => a.name));
  const leaveSet = new Set(data.anomalies.filter((a) => a.연차 > 0).map((a) => a.name));
  const absent = absentSet.size;
  const leave = leaveSet.size;
  return { total, present: Math.max(0, total - absent - leave), absent, leave };
}

function getEmployeeStatus(name: string, anomalies: ParsedData["anomalies"]) {
  const a = anomalies.find((x) => x.name === name);
  if (!a) return { label: "정상", color: "bg-green-100 text-green-700" };
  if (a.결근 > 0) return { label: "결근", color: "bg-red-100 text-red-600" };
  if (a.연차 > 0) return { label: "연차", color: "bg-gray-100 text-gray-500" };
  if (a.지각 > 0) return { label: "지각", color: "bg-blue-100 text-blue-600" };
  return { label: "정상", color: "bg-green-100 text-green-700" };
}

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

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors font-bold text-base leading-none">‹</button>
        <span className="text-sm font-bold text-gray-700">{viewYear}년 {viewMonth + 1}월</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors font-bold text-base leading-none">›</button>
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

export default function HomePage({ data, lastUploadedAt, selectedDate }: HomePageProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${DAY_KO[today.getDay()]})`;

  const stats = useMemo(() => calcStats(data), [data]);

  const recentRows = useMemo(() => {
    if (!data) return [];
    return data.employees.slice(0, 10).map((emp) => {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const key = `${m}/${d}`;
      const rec = emp.dailyRecords?.[key];
      const status = getEmployeeStatus(emp.name, data.anomalies);
      return { name: emp.name, team: emp.team, rank: emp.rank, punchIn: rec?.punchIn ?? null, punchOut: rec?.punchOut ?? null, status };
    });
  }, [data, selectedDate]);

  const STAT_CARDS = [
    { label: "총 인원수",  value: data ? stats.total   : null, icon: "👷", bg: "bg-blue-50",   sub: "업로드 기준" },
    { label: "정상 출근",  value: data ? stats.present : null, icon: "✅", bg: "bg-green-50",  sub: "결근·연차 제외" },
    { label: "결근자",    value: data ? stats.absent  : null, icon: "❌", bg: "bg-red-50",    sub: stats.absent > 0 ? "주의 필요" : "" },
    { label: "연차자",    value: data ? stats.leave   : null, icon: "🌿", bg: "bg-purple-50", sub: "이번 기간 기준" },
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

      {/* 통계 카드 + 미니 달력 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 items-start">
        <div className="grid grid-cols-2 gap-4">
          {STAT_CARDS.map((card) => (
            <div key={card.label} className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
              <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center text-lg mb-3`}>
                {card.icon}
              </div>
              <div className="text-3xl font-bold text-gray-800 mb-0.5">
                {card.value !== null ? card.value : "—"}
              </div>
              <div className="text-xs text-gray-400 font-medium">{card.label}</div>
              {card.sub && <div className="text-[11px] text-gray-300 mt-1">{card.sub}</div>}
            </div>
          ))}
        </div>

        <MiniCalendar selectedDate={selectedDate} />
      </div>

      {/* 최근 근태 테이블 */}
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-4">최근 근태 현황</h3>
        {!data ? (
          <p className="text-sm text-gray-400 py-8 text-center">업로드된 데이터가 없습니다.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {["이름", "팀", "직급", "출근", "퇴근", "상태"].map((h) => (
                  <th key={h} className="text-left text-gray-400 font-semibold pb-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRows.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 px-2 font-medium text-gray-700">{row.name}</td>
                  <td className="py-2.5 px-2 text-gray-500">{row.team}</td>
                  <td className="py-2.5 px-2 text-gray-500">{row.rank}</td>
                  <td className="py-2.5 px-2 text-gray-500">{row.punchIn ?? "—"}</td>
                  <td className="py-2.5 px-2 text-gray-500">{row.punchOut ?? "—"}</td>
                  <td className="py-2.5 px-2">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${row.status.color}`}>
                      {row.status.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
