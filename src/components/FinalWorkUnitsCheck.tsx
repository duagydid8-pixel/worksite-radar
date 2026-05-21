import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, FileSpreadsheet, Search, Upload } from "lucide-react";
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
import { listElectronicCardDatesFS, listPmisLogDatesFS, loadElectronicCardFS, loadPmisLogFS } from "@/lib/firestoreService";

type StatusFilter = "all" | FinalWorkUnitsStatus;

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

const STATUS_META: Record<FinalWorkUnitsStatus, { label: string; className: string }> = {
  "missing-work-units": { label: "공수누락", className: "bg-rose-100 text-rose-700 border-rose-200" },
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
  { value: "missing-work-units", label: "공수누락" },
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
  return Number.isInteger(value) ? String(value) : String(value);
}

function reviewFor(row: FinalWorkUnitsRow, reviews: Record<string, ReviewState>): ReviewState {
  return reviews[row.id] ?? { flags: [], memo: "" };
}

export default function FinalWorkUnitsCheck({ site, pmisData }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<MonthlyXerpAttendanceRecord[]>([]);
  const [savedPmisByDate, setSavedPmisByDate] = useState<Record<string, FinalWorkUnitsPmisData>>({});
  const [savedElectronicCardByDate, setSavedElectronicCardByDate] = useState<Record<string, ElectronicCardDateData>>({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(() => loadReviewState());

  useEffect(() => {
    let active = true;
    async function loadSavedPmis() {
      try {
        const dates = await listPmisLogDatesFS(site);
        const entries = await Promise.all(
          dates.map(async (date) => {
            const loaded = await loadPmisLogFS(site, date);
            return [date, coercePmisData(loaded)] as const;
          })
        );
        if (!active) return;
        setSavedPmisByDate(Object.fromEntries(entries.filter((entry): entry is readonly [string, FinalWorkUnitsPmisData] => Boolean(entry[1]))));
      } catch {
        if (active) setSavedPmisByDate({});
      }
    }
    loadSavedPmis();
    return () => {
      active = false;
    };
  }, [site]);

  useEffect(() => {
    let active = true;
    async function loadSavedElectronicCards() {
      try {
        const dates = await listElectronicCardDatesFS(site);
        const entries = await Promise.all(
          dates.map(async (date) => {
            const loaded = await loadElectronicCardFS(site, date);
            return [date, coerceElectronicCardData(loaded)] as const;
          })
        );
        if (!active) return;
        setSavedElectronicCardByDate(Object.fromEntries(entries.filter((entry): entry is readonly [string, ElectronicCardDateData] => Boolean(entry[1]))));
      } catch {
        if (active) setSavedElectronicCardByDate({});
      }
    }
    loadSavedElectronicCards();
    return () => {
      active = false;
    };
  }, [site]);

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
      startDate,
      endDate,
    });
  }, [records, pmisByDate, savedElectronicCardByDate, startDate, endDate]);

  const filteredRows = useMemo(() => {
    const rows = analysis?.rows ?? [];
    const normalizedQuery = query.replace(/\s+/g, "").trim();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (normalizedQuery && !row.name.replace(/\s+/g, "").includes(normalizedQuery)) return false;
      return true;
    });
  }, [analysis, query, statusFilter]);

  const completedCount = useMemo(
    () => (analysis?.rows ?? []).filter((row) => reviewFor(row, reviews).flags.includes("확인완료")).length,
    [analysis, reviews]
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
          </div>
        )}
      </section>

      {analysis ? (
        <>
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
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
              {filteredRows.length}건 표시 중
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[1500px] w-full border-collapse text-xs">
                <thead className="bg-slate-50 text-left text-[11px] font-extrabold text-slate-500">
                  <tr>
                    <th className="px-2 py-2">상태</th>
                    <th className="px-2 py-2">이름</th>
                    <th className="px-2 py-2">팀</th>
                    <th className="px-2 py-2">날짜</th>
                    <th className="px-2 py-2">XERP 출근</th>
                    <th className="px-2 py-2">XERP 퇴근</th>
                    <th className="px-2 py-2">시스템 공수</th>
                    <th className="px-2 py-2">근무시간</th>
                    <th className="px-2 py-2">가산사유</th>
                    <th className="px-2 py-2">PMIS 출근</th>
                    <th className="px-2 py-2">PMIS 퇴근</th>
                    <th className="px-2 py-2">전자카드 출근</th>
                    <th className="px-2 py-2">전자카드 퇴근</th>
                    <th className="px-2 py-2">확인 내용</th>
                    <th className="px-2 py-2">검토</th>
                    <th className="px-2 py-2">메모</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <WorkUnitRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      review={reviewFor(row, reviews)}
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

function WorkUnitRow({
  row,
  expanded,
  review,
  onToggleExpanded,
  onToggleFlag,
  onMemoChange,
}: {
  row: FinalWorkUnitsRow;
  expanded: boolean;
  review: ReviewState;
  onToggleExpanded: () => void;
  onToggleFlag: (flag: string) => void;
  onMemoChange: (memo: string) => void;
}) {
  const meta = STATUS_META[row.status];
  return (
    <>
      <tr
        onClick={onToggleExpanded}
        className="cursor-pointer border-b border-slate-100 align-middle hover:bg-slate-50"
        title="클릭하면 상세정보를 확인합니다."
      >
        <td className="px-2 py-2">
          <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-extrabold ${meta.className}`}>{meta.label}</span>
        </td>
        <td className="px-2 py-2 font-extrabold text-slate-900">{row.name}</td>
        <td className="px-2 py-2 text-slate-600">{row.team}</td>
        <td className="px-2 py-2 tabular-nums text-slate-700">{row.date.slice(5)}</td>
        <td className="px-2 py-2 tabular-nums">{row.xerpIn || "-"}</td>
        <td className="px-2 py-2 tabular-nums">{row.xerpOut || "-"}</td>
        <td className="px-2 py-2 font-black tabular-nums">{displayUnits(row.systemWorkUnits) || "-"}</td>
        <td className="px-2 py-2 tabular-nums">{row.workTime || "-"}</td>
        <td className="px-2 py-2">
          {row.gasanReason ? <span className="rounded-md bg-violet-50 px-1.5 py-1 font-bold text-violet-700">{row.gasanReason}</span> : "-"}
        </td>
        <td className="px-2 py-2 tabular-nums">{row.pmisUploaded ? row.pmisIn || "없음" : "미업로드"}</td>
        <td className="px-2 py-2 tabular-nums">{row.pmisUploaded ? row.pmisOut || "없음" : "미업로드"}</td>
        <td className="px-2 py-2 tabular-nums">{row.electronicCardSaved ? row.electronicCardIn || "없음" : "미저장"}</td>
        <td className="px-2 py-2 tabular-nums">{row.electronicCardSaved ? row.electronicCardOut || "없음" : "미저장"}</td>
        <td className="max-w-[220px] whitespace-normal px-2 py-2 font-semibold leading-5 text-slate-600">{row.message}</td>
        <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
          <div className="flex flex-wrap gap-1">
            {REVIEW_FLAGS.map((flag) => (
              <label key={flag} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[11px] font-bold text-slate-600">
                <input type="checkbox" checked={review.flags.includes(flag)} onChange={() => onToggleFlag(flag)} />
                {flag}
              </label>
            ))}
          </div>
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
          <td colSpan={17} className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-3">
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
                title="PMIS / 전자카드 증빙"
                rows={[
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
                  ["가산사유", row.gasanReason || "-"],
                  ["확인 내용", row.message],
                  ["근거", row.checks.join(" / ") || "-"],
                ]}
              />
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
          <div key={label} className="grid grid-cols-[90px_1fr] gap-2">
            <span className="font-bold text-slate-400">{label}</span>
            <span className="font-semibold text-slate-700">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
