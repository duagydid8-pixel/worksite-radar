import { useState, useMemo } from "react";
import type { Employee } from "@/lib/parseExcel";

interface Props {
  employees: Employee[];
  annualLeaveMap: Record<string, Record<string, boolean>>;
}

const STORAGE_KEY = "worksite_hire_dates";

// 입사일 이후 지난 매월 1일 횟수 = 발생연차
function calcAccruedLeaves(hireDate: string): number {
  if (!hireDate) return 0;
  const hire = new Date(hireDate);
  hire.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 입사 다음달 1일부터 시작
  const start = new Date(hire.getFullYear(), hire.getMonth() + 1, 1);
  if (start > today) return 0;
  let count = 0;
  const d = new Date(start);
  while (d <= today) {
    count++;
    d.setMonth(d.getMonth() + 1);
  }
  return count;
}

function calcUsedLeaves(name: string, annualLeaveMap: Record<string, Record<string, boolean>>): number {
  const leaves = annualLeaveMap[name];
  if (!leaves) return 0;
  return Object.keys(leaves).length;
}

export default function AnnualLeavePanel({ employees, annualLeaveMap }: Props) {
  const [hireDates, setHireDates] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState("");

  const uniqueEmployees = useMemo(() => {
    const seen = new Set<string>();
    return employees.filter((emp) => {
      if (seen.has(emp.name)) return false;
      seen.add(emp.name);
      return true;
    });
  }, [employees]);

  function saveHireDate(name: string, date: string) {
    const updated = { ...hireDates, [name]: date };
    setHireDates(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setEditingName(null);
  }

  const leaveDetails = useMemo(() => {
    const details: { date: string; name: string; days: number }[] = [];
    for (const [name, dates] of Object.entries(annualLeaveMap)) {
      for (const key of Object.keys(dates)) {
        const [y, m, d] = key.split("|").map(Number);
        details.push({
          date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          name,
          days: 1,
        });
      }
    }
    return details.sort((a, b) => a.date.localeCompare(b.date));
  }, [annualLeaveMap]);

  const totalAccrued = uniqueEmployees.reduce(
    (sum, emp) => sum + calcAccruedLeaves(hireDates[emp.name] || ""),
    0
  );
  const totalUsed = uniqueEmployees.reduce(
    (sum, emp) => sum + calcUsedLeaves(emp.name, annualLeaveMap),
    0
  );

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="flex gap-2.5 flex-wrap">
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 인원</p>
          <p className="text-xl font-bold text-foreground">{uniqueEmployees.length}<span className="text-xs font-normal text-muted-foreground ml-1">명</span></p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 발생연차</p>
          <p className="text-xl font-bold text-primary">{totalAccrued}<span className="text-xs font-normal text-muted-foreground ml-1">일</span></p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 사용일수</p>
          <p className="text-xl font-bold text-warning">{totalUsed}<span className="text-xs font-normal text-muted-foreground ml-1">일</span></p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 잔여일수</p>
          <p className="text-xl font-bold text-secondary">{totalAccrued - totalUsed}<span className="text-xs font-normal text-muted-foreground ml-1">일</span></p>
        </div>
      </div>

      {/* 직원별 연차 현황 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">직원별 연차 현황</span>
          <span className="text-[10px] text-muted-foreground">입사일 클릭하여 수정</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">팀</th>
                <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">성명</th>
                <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">입사일</th>
                <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">발생연차</th>
                <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">사용일수</th>
                <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">잔여일수</th>
              </tr>
            </thead>
            <tbody>
              {uniqueEmployees.map((emp) => {
                const hireDate = hireDates[emp.name] || "";
                const accrued = calcAccruedLeaves(hireDate);
                const used = calcUsedLeaves(emp.name, annualLeaveMap);
                const remaining = accrued - used;
                const teamCls = emp.team === "한성_F" ? "text-primary" : "text-secondary";
                const teamLabel = emp.team === "한성_F" ? "한성" : "태화";

                return (
                  <tr key={emp.name} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold ${teamCls}`}>{teamLabel}</span>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{emp.name}</td>
                    <td className="px-4 py-2.5 text-center">
                      {editingName === emp.name ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            type="date"
                            value={tempDate}
                            onChange={(e) => setTempDate(e.target.value)}
                            className="bg-[#1a2f4a] border border-primary text-primary text-[11px] px-2 py-0.5 rounded outline-none w-32"
                            autoFocus
                          />
                          <button
                            onClick={() => saveHireDate(emp.name, tempDate)}
                            className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded hover:bg-primary/90 transition-colors"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => setEditingName(null)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingName(emp.name); setTempDate(hireDate); }}
                          className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                            hireDate
                              ? "text-secondary border-secondary/30 hover:border-secondary/60"
                              : "text-muted-foreground border-border hover:border-muted-foreground"
                          }`}
                        >
                          {hireDate || "미입력"}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-bold ${accrued > 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {accrued}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-bold ${used > 0 ? "text-warning" : "text-muted-foreground"}`}>
                        {used}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-bold ${
                        remaining < 0
                          ? "text-destructive"
                          : remaining > 0
                          ? "text-secondary"
                          : "text-muted-foreground"
                      }`}>
                        {hireDate ? remaining : "-"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 연차 사용 내역 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">연차 사용 내역</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
            총 {leaveDetails.length}건
          </span>
        </div>
        {leaveDetails.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            연차 사용 내역이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">날짜</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">이름</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">사용일수</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">비고</th>
                </tr>
              </thead>
              <tbody>
                {leaveDetails.map((item, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 text-secondary font-mono">{item.date}</td>
                    <td className="px-4 py-2 font-medium text-foreground">{item.name}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-warning font-bold">{item.days}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">연차</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
