import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Edit2, Save, X, Download, Receipt, Package, History, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  loadExpenseCatalogFS, saveExpenseCatalogFS,
  loadExpenseReportsFS, saveExpenseReportsFS,
  type ExpenseCatalogItem, type ExpenseLineItem, type ExpenseReport,
} from "@/lib/firestoreService";

// ─── Utils ────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function getNextWeekday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

function calcPaymentDate(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0);
  const adj = getNextWeekday(last);
  return fmtDate(adj);
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

function paymentDateLabel(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${fmtDateKR(dateStr)} (${DAY_NAMES[d.getDay()]})`;
}

// ─── Sub-components ───────────────────────────────────────────────
type SubTab = "write" | "items" | "history";

function emptyLine(): ExpenseLineItem {
  return { id: uid(), name: "", unit: "", quantity: 1, unitPrice: 0, note: "" };
}

// ─── Main Component ───────────────────────────────────────────────
export default function ExpenseReportTab({ isAdmin }: { isAdmin: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>("write");

  // catalog
  const [catalog, setCatalog] = useState<ExpenseCatalogItem[]>([]);
  const [editingCatalogItem, setEditingCatalogItem] = useState<ExpenseCatalogItem | null>(null);
  const [showAddCatalog, setShowAddCatalog] = useState(false);
  const [newCatalog, setNewCatalog] = useState<Omit<ExpenseCatalogItem, "id">>({
    name: "", unit: "", defaultPrice: 0, note: "",
  });
  const [showCatalogDropdown, setShowCatalogDropdown] = useState(false);

  // saved reports
  const [reports, setReports] = useState<ExpenseReport[]>([]);

  // write form
  const [yearMonth, setYearMonth] = useState(currentYM);
  const [writtenDate, setWrittenDate] = useState(todayStr);
  const [paymentDate, setPaymentDate] = useState(() => calcPaymentDate(currentYM()));
  const [department, setDepartment] = useState("P4-PH4");
  const [reportTitle, setReportTitle] = useState("");
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([emptyLine()]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadExpenseCatalogFS().then(setCatalog);
    loadExpenseReportsFS().then(setReports);
  }, []);

  const totalAmount = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0),
    [lineItems],
  );

  // ── Year/Month change → auto-recalculate paymentDate ──
  const handleYMChange = (ym: string) => {
    setYearMonth(ym);
    setPaymentDate(calcPaymentDate(ym));
  };

  // ── Manually entered payment date: auto-push past weekends ──
  const handlePaymentDateChange = (val: string) => {
    if (!val) { setPaymentDate(val); return; }
    const d = new Date(val);
    const adj = getNextWeekday(d);
    setPaymentDate(fmtDate(adj));
  };

  // ── Catalog CRUD ──────────────────────────────────────
  const handleAddCatalog = async () => {
    if (!newCatalog.name.trim()) { toast.error("항목명을 입력하세요."); return; }
    const item: ExpenseCatalogItem = { ...newCatalog, id: uid() };
    const updated = [...catalog, item];
    setCatalog(updated);
    setNewCatalog({ name: "", unit: "", defaultPrice: 0, note: "" });
    setShowAddCatalog(false);
    await saveExpenseCatalogFS(updated);
    toast.success("항목이 추가되었습니다.");
  };

  const handleSaveCatalogEdit = async (item: ExpenseCatalogItem) => {
    const updated = catalog.map(c => (c.id === item.id ? item : c));
    setCatalog(updated);
    setEditingCatalogItem(null);
    await saveExpenseCatalogFS(updated);
    toast.success("항목이 저장되었습니다.");
  };

  const handleDeleteCatalog = async (id: string) => {
    const updated = catalog.filter(c => c.id !== id);
    setCatalog(updated);
    await saveExpenseCatalogFS(updated);
    toast.success("항목이 삭제되었습니다.");
  };

  // ── Line items ────────────────────────────────────────
  const updateLine = (id: string, field: keyof ExpenseLineItem, value: string | number) => {
    setLineItems(prev => prev.map(li => (li.id === id ? { ...li, [field]: value } : li)));
  };

  const insertFromCatalog = (item: ExpenseCatalogItem) => {
    setLineItems(prev => [
      ...prev,
      { id: uid(), name: item.name, unit: item.unit, quantity: 1, unitPrice: item.defaultPrice, note: "" },
    ]);
    setShowCatalogDropdown(false);
  };

  const removeLine = (id: string) => {
    setLineItems(prev => {
      const next = prev.filter(li => li.id !== id);
      return next.length === 0 ? [emptyLine()] : next;
    });
  };

  // ── Save report ───────────────────────────────────────
  const handleSaveReport = async () => {
    const filled = lineItems.filter(li => li.name.trim());
    if (filled.length === 0) { toast.error("항목을 하나 이상 입력하세요."); return; }
    setIsSaving(true);
    const [yy, mm] = yearMonth.split("-");
    const title = reportTitle.trim() || `${yy}년 ${parseInt(mm)}월 지출결의서`;
    const report: ExpenseReport = {
      id: uid(),
      title,
      yearMonth,
      writtenDate,
      paymentDate,
      department,
      items: filled,
      savedAt: new Date().toISOString(),
    };
    const updated = [report, ...reports];
    const ok = await saveExpenseReportsFS(updated);
    setIsSaving(false);
    if (ok) {
      setReports(updated);
      toast.success("결의서가 저장되었습니다.");
      setReportTitle("");
    } else {
      toast.error("저장 실패");
    }
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

  // ── Excel export ──────────────────────────────────────
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
      ...items.map((li, i) => [
        i + 1, li.name, li.unit, li.quantity, li.unitPrice, li.quantity * li.unitPrice, li.note,
      ]),
      [],
      ["", "", "", "", "합   계", total, ""],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 6 }, { wch: 22 }, { wch: 8 }, { wch: 8 },
      { wch: 14 }, { wch: 16 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "지출결의서");
    XLSX.writeFile(wb, `${yy}년${mm}월_지출결의서.xlsx`);
    toast.success("엑셀 파일이 다운로드되었습니다.");
  };

  // ── Input style ───────────────────────────────────────
  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";
  const thCls = "px-4 py-2.5 text-xs font-bold text-muted-foreground text-left whitespace-nowrap";

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Receipt className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">지출결의서</h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        {(
          [
            { key: "write" as SubTab, label: "결의서 작성", icon: <Receipt className="h-3.5 w-3.5" /> },
            { key: "items" as SubTab, label: "항목 관리", icon: <Package className="h-3.5 w-3.5" /> },
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
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ═══ 항목 관리 ═══════════════════════════════════════ */}
      {subTab === "items" && (
        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-bold text-sm">항목 카탈로그</h3>
            {isAdmin && (
              <button
                onClick={() => setShowAddCatalog(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> 항목 추가
              </button>
            )}
          </div>

          {showAddCatalog && (
            <div className="px-5 py-4 bg-accent/40 border-b border-border">
              <p className="text-xs font-bold text-muted-foreground mb-3">새 항목</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(
                  [
                    { field: "name", label: "항목명 *", placeholder: "예: 인건비", type: "text" },
                    { field: "unit", label: "단위", placeholder: "예: 명", type: "text" },
                    { field: "defaultPrice", label: "기본단가", placeholder: "0", type: "number" },
                    { field: "note", label: "비고", placeholder: "선택사항", type: "text" },
                  ] as const
                ).map(({ field, label, placeholder, type }) => (
                  <div key={field}>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{label}</label>
                    <input
                      type={type}
                      className={inputCls}
                      placeholder={placeholder}
                      value={field === "defaultPrice" ? (newCatalog.defaultPrice || "") : (newCatalog as Record<string, unknown>)[field] as string}
                      onChange={e =>
                        setNewCatalog(p => ({
                          ...p,
                          [field]: type === "number" ? Number(e.target.value) : e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleAddCatalog}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  추가
                </button>
                <button
                  onClick={() => {
                    setShowAddCatalog(false);
                    setNewCatalog({ name: "", unit: "", defaultPrice: 0, note: "" });
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {catalog.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              등록된 항목이 없습니다.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className={thCls}>항목명</th>
                  <th className={thCls}>단위</th>
                  <th className={`${thCls} text-right`}>기본단가</th>
                  <th className={thCls}>비고</th>
                  {isAdmin && <th className="px-4 py-2.5 w-20" />}
                </tr>
              </thead>
              <tbody>
                {catalog.map(item =>
                  editingCatalogItem?.id === item.id ? (
                    <tr key={item.id} className="bg-accent/30 border-b border-border">
                      {(["name", "unit", "defaultPrice", "note"] as const).map(field => (
                        <td key={field} className="px-3 py-2">
                          <input
                            type={field === "defaultPrice" ? "number" : "text"}
                            className="w-full border border-border rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30"
                            value={
                              field === "defaultPrice"
                                ? editingCatalogItem.defaultPrice
                                : editingCatalogItem[field]
                            }
                            onChange={e =>
                              setEditingCatalogItem(p =>
                                p
                                  ? {
                                      ...p,
                                      [field]:
                                        field === "defaultPrice" ? Number(e.target.value) : e.target.value,
                                    }
                                  : p,
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleSaveCatalogEdit(editingCatalogItem)}
                            className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingCatalogItem(null)}
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{item.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{item.unit}</td>
                      <td className="px-4 py-2.5 font-mono text-right">{fmtKRW(item.defaultPrice)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{item.note}</td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => setEditingCatalogItem(item)}
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCatalog(item.id)}
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
          {/* Basic info */}
          <div className="bg-white border border-border rounded-2xl shadow-sm p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">기본 정보</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* 대상 년월 */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  대상 년월
                </label>
                <input
                  type="month"
                  value={yearMonth}
                  onChange={e => handleYMChange(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* 작성일 */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  작성일
                </label>
                <input
                  type="date"
                  value={writtenDate}
                  onChange={e => setWrittenDate(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* 지급요청일 */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  지급요청일
                  <span className="ml-1 text-[9px] text-primary font-normal normal-case">
                    토·일 → 자동조정
                  </span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => handlePaymentDateChange(e.target.value)}
                  className={inputCls}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {paymentDateLabel(paymentDate)}
                </p>
              </div>

              {/* 소속 */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                  소속
                </label>
                <input
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  placeholder="예: P4-PH4"
                  className={inputCls}
                />
              </div>
            </div>

            {/* 제목 */}
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

          {/* Line items */}
          <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="font-bold text-sm">지출 항목</h3>
              <div className="flex gap-2">
                {/* 카탈로그 드롭다운 */}
                {catalog.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowCatalogDropdown(v => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                      <Package className="h-3.5 w-3.5" />
                      카탈로그
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showCatalogDropdown && (
                      <div className="absolute right-0 top-9 z-20 bg-white border border-border rounded-xl shadow-lg min-w-[220px] overflow-hidden">
                        {catalog.map(item => (
                          <button
                            key={item.id}
                            onClick={() => insertFromCatalog(item)}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 flex items-center justify-between gap-3"
                          >
                            <span className="font-medium">{item.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {fmtKRW(item.defaultPrice)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setLineItems(prev => [...prev, emptyLine()])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> 행 추가
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-center w-10">
                      No.
                    </th>
                    <th className={`${thCls} min-w-[150px]`}>항목명</th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-center w-20">
                      단위
                    </th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-24">
                      수량
                    </th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-32">
                      단가
                    </th>
                    <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right w-32">
                      금액
                    </th>
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
                          list={`cat-${li.id}`}
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm py-0.5"
                          value={li.name}
                          onChange={e => {
                            updateLine(li.id, "name", e.target.value);
                            const match = catalog.find(c => c.name === e.target.value);
                            if (match) {
                              updateLine(li.id, "unit", match.unit);
                              updateLine(li.id, "unitPrice", match.defaultPrice);
                            }
                          }}
                          placeholder="항목명 입력"
                        />
                        <datalist id={`cat-${li.id}`}>
                          {catalog.map(c => (
                            <option key={c.id} value={c.name} />
                          ))}
                        </datalist>
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
                          type="number"
                          min={0}
                          className="w-full border-0 border-b border-border focus:border-primary bg-transparent outline-none text-sm text-right py-0.5"
                          value={li.quantity || ""}
                          onChange={e => updateLine(li.id, "quantity", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
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
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold">
                      합   계
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-base text-primary">
                      {fmtKRW(totalAmount)}원
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Action buttons */}
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
            <div className="py-12 text-center text-sm text-muted-foreground">
              저장된 결의서가 없습니다.
            </div>
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
