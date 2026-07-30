import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  Loader2,
  Pencil,
  Save,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildLeaveUsage,
  deriveLeaveStatusRows,
  exportAnnualLeaveManagementExcel,
  getUsageDays,
  parseAnnualLeaveRosterWorkbook,
  type LeaveManagedEmployee,
  type LeaveUsage,
  type LeaveUsageType,
} from "@/lib/annualLeaveManagement";
import {
  loadAnnualLeaveManagementFS,
  saveAnnualLeaveManagementFS,
} from "@/lib/firestoreService";

interface AnnualLeaveManagementPageProps {
  isAdmin: boolean;
  initialEmployees?: LeaveManagedEmployee[];
  initialUsages?: LeaveUsage[];
  initialBasisDate?: string;
}

const USAGE_TYPES: LeaveUsageType[] = ["연차", "오전반차", "오후반차"];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatLeave(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sortUsages(usages: LeaveUsage[]): LeaveUsage[] {
  return [...usages].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export default function AnnualLeaveManagementPage({
  isAdmin,
  initialEmployees,
  initialUsages,
  initialBasisDate,
}: AnnualLeaveManagementPageProps) {
  const usesInitialData = initialEmployees !== undefined || initialUsages !== undefined;
  const [employees, setEmployees] = useState<LeaveManagedEmployee[]>(initialEmployees ?? []);
  const [usages, setUsages] = useState<LeaveUsage[]>(initialUsages ?? []);
  const [basisDate, setBasisDate] = useState(initialBasisDate ?? todayKey());
  const [usageDate, setUsageDate] = useState(initialBasisDate ?? todayKey());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialEmployees?.[0]?.id ?? "");
  const [usageType, setUsageType] = useState<LeaveUsageType>("연차");
  const [memo, setMemo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUsageId, setEditingUsageId] = useState<string | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(initialEmployees?.[0]?.id ?? null);
  const [uploadedAt, setUploadedAt] = useState("");
  const [isLoading, setIsLoading] = useState(!usesInitialData);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (usesInitialData) return;
    let cancelled = false;
    loadAnnualLeaveManagementFS()
      .then((snapshot) => {
        if (cancelled) return;
        setEmployees(snapshot.employees);
        setUsages(snapshot.usages);
        setUploadedAt(snapshot.uploadedAt);
        if (snapshot.employees[0]) {
          setSelectedEmployeeId(snapshot.employees[0].id);
          setSelectedDetailId(snapshot.employees[0].id);
        }
      })
      .catch(() => toast.error("연차 데이터를 불러오지 못했습니다."))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [usesInitialData]);

  useEffect(() => {
    if (!selectedEmployeeId && employees[0]) setSelectedEmployeeId(employees[0].id);
    if (!selectedDetailId && employees[0]) setSelectedDetailId(employees[0].id);
  }, [employees, selectedDetailId, selectedEmployeeId]);

  const statusRows = useMemo(
    () => deriveLeaveStatusRows(employees, usages, basisDate),
    [basisDate, employees, usages]
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return statusRows;
    return statusRows.filter((row) =>
      [row.employee.project, row.employee.category, row.employee.name, row.employee.department]
        .join(" ")
        .includes(query)
    );
  }, [searchQuery, statusRows]);

  useEffect(() => {
    if (!searchQuery.trim() || filteredRows.length !== 1) return;
    const matchedEmployeeId = filteredRows[0].employee.id;
    if (matchedEmployeeId !== selectedDetailId) {
      setSelectedDetailId(matchedEmployeeId);
    }
  }, [filteredRows, searchQuery, selectedDetailId]);

  const summary = useMemo(() => {
    return statusRows.reduce(
      (acc, row) => ({
        totalEmployees: acc.totalEmployees + 1,
        totalAccrued: acc.totalAccrued + row.accrued,
        totalUsed: acc.totalUsed + row.used,
        totalRemaining: acc.totalRemaining + row.remaining,
        negativeRemaining: acc.negativeRemaining + (row.remaining < 0 ? 1 : 0),
      }),
      { totalEmployees: 0, totalAccrued: 0, totalUsed: 0, totalRemaining: 0, negativeRemaining: 0 }
    );
  }, [statusRows]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );

  const detailEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedDetailId) ?? null,
    [employees, selectedDetailId]
  );

  const detailUsages = useMemo(
    () => sortUsages(usages.filter((usage) => usage.employeeId === selectedDetailId)),
    [selectedDetailId, usages]
  );

  const resetUsageForm = () => {
    setUsageDate(basisDate);
    setUsageType("연차");
    setMemo("");
    setEditingUsageId(null);
  };

  const handleRosterUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseAnnualLeaveRosterWorkbook(buffer);
      if (parsed.errors.length > 0) {
        toast.error(parsed.errors.slice(0, 3).join("\n"));
        return;
      }
      setEmployees(parsed.employees);
      setSelectedEmployeeId(parsed.employees[0]?.id ?? "");
      setSelectedDetailId(parsed.employees[0]?.id ?? null);
      if (parsed.basisDate) {
        setBasisDate(parsed.basisDate);
        setUsageDate(parsed.basisDate);
      }
      setUploadedAt(new Date().toISOString());
      toast.success(`${parsed.employees.length}명의 명단을 불러왔습니다.`);
    } catch {
      toast.error("명단 엑셀 파일을 읽지 못했습니다.");
    }
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    setIsSaving(true);
    const savedAt = new Date().toISOString();
    try {
      const ok = await saveAnnualLeaveManagementFS({ employees, usages, uploadedAt: savedAt });
      if (!ok) {
        toast.error("연차 데이터를 저장하지 못했습니다.");
        return;
      }
      setUploadedAt(savedAt);
      toast.success("연차 데이터를 저장했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitUsage = () => {
    if (!selectedEmployee) {
      toast.error("직원을 선택하세요.");
      return;
    }
    if (!usageDate) {
      toast.error("사용일을 입력하세요.");
      return;
    }

    if (editingUsageId) {
      setUsages((current) =>
        current.map((usage) =>
          usage.id === editingUsageId
            ? {
                ...usage,
                date: usageDate,
                employeeId: selectedEmployee.id,
                employeeName: selectedEmployee.name,
                type: usageType,
                days: getUsageDays(usageType),
                memo: memo.trim(),
                updatedAt: new Date().toISOString(),
              }
            : usage
        )
      );
      resetUsageForm();
      return;
    }

    setUsages((current) => [
      ...current,
      buildLeaveUsage({
        date: usageDate,
        employee: selectedEmployee,
        type: usageType,
        memo,
      }),
    ]);
    setSelectedDetailId(selectedEmployee.id);
    resetUsageForm();
  };

  const handleEditUsage = (usage: LeaveUsage) => {
    setEditingUsageId(usage.id);
    setUsageDate(usage.date);
    setSelectedEmployeeId(usage.employeeId);
    setUsageType(usage.type);
    setMemo(usage.memo);
  };

  const handleDeleteUsage = (usageId: string) => {
    setUsages((current) => current.filter((usage) => usage.id !== usageId));
    if (editingUsageId === usageId) resetUsageForm();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-bold text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        연차 데이터를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 p-5 md:p-7">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                <CalendarDays className="h-4.5 w-4.5 text-slate-700" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-slate-950">연차관리</h1>
                <p className="mt-0.5 text-xs font-semibold text-slate-400">
                  명단 업로드 후 사용내역을 입력하면 발생·사용·잔여 연차가 자동 계산됩니다.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50">
              <Upload className="h-4 w-4 text-slate-400" />
              명단 업로드
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={!isAdmin}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleRosterUpload(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isAdmin || isSaving}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              저장
            </button>
            <button
              type="button"
              onClick={() => exportAnnualLeaveManagementExcel(statusRows, sortUsages(usages))}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Download className="h-4 w-4 text-slate-400" />
              엑셀 다운로드
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
          <label className="text-[11px] font-extrabold text-slate-400">
            기준일
            <input
              type="date"
              value={basisDate}
              onChange={(event) => setBasisDate(event.target.value || todayKey())}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:bg-white"
            />
          </label>
          <div className="text-xs font-semibold text-slate-400">
            {uploadedAt ? `최근 저장: ${uploadedAt.slice(0, 10)} ${uploadedAt.slice(11, 16)}` : "저장된 연차 데이터가 아직 없습니다."}
          </div>
        </div>
      </section>

      <section className="grid gap-2.5 md:grid-cols-5">
        {[
          { label: "총 인원", value: summary.totalEmployees, unit: "명", icon: <Users className="h-4 w-4" />, color: "text-slate-950" },
          { label: "총 발생연차", value: formatLeave(summary.totalAccrued), unit: "일", icon: <CalendarDays className="h-4 w-4" />, color: "text-sky-700" },
          { label: "총 사용연차", value: formatLeave(summary.totalUsed), unit: "일", icon: <Pencil className="h-4 w-4" />, color: "text-amber-700" },
          { label: "총 잔여연차", value: formatLeave(summary.totalRemaining), unit: "일", icon: <Save className="h-4 w-4" />, color: "text-emerald-700" },
          { label: "잔여 부족", value: summary.negativeRemaining, unit: "명", icon: <AlertTriangle className="h-4 w-4" />, color: "text-rose-700" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-extrabold text-slate-400">{card.label}</p>
              <span className={card.color}>{card.icon}</span>
            </div>
            <p className={`mt-2 text-2xl font-extrabold tabular-nums ${card.color}`}>
              {card.value}
              <span className="ml-0.5 text-xs font-semibold text-slate-400">{card.unit}</span>
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
            <div className="mr-auto">
              <h2 className="text-sm font-extrabold text-slate-950">직원별 연차 현황</h2>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">입사월부터 월 1개씩 발생합니다.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="이름, 부서, 프로젝트 검색"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              />
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm font-bold text-slate-400">
              표시할 직원 명단이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left font-extrabold text-slate-400">
                    <th className="px-4 py-2.5">소속프로젝트</th>
                    <th className="px-4 py-2.5">구분</th>
                    <th className="px-4 py-2.5">이름</th>
                    <th className="px-4 py-2.5">부서</th>
                    <th className="px-4 py-2.5">입사일</th>
                    <th className="px-4 py-2.5 text-right">발생</th>
                    <th className="px-4 py-2.5 text-right">사용</th>
                    <th className="px-4 py-2.5 text-right">잔여</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.employee.id}
                      className="border-b border-slate-100 transition-colors hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{row.employee.project || "-"}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.employee.category || "-"}</td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedDetailId(row.employee.id)}
                          className="font-extrabold text-slate-950 transition-colors hover:text-sky-700"
                        >
                          {row.employee.name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{row.employee.department || "-"}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{row.employee.hireDate}</td>
                      <td className="px-4 py-2.5 text-right font-extrabold text-sky-700">{formatLeave(row.accrued)}</td>
                      <td className="px-4 py-2.5 text-right font-extrabold text-amber-700">{formatLeave(row.used)}</td>
                      <td
                        className={`px-4 py-2.5 text-right font-extrabold ${row.remaining < 0 ? "text-rose-700" : "text-emerald-700"}`}
                        data-testid={`remaining-${row.employee.id}`}
                      >
                        {formatLeave(row.remaining)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-extrabold text-slate-950">연차 사용 입력</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-[11px] font-extrabold text-slate-400">
                사용일
                <input
                  type="date"
                  value={usageDate}
                  disabled={!isAdmin}
                  onChange={(event) => setUsageDate(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:bg-white disabled:opacity-60"
                />
              </label>

              <label className="text-[11px] font-extrabold text-slate-400">
                직원
                <select
                  value={selectedEmployeeId}
                  disabled={!isAdmin}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:bg-white disabled:opacity-60"
                >
                  <option value="">직원 선택</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} · {employee.department || employee.project}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[11px] font-extrabold text-slate-400">
                구분
                <select
                  value={usageType}
                  disabled={!isAdmin}
                  onChange={(event) => setUsageType(event.target.value as LeaveUsageType)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:bg-white disabled:opacity-60"
                >
                  {USAGE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[11px] font-extrabold text-slate-400">
                메모
                <input
                  value={memo}
                  disabled={!isAdmin}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder="사유 또는 참고사항"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-300 focus:bg-white disabled:opacity-60"
                />
              </label>

              <button
                type="button"
                disabled={!isAdmin}
                onClick={handleSubmitUsage}
                className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editingUsageId ? "사용내역 수정" : "사용내역 추가"}
              </button>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-extrabold text-slate-950">연차 사용내역</h2>
              {detailEmployee && (
                <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{detailEmployee.name} 기준</p>
              )}
            </div>
            {detailUsages.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs font-bold text-slate-400">
                선택한 직원의 사용내역이 없습니다.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {detailUsages.map((usage) => (
                  <div key={usage.id} className="grid grid-cols-[minmax(0,1fr)_72px] gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-500">{usage.date}</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">
                          {usage.type}
                        </span>
                        <span className="text-xs font-extrabold text-amber-700">{formatLeave(usage.days)}일</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-500">{usage.memo || "-"}</p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-start justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditUsage(usage)}
                          aria-label="사용내역 수정"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUsage(usage.id)}
                          aria-label="사용내역 삭제"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
