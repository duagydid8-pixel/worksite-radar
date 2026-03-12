import type { Employee, AnomalyRecord } from "@/lib/parseExcel";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

interface AttendanceTableProps {
  employees: Employee[];
  anomalyMap: Map<string, AnomalyRecord>;
  weekDates: Date[];
  dataYear: number;
  dataMonth: number;
}

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 7 || (h === 7 && m > 10);
}

function formatDateHeader(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES[date.getDay()]})`;
}

export default function AttendanceTable({
  employees,
  anomalyMap,
  weekDates,
  dataYear,
  dataMonth,
}: AttendanceTableProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const renderCell = (emp: Employee, date: Date) => {
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat

    // Only show data if the date's month matches the data month
    if (month !== dataMonth) return <span></span>;

    const record = emp.dailyRecords[dayOfMonth];
    const cellDate = new Date(date);
    cellDate.setHours(0, 0, 0, 0);

    const isFuture = cellDate > today;
    const isToday = cellDate.getTime() === today.getTime();
    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;

    if (isFuture) return <span></span>;

    if (!record || (!record.punchIn && !record.punchOut)) {
      if (isToday) return <span></span>;
      if (isSunday || isSaturday) return <span></span>;
      // Past weekday with no record
      return <span className="text-destructive text-xs font-medium">미출근</span>;
    }

    const pIn = record.punchIn;
    const pOut = record.punchOut;

    if (pIn && !pOut) {
      return (
        <div className="text-xs leading-tight">
          <span className={isLate(pIn) ? "text-warning font-semibold" : ""}>{pIn}</span>
          <span className="text-destructive ml-0.5">↑미기록</span>
        </div>
      );
    }

    return (
      <div className="text-xs leading-tight whitespace-nowrap">
        <span className={pIn && isLate(pIn) ? "text-warning font-semibold" : ""}>{pIn || ""}</span>
        {pIn && pOut && <span className="text-muted-foreground"> / </span>}
        <span>{pOut || ""}</span>
      </div>
    );
  };

  const renderAnomalyBadges = (emp: Employee) => {
    const a = anomalyMap.get(emp.name);
    if (!a) return null;
    const badges: { label: string; value: number; color: string }[] = [];
    if (a.미타각 > 0) badges.push({ label: "미타각", value: a.미타각, color: "bg-warning/20 text-warning" });
    if (a.지각 > 0) badges.push({ label: "지각", value: a.지각, color: "bg-warning/20 text-warning" });
    if (a.결근 > 0) badges.push({ label: "결근", value: a.결근, color: "bg-destructive/20 text-destructive" });
    if (a.연차 > 0) badges.push({ label: "연차", value: a.연차, color: "bg-primary/20 text-primary" });
    if (badges.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1">
        {badges.map((b) => (
          <span key={b.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${b.color}`}>
            {b.label} {b.value}
          </span>
        ))}
      </div>
    );
  };

  let counter = 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-card text-muted-foreground text-xs">
            <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left w-10">NO</th>
            <th className="sticky left-[40px] bg-card z-10 px-3 py-2 text-left min-w-[80px]">이름</th>
            <th className="sticky left-[120px] bg-card z-10 px-3 py-2 text-left min-w-[60px]">직종</th>
            {weekDates.map((d, i) => (
              <th key={i} className="px-3 py-2 text-center min-w-[90px] whitespace-nowrap">
                {formatDateHeader(d)}
              </th>
            ))}
            <th className="px-3 py-2 text-center min-w-[60px]">출역일수</th>
            <th className="px-3 py-2 text-left min-w-[120px]">이상사항</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, idx) => {
            counter++;
            const isHanseong = emp.team === "한성_F";
            const borderColor = isHanseong ? "border-l-hanseong" : "border-l-taehwa";
            const showTeamHeader =
              idx === 0 || employees[idx - 1].team !== emp.team;

            return (
              <>
                {showTeamHeader && (
                  <tr key={`header-${emp.team}`} className="bg-muted/30">
                    <td
                      colSpan={10 + weekDates.length}
                      className={`px-3 py-1.5 text-xs font-bold border-l-4 ${borderColor} ${
                        isHanseong ? "text-hanseong" : "text-taehwa"
                      }`}
                    >
                      {emp.team}
                    </td>
                  </tr>
                )}
                <tr
                  key={`${emp.name}-${idx}`}
                  className={`border-b border-border/50 hover:bg-card/50 border-l-4 ${borderColor}`}
                >
                  <td className="sticky left-0 bg-background z-10 px-3 py-2 text-muted-foreground tabular-nums">
                    {counter}
                  </td>
                  <td className="sticky left-[40px] bg-background z-10 px-3 py-2 font-medium text-foreground">
                    {emp.name}
                  </td>
                  <td className="sticky left-[120px] bg-background z-10 px-3 py-2 text-muted-foreground">
                    {emp.jobTitle}
                  </td>
                  {weekDates.map((d, i) => (
                    <td key={i} className="px-3 py-2 text-center">
                      {renderCell(emp, d)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center tabular-nums font-medium">{emp.totalDays}</td>
                  <td className="px-3 py-2">{renderAnomalyBadges(emp)}</td>
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
      {employees.length === 0 && (
        <div className="py-16 text-center text-muted-foreground text-sm">데이터가 없습니다</div>
      )}
    </div>
  );
}
