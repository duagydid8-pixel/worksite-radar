import { useState, useRef } from "react";
import { GripVertical } from "lucide-react";
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
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES[date.getDay()]})`;
}

function applyOrder(emps: Employee[], order: string[]): Employee[] {
  if (!order.length) return emps;
  const map = new Map(emps.map((e) => [e.name, e]));
  const result: Employee[] = [];
  for (const name of order) {
    const e = map.get(name);
    if (e) result.push(e);
  }
  // append any employees not in saved order
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

  // group by team
  const raw: Record<string, Employee[]> = {};
  for (const emp of employees) {
    if (!raw[emp.team]) raw[emp.team] = [];
    raw[emp.team].push(emp);
  }

  // apply saved order per team
  const [localOrders, setLocalOrders] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const team of ["한성_F", "태화_F"] as const) {
      const ctx = `attendance_${team}`;
      init[ctx] = rowOrders[ctx] || [];
    }
    return init;
  });

  const dragRef = useRef<{ team: string; idx: number } | null>(null);

  const handleDragStart = (team: string, idx: number) => {
    dragRef.current = { team, idx };
  };

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
    const isWeekend = dayIndex >= 6;
    const key = `${year}-${month}-${day}`;
    const leaveKey = `${year}|${month}|${day}`;

    const cellDate = new Date(date);
    cellDate.setHours(0, 0, 0, 0);
    const isFuture = cellDate > today;
    const isToday = cellDate.getTime() === today.getTime();

    if (isFuture) return <td key={dayIndex} className="px-2 py-1.5 text-center" />;

    const record = emp.dailyRecords[key];
    const hasLeave = annualLeaveMap[emp.name]?.[leaveKey];

    if (isWeekend) {
      if (record && (record.punchIn || record.punchOut)) {
        return (
          <td key={dayIndex} className="px-2 py-1.5 text-center">
            <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
              <span className="text-emerald-600">{record.punchIn || ""}</span>
              <span className="text-emerald-500/70">{record.punchOut || ""}</span>
            </div>
          </td>
        );
      }
      return <td key={dayIndex} className="px-2 py-1.5 text-center" />;
    }

    if (hasLeave && (!record || !record.punchIn)) {
      return (
        <td key={dayIndex} className="px-2 py-1.5 text-center">
          <span
            className="inline-block text-[10px] font-bold rounded px-1.5 py-0.5"
            style={{ background: "#e6f1fb", color: "#185fa5" }}
          >
            연차
          </span>
        </td>
      );
    }

    if (!record || (!record.punchIn && !record.punchOut)) {
      if (isToday) return <td key={dayIndex} className="px-2 py-1.5 text-center" />;
      return (
        <td key={dayIndex} className="px-2 py-1.5 text-center">
          <span
            className="inline-block text-[10px] font-bold rounded px-1.5 py-0.5"
            style={{ background: "#fcebeb", color: "#a32d2d" }}
          >
            결근
          </span>
        </td>
      );
    }

    const pIn = record.punchIn;
    const pOut = record.punchOut;
    const late = pIn ? isLate(pIn) : false;

    return (
      <td key={dayIndex} className="px-2 py-1.5 text-center">
        <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
          {late ? (
            <span
              className="inline-block rounded px-1 py-px font-bold"
              style={{ background: "#faeeda", color: "#854f0b" }}
            >
              ⏰ {pIn}
            </span>
          ) : (
            <span className="text-blue-500">{pIn || ""}</span>
          )}
          {pOut ? (
            <span className="text-slate-400">{pOut}</span>
          ) : emp.team === "태화_F" && !isToday ? (
            <span className="font-semibold" style={{ color: "#854f0b" }}>↑미기록</span>
          ) : null}
        </div>
      </td>
    );
  };

  const renderAnomalyBadges = (emp: Employee) => {
    const today2 = new Date();
    today2.setHours(0, 0, 0, 0);
    let lateCount = 0;
    let uncheckCount = 0;
    let leaveCount = 0;
    let absentCount = 0;

    weekDates.forEach((wd, i) => {
      if (i >= 6) return;
      const cellDate = new Date(wd);
      cellDate.setHours(0, 0, 0, 0);
      if (cellDate > today2) return;
      const dow = wd.getDay();
      if (dow === 0 || dow === 6) return;

      const leaveKey = `${wd.getFullYear()}|${wd.getMonth() + 1}|${wd.getDate()}`;
      if (annualLeaveMap[emp.name]?.[leaveKey]) { leaveCount++; return; }

      const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
      const rec = emp.dailyRecords[key];

      if (!rec || (!rec.punchIn && !rec.punchOut)) {
        const isToday2 = cellDate.getTime() === today2.getTime();
        if (!isToday2) absentCount++;
        return;
      }

      if (rec?.punchIn && isLate(rec.punchIn)) lateCount++;
      const isToday = cellDate.getTime() === today2.getTime();
      if (!isToday && rec?.punchIn && !rec.punchOut && emp.team !== "한성_F") uncheckCount++;
    });

    if (lateCount === 0 && uncheckCount === 0 && leaveCount === 0 && absentCount === 0) {
      return <span className="text-muted-foreground text-[10px]">이상없음</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {absentCount > 0 && (
          <span
            className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "#fcebeb", color: "#a32d2d" }}
          >
            결근 {absentCount}
          </span>
        )}
        {lateCount > 0 && (
          <span
            className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "#faeeda", color: "#854f0b" }}
          >
            지각 {lateCount}
          </span>
        )}
        {uncheckCount > 0 && (
          <span
            className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "#fde8e8", color: "#991b1b" }}
          >
            미타각 {uncheckCount}
          </span>
        )}
        {leaveCount > 0 && (
          <span
            className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "#e8f4fd", color: "#1e40af" }}
          >
            연차 {leaveCount}
          </span>
        )}
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
    "한성_F": {
      bar: "bg-primary",
      label: "한성크린텍 — 관리자 (F)",
      textColor: "text-primary",
    },
    "태화_F": {
      bar: "bg-secondary",
      label: "태화 (협력사) — 관리자 (F)",
      textColor: "text-secondary",
    },
  };

  return (
    <div className="space-y-4">
      {teamOrder.map((team) => {
        const ctx = `attendance_${team}`;
        const emps = applyOrder(raw[team] || [], localOrders[ctx]);
        if (!emps.length) return null;
        const meta = teamMeta[team];

        // 직종 → 등급(한성만) → 이름 순 정렬
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
          <div key={team} className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
            {/* team header */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 border-b border-border">
              <div className={`w-1 h-5 rounded-full ${meta.bar}`} />
              <span className={`text-xs font-bold ${meta.textColor}`}>{meta.label}</span>
              <span className="text-[10px] text-muted-foreground ml-1">— {emps.length}명</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground font-semibold border-b border-border">
                    <th className="w-6 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">NO</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">이름</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">직종</th>
                    {weekDates.map((d, i) => {
                      const dayIdx = d.getDay();
                      const colorCls =
                        dayIdx === 0
                          ? "text-red-500"
                          : dayIdx === 6
                          ? "text-emerald-600"
                          : "text-slate-500";
                      return (
                        <th key={i} className={`px-2 py-1.5 text-center whitespace-nowrap ${colorCls}`}>
                          {formatDateHeader(d)}
                        </th>
                      );
                    })}
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">이상사항(이번주)</th>
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
                          <tr key={`group-${curGroup}-${idx}`} className="bg-muted/50 border-b border-border/60">
                            <td colSpan={colSpan} className="px-3 py-1 text-[10px] font-bold text-muted-foreground tracking-wide">
                              {curGroup || "직종 미지정"}
                            </td>
                          </tr>
                        )}
                        <tr
                          key={emp.name}
                          draggable
                          onDragStart={() => handleDragStart(team, idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDrop(team, idx)}
                          className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-default"
                        >
                          <td className="px-1 py-1.5 text-center">
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab mx-auto" />
                          </td>
                          <td className="px-2 py-1.5 text-center text-muted-foreground text-[10px]">{idx + 1}</td>
                          <td className="px-2 py-1.5 text-center font-bold text-xs whitespace-nowrap">{emp.name}</td>
                          <td className="px-2 py-1.5 text-center text-muted-foreground text-[10px]">{emp.jobTitle}</td>
                          {weekDates.map((d, i) => renderCell(emp, d, i))}
                          <td className="px-2 py-1.5 text-left">{renderAnomalyBadges(emp)}</td>
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
        <div className="py-16 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-sm text-muted-foreground">해당 월 데이터가 없습니다</p>
        </div>
      )}
    </div>
  );
}
