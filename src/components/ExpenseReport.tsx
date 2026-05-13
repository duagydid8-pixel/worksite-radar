import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  loadPaymentDatesFS,
  savePaymentDatesFS,
  type PaymentDateEntry,
} from "@/lib/firestoreService";

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

function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDateKR(s: string) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function dateLabel(s: string) {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  return `${fmtDateKR(s)} (${DAY_NAMES[d.getDay()]})`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m)}월`;
}

function nearbyMonths(count = 6): string[] {
  const list: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return list;
}

export default function ExpenseReportTab({ isAdmin }: { isAdmin: boolean }) {
  const [paymentDates, setPaymentDates] = useState<Record<string, PaymentDateEntry>>({});
  const [editingPD, setEditingPD] = useState<{ ym: string; date: string; note: string } | null>(null);
  const [newPD, setNewPD] = useState({ ym: currentYM(), date: autoPaymentDate(currentYM()), note: "" });
  const [showAddPD, setShowAddPD] = useState(false);

  useEffect(() => {
    loadPaymentDatesFS().then(setPaymentDates);
  }, []);

  const sortedPDEntries = useMemo(
    () => Object.entries(paymentDates).sort((a, b) => b[0].localeCompare(a[0])),
    [paymentDates],
  );

  const summaryMonths = useMemo(() => nearbyMonths(6), []);

  const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";
  const thCls = "px-4 py-2.5 text-xs font-bold text-muted-foreground text-left whitespace-nowrap";

  const normalizePaymentDate = (date: string) => {
    if (!date) return "";
    return fmtDate(getNextWeekday(new Date(`${date}T00:00:00`)));
  };

  const handleAddPD = async () => {
    if (!newPD.ym || !newPD.date) {
      toast.error("년월과 지급요청일을 입력하세요.");
      return;
    }

    const updated = { ...paymentDates, [newPD.ym]: { date: newPD.date, note: newPD.note } };
    setPaymentDates(updated);
    setShowAddPD(false);
    setNewPD({ ym: currentYM(), date: autoPaymentDate(currentYM()), note: "" });
    const ok = await savePaymentDatesFS(updated);
    if (ok) toast.success("지급요청일이 저장되었습니다.");
    else toast.error("저장 실패");
  };

  const handleSavePDEdit = async () => {
    if (!editingPD) return;
    const updated = { ...paymentDates, [editingPD.ym]: { date: editingPD.date, note: editingPD.note } };
    setPaymentDates(updated);
    setEditingPD(null);
    const ok = await savePaymentDatesFS(updated);
    if (ok) toast.success("수정되었습니다.");
    else toast.error("수정 실패");
  };

  const handleDeletePD = async (ym: string) => {
    const updated = { ...paymentDates };
    delete updated[ym];
    setPaymentDates(updated);
    const ok = await savePaymentDatesFS(updated);
    if (ok) toast.success("삭제되었습니다.");
    else toast.error("삭제 실패");
  };

  return (
    <div className="p-4 md:p-6 max-w-[980px] mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-bold text-foreground">지급요청일</h2>
            <p className="text-xs text-muted-foreground">월별 지급요청일을 미리 등록하고 확인합니다.</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddPD((value) => !value)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> 지급요청일 추가
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {summaryMonths.map((ym) => {
          const saved = paymentDates[ym];
          const date = saved?.date ?? autoPaymentDate(ym);
          return (
            <div
              key={ym}
              className={`rounded-xl border p-4 ${saved ? "border-primary/30 bg-primary/5" : "border-border bg-white"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">{monthLabel(ym)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${saved ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {saved ? "등록" : "자동예상"}
                </span>
              </div>
              <div className="mt-3 text-base font-extrabold text-foreground">{dateLabel(date)}</div>
              {saved?.note && <div className="mt-1 text-xs font-semibold text-muted-foreground">{saved.note}</div>}
            </div>
          );
        })}
      </div>

      {showAddPD && (
        <div className="rounded-2xl border border-border bg-accent/40 p-4">
          <p className="text-xs font-bold text-muted-foreground mb-3">새 지급요청일 등록</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">대상 년월</label>
              <input
                type="month"
                className={`${inputCls} w-40`}
                value={newPD.ym}
                onChange={(event) => {
                  const ym = event.target.value;
                  setNewPD((prev) => ({ ...prev, ym, date: autoPaymentDate(ym) }));
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
                className={`${inputCls} w-44`}
                value={newPD.date}
                onChange={(event) => setNewPD((prev) => ({ ...prev, date: normalizePaymentDate(event.target.value) }))}
              />
              {newPD.date && <p className="text-[11px] text-muted-foreground mt-1">{dateLabel(newPD.date)}</p>}
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">항목</label>
              <input
                className={`${inputCls} w-52`}
                value={newPD.note}
                onChange={(event) => setNewPD((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="예: 인건비, 재료비"
              />
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

      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm">저장된 지급요청일 목록</h3>
        </div>

        {sortedPDEntries.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">저장된 지급요청일이 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className={thCls}>대상 년월</th>
                <th className={thCls}>지급요청일</th>
                <th className={thCls}>요일</th>
                <th className={thCls}>항목</th>
                {isAdmin && <th className="px-4 py-2.5 w-24" />}
              </tr>
            </thead>
            <tbody>
              {sortedPDEntries.map(([ym, entry]) =>
                editingPD?.ym === ym ? (
                  <tr key={ym} className="bg-accent/30 border-b border-border">
                    <td className="px-4 py-2.5 font-medium">{ym}</td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="border border-border rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 w-40"
                        value={editingPD.date}
                        onChange={(event) => {
                          const date = normalizePaymentDate(event.target.value);
                          if (date) setEditingPD((prev) => prev ? { ...prev, date } : prev);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {editingPD.date ? `${DAY_NAMES[new Date(`${editingPD.date}T00:00:00`).getDay()]}요일` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="border border-border rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30 w-52"
                        value={editingPD.note}
                        onChange={(event) => setEditingPD((prev) => prev ? { ...prev, note: event.target.value } : prev)}
                        placeholder="예: 인건비"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5">
                        <button
                          onClick={handleSavePDEdit}
                          className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                          title="저장"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingPD(null)}
                          className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                          title="취소"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={ym} className="border-b border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{ym}</td>
                    <td className="px-4 py-3">{fmtDateKR(entry.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {DAY_NAMES[new Date(`${entry.date}T00:00:00`).getDay()]}요일
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.note || "—"}</td>
                    {isAdmin && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => setEditingPD({ ym, date: entry.date, note: entry.note })}
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50"
                            title="수정"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeletePD(ym)}
                            className="p-1.5 rounded-md border border-border text-destructive hover:bg-destructive/5"
                            title="삭제"
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
    </div>
  );
}
