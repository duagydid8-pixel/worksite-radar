import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Download, Info, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { addMonths, format } from "date-fns";
import { loadTenureWorkersFS, saveTenureWorkersFS } from "@/lib/firestoreService";
import {
  DDAY_BADGE_CLASS,
  TENURE_PROJECTS,
  buildTenureWorkerView,
  formatDday,
  mergeRosterRowsIntoWorkers,
  parseTenureRosterWorkbook,
  sortRecordsByHireDate,
  tenureProjectLabel,
  type EmploymentRecord,
  type EmploymentStatus,
  type TenureOrigin,
  type TenureProjectCode,
  type TenureWorker,
} from "@/lib/tenureAlert";
import StatCard from "@/components/StatCard";

type MonthFilter = "all" | "thisMonth" | "nextMonth";
type OriginFilter = "all" | TenureOrigin;
type StatusFilter = "all" | EmploymentStatus;

const ORIGIN_LABEL: Record<TenureOrigin, string> = {
  transferee: "이관자",
  existing: "기존(유지)",
  new: "신규",
};

const ORIGIN_BADGE_CLASS: Record<TenureOrigin, string> = {
  transferee: "border-indigo-200 bg-indigo-50 text-indigo-700",
  existing: "border-slate-200 bg-slate-100 text-slate-600",
  new: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: "재직중",
  resigned: "퇴사",
  unknown: "미상",
};

const STATUS_BADGE_CLASS: Record<EmploymentStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  resigned: "border-rose-200 bg-rose-50 text-rose-600",
  unknown: "border-slate-200 bg-slate-100 text-slate-400",
};

interface RecordDraft {
  project: TenureProjectCode;
  hireDate: string;
  leaveDate: string;
  erpNo: string;
  note: string;
}

const NEW_RECORD_ID = "__new__";

export default function TenureAlert() {
  const [workers, setWorkers] = useState<TenureWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<TenureProjectCode | "all">("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [monthFilter, setMonthFilter] = useState<MonthFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [recordDraft, setRecordDraft] = useState<RecordDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTenureWorkersFS().then((rows) => {
      if (Array.isArray(rows)) setWorkers(rows);
      setLoading(false);
    });
  }, []);

  const views = useMemo(() => workers.map((w) => buildTenureWorkerView(w)), [workers]);

  // 매 렌더마다 오늘 날짜 기준으로 새로 계산 — 월이 바뀐 채로 탭을 오래 켜둬도 항상 실제 이번 달/다음 달을 가리킨다.
  const thisMonthKey = format(new Date(), "yyyy-MM");
  const nextMonthKey = format(addMonths(new Date(), 1), "yyyy-MM");

  const counts = useMemo(() => {
    let thisMonth = 0, nextMonth = 0, critical = 0, transferees = 0, newHires = 0, resigned = 0;
    for (const v of views) {
      if (v.employmentStatus === "resigned") { resigned += 1; continue; } // 퇴사자는 도래 알림 집계 제외
      if (v.cutoffDate.slice(0, 7) === thisMonthKey) thisMonth += 1;
      if (v.cutoffDate.slice(0, 7) === nextMonthKey) nextMonth += 1;
      if (v.dday !== null && v.dday <= 30) critical += 1;
      if (v.origin === "transferee") transferees += 1;
      if (v.origin === "new") newHires += 1;
    }
    return { total: views.length, thisMonth, nextMonth, critical, transferees, newHires, resigned };
  }, [views, thisMonthKey, nextMonthKey]);

  const filtered = useMemo(() => {
    return views
      .filter((v) => {
        if (search.trim() && !v.worker.name.includes(search.trim())) return false;
        if (projectFilter !== "all" && v.currentRecord?.project !== projectFilter) return false;
        if (originFilter !== "all" && v.origin !== originFilter) return false;
        if (statusFilter !== "all" && v.employmentStatus !== statusFilter) return false;
        if (upcomingOnly && (v.dday === null || v.dday > 60)) return false;
        if (criticalOnly && (v.dday === null || v.dday > 30)) return false;
        if (monthFilter === "thisMonth" && v.cutoffDate.slice(0, 7) !== thisMonthKey) return false;
        if (monthFilter === "nextMonth" && v.cutoffDate.slice(0, 7) !== nextMonthKey) return false;
        return true;
      })
      .sort((a, b) => {
        const statusRank = (s: EmploymentStatus) => (s === "active" ? 0 : s === "unknown" ? 1 : 2);
        const rankDiff = statusRank(a.employmentStatus) - statusRank(b.employmentStatus);
        if (rankDiff !== 0) return rankDiff;
        return (a.dday ?? Infinity) - (b.dday ?? Infinity);
      });
  }, [views, search, projectFilter, originFilter, statusFilter, upcomingOnly, criticalOnly, monthFilter, thisMonthKey, nextMonthKey]);

  const detailView = useMemo(() => views.find((v) => v.worker.id === detailId) ?? null, [views, detailId]);

  const persist = (next: TenureWorker[]) => {
    setWorkers(next);
    saveTenureWorkersFS(next).then((ok) => {
      if (!ok) toast.error("Firestore 저장 실패");
    });
  };

  const startEditRecord = (r: EmploymentRecord) => {
    setEditingRecordId(r.id);
    setRecordDraft({ project: r.project, hireDate: r.hireDate, leaveDate: r.leaveDate, erpNo: r.erpNo, note: r.note });
  };

  const startAddRecord = () => {
    setEditingRecordId(NEW_RECORD_ID);
    // 새 이력을 추가하는 시점은 대부분 "오늘" 이관/등록 처리를 하는 경우라 입사일을 오늘 날짜로 기본값 지정
    setRecordDraft({ project: TENURE_PROJECTS[0].code, hireDate: format(new Date(), "yyyy-MM-dd"), leaveDate: "", erpNo: "", note: "" });
  };

  const cancelEditRecord = () => {
    setEditingRecordId(null);
    setRecordDraft(null);
  };

  const saveRecordEdit = (workerId: string) => {
    if (!recordDraft || !recordDraft.hireDate) {
      toast.error("입사일을 입력하세요.");
      return;
    }
    const next = workers.map((w) => {
      if (w.id !== workerId) return w;
      if (editingRecordId === NEW_RECORD_ID) {
        return { ...w, records: [...w.records, { id: crypto.randomUUID(), ...recordDraft }] };
      }
      return { ...w, records: w.records.map((r) => (r.id === editingRecordId ? { ...r, ...recordDraft } : r)) };
    });
    persist(next);
    toast.success("저장되었습니다. 최초입사일/D-day가 자동으로 다시 계산됩니다.");
    cancelEditRecord();
  };

  const deleteRecord = (workerId: string, recordId: string) => {
    if (!window.confirm("이 현장 이력을 삭제할까요?")) return;
    const next = workers.map((w) => (w.id === workerId ? { ...w, records: w.records.filter((r) => r.id !== recordId) } : w));
    persist(next);
    toast.success("삭제되었습니다.");
  };

  const exportToExcel = () => {
    const headers = ["No", "성명", "생년월일", "구분", "상태", "이관경로", "최초입사일", "단절기준일", "D-day", "이관횟수", "현장 이력(날짜)"];
    const dataRows = filtered.map((v, i) => [
      i + 1,
      v.worker.name,
      v.worker.birthDate,
      ORIGIN_LABEL[v.origin],
      STATUS_LABEL[v.employmentStatus],
      v.transferPath.map(tenureProjectLabel).join(" → "),
      v.firstHireDate,
      v.cutoffDate,
      formatDday(v.dday),
      v.transferCount,
      sortRecordsByHireDate(v.worker.records)
        .map((r) => `${tenureProjectLabel(r.project)}(${r.hireDate}~${r.leaveDate || "재직중"})`)
        .join(" → "),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [
      { wch: 4 }, { wch: 8 }, { wch: 11 }, { wch: 9 }, { wch: 7 },
      { wch: 28 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 7 }, { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "근속현황");
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `근속1년도래알림_${dateStr}.xlsx`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const { employmentRows, priorRows } = parseTenureRosterWorkbook(wb);
        if (employmentRows.length === 0 && priorRows.length === 0) {
          toast.error("데이터를 찾을 수 없습니다. 헤더 행(이름/주민번호/현장/입사일)을 확인하세요.");
          return;
        }
        const { workers: merged, newWorkers, newRecords, priorMatches } = mergeRosterRowsIntoWorkers(workers, { employmentRows, priorRows });
        persist(merged);
        toast.success(
          `${employmentRows.length}건 반영 — 신규 인원 ${newWorkers}명, 신규 이력 ${newRecords}건` +
          (priorMatches > 0 ? ` · 참고 이력(구 명단) ${priorMatches}건 (이관자 판별용)` : "")
        );
      } catch {
        toast.error("파일을 읽는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-extrabold text-slate-950">근속 1년 도래 알림</h2>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          현장 이관으로 X-ERP상 최초입사일이 초기화된 근로자를 주민번호 기준으로 묶어, 실제 최초입사일과 만1년 도래 D-day를 추적합니다.
        </p>
      </div>

      {/* 안내문구 */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-900">
        <div className="flex items-start gap-2 mb-1.5">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <p>이 시스템은 P4-PH4 · P4-PH2 · P5-PH1 3개 현장 데이터만 집계합니다. 타 현장·과거 재직 이력은 미반영되므로 확정 전 4대보험 자격취득일과 반드시 크로스체크하세요.</p>
        </div>
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <p>공백일수가 짧으면 형식상 단절해도 계속근로로 통산될 수 있습니다. 상세보기의 공백일수를 통산 여부 소명 근거로 보관하세요.</p>
        </div>
      </div>

      {/* 대시보드 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="전체 인원" value={counts.total} unit="명" />
        <button onClick={() => setMonthFilter((f) => (f === "thisMonth" ? "all" : "thisMonth"))} className={`text-left rounded-xl transition-shadow ${monthFilter === "thisMonth" ? "ring-2 ring-amber-400" : ""}`}>
          <StatCard label="이번 달 도래" value={counts.thisMonth} unit="명" variant="late" />
        </button>
        <button onClick={() => setMonthFilter((f) => (f === "nextMonth" ? "all" : "nextMonth"))} className={`text-left rounded-xl transition-shadow ${monthFilter === "nextMonth" ? "ring-2 ring-amber-400" : ""}`}>
          <StatCard label="다음 달 도래" value={counts.nextMonth} unit="명" variant="late" />
        </button>
        <button onClick={() => setCriticalOnly((v) => !v)} className={`text-left rounded-xl transition-shadow ${criticalOnly ? "ring-2 ring-red-400" : ""}`}>
          <StatCard label="임박 (30일 이내)" value={counts.critical} unit="명" variant="uncheck" />
        </button>
      </div>

      {/* hidden file input */}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />

      {/* 툴바 */}
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 검색..."
              className="h-10 w-48 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setProjectFilter("all")}
              className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-colors ${projectFilter === "all" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              전체현장
            </button>
            {TENURE_PROJECTS.map((p) => (
              <button
                key={p.code}
                onClick={() => setProjectFilter(p.code)}
                className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-colors ${projectFilter === p.code ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {([
              { value: "all", label: "전체" },
              { value: "transferee", label: `이관자 (${counts.transferees})` },
              { value: "new", label: `신규 (${counts.newHires})` },
              { value: "existing", label: "기존(유지)" },
            ] as { value: OriginFilter; label: string }[]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setOriginFilter(opt.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-colors ${originFilter === opt.value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {([
              { value: "all", label: "전체" },
              { value: "active", label: "재직중" },
              { value: "resigned", label: `퇴사 (${counts.resigned})` },
            ] as { value: StatusFilter; label: string }[]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-colors ${statusFilter === opt.value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setUpcomingOnly((v) => !v)}
            className={`h-10 rounded-lg border px-3 text-xs font-extrabold transition-colors ${upcomingOnly ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            임박자만 보기 (60일 이내)
          </button>

          <button
            onClick={exportToExcel}
            className="ml-auto flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4 text-slate-400" />
            엑셀 내려받기
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
          >
            <Upload className="h-4 w-4 text-slate-400" />
            X-ERP 명부 업로드
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 420px)" }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {["성명", "생년월일", "구분", "상태", "현장 (이관경로)", "최초입사일", "단절기준일", "D-day", "이관횟수"].map((col) => (
                <th key={col} className="sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-3 text-center text-[11px] font-extrabold text-slate-600 border-b border-slate-200">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">조건에 해당하는 근로자가 없습니다. 우측 상단에서 X-ERP 명부를 업로드하세요.</td></tr>
            ) : (
              filtered.map((v) => (
                <tr
                  key={v.worker.id}
                  className={`group cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${v.employmentStatus === "resigned" ? "opacity-60" : ""}`}
                  onClick={() => setDetailId(v.worker.id)}
                >
                  <td className="px-3 py-2.5 text-center font-extrabold text-slate-900">{v.worker.name}</td>
                  <td className="px-3 py-2.5 text-center font-medium text-slate-600">{v.worker.birthDate || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${ORIGIN_BADGE_CLASS[v.origin]}`}>
                      {ORIGIN_LABEL[v.origin]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${STATUS_BADGE_CLASS[v.employmentStatus]}`}>
                      {STATUS_LABEL[v.employmentStatus]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-700">
                    {v.transferPath.length > 0 ? (
                      <span className="inline-flex flex-wrap items-center justify-center gap-1">
                        {v.transferPath.map((p, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            {i > 0 && <ArrowRight className="h-3 w-3 text-slate-300 shrink-0" />}
                            {tenureProjectLabel(p)}
                          </span>
                        ))}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center font-medium text-slate-600">{v.firstHireDate || "—"}</td>
                  <td className="px-3 py-2.5 text-center font-medium text-slate-600">{v.cutoffDate || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {v.employmentStatus === "resigned" ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-extrabold ${DDAY_BADGE_CLASS[v.urgency]}`}>
                        {v.urgency === "overdue" && <AlertTriangle className="h-3 w-3" />}
                        {formatDday(v.dday)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-bold text-slate-600">
                    {v.transferCount}
                    {v.origin === "transferee" && v.transferCount === 0 && (
                      <div className="mt-0.5 text-[9px] font-extrabold leading-tight text-amber-600" title="구 명단으로만 확인됨 — 실제 이관일자가 아직 입력되지 않았습니다">
                        날짜 미입력
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 text-xs font-semibold text-slate-400">
        {filtered.length !== views.length ? `${filtered.length}명 표시 / 전체 ${views.length}명` : `총 ${views.length}명`} · 행을 클릭하면 현장 이력 타임라인을 볼 수 있습니다
      </p>

      {/* 상세 뷰 */}
      {detailView && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                {detailView.worker.name}
                <span className="text-xs font-semibold text-muted-foreground">{detailView.worker.birthDate}</span>
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${ORIGIN_BADGE_CLASS[detailView.origin]}`}>
                  {ORIGIN_LABEL[detailView.origin]}
                </span>
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold ${STATUS_BADGE_CLASS[detailView.employmentStatus]}`}>
                  {STATUS_LABEL[detailView.employmentStatus]}
                </span>
              </h3>
              <button onClick={() => setDetailId(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-4 flex-1">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold text-slate-400">최초입사일</p>
                  <p className="text-sm font-extrabold text-slate-900">{detailView.firstHireDate || "—"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold text-slate-400">단절기준일</p>
                  <p className="text-sm font-extrabold text-slate-900">{detailView.cutoffDate || "—"}</p>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${DDAY_BADGE_CLASS[detailView.urgency]}`}>
                  <p className="text-[10px] font-bold opacity-70">D-day</p>
                  <p className="text-sm font-extrabold">{formatDday(detailView.dday)}</p>
                </div>
              </div>

              {detailView.transferPath.length > 1 && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide mb-1">이관 경로</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-extrabold text-indigo-900">
                    {detailView.transferPath.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5">
                        {i > 0 && <ArrowRight className="h-4 w-4 text-indigo-400 shrink-0" />}
                        {tenureProjectLabel(p)}
                      </span>
                    ))}
                  </p>
                  {detailView.transferCount === 0 && (detailView.worker.priorSites?.length ?? 0) > 0 && (
                    <p className="mt-1.5 text-[11px] font-semibold text-indigo-700">
                      구 명단(참고용)에서만 확인된 이력이라 정확한 날짜가 아직 없어 이관횟수·최초입사일에는 반영되지 않았습니다.
                      아래 <span className="font-extrabold">"이력 추가"</span> 버튼으로 이 현장의 실제 입사일/퇴사일을 입력하면 자동으로 반영됩니다.
                    </p>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">현장 이력 타임라인 (직접 수정 가능)</p>
                  {editingRecordId === null && (
                    <button
                      onClick={startAddRecord}
                      className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3 w-3" />
                      이력 추가
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {sortRecordsByHireDate(detailView.worker.records).map((r, idx, arr) => {
                    const gap = detailView.gaps.find((g) => g.beforeRecord.id === r.id);
                    const isEditing = editingRecordId === r.id;
                    return (
                      <div key={r.id}>
                        {gap && (
                          <div className="ml-3 border-l-2 border-dashed border-amber-300 pl-4 py-1.5 text-[11px] font-bold text-amber-700">
                            공백 {gap.days}일 (이관 간격)
                          </div>
                        )}
                        {isEditing ? (
                          <RecordEditForm
                            draft={recordDraft!}
                            onChange={setRecordDraft}
                            onCancel={cancelEditRecord}
                            onSave={() => saveRecordEdit(detailView.worker.id)}
                          />
                        ) : (
                          <div className="group/rec rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-extrabold text-slate-900">{tenureProjectLabel(r.project)}</span>
                              <div className="flex items-center gap-2">
                                {!r.leaveDate && idx === arr.length - 1 && (
                                  <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700">재직중</span>
                                )}
                                {editingRecordId === null && (
                                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/rec:opacity-100">
                                    <button onClick={() => startEditRecord(r)} title="수정" className="text-slate-400 hover:text-slate-900">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => deleteRecord(detailView.worker.id, r.id)} title="삭제" className="text-slate-400 hover:text-rose-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {r.hireDate} ~ {r.leaveDate || "재직중"}
                            </p>
                            {(r.erpNo || r.note) && (
                              <p className="mt-1 text-[11px] font-medium text-slate-400">
                                {r.erpNo && `사번 ${r.erpNo}`}{r.erpNo && r.note && " · "}{r.note}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {editingRecordId === NEW_RECORD_ID && (
                    <RecordEditForm
                      draft={recordDraft!}
                      onChange={setRecordDraft}
                      onCancel={cancelEditRecord}
                      onSave={() => saveRecordEdit(detailView.worker.id)}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
              <button onClick={() => { setDetailId(null); cancelEditRecord(); }} className="px-5 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordEditForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: RecordDraft;
  onChange: (next: RecordDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<RecordDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="rounded-xl border-2 border-slate-900 bg-slate-50 px-4 py-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-bold text-slate-500 block mb-1">현장</label>
          <select
            value={draft.project}
            onChange={(e) => set({ project: e.target.value as TenureProjectCode })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-xs font-semibold outline-none focus:border-slate-400 bg-white"
          >
            {TENURE_PROJECTS.map((p) => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 block mb-1">사번</label>
          <input
            type="text"
            value={draft.erpNo}
            onChange={(e) => set({ erpNo: e.target.value })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-xs outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 block mb-1">입사일 (최초입사일에 반영)</label>
          <input
            type="date"
            value={draft.hireDate}
            onChange={(e) => set({ hireDate: e.target.value })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-xs outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 block mb-1">퇴사일 (비우면 재직중)</label>
          <input
            type="date"
            value={draft.leaveDate}
            onChange={(e) => set({ leaveDate: e.target.value })}
            className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-xs outline-none focus:border-slate-400"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-bold text-slate-500 block mb-1">메모</label>
          <input
            type="text"
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="예: 이관/251103"
            className="w-full px-2 py-1.5 border border-slate-200 rounded-md text-xs outline-none focus:border-slate-400"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-100">
          취소
        </button>
        <button onClick={onSave} className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-bold hover:bg-slate-700">
          저장
        </button>
      </div>
    </div>
  );
}
