import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, FileSpreadsheet, Save, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  analyzeFinalWorkUnits,
  coercePmisData,
  parseMonthlyXerpAttendance,
  type FinalWorkUnitsPmisData,
  type FinalWorkUnitsRow,
  type FinalWorkUnitsStatus,
  type MonthlyXerpAttendanceRecord,
} from "@/lib/finalWorkUnitsCheck";
import { coerceElectronicCardData, type ElectronicCardDateData } from "@/lib/electronicCardSync";
import {
  loadElectronicCardFS,
  loadFinalWorkUnitsReviewMemoryFS,
  saveFinalWorkUnitsMonthFS,
  loadPmisLogFS,
  loadXerpDateFS,
} from "@/lib/firestoreService";
import { buildFinalWorkUnitsMonthSnapshot, finalWorkUnitsMonthKey } from "@/lib/finalWorkUnitsMonthlySave";
import {
  findFinalWorkUnitsReviewSuggestion,
  type FinalWorkUnitsReviewMemoryEntry,
  type FinalWorkUnitsReviewSuggestion,
} from "@/lib/finalWorkUnitsReviewMemory";

type StatusFilter = "all" | FinalWorkUnitsStatus;
type XerpPmisLoadStatus = "loading" | "loaded" | "missing" | "error";

interface Props {
  site: string;
  pmisData?: unknown;
}

interface ReviewState {
  flags: string[];
  memo: string;
}

const REVIEW_KEY = "final_work_units_review_v1";
const REVIEW_FLAGS = ["확인완료", "특이사항", "문의필요", "수정필요", "보류"] as const;
const INITIAL_VISIBLE_ROWS = 200;

const STATUS_META: Record<FinalWorkUnitsStatus, { label: string; className: string }> = {
  "missing-work-units": { label: "공수반영누락", className: "bg-rose-100 text-rose-700 border-rose-200" },
  "overtime-review": { label: "연장", className: "bg-orange-100 text-orange-700 border-orange-200" },
  "gasan-review": { label: "가산사유", className: "bg-violet-100 text-violet-700 border-violet-200" },
  "pmis-review": { label: "PMIS", className: "bg-amber-100 text-amber-700 border-amber-200" },
  "pmis-not-uploaded": { label: "PMIS미업로드", className: "bg-slate-100 text-slate-600 border-slate-200" },
  "electronic-card-reference": { label: "전자카드", className: "bg-sky-100 text-sky-700 border-sky-200" },
  "electronic-card-not-saved": { label: "전자카드미저장", className: "bg-slate-100 text-slate-600 border-slate-200" },
  normal: { label: "정상", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "missing-work-units", label: "공수반영누락" },
  { value: "overtime-review", label: "연장" },
  { value: "gasan-review", label: "가산사유" },
  { value: "pmis-review", label: "PMIS" },
  { value: "electronic-card-reference", label: "전자카드" },
  { value: "normal", label: "정상" },
];

function loadReviewState(): Record<string, ReviewState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReviewState(state: Record<string, ReviewState>) {
  localStorage.setItem(REVIEW_KEY, JSON.stringify(state));
}

function minDate(records: MonthlyXerpAttendanceRecord[]): string {
  return records.map((record) => record.date).sort()[0] ?? "";
}

function maxDate(records: MonthlyXerpAttendanceRecord[]): string {
  return records.map((record) => record.date).sort().at(-1) ?? "";
}

function defaultStartDate(records: MonthlyXerpAttendanceRecord[]): string {
  const dates = records.map((record) => record.date).sort();
  const preferred = dates.find((date) => date.endsWith("-05-13"));
  return preferred ?? dates[0] ?? "";
}

function defaultEndDate(records: MonthlyXerpAttendanceRecord[]): string {
  const dates = records.map((record) => record.date).sort();
  const preferred = [...dates].reverse().find((date) => date.endsWith("-05-20"));
  return preferred ?? dates.at(-1) ?? "";
}

function displayUnits(value: number | null): string {
  if (value === null) return "";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function xerpPmisLoadLabel(status: XerpPmisLoadStatus | undefined): string {
  if (status === "loading" || !status) return "XERP&PMIS 확인 중";
  if (status === "error") return "XERP&PMIS 로드 실패";
  if (status === "missing") return "XERP&PMIS 자료 없음";
  return "로드됨";
}

function displayGasanReason(row: FinalWorkUnitsRow, xerpPmisStatus: XerpPmisLoadStatus | undefined): string {
  const reasons = [row.gasanReason, row.xerpPmisReason]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) return uniqueReasons.join(" / ");
  if (row.xerpPmisExtraUnits > 0) return `가산 ${displayUnits(row.xerpPmisExtraUnits)} · 사유 없음`;
  if (xerpPmisStatus !== "loaded") return xerpPmisLoadLabel(xerpPmisStatus);
  if (!row.hasXerpPmisMatch) return "XERP&PMIS 매칭 없음";
  return "";
}

function reviewFor(row: FinalWorkUnitsRow, reviews: Record<string, ReviewState>): ReviewState {
  return reviews[row.id] ?? { flags: [], memo: "" };
}

function datesInRange(records: MonthlyXerpAttendanceRecord[], startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  return [...new Set(records.filter((record) => record.date >= startDate && record.date <= endDate).map((record) => record.date))].sort();
}

export default function FinalWorkUnitsCheck({ site, pmisData }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<MonthlyXerpAttendanceRecord[]>([]);
  const [savedPmisByDate, setSavedPmisByDate] = useState<Record<string, FinalWorkUnitsPmisData>>({});
  const [savedElectronicCardByDate, setSavedElectronicCardByDate] = useState<Record<string, ElectronicCardDateData>>({});
  const [savedXerpPmisByDate, setSavedXerpPmisByDate] = useState<Record<string, unknown[]>>({});
  const [xerpPmisLoadStatusByDate, setXerpPmisLoadStatusByDate] = useState<Record<string, XerpPmisLoadStatus>>({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ROWS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(() => loadReviewState());
  const [isSavingMonth, setIsSavingMonth] = useState(false);
  const [reviewMemoryEntries, setReviewMemoryEntries] = useState<FinalWorkUnitsReviewMemoryEntry[]>([]);
  const [reviewMemoryStatus, setReviewMemoryStatus] = useState<"loading" | "loaded" | "error">("loading");

  const requiredDates = useMemo(() => datesInRange(records, startDate, endDate), [records, startDate, endDate]);

  useEffect(() => {
    let active = true;
    setReviewMemoryStatus("loading");
    loadFinalWorkUnitsReviewMemoryFS(site)
      .then((entries) => {
        if (!active) return;
        setReviewMemoryEntries(entries);
        setReviewMemoryStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setReviewMemoryEntries([]);
        setReviewMemoryStatus("error");
      });
    return () => {
      active = false;
    };
  }, [site]);

  useEffect(() => {
    if (requiredDates.length === 0) {
      setSavedPmisByDate({});
      setSavedElectronicCardByDate({});
      setSavedXerpPmisByDate({});
      setXerpPmisLoadStatusByDate({});
      return;
    }

    let active = true;
    setXerpPmisLoadStatusByDate(Object.fromEntries(requiredDates.map((date) => [date, "loading" as const])));
    async function loadNeededEvidence() {
      try {
        const [pmisEntries, electronicCardEntries, xerpPmisEntries] = await Promise.all([
          Promise.all(
            requiredDates.map(async (date) => {
              try {
                const loaded = await loadPmisLogFS(site, date);
                return [date, coercePmisData(loaded)] as const;
              } catch {
                return [date, null] as const;
              }
            })
          ),
          Promise.all(
            requiredDates.map(async (date) => {
              try {
                const loaded = await loadElectronicCardFS(site, date);
                return [date, coerceElectronicCardData(loaded)] as const;
              } catch {
                return [date, null] as const;
              }
            })
          ),
          Promise.all(
            requiredDates.map(async (date) => {
              try {
                const loaded = await loadXerpDateFS(site, date);
                return {
                  date,
                  rows: Array.isArray(loaded) ? loaded : null,
                  status: Array.isArray(loaded) ? "loaded" as const : "missing" as const,
                };
              } catch {
                return { date, rows: null, status: "error" as const };
              }
            })
          ),
        ]);
        if (!active) return;
        setSavedPmisByDate(Object.fromEntries(pmisEntries.filter((entry): entry is readonly [string, FinalWorkUnitsPmisData] => Boolean(entry[1]))));
        setSavedElectronicCardByDate(Object.fromEntries(electronicCardEntries.filter((entry): entry is readonly [string, ElectronicCardDateData] => Boolean(entry[1]))));
        setSavedXerpPmisByDate(Object.fromEntries(xerpPmisEntries.filter((entry) => Array.isArray(entry.rows)).map((entry) => [entry.date, entry.rows as unknown[]])));
        setXerpPmisLoadStatusByDate(Object.fromEntries(xerpPmisEntries.map((entry) => [entry.date, entry.status])));
      } catch {
        if (!active) return;
        setSavedPmisByDate({});
        setSavedElectronicCardByDate({});
        setSavedXerpPmisByDate({});
        setXerpPmisLoadStatusByDate(Object.fromEntries(requiredDates.map((date) => [date, "error" as const])));
      }
    }
    void loadNeededEvidence();
    return () => {
      active = false;
    };
  }, [requiredDates, site]);

  const pmisByDate = useMemo(() => {
    const next = { ...savedPmisByDate };
    const current = coercePmisData(pmisData);
    if (current) next[current.dateLabel] = current;
    return next;
  }, [pmisData, savedPmisByDate]);

  const analysis = useMemo(() => {
    if (!records.length || !startDate || !endDate) return null;
    return analyzeFinalWorkUnits({
      monthlyRecords: records,
      pmisByDate,
      electronicCardByDate: savedElectronicCardByDate,
      xerpPmisByDate: savedXerpPmisByDate,
      startDate,
      endDate,
    });
  }, [records, pmisByDate, savedElectronicCardByDate, savedXerpPmisByDate, startDate, endDate]);

  const saveMonthKey = useMemo(() => finalWorkUnitsMonthKey(startDate, endDate), [startDate, endDate]);

  const reviewSuggestionByRowId = useMemo(() => {
    const suggestions: Record<string, FinalWorkUnitsReviewSuggestion> = {};
    for (const row of analysis?.rows ?? []) {
      const suggestion = findFinalWorkUnitsReviewSuggestion(row, reviewMemoryEntries);
      if (suggestion) suggestions[row.id] = suggestion;
    }
    return suggestions;
  }, [analysis, reviewMemoryEntries]);

  const reviewSuggestionCount = useMemo(() => Object.keys(reviewSuggestionByRowId).length, [reviewSuggestionByRowId]);

  const filteredRows = useMemo(() => {
    const rows = analysis?.rows ?? [];
    const normalizedQuery = query.replace(/\s+/g, "").trim();
    return rows.filter((row) => {
      if (statusFilter === "gasan-review") {
        if (!row.gasanReason?.trim() && !row.xerpPmisReason?.trim() && row.xerpPmisExtraUnits <= 0) return false;
      } else if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }
      if (normalizedQuery && !row.name.replace(/\s+/g, "").includes(normalizedQuery)) return false;
      return true;
    });
  }, [analysis, query, statusFilter]);

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_ROWS);
  }, [analysis, query, statusFilter, startDate, endDate]);

  const visibleRows = useMemo(() => filteredRows.slice(0, visibleLimit), [filteredRows, visibleLimit]);

  const completedCount = useMemo(
    () => (analysis?.rows ?? []).filter((row) => reviewFor(row, reviews).flags.includes("확인완료")).length,
    [analysis, reviews]
  );
  const xerpPmisLoadedDateCount = useMemo(
    () => Object.values(xerpPmisLoadStatusByDate).filter((status) => status === "loaded").length,
    [xerpPmisLoadStatusByDate]
  );
  const xerpPmisLoadingDateCount = useMemo(
    () => Object.values(xerpPmisLoadStatusByDate).filter((status) => status === "loading").length,
    [xerpPmisLoadStatusByDate]
  );

  const handleUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseMonthlyXerpAttendance(buffer);
      if (!parsed.length) {
        toast.error("월간출퇴근현황 데이터를 찾지 못했습니다.");
        return;
      }
      setRecords(parsed);
      setFileName(file.name);
      setStartDate(defaultStartDate(parsed));
      setEndDate(defaultEndDate(parsed));
      setStatusFilter("all");
      setExpandedId(null);
      toast.success(`${parsed.length}건을 불러왔습니다.`);
    } catch (error) {
      toast.error(`파일을 읽지 못했습니다: ${(error as Error).message}`);
    }
  };

  const updateReview = (rowId: string, updater: (current: ReviewState) => ReviewState) => {
    setReviews((prev) => {
      const current = prev[rowId] ?? { flags: [], memo: "" };
      const next = { ...prev, [rowId]: updater(current) };
      saveReviewState(next);
      return next;
    });
  };

  const handleSaveMonth = async () => {
    if (!analysis) return;
    if (!saveMonthKey) {
      toast.error("월단위 저장은 시작일과 종료일이 같은 달일 때만 가능합니다.");
      return;
    }
    setIsSavingMonth(true);
    try {
      const snapshot = buildFinalWorkUnitsMonthSnapshot({
        site,
        month: saveMonthKey,
        startDate,
        endDate,
        fileName,
        summary: analysis.summary,
        rows: analysis.rows,
        reviews,
      });
      const ok = await saveFinalWorkUnitsMonthFS(site, saveMonthKey, snapshot);
      if (ok) {
        const entries = await loadFinalWorkUnitsReviewMemoryFS(site);
        setReviewMemoryEntries(entries);
        setReviewMemoryStatus("loaded");
        toast.success(`${saveMonthKey} 최종공수반영 저장 완료 (${analysis.rows.length}건)`);
      } else {
        toast.error("최종공수반영 저장 실패");
      }
    } catch {
      toast.error("최종공수반영 저장 실패");
    } finally {
      setIsSavingMonth(false);
    }
  };

  const dateMin = minDate(records);
  const dateMax = maxDate(records);

  return (
    <div className="space-y-3 p-4 md:p-5">
      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">최종공수확인</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              XERP 월간출퇴근현황, PMIS 출퇴근, 가산사유를 한 화면에서 확인합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" />
              월간출퇴근현황 업로드
            </button>
          </div>
        </div>

        {fileName && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>{fileName}</span>
            <span className="text-slate-300">|</span>
            <span>PMIS 저장 날짜 {Object.keys(pmisByDate).length}개</span>
            <span className="text-slate-300">|</span>
            <span>전자카드 저장 날짜 {Object.keys(savedElectronicCardByDate).length}개</span>
            <span className="text-slate-300">|</span>
            <span>
              XERP&PMIS 로드 {xerpPmisLoadedDateCount}/{requiredDates.length}개
              {xerpPmisLoadingDateCount > 0 ? ` · 확인 중 ${xerpPmisLoadingDateCount}개` : ""}
            </span>
            <span className="text-slate-300">|</span>
            <span>
              이전검토 {reviewMemoryStatus === "loading" ? "확인 중" : reviewMemoryStatus === "error" ? "로드 실패" : `${reviewMemoryEntries.length}건`}
              {reviewSuggestionCount > 0 ? ` · 추천 ${reviewSuggestionCount}건` : ""}
            </span>
          </div>
        )}
      </section>

      {analysis ? (
        <>
          {requiredDates.length > 0 && xerpPmisLoadingDateCount === 0 && xerpPmisLoadedDateCount === 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              XERP&PMIS 저장자료가 로드되지 않았습니다. 로컬 브라우저 로그인 상태, 현장 선택(PH4/PH2/P5), 저장 날짜를 확인하세요.
              자료가 로드되지 않은 날짜는 가산사유 칸에 사유 없음 대신 XERP&PMIS 자료 없음으로 표시합니다.
            </section>
          )}

          <section className="grid gap-2 md:grid-cols-5">
            <SummaryCard label="확인 기간" value={`${startDate.slice(5)}~${endDate.slice(5)}`} />
            <SummaryCard label="전체" value={analysis.summary.total} />
            <SummaryCard label="확인필요" value={analysis.summary.needsReview} tone="danger" />
            <SummaryCard label="증빙부족" value={analysis.summary.evidenceMissing} />
            <SummaryCard label="확인완료" value={completedCount} tone="success" />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_TABS.map((tab) => {
                const count = tab.value === "all" ? analysis.summary.total : analysis.summary[tab.value];
                const active = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setStatusFilter(tab.value)}
                    className={`rounded-full border px-2.5 py-1.5 text-xs font-extrabold transition-colors ${
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {tab.label} <span className={active ? "text-white/80" : "text-slate-400"}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                시작일
                <input
                  type="date"
                  min={dateMin}
                  max={dateMax}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                종료일
                <input
                  type="date"
                  min={dateMin}
                  max={dateMax}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                />
              </label>
              <div className="ml-auto flex min-w-[220px] items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="이름 검색"
                  className="min-w-0 flex-1 text-xs font-semibold outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveMonth}
                disabled={isSavingMonth || !analysis}
                title="같은 월에 다시 저장하면 기존 최종공수반영 저장본을 새 내용으로 업데이트합니다."
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-extrabold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {isSavingMonth ? "저장 중..." : saveMonthKey ? `${saveMonthKey} 새로 저장` : "월단위 저장"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
              {filteredRows.length}건 중 {visibleRows.length}건 표시 중
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[2400px] w-full border-collapse text-xs">
                <thead className="whitespace-nowrap bg-slate-50 text-left text-[11px] font-extrabold text-slate-500">
                  <tr>
                    <th className="min-w-[96px] px-2 py-2">상태</th>
                    <th className="min-w-[96px] px-2 py-2">이름</th>
                    <th className="min-w-[120px] px-2 py-2">팀</th>
                    <th className="min-w-[56px] px-2 py-2">날짜</th>
                    <th className="px-2 py-2">XERP 출근</th>
                    <th className="px-2 py-2">XERP 퇴근</th>
                    <th className="px-2 py-2">시스템 공수</th>
                    <th className="px-2 py-2">예상공수</th>
                    <th className="px-2 py-2">반영공수</th>
                    <th className="px-2 py-2">부족</th>
                    <th className="px-2 py-2">증빙</th>
                    <th className="px-2 py-2">근무시간</th>
                    <th className="min-w-[320px] px-2 py-2">가산사유</th>
                    <th className="px-2 py-2">PMIS 출근</th>
                    <th className="px-2 py-2">PMIS 퇴근</th>
                    <th className="px-2 py-2">전자카드 출근</th>
                    <th className="px-2 py-2">전자카드 퇴근</th>
                    <th className="min-w-[320px] px-2 py-2">확인 내용</th>
                    <th className="min-w-[220px] px-2 py-2">검토</th>
                    <th className="px-2 py-2">메모</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <WorkUnitRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      review={reviewFor(row, reviews)}
                      reviewSuggestion={reviewSuggestionByRowId[row.id]}
                      xerpPmisLoadStatus={xerpPmisLoadStatusByDate[row.date]}
                      onToggleExpanded={() => setExpandedId((current) => (current === row.id ? null : row.id))}
                      onToggleFlag={(flag) =>
                        updateReview(row.id, (current) => ({
                          ...current,
                          flags: current.flags.includes(flag) ? current.flags.filter((item) => item !== flag) : [...current.flags, flag],
                        }))
                      }
                      onMemoChange={(memo) => updateReview(row.id, (current) => ({ ...current, memo }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {visibleRows.length < filteredRows.length && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-200 px-3 py-3">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((current) => Math.min(current + INITIAL_VISIBLE_ROWS, filteredRows.length))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  200건 더 보기
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleLimit(filteredRows.length)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
                >
                  전체 표시
                </button>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-slate-300" />
          <h3 className="mt-3 text-sm font-extrabold text-slate-800">월간출퇴근현황 파일을 업로드하세요</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            업로드하면 날짜 범위, 상태 메뉴, 상세 확인표가 표시됩니다.
          </p>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "danger" | "success" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black ${tone === "danger" ? "text-rose-600" : tone === "success" ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function reviewSuggestionMatchLabel(matchType: FinalWorkUnitsReviewSuggestion["matchType"]): string {
  if (matchType === "same-worker") return "같은 작업자";
  if (matchType === "same-reason") return "같은 사유";
  return "유사 패턴";
}

function reviewSuggestionPreview(suggestion: FinalWorkUnitsReviewSuggestion): string {
  const flags = suggestion.entry.flags.join(", ");
  return [flags, suggestion.entry.memo].filter(Boolean).join(" / ") || "-";
}

function reviewSuggestionReason(entry: FinalWorkUnitsReviewMemoryEntry): string {
  return [entry.gasanReason, entry.xerpPmisReason].filter(Boolean).join(" / ") || "-";
}

function WorkUnitRow({
  row,
  expanded,
  review,
  reviewSuggestion,
  xerpPmisLoadStatus,
  onToggleExpanded,
  onToggleFlag,
  onMemoChange,
}: {
  row: FinalWorkUnitsRow;
  expanded: boolean;
  review: ReviewState;
  reviewSuggestion?: FinalWorkUnitsReviewSuggestion;
  xerpPmisLoadStatus: XerpPmisLoadStatus | undefined;
  onToggleExpanded: () => void;
  onToggleFlag: (flag: string) => void;
  onMemoChange: (memo: string) => void;
}) {
  const meta = STATUS_META[row.status];
  const gasanReason = displayGasanReason(row, xerpPmisLoadStatus);
  const gasanReasonIsWarning = !row.gasanReason?.trim() && !row.xerpPmisReason?.trim() && row.xerpPmisExtraUnits <= 0 && gasanReason !== "";
  const reviewSuggestionLabel = reviewSuggestion ? reviewSuggestionMatchLabel(reviewSuggestion.matchType) : "";
  return (
    <>
      <tr
        onClick={onToggleExpanded}
        className="cursor-pointer border-b border-slate-100 align-middle hover:bg-slate-50"
        title="클릭하면 상세정보를 확인합니다."
      >
        <td className="whitespace-nowrap px-2 py-2">
          <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-extrabold ${meta.className}`}>{meta.label}</span>
        </td>
        <td className="whitespace-nowrap px-2 py-2 font-extrabold text-slate-900">{row.name}</td>
        <td className="whitespace-nowrap px-2 py-2 text-slate-600">{row.team}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{row.date.slice(5)}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.xerpIn || "-"}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.xerpOut || "-"}</td>
        <td className="whitespace-nowrap px-2 py-2 font-black tabular-nums">{displayUnits(row.systemWorkUnits) || "-"}</td>
        <td className="whitespace-nowrap px-2 py-2 font-black tabular-nums text-emerald-700">{displayUnits(row.expectedWorkUnits) || "-"}</td>
        <td className="whitespace-nowrap px-2 py-2 font-black tabular-nums text-slate-800">{displayUnits(row.reflectedWorkUnits) || "-"}</td>
        <td className={`whitespace-nowrap px-2 py-2 font-black tabular-nums ${row.missingWorkUnits > 0 ? "text-rose-600" : "text-slate-400"}`}>
          {row.missingWorkUnits > 0 ? displayUnits(row.missingWorkUnits) : "-"}
        </td>
        <td className="px-2 py-2">
          <span className={`rounded-md px-1.5 py-1 font-bold ${row.evidenceSource === "XERP" ? "bg-slate-100 text-slate-600" : "bg-sky-50 text-sky-700"}`}>
            {row.evidenceSource}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.workTime || "-"}</td>
        <td className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2">
          {gasanReason ? (
            <span className={`inline-block whitespace-pre-wrap break-words rounded-md px-1.5 py-1 font-bold leading-5 ${
              gasanReasonIsWarning ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"
            }`}>
              {gasanReason}
            </span>
          ) : (
            <span className="inline-block whitespace-nowrap rounded-md bg-slate-50 px-1.5 py-1 font-bold text-slate-400">
              사유 없음
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.pmisUploaded ? row.pmisIn || "없음" : "미업로드"}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.pmisUploaded ? row.pmisOut || "없음" : "미업로드"}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.electronicCardSaved ? row.electronicCardIn || "없음" : "미저장"}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.electronicCardSaved ? row.electronicCardOut || "없음" : "미저장"}</td>
        <td className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2 font-semibold leading-5 text-slate-600">{row.message}</td>
        <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
          <div className="flex flex-wrap gap-1">
            {REVIEW_FLAGS.map((flag) => (
              <label key={flag} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] font-bold text-slate-600">
                <input type="checkbox" checked={review.flags.includes(flag)} onChange={() => onToggleFlag(flag)} />
                {flag}
              </label>
            ))}
          </div>
          {reviewSuggestion && (
            <div className="mt-1 max-w-[260px] rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold leading-4 text-emerald-700">
              <div>이전 검토 · {reviewSuggestionLabel} · {reviewSuggestion.entry.month}</div>
              <div className="mt-0.5 whitespace-pre-wrap break-words text-emerald-800">{reviewSuggestionPreview(reviewSuggestion)}</div>
            </div>
          )}
        </td>
        <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
          <input
            value={review.memo}
            onChange={(event) => onMemoChange(event.target.value)}
            placeholder="메모"
            className="w-[180px] rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-slate-400"
          />
        </td>
        <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={onToggleExpanded} className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={21} className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <DetailBox
                title="XERP 월간출퇴근현황"
                rows={[
                  ["출근", row.xerpIn || "-"],
                  ["퇴근", row.xerpOut || "-"],
                  ["시스템 공수", displayUnits(row.systemWorkUnits) || "-"],
                  ["근무시간", row.workTime || "-"],
                ]}
              />
              <DetailBox
                title="공수 계산 / 증빙"
                rows={[
                  ["예상공수", displayUnits(row.expectedWorkUnits) || "-"],
                  ["반영공수", displayUnits(row.reflectedWorkUnits) || "-"],
                  ["부족공수", row.missingWorkUnits > 0 ? displayUnits(row.missingWorkUnits) : "-"],
                  ["증빙출처", row.evidenceSource],
                  ["자동사유", row.autoReason || "-"],
                  ["PMIS 출근", row.pmisUploaded ? row.pmisIn || "없음" : "미업로드"],
                  ["PMIS 퇴근", row.pmisUploaded ? row.pmisOut || "없음" : "미업로드"],
                  ["PMIS 이벤트", row.pmisUploaded ? `${row.pmisEvents}회` : "-"],
                  ["전자카드 출근", row.electronicCardSaved ? row.electronicCardIn || "없음" : "미저장"],
                  ["전자카드 퇴근", row.electronicCardSaved ? row.electronicCardOut || "없음" : "미저장"],
                ]}
              />
              <DetailBox
                title="판정 근거"
                rows={[
                  ["상태", row.statusLabel],
                  ["가산사유 표시", gasanReason || "사유 없음"],
                  ["월간 XERP 사유", row.gasanReason || "없음"],
                  ["XERP&PMIS 로드", xerpPmisLoadLabel(xerpPmisLoadStatus)],
                  ["XERP&PMIS 매칭", xerpPmisLoadStatus === "loaded" ? (row.hasXerpPmisMatch ? "매칭됨" : "매칭 없음") : "-"],
                  ["XERP&PMIS 사유", row.xerpPmisReason || "없음"],
                  ["XERP&PMIS 가산", row.xerpPmisExtraUnits > 0 ? displayUnits(row.xerpPmisExtraUnits) : "-"],
                  ["사진증빙", row.hasXerpPmisPhoto ? "있음" : "-"],
                  ["확인 내용", row.message],
                  ["근거", row.checks.join(" / ") || "-"],
                ]}
              />
              {reviewSuggestion && (
                <DetailBox
                  title="이전 검토"
                  rows={[
                    ["매칭", `${reviewSuggestionLabel} / ${reviewSuggestion.entry.month}`],
                    ["작업자", reviewSuggestion.entry.name],
                    ["검토", reviewSuggestion.entry.flags.join(", ") || "-"],
                    ["메모", reviewSuggestion.entry.memo || "-"],
                    ["당시 사유", reviewSuggestionReason(reviewSuggestion.entry)],
                    ["당시 판단", reviewSuggestion.entry.message || "-"],
                  ]}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-2 text-xs font-black text-slate-800">{title}</h4>
      <div className="space-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
            <span className="font-bold text-slate-400">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words font-semibold text-slate-700">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
