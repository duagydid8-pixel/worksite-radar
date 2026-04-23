import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Edit2, Save, X, Download, Receipt, CalendarClock, History } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  loadPaymentDatesFS, savePaymentDatesFS,
  loadExpenseReportsFS, saveExpenseReportsFS,
  type ExpenseLineItem, type ExpenseReport,
} from "@/lib/firestoreService";

// ─── Utils ─────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function getNextWeekday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

function autoPaymentDate(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0);
  return fmtDate(getNextWeekday(last));
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() { return fmtDate(new Date()); }

function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtKRW(n: number) { return n.toLocaleString("ko-KR"); }

function fmtDateKR(s: string) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function dateLabel(s: string) {
  if (!s) return "";
  const d = new Date(s);
  return `${fmtDateKR(s)} (${DAY_NAMES[d.getDay()]})`;
}

// 최근 N개월 목록
function recentMonths(n = 12): string[] {
  const list: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return list;
}

type SubTab = "write" | "payment" | "history";

function emptyLine(): ExpenseLineItem {
  return { id: uid(), name: "", unit: "", quantity: 1, unitPrice: 0, note: "" };
}

// ─── Main Component ─────────────────────────────────────────────────
export default function ExpenseReportTab({ isAdmin }: { isAdmin: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>("write");

  // 지급요청일 관리
  const [paymentDates, setPaymentDates] = useState<Record<string, string>>({});
  const [editingPD, setEditingPD] = useState<{ ym: string; date: string } | null>(null);
  const [newPD, setNewPD] = useState({ ym: currentYM(), date: autoPaymentDate(currentYM()) });
  const [showAddPD, setShowAddPD] = useState(false);

  // 저장된 결의서
  const [reports, setReports] = useState<ExpenseReport[]>([]);

  // 결의서 작성
  const [yearMonth, setYearMonth] = useState(currentYM);
  const [writtenDate, setWrittenDate] = useState(todayStr);
  const [paymentDate, setPaymentDate] = useState(() => autoPaymentDate(currentYM()));
  const [department, setDepartment] = useState("P4-PH4");
  const [reportTitle, setReportTitle] = useState("");
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([emptyLine()]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadPaymentDatesFS().then(setPaymentDates);
    loadExpenseReportsFS().then(setReports);
  }, []);

  const totalAmount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0),
    [lineItems],
  );

  // 년월 변경 → 저장된 지급요청일 우선 반영, 없으면 자동 계산
  const handleYMChange = (ym: string) => {
    setYearMonth(ym);
    setPaymentDate(paymentDates[ym] ?? autoPaymentDate(ym));
  };

  // 수동 입력 시 주말이면 다음 평일로 자동 보정
  const handlePaymentDateChange = (val: string) => {
    if (!val) { setPaymentDate(""); return; }
    setPaymentDate(fmtDate(getNextWeekday(new Date(val))));
  };

  // ── 지급요청일 관리 ──────────────────────────────────────
  const handleAddPD = async () => {
    if (!newPD.ym || !newPD.date) { toast.error("년월과 날짜를 입력하세요."); return; }
    const updated = { ...paymentDates, [newPD.ym]: newPD.date };
    setPaymentDates(updated);
    setShowAddPD(false);
    setNewPD({ ym: currentYM(), date: autoPaymentDate(currentYM()) });
    await savePaymentDatesFS(updated);
    toast.success("지급요청일이 저장되었습니다.");
  };

  const handleSavePDEdit = async () => {
    if (!editingPD) return;
    const updated = { ...paymentDates, [editingPD.ym]: editingPD.date };
    setPaymentDates(updated);
    setEditingPD(null);
    await savePaymentDatesFS(updated);
    toast.success("수정되었습니다.");
  };

  const handleDeletePD = async (ym: string) => {
    const updated = { ...paymentDates };
    delete updated[ym];
    setPaymentDates(updated);
    await savePaymentDatesFS(updated);
    toast.success("삭제되었습니다.");
  };

  // ── 결의서 행 수정 ────────────────────────────────────────
  const updateLine = (id: string, field: keyof ExpenseLineItem, value: string | number) => {
    setLineItems(prev => prev.map(li => (li.id === id ? { ...li, [field]: value } : li)));
  };

  const removeLine = (id: string) => {
    setLineItems(prev => {
      const next = prev.filter(li => li.id !== id);
      return next.length === 0 ? [emptyLine()] : next;
    });
  };

  // ── 결의서 저장 ───────────────────────────────────────────
  const handleSaveReport = async () => {
    const filled = lineItems.filter(li => li.name.trim());
    if (filled.length === 0) { toast.error("항목을 하나 이상 입력하세요."); return; }
    setIsSaving(true);
    const [yy, mm] = yearMonth.split("-");
    const title = reportTitle.trim() || `${yy}년 ${parseInt(mm)}월 지출결의서`;
    const report: ExpenseReport = {
      id: uid(), title, yearMonth, writtenDate, paymentDate, department, items: filled,
      savedAt: new Date().toISOString(),
    };
    const updated = [report, ...reports];
    const ok = await saveExpenseReportsFS(updated);
    setIsSaving(false);
    if (ok) { setReports(updated); toast.success("결의서가 저장되었습니다."); setReportTitle(""); }
    else toast.error("저장 실패");
  };

  const handleLoadReport = (r: ExpenseReport) => {
    setYearMonth(r.yearMonth);
    setWrittenDate(r.writtenDate);
    setPaymentDate(r.paymentDate);
    setDepartment(r.department);
    setReportTitle(r.title);
    setLineItems(r.items.length ? r.items : [emptyLine()]);
    setSubTab("write");
    toast.success("결의서를 불러왔습니다.");
  };

  const handleDeleteReport = async (id: string) => {
    const updated = reports.filter(r => r.id !== id);
    setReports(updated);
    await saveExpenseReportsFS(updated);
    toast.success("삭제되었습니다.");
  };

  // ── 엑셀 내보내기 ─────────────────────────────────────────
  const exportExcel = (r?: ExpenseReport) => {
    const items = r ? r.items : lineItems.filter(li => li.name.trim());
    const wd = r ? r.writtenDate : writtenDate;
    const pd = r ? r.paymentDate : paymentDate;
    const dept = r ? r.department : department;
    const total = items.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
    const [yy, mm] = (r ? r.yearMonth : yearMonth).split("-");

    const aoa: (string | number)[][] = [
      ["지 출 결 의 서"],
      [],
      ["작성일", fmtDateKR(wd), "", "지급요청일", fmtDateKR(pd)],
      ["소  속", dept, "", "결의금액", `${fmtKRW(total)}원`],
      [],
      ["No.", "항목명", "단위", "수량", "단가", "금액", "비고"],
      ...items.map((li, i) => [i + 1, li.name, li.unit, li.quantity, li.unitPrice, li.quantity * li.unitPrice, li.note]),
      [],
      ["", "", "", "", "합   계", total, ""],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, "지출결의서");
    XLSX.writeFile(wb, `${yy}년${mm}월_지출결의서.xlsx`);
    toast.success("엑셀 파일이 다운로드되었습니다.");
  };

  // ── 공통 스타일 ───────────────────────────────────────────
  const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";
  const thCls = "px-4 py-2.5 text-xs font-bold text-muted-foreground text-left whitespace-nowrap";

  // 지급요청일 관리: 저장된 항목 최신순 정렬
  const sortedPDEntries = Object.entries(paymentDates).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Receipt className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">지출결의서</h2>
      </div>

      {/* 서브탭 */}
      <div className="flex gap-2 flex-wrap">
        {(
          [
            { key: "write" as SubTab, label: "결의서 작성", icon: <Receipt className="h-3.5 w-3.5" /> },
            { key: "payment" as SubTab, label: "지급요청일 관리", icon: <CalendarClock className="h-3.5 w-3.5" /> },
            { key: "history" as SubTab, label: "저장된 결의서", icon: <History className="h-3.5 w-3.5" /> },
          ] as { key: SubTab; label: string; icon: React.ReactNode }[]
        ).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
              subTab === key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-white text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ═══ 지급요청일 관리 ══════════════════════════════════ */}
      {subTab === "payment" && (
        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-bold text-sm">월별 지급요청일</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                저장해두면 결의서 작성 시 해당 월의 지급요청일이 자동 입력됩니다
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowAddPD(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> 추가
              </button>
            )}
          </div>

          {/* 추가 폼 */}
          {showAddPD && (
            <div className="px-5 py-4 bg-accent/40 border-b border-border">
              <p className="text-xs font-bold text-muted-foreground mb-3">새 지급요청일 등록</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">대상 년월</label>
                  <input
                    type="month"
                    className={inputCls + " w-40"}
                    value={newPD.ym}
                    onChange={e => {
                      const ym = e.target.value;
                      setNewPD(p => ({ ym, date: p.date || autoPaymentDate(ym) }));
                    }}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                    지급요청일
                    <span className="ml-1 text-[9px] text-primary font-normal">토·일 → 자동조정</span>
                  </label>
                  <input
                    type="date"
                    className={inputCls + " w-44"}
                    value={newPD.date}
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) { setNewPD(p => ({ ...p, date: "" })); return; }
                      setNewPD(p => ({ ...p, date: fmtDate(getNextWeekday(new Date(val))) }));
                    }}
                  />
                  {newPD.date && (
                    <p className="text-[11px] text-muted-foreground mt-1">{dateLabel(newPD.date)}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddPD}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                  >
                    저장
                  </button>
                  <button
                    onClick={() => setShowAddPD(false)}
                    className="px-3 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          )}

          {sortedPDEntries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              저장된 지급요청일이 없습니다.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className={thCls}>대상 년월</th>
                  <th className={thCls}>지급요청일</th>
                  <th className={thCls}>요일</th>
                  {isAdmin && <th className="px-4 py-2.5 w-24" />}
                </tr>
              </thead>
              <tbody>
                {sortedPDEntries.map(([ym, date]) =>
                  editingPD?.ym === ym ? (
                    <tr key={ym} className="bg-accent/30 border-b border-border">
                      <td className="px-4 py-2.5 font-medium">{ym}</td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          className="border border-border rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 w-40"
                          value={editingPD.date}
                          onChange={e => {
                            const val = e.target.value;
                            if (!val) return;
                            setEditingPD(p => p ? { ...p, date: fmtDate(getNextWeekday(new Date(val))) } : p);
                          }}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {editingPD.date ? DAY_NAMES[new Date(editingPD.date).getDay()] + "요일" : ""}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleSavePDEdit}
                            className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingPD(null)}
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={ym} className="border-b border-border hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{ym}</td>
                      <td className="px-4 py-3">{fmtDateKR(date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {DAY_NAMES[new Date(date).getDay()]}요일
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => setEditingPD({ ym, date })}
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeletePD(ym)}
                              className="p-1.5 rounded-md border border-border text-destructive hover:bg-destructive/5"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══ 결의서 작성 ══════════════════════════════════════ */}
      {subTab === "write" && (
        <div className="space-y-4">
          {/* 기본 정보 */}
          <div className="bg-white border border-border rounded-2xl shadow-sm p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">기본 정보</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  대상 년월
                </label>
                <input type="month" value={yearMonth} onChange={e => handleYMChange(e.target.value)} className={inputCls} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  작성일
                </label>
                <input type="date" value={writtenDate} onChange={e => setWrittenDate(e.target.value)} className={inputCls} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  지급요청일
                  <span className="ml-1 text-[9px] text-primary font-normal normal-case">
                    {paymentDates[yearMonth] ? "저장된 날짜 적용됨" : "토·일 → 자동조정"}
                  </span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => handlePaymentDateChange(e.target.value)}
                  className={`${inputCls} ${paymentDates[yearMonth] ? "border-primary/50 bg-primary/5" : ""}`}
                />
                <p className="text-[11px] text-muted-foreground mt-1">{dateLabel(paymentDate)}</p>
              </div>

              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  소속
                </label>
                <input value={department} onChange={e => setDepartment(e.target.value)} placeholder="예: P4-PH4" className={inputCls} />
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                결의서 제목 (비워두면 자동 생성)
              </label>
              <input
                value={reportTitle}
                onChange={e => setReportTitle(e.target.value)}
                placeholder={`${yearMonth.split("-")[0]}년 ${parseInt(yearMonth.split("-")[1])}월 지출결의서`}
                className={`${inputCls} md:max-w-sm`}
              />
            </div>
          </div>

          {/* 지출 항목 */}
          <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="font-bold text-sm">지출 항목</h3>
              <button
                onClick={() => setLineItems(prev => [...prev, emptyLine()])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> 행 추가
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-center w-10">No.</th>
                    <th className={`${thCls} min-w-[150px]`}>항목명</th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-center w-20">단위</th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-24">수량</th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-32">단가</th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-32">금액</th>
                    <th className={`${thCls} min-w-[120px]`}>비고</th>
                    <th className="px-3 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, idx) => (
                    <tr key={li.id} className="border-b border-border hover:bg-muted/10">
                      <td className="px-3 py-2 text-center text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm py-0.5"
                          value={li.name}
                          onChange={e => updateLine(li.id, "name", e.target.value)}
                          placeholder="항목명 입력"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm text-center py-0.5"
                          value={li.unit}
                          onChange={e => updateLine(li.id, "unit", e.target.value)}
                          placeholder="단위"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={0}
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm text-right py-0.5"
                          value={li.quantity || ""}
                          onChange={e => updateLine(li.id, "quantity", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={0}
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm text-right font-mono py-0.5"
                          value={li.unitPrice || ""}
                          onChange={e => updateLine(li.id, "unitPrice", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {fmtKRW(li.quantity * li.unitPrice)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm py-0.5"
                          value={li.note}
                          onChange={e => updateLine(li.id, "note", e.target.value)}
                          placeholder="비고"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeLine(li.id)}
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted">
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold">합   계</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-base text-primary">
                      {fmtKRW(totalAmount)}원
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex justify-end gap-2 flex-wrap">
            <button
              onClick={() => exportExcel()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors shadow-sm"
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              엑셀 내보내기
            </button>
            {isAdmin && (
              <button
                onClick={handleSaveReport}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {isSaving ? "저장 중..." : "결의서 저장"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ 저장된 결의서 ════════════════════════════════════ */}
      {subTab === "history" && (
        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-bold text-sm">저장된 결의서 목록</h3>
          </div>
          {reports.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">저장된 결의서가 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className={thCls}>제목</th>
                  <th className={thCls}>대상 년월</th>
                  <th className={thCls}>지급요청일</th>
                  <th className={`${thCls} text-right`}>결의금액</th>
                  <th className={thCls}>저장일시</th>
                  <th className="px-4 py-2.5 w-28" />
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{r.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.yearMonth}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDateKR(r.paymentDate)}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-right">
                      {fmtKRW(r.items.reduce((s, li) => s + li.quantity * li.unitPrice, 0))}원
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(r.savedAt).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        <button
                          onClick={() => exportExcel(r)}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 transition-colors"
                          title="엑셀 내보내기"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleLoadReport(r)}
                          className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                          불러오기
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteReport(r.id)}
                            className="p-1.5 rounded-lg border border-border text-destructive hover:bg-destructive/5 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
