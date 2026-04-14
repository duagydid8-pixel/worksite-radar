import { useState, useRef } from "react";
import { GripVertical, Users } from "lucide-react";
import type { Employee, AnomalyRecord } from "@/lib/parseExcel";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

interface AttendanceTableProps {
  employees: Employee[];
  anomalyMap: Map<string, AnomalyRecord>;
  annualLeaveMap: Record<string, Record<string, boolean>>;
  weekDates: Date[];
  dataYear: number;
  dataMonth: number;
  rowOrders: Record<string, string[]>;
  onOrderChange: (context: string, names: string[]) => void;
}

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

function formatDateHeader(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function applyOrder(emps: Employee[], order: string[]): Employee[] {
  if (!order.length) return emps;
  const map = new Map(emps.map((e) => [e.name, e]));
  const result: Employee[] = [];
  for (const name of order) {
    const e = map.get(name);
    if (e) result.push(e);
  }
  for (const e of emps) {
    if (!order.includes(e.name)) result.push(e);
  }
  return result;
}

export default function AttendanceTable({
  employees,
  anomalyMap,
  annualLeaveMap,
  weekDates,
  dataYear,
  dataMonth,
  rowOrders,
  onOrderChange,
}: AttendanceTableProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const raw: Record<string, Employee[]> = {};
  for (const emp of employees) {
    if (!raw[emp.team]) raw[emp.team] = [];
    raw[emp.team].push(emp);
  }

  const [localOrders, setLocalOrders] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const team of ["한성_F", "태화_F"] as const) {
      const ctx = `attendance_${team}`;
      init[ctx] = rowOrders[ctx] || [];
    }
    return init;
  });

  const dragRef = useRef<{ team: string; idx: number } | null>(null);

  const handleDragStart = (team: string, idx: number) => { dragRef.current = { team, idx }; };
  const handleDrop = (team: string, targetIdx: number) => {
    if (!dragRef.current || dragRef.current.team !== team) return;
    const srcIdx = dragRef.current.idx;
    if (srcIdx === targetIdx) return;
    const ctx = `attendance_${team}`;
    const orderedEmps = applyOrder(raw[team] || [], localOrders[ctx]);
    const names = orderedEmps.map((e) => e.name);
    const [moved] = names.splice(srcIdx, 1);
    names.splice(targetIdx, 0, moved);
    setLocalOrders((prev) => ({ ...prev, [ctx]: names }));
    onOrderChange(ctx, names);
    dragRef.current = null;
  };

  const renderCell = (emp: Employee, date: Date, dayIndex: number) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isSun = dow === 0;
    const isSat = dow === 6;
    const key = `${year}-${month}-${day}`;
    const leaveKey = `${year}|${month}|${day}`;

    const cellDate = new Date(date);
    cellDate.setHours(0, 0, 0, 0);
    const isFuture = cellDate > today;
    const isToday = cellDate.getTime() === today.getTime();

    const weekendBg = isSun ? "bg-red-50/60" : isSat ? "bg-sky-50/40" : "";
    const todayBg = isToday ? "bg-primary/5" : "";
    const baseTd = `px-1 py-2 text-center ${weekendBg || todayBg}`;

    if (isFuture) return <td key={dayIndex} className={baseTd} />;

    const isAfterResign = emp.name === "윤기순" && (year > 2026 || (year === 2026 && month > 3) || (year === 2026 && month === 3 && day >= 27));
    const isBeforeHire  = emp.name === "이형우" && (year < 2026 || (year === 2026 && month < 3) || (year === 2026 && month === 3 && day < 26));
    const isHireDay     = emp.name === "이형우" && year === 2026 && month === 3 && day === 26;

    if (isBeforeHire) return <td key={dayIndex} className={baseTd} />;
    if (isHireDay) return (
      <td key={dayIndex} className={baseTd}>
        <span className="inline-block text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-emerald-100 text-emerald-700">입사</span>
      </td>
    );
    if (isAfterResign) {
      if (!isWeekend && year === 2026 && month === 3) return (
        <td key={dayIndex} className={baseTd}>
          <span className="inline-block text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-500">퇴사</span>
        </td>
      );
      return <td key={dayIndex} className={baseTd} />;
    }

    const record = emp.dailyRecords[key];
    const hasLeave = annualLeaveMap[emp.name]?.[leaveKey];

    if (isWeekend) {
      if (record && (record.punchIn || record.punchOut)) {
        return (
          <td key={dayIndex} className={baseTd}>
            <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
              <span className="text-emerald-600 font-medium">{record.punchIn || ""}</span>
              <span className="text-emerald-400">{record.punchOut || ""}</span>
            </div>
          </td>
        );
      }
      return <td key={dayIndex} className={baseTd} />;
    }

    if (hasLeave && (!record || !record.punchIn)) {
      return (
        <td key={dayIndex} className={baseTd}>
          <span className="inline-block text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700">연차</span>
        </td>
      );
    }

    if (!record || (!record.punchIn && !record.punchOut)) {
      if (isToday || isWeekend) return <td key={dayIndex} className={baseTd} />;
      return (
        <td key={dayIndex} className={baseTd}>
          <span className="inline-block text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-rose-100 text-rose-700">결근</span>
        </td>
      );
    }

    const pIn = record.punchIn;
    const pOut = record.punchOut;
    const late = pIn ? isLate(pIn) : false;

    return (
      <td key={dayIndex} className={baseTd}>
        <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
          {late ? (
            <span className="inline-block rounded-full px-1.5 py-px font-bold bg-amber-100 text-amber-800">
              ⏰ {pIn}
            </span>
          ) : (
            <span className="text-blue-600 font-medium">{pIn || ""}</span>
          )}
          {pOut ? (
            <span className="text-slate-400">{pOut}</span>
          ) : emp.team === "태화_F" && !isToday ? (
            <span className="font-bold text-orange-500">미타각</span>
          ) : null}
        </div>
      </td>
    );
  };

  const renderAnomalyBadges = (emp: Employee) => {
    const today2 = new Date();
    today2.setHours(0, 0, 0, 0);
    let lateCount = 0, uncheckCount = 0, leaveCount = 0, absentCount = 0;

    weekDates.forEach((wd) => {
      const dow = wd.getDay();
      if (dow === 0 || dow === 6) return;
      const cellDate = new Date(wd);
      cellDate.setHours(0, 0, 0, 0);
      if (cellDate > today2) return;

      const wy = wd.getFullYear(), wm = wd.getMonth() + 1, wd2 = wd.getDate();
      if (emp.name === "윤기순" && (wy > 2026 || (wy === 2026 && wm > 3) || (wy === 2026 && wm === 3 && wd2 >= 27))) return;
      if (emp.name === "이형우" && (wy < 2026 || (wy === 2026 && wm < 3) || (wy === 2026 && wm === 3 && wd2 < 26))) return;

      const leaveKey = `${wd.getFullYear()}|${wd.getMonth() + 1}|${wd.getDate()}`;
      if (annualLeaveMap[emp.name]?.[leaveKey]) { leaveCount++; return; }

      const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
      const rec = emp.dailyRecords[key];

      if (!rec || (!rec.punchIn && !rec.punchOut)) {
        const isToday2 = cellDate.getTime() === today2.getTime();
        if (!isToday2 && emp.name !== "이형우") absentCount++;
        return;
      }
      if (rec?.punchIn && isLate(rec.punchIn) && emp.name !== "이형우") lateCount++;
      const isToday = cellDate.getTime() === today2.getTime();
      if (!isToday && rec?.punchIn && !rec.punchOut && emp.team !== "한성_F") uncheckCount++;
    });

    if (lateCount === 0 && uncheckCount === 0 && leaveCount === 0 && absentCount === 0) {
      return <span className="text-[10px] text-emerald-600 font-medium">정상</span>;
    }

    return (
      <div className="flex flex-wrap gap-1 justify-center">
        {absentCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">결근 {absentCount}</span>}
        {lateCount   > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">지각 {lateCount}</span>}
        {uncheckCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">미타각 {uncheckCount}</span>}
        {leaveCount  > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">연차 {leaveCount}</span>}
      </div>
    );
  };

  const JOB_ORDER = ["소장", "공사", "안전", "품질", "공무", "설계", "차량"];
  const RANK_ORDER = ["수석", "책임", "선임"];

  function normalizeJobTitle(title: string): string {
    return (title || "").replace("관리자", "").replace("운행", "").trim();
  }
  function jobSortIndex(title: string): number {
    const normalized = normalizeJobTitle(title);
    const idx = JOB_ORDER.findIndex((j) => normalized === j || normalized.includes(j));
    return idx === -1 ? JOB_ORDER.length : idx;
  }

  const teamOrder: ("한성_F" | "태화_F")[] = ["한성_F", "태화_F"];
  const teamMeta = {
    "한성_F": { gradient: "from-primary/10 to-primary/5", accent: "bg-primary", label: "한성크린텍", sub: "관리자 (F)", textColor: "text-primary" },
    "태화_F": { gradient: "from-secondary/10 to-secondary/5", accent: "bg-secondary", label: "태화 (협력사)", sub: "관리자 (F)", textColor: "text-secondary" },
  };

  return (
    <div className="space-y-4">
      {teamOrder.map((team) => {
        const ctx = `attendance_${team}`;
        const emps = applyOrder(raw[team] || [], localOrders[ctx]);
        if (!emps.length) return null;
        const meta = teamMeta[team];

        const sortedEmps = [...emps].sort((a, b) => {
          const jobDiff = jobSortIndex(a.jobTitle) - jobSortIndex(b.jobTitle);
          if (jobDiff !== 0) return jobDiff;
          const rankA = RANK_ORDER.indexOf(a.rank);
          const rankB = RANK_ORDER.indexOf(b.rank);
          const rankDiff = (rankA === -1 ? RANK_ORDER.length : rankA) - (rankB === -1 ? RANK_ORDER.length : rankB);
          if (rankDiff !== 0) return rankDiff;
          return a.name.localeCompare(b.name, "ko");
        });

        const colSpan = 4 + weekDates.length + 1;

        return (
          <div key={team} className="rounded-2xl border border-border overflow-hidden bg-white shadow-sm">
            {/* 팀 헤더 */}
            <div className={`flex items-center gap-3 px-5 py-3 bg-gradient-to-r ${meta.gradient} border-b border-border`}>
              <div className={`w-1.5 h-7 rounded-full ${meta.accent}`} />
              <div>
                <p className={`text-sm font-bold ${meta.textColor}`}>{meta.label}</p>
                <p className="text-[11px] text-muted-foreground">{meta.sub}</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5 bg-white/70 border border-border/60 rounded-lg px-3 py-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-bold text-foreground">{emps.length}명</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-muted border-b-2 border-border text-foreground font-semibold">
                    <th className="w-6 px-2 py-2.5" />
                    <th className="px-2 py-2.5 text-center whitespace-nowrap text-muted-foreground">NO</th>
                    <th className="px-3 py-2.5 text-center whitespace-nowrap">이름</th>
                    <th className="px-2 py-2.5 text-center whitespace-nowrap text-muted-foreground">직종</th>
                    {weekDates.map((d, i) => {
                      const dow = d.getDay();
                      const isSun = dow === 0;
                      const isSat = dow === 6;
                      const cellDate = new Date(d); cellDate.setHours(0, 0, 0, 0);
                      const isToday = cellDate.getTime() === today.getTime();
                      const colorCls = isToday
                        ? "text-primary"
                        : isSun ? "text-rose-500"
                        : isSat ? "text-sky-500"
                        : "text-foreground";
                      const bgCls = isToday ? "bg-primary/10" : isSun ? "bg-red-50/60" : isSat ? "bg-sky-50/40" : "";
                      return (
                        <th key={i} className={`px-2 py-2.5 text-center whitespace-nowrap ${colorCls} ${bgCls}`}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{formatDateHeader(d)}</span>
                            <span className="text-[9px] font-normal opacity-70">{DAY_NAMES[dow]}</span>
                          </div>
                          {isToday && <div className="w-1 h-1 rounded-full bg-primary mx-auto mt-0.5" />}
                        </th>
                      );
                    })}
                    <th className="px-3 py-2.5 text-center whitespace-nowrap">이번주 현황</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEmps.map((emp, idx) => {
                    const curGroup = normalizeJobTitle(emp.jobTitle);
                    const prevGroup = idx > 0 ? normalizeJobTitle(sortedEmps[idx - 1].jobTitle) : null;
                    const isNewGroup = curGroup !== prevGroup;
                    return (
                      <>
                        {isNewGroup && (
                          <tr key={`group-${curGroup}-${idx}`}>
                            <td colSpan={colSpan} className="px-4 py-1.5 bg-slate-50 border-y border-border/60">
                              <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                                {curGroup || "직종 미지정"}
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr
                          key={emp.name}
                          draggable
                          onDragStart={() => handleDragStart(team, idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDrop(team, idx)}
                          className={`border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors cursor-default ${idx % 2 === 1 ? "bg-slate-50/40" : ""}`}
                        >
                          <td className="px-1 py-2 text-center">
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab mx-auto" />
                          </td>
                          <td className="px-2 py-2 text-center text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 text-center font-bold whitespace-nowrap">{emp.name}</td>
                          <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{emp.jobTitle}</td>
                          {weekDates.map((d, i) => renderCell(emp, d, i))}
                          <td className="px-2 py-2 text-center">{renderAnomalyBadges(emp)}</td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {employees.length === 0 && (
        <div className="py-20 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-sm text-muted-foreground">해당 월 데이터가 없습니다</p>
        </div>
      )}
    </div>
  );
}
