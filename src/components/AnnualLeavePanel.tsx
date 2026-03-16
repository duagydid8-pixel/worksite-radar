import { useState, useMemo } from "react";
import type { LeaveEmployee, LeaveDetail } from "@/lib/parseExcel";

interface Props {
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
}

// 입사일 이후 지난 매월 1일 횟수 = 발생연차
function calcAccruedLeaves(hireDate: string): number {
  if (!hireDate) return 0;
  const hire = new Date(hireDate);
  hire.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 입사 다음달 1일부터 카운트
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

function padZ(n: number) {
  return String(n).padStart(2, "0");
}

export default function AnnualLeavePanel({ leaveEmployees, leaveDetails }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // 직원별 사용일수 합산
  const usedMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of leaveDetails) {
      map[d.name] = (map[d.name] || 0) + d.days;
    }
    return map;
  }, [leaveDetails]);

  const totalAccrued = useMemo(
    () => leaveEmployees.reduce((sum, e) => sum + calcAccruedLeaves(e.hireDate), 0),
    [leaveEmployees]
  );
  const totalUsed = useMemo(
    () => leaveEmployees.reduce((sum, e) => sum + (usedMap[e.name] || 0), 0),
    [leaveEmployees, usedMap]
  );

  const filteredDetails = useMemo(
    () => selectedName ? leaveDetails.filter((d) => d.name === selectedName) : leaveDetails,
    [leaveDetails, selectedName]
  );

  const noData = leaveEmployees.length === 0;

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="flex gap-2.5 flex-wrap">
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 인원</p>
          <p className="text-xl font-bold text-foreground">
            {leaveEmployees.length}<span className="text-xs font-normal text-muted-foreground ml-1">명</span>
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 발생연차</p>
          <p className="text-xl font-bold text-primary">
            {totalAccrued}<span className="text-xs font-normal text-muted-foreground ml-1">일</span>
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 사용일수</p>
          <p className="text-xl font-bold text-warning">
            {totalUsed}<span className="text-xs font-normal text-muted-foreground ml-1">일</span>
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1">총 잔여일수</p>
          <p className="text-xl font-bold text-secondary">
            {totalAccrued - totalUsed}<span className="text-xs font-normal text-muted-foreground ml-1">일</span>
          </p>
        </div>
      </div>

      {/* 직원별 연차 현황 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">직원별 연차 현황</span>
          <span className="text-[10px] text-muted-foreground">이름 클릭 시 해당 직원 내역 필터링</span>
        </div>
        {noData ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            연차_현채직 시트 데이터가 없습니다. 엑셀 파일을 업로드하세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">성명</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">부서</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">입사일</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">발생연차</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">사용일수</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">잔여일수</th>
                </tr>
              </thead>
              <tbody>
                {leaveEmployees.map((emp) => {
                  const accrued = calcAccruedLeaves(emp.hireDate);
                  const used = usedMap[emp.name] || 0;
                  const remaining = accrued - used;
                  const isSelected = selectedName === emp.name;

                  return (
                    <tr
                      key={emp.name}
                      className={`border-b border-border/50 transition-colors ${
                        isSelected ? "bg-primary/10" : "hover:bg-muted/20"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setSelectedName(isSelected ? null : emp.name)}
                          className={`font-semibold transition-colors ${
                            isSelected
                              ? "text-primary underline underline-offset-2"
                              : "text-foreground hover:text-primary"
                          }`}
                        >
                          {emp.name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{emp.dept || "-"}</td>
                      <td className="px-4 py-2.5 text-center font-mono text-[11px] text-secondary">
                        {emp.hireDate || <span className="text-muted-foreground">미등록</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-bold ${accrued > 0 ? "text-primary" : "text-muted-foreground"}`}>
                          {emp.hireDate ? accrued : "-"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-bold ${used > 0 ? "text-warning" : "text-muted-foreground"}`}>
                          {used}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-bold ${
                          !emp.hireDate
                            ? "text-muted-foreground"
                            : remaining < 0
                            ? "text-destructive"
                            : remaining > 0
                            ? "text-secondary"
                            : "text-muted-foreground"
                        }`}>
                          {emp.hireDate ? remaining : "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 연차 사용 내역 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-foreground">연차 사용 내역</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {filteredDetails.length}건
          </span>
          {selectedName && (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-[11px] text-primary font-semibold bg-primary/10 border border-primary/25 px-2 py-0.5 rounded">
                {selectedName}
              </span>
              <button
                onClick={() => setSelectedName(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                ✕ 전체보기
              </button>
            </div>
          )}
        </div>
        {filteredDetails.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            {selectedName ? `${selectedName}의 연차 사용 내역이 없습니다.` : "연차 사용 내역이 없습니다."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">날짜</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">이름</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-semibold">사용일수</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">사유</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetails.map((item, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 text-secondary font-mono">
                      {item.year}-{padZ(item.month)}-{padZ(item.day)}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setSelectedName(selectedName === item.name ? null : item.name)}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-warning font-bold">{item.days}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{item.reason || "-"}</td>
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
