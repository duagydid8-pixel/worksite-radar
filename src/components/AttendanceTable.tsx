import type { Employee, AnomalyRecord } from "@/lib/parseExcel";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

interface AttendanceTableProps {
  employees: Employee[];
  anomalyMap: Map<string, AnomalyRecord>;
  annualLeaveMap: Record<string, Record<string, boolean>>;
  weekDates: Date[];
  dataYear: number;
  dataMonth: number;
}

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

function formatDateHeader(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES[date.getDay()]})`;
}

function calcWeeklyLate(emp: Employee, weekDates: Date[], annualLeaveMap: Record<string, Record<string, boolean>>): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let count = 0;

  weekDates.forEach((wd, i) => {
    if (i >= 6) return; // Mon–Sat only (exclude Sunday)
    const cellDate = new Date(wd);
    cellDate.setHours(0, 0, 0, 0);
    if (cellDate > today) return;

    const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
    const leaveKey = `${wd.getFullYear()}|${wd.getMonth() + 1}|${wd.getDate()}`;
    
    // Skip 연차 days
    if (annualLeaveMap[emp.name]?.[leaveKey]) return;

    const rec = emp.dailyRecords[key];
    if (rec?.punchIn && isLate(rec.punchIn)) count++;
  });

  return count;
}

export default function AttendanceTable({
  employees,
  anomalyMap,
  annualLeaveMap,
  weekDates,
  dataYear,
  dataMonth,
}: AttendanceTableProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const renderCell = (emp: Employee, date: Date, dayIndex: number) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const isWeekend = dayIndex >= 6; // Sunday only
    const key = `${year}-${month}-${day}`;
    const leaveKey = `${year}|${month}|${day}`;

    const cellDate = new Date(date);
    cellDate.setHours(0, 0, 0, 0);
    const isFuture = cellDate > today;
    const isToday = cellDate.getTime() === today.getTime();

    if (isFuture) return <td key={dayIndex} className="px-2 py-1.5 text-center"></td>;

    const record = emp.dailyRecords[key];
    const hasLeave = annualLeaveMap[emp.name]?.[leaveKey];

    // Weekend
    if (isWeekend) {
      if (record && (record.punchIn || record.punchOut)) {
        return (
          <td key={dayIndex} className="px-2 py-1.5 text-center">
            <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
              <span className="text-green-400">{record.punchIn || ""}</span>
              <span className="text-green-300">{record.punchOut || ""}</span>
            </div>
          </td>
        );
      }
      return <td key={dayIndex} className="px-2 py-1.5 text-center"></td>;
    }

    // 연차 check
    if (hasLeave && (!record || !record.punchIn)) {
      return (
        <td key={dayIndex} className="px-2 py-1.5 text-center">
          <span className="inline-block text-[10px] font-bold text-green-400 bg-green-400/10 border border-green-400/25 rounded px-1.5 py-0.5">
            연차
          </span>
        </td>
      );
    }

    // No record
    if (!record || (!record.punchIn && !record.punchOut)) {
      // Today with no record → blank
      if (isToday) return <td key={dayIndex} className="px-2 py-1.5 text-center"></td>;
      
      // 한성_F → blank
      if (emp.team === "한성_F") return <td key={dayIndex} className="px-2 py-1.5 text-center"></td>;
      
      // 태화_F past weekday → 미출근
      return (
        <td key={dayIndex} className="px-2 py-1.5 text-center">
          <span className="inline-block text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/25 rounded px-1.5 py-0.5">
            미출근
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
            <span className="inline-block bg-warning/15 border border-warning/30 rounded px-1 py-px">
              <span className="text-warning font-bold">⏰ {pIn}</span>
            </span>
          ) : (
            <span className="text-blue-300">{pIn || ""}</span>
          )}
          {pOut ? (
            <span className="text-blue-200/70">{pOut}</span>
          ) : emp.team === "태화_F" ? (
            <span className="text-warning font-semibold">↑미기록</span>
          ) : null}
        </div>
      </td>
    );
  };

  const renderAnomalyBadges = (emp: Employee) => {
    const lateCount = calcWeeklyLate(emp, weekDates, annualLeaveMap);
    const badges: { label: string; value: number; cls: string }[] = [];

    if (lateCount > 0) badges.push({ label: "지각", value: lateCount, cls: "bg-yellow-400/10 text-yellow-400 border-yellow-400/25" });

    if (badges.length === 0) {
      return <span className="text-muted-foreground text-[10px]">이상없음</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {badges.map((b) => (
          <span key={b.label} className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${b.cls}`}>
            {b.label} {b.value}
          </span>
        ))}
      </div>
    );
  };

  const teamOrder: ("한성_F" | "태화_F")[] = ["한성_F", "태화_F"];
  const teamMeta: Record<string, { cls: string; label: string; icon: string }> = {
    "한성_F": { cls: "bg-primary/10 border-primary/25 text-primary", label: "한성크린텍 — 관리자 (F)", icon: "🔷" },
    "태화_F": { cls: "bg-secondary/10 border-secondary/20 text-secondary", label: "태화 (협력사) — 관리자 (F)", icon: "🔶" },
  };

  const groups: Record<string, Employee[]> = {};
  for (const emp of employees) {
    if (!groups[emp.team]) groups[emp.team] = [];
    groups[emp.team].push(emp);
  }

  return (
    <div className="space-y-4">
      {teamOrder.map((team) => {
        const emps = groups[team];
        if (!emps || emps.length === 0) return null;
        const meta = teamMeta[team];

        return (
          <div key={team}>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border text-xs font-bold ${meta.cls}`}>
              <div className={`w-2 h-2 rounded-full ${team === "한성_F" ? "bg-primary" : "bg-secondary"}`} />
              {meta.icon} {meta.label} — {emps.length}명
            </div>
            <div className="border border-t-0 border-border rounded-b-lg overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-muted text-muted-foreground font-semibold">
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">NO</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">이름</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">직종</th>
                    {weekDates.map((d, i) => {
                      const dayIdx = d.getDay();
                      const colorCls = dayIdx === 0 ? "text-destructive" : dayIdx === 6 ? "text-green-400" : "text-blue-300";
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
                  {emps.map((emp, idx) => (
                    <tr key={`${emp.name}-${idx}`} className="border-b border-border/40 hover:bg-primary/[0.03]">
                      <td className="px-2 py-1.5 text-center text-muted-foreground text-[10px]">{idx + 1}</td>
                      <td className="px-2 py-1.5 text-center font-bold text-xs whitespace-nowrap">{emp.name}</td>
                      <td className="px-2 py-1.5 text-center text-muted-foreground text-[10px]">{emp.jobTitle}</td>
                      {weekDates.map((d, i) => renderCell(emp, d, i))}
                      <td className="px-2 py-1.5 text-left">{renderAnomalyBadges(emp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {employees.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">해당 월 데이터가 없습니다</h2>
          <p className="text-xs text-muted-foreground">날짜 범위를 확인해주세요</p>
        </div>
      )}
    </div>
  );
}
