import { useState, useMemo, useRef } from "react";
import { GripVertical, Search, X } from "lucide-react";
import type { LeaveEmployee, LeaveDetail } from "@/lib/parseExcel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  leaveEmployees: LeaveEmployee[];
  leaveDetails: LeaveDetail[];
  rowOrder: string[];
  onOrderChange: (context: string, names: string[]) => void;
}

function padZ(n: number) {
  return String(n).padStart(2, "0");
}

function applyOrder(emps: LeaveEmployee[], order: string[]): LeaveEmployee[] {
  if (!order.length) return emps;
  const map = new Map(emps.map((e) => [e.name, e]));
  const result: LeaveEmployee[] = [];
  for (const name of order) {
    const e = map.get(name);
    if (e) result.push(e);
  }
  for (const e of emps) {
    if (!order.includes(e.name)) result.push(e);
  }
  return result;
}

export default function AnnualLeavePanel({ leaveEmployees, leaveDetails, rowOrder, onOrderChange }: Props) {
  const [modalName, setModalName] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>(rowOrder);
  const [searchQuery, setSearchQuery] = useState("");
  const dragRef = useRef<number | null>(null);

  const orderedEmps = useMemo(() => applyOrder(leaveEmployees, localOrder), [leaveEmployees, localOrder]);
  const displayEmps = useMemo(
    () => searchQuery.trim() ? orderedEmps.filter((e) => e.name.includes(searchQuery.trim())) : orderedEmps,
    [orderedEmps, searchQuery]
  );

  const totalUsed = useMemo(() => leaveEmployees.reduce((sum, e) => sum + e.totalUsed, 0), [leaveEmployees]);
  const totalRemaining = useMemo(() => leaveEmployees.reduce((sum, e) => sum + e.remaining, 0), [leaveEmployees]);
  const totalAccrued = totalUsed + totalRemaining;

  const modalEmp = useMemo(() => leaveEmployees.find((e) => e.name === modalName) ?? null, [leaveEmployees, modalName]);
  const modalDetails = useMemo(() => leaveDetails.filter((d) => d.name === modalName), [leaveDetails, modalName]);

  const handleDragStart = (idx: number) => { dragRef.current = idx; };
  const handleDrop = (targetIdx: number) => {
    const srcIdx = dragRef.current;
    if (srcIdx == null || srcIdx === targetIdx) return;
    const names = orderedEmps.map((e) => e.name);
    const [moved] = names.splice(srcIdx, 1);
    names.splice(targetIdx, 0, moved);
    setLocalOrder(names);
    onOrderChange("leave", names);
    dragRef.current = null;
  };

  const noData = leaveEmployees.length === 0;

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-2.5">
        {[
          { label: "총 인원", value: leaveEmployees.length, unit: "명", color: "text-foreground" },
          { label: "총 발생연차", value: totalAccrued, unit: "일", color: "text-primary" },
          { label: "총 사용일수", value: totalUsed, unit: "일", color: "text-[#854f0b]" },
          { label: "총 잔여일수", value: totalRemaining, unit: "일", color: "text-secondary" },
        ].map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-[10px] text-muted-foreground mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>
              {c.value}
              <span className="text-xs font-normal text-muted-foreground ml-0.5">{c.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* 검색창 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="이름으로 검색..."
          className="w-full bg-white border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 직원별 연차 현황 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-primary" />
          <span className="text-sm font-bold text-foreground">직원별 연차 현황</span>
          <span className="text-[10px] text-muted-foreground ml-1">이름 클릭 시 상세 내역</span>
        </div>
        {noData ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            연차_현채직 시트 데이터가 없습니다. 엑셀 파일을 업로드하세요.
          </div>
        ) : displayEmps.length === 0 ? (
          <div className="py-10 text-center">
            <Search className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs font-semibold text-muted-foreground">검색 결과가 없습니다</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">"{searchQuery}"</span>에 해당하는 직원이 없습니다
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border text-muted-foreground font-semibold">
                  <th className="w-6 px-2 py-2.5" />
                  <th className="px-4 py-2.5 text-left">성명</th>
                  <th className="px-4 py-2.5 text-left">부서</th>
                  <th className="px-4 py-2.5 text-center">입사일</th>
                  <th className="px-4 py-2.5 text-center">발생연차</th>
                  <th className="px-4 py-2.5 text-center">사용일수</th>
                  <th className="px-4 py-2.5 text-center">잔여일수</th>
                </tr>
              </thead>
              <tbody>
                {displayEmps.map((emp, idx) => {
                  const accrued = emp.totalUsed + emp.remaining;
                  return (
                    <tr
                      key={emp.name}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(idx)}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-1 py-2.5 text-center">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab mx-auto" />
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setModalName(emp.name)}
                          className="font-semibold text-foreground hover:text-primary transition-colors"
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
                          {accrued}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className="font-bold"
                          style={{ color: emp.totalUsed > 0 ? "#854f0b" : undefined }}
                        >
                          {emp.totalUsed > 0 ? emp.totalUsed : <span className="text-muted-foreground">{emp.totalUsed}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-bold ${emp.remaining < 0 ? "text-destructive" : emp.remaining > 0 ? "text-secondary" : "text-muted-foreground"}`}>
                          {emp.remaining}
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

      {/* 전체 연차 사용 내역 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-secondary" />
          <span className="text-sm font-bold text-foreground">연차 사용 내역 전체</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded ml-1">
            총 {leaveDetails.length}건
          </span>
        </div>
        {leaveDetails.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">연차 사용 내역이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30 border-b border-border text-muted-foreground font-semibold">
                  <th className="px-4 py-2.5 text-left">날짜</th>
                  <th className="px-4 py-2.5 text-left">이름</th>
                  <th className="px-4 py-2.5 text-center">사용일수</th>
                  <th className="px-4 py-2.5 text-left">사유</th>
                </tr>
              </thead>
              <tbody>
                {leaveDetails.map((item, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 text-secondary font-mono">
                      {item.year}-{padZ(item.month)}-{padZ(item.day)}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setModalName(item.name)}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="font-bold" style={{ color: "#854f0b" }}>{item.days}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{item.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 직원 상세 내역 모달 */}
      <Dialog open={!!modalName} onOpenChange={(open) => { if (!open) setModalName(null); }}>
        <DialogContent className="bg-card border-border max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <span>{modalName}</span>
              <span className="text-xs font-normal text-muted-foreground">연차 사용 내역</span>
            </DialogTitle>
          </DialogHeader>

          {modalEmp && (
            <div className="flex gap-2 flex-wrap pt-1">
              {[
                { label: "발생연차", value: modalEmp.totalUsed + modalEmp.remaining, cls: "text-primary" },
                { label: "사용일수", value: modalEmp.totalUsed, style: { color: "#854f0b" } },
                { label: "잔여일수", value: modalEmp.remaining, cls: modalEmp.remaining < 0 ? "text-destructive" : "text-secondary" },
              ].map((s) => (
                <div key={s.label} className="bg-muted/50 border border-border rounded-xl px-3 py-2 flex-1 min-w-[80px] text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">{s.label}</p>
                  <p className={`text-lg font-bold ${"cls" in s ? s.cls : ""}`} style={"style" in s ? s.style : undefined}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {modalDetails.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">사용 내역이 없습니다.</p>
          ) : (
            <div className="overflow-y-auto max-h-72 rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">날짜</th>
                    <th className="px-3 py-2 text-center text-muted-foreground font-semibold">사용일수</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {modalDetails.map((item, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-secondary font-mono">
                        {item.year}-{padZ(item.month)}-{padZ(item.day)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-bold" style={{ color: "#854f0b" }}>{item.days}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{item.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
