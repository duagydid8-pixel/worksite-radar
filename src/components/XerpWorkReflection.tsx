import { useState, useRef, useEffect, useMemo } from "react";
import { Upload, Download, AlertTriangle, CheckCircle, MinusCircle, Search, X, Save, Clock, UserX } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { loadXerpWorkFS, saveXerpWorkFS } from "@/lib/firestoreService";

// ── 시간 유틸 ─────────────────────────────────────────
function parseMin(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    const totalMin = Math.round(val * 24 * 60);
    return totalMin % (24 * 60);
  }
  const s = String(val).trim();
  if (!s) return null;
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const d4 = s.match(/^(\d{2})(\d{2})$/);
  if (d4) return parseInt(d4[1]) * 60 + parseInt(d4[2]);
  return null;
}

function minToStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const STANDARD_START = 7 * 60;   // 420 (07:00)
const STANDARD_END   = 17 * 60;  // 1020 (17:00)
const JOCHUL_CUTOFF  = 7 * 60 + 10; // 430 (07:10)

// 퇴근 50분 기준: 분 >= 50 → 올림, 분 < 50 → 내림
function roundBy50(min: number): number {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 50 ? (h + 1) * 60 : h * 60;
}

// 적용 출근 (조출 여부에 따라 분기)
function resolveEffInMin(rawInMin: number | null, isJochul: boolean): number | null {
  if (rawInMin === null) return null;
  if (!isJochul && rawInMin < JOCHUL_CUTOFF) return STANDARD_START;
  return rawInMin;
}

// 적용 퇴근 (X-ERP, PMIS 각각 50분 기준 후 최대값)
function resolveEffOutMin(xerpOut: unknown, pmisOut: unknown): number | null {
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);
  if (xOMin !== null && pOMin !== null) return Math.max(roundBy50(xOMin), roundBy50(pOMin));
  if (xOMin !== null) return roundBy50(xOMin);
  if (pOMin !== null) return roundBy50(pOMin);
  return null;
}

// 공수 계산 (주간 8시간 충족 기준, 17:00 이후만 연장)
function calcGongsu(effInMin: number | null, effOutMin: number | null, isJochul: boolean): number | null {
  if (effInMin === null || effOutMin === null) return null;
  let total = 1.0;
  if (isJochul && effInMin < STANDARD_START) {
    const jochulMin = STANDARD_START - effInMin;
    total += Math.ceil(jochulMin / 60) * 0.25;
  }
  if (effOutMin > STANDARD_END) {
    const overtimeMin = effOutMin - STANDARD_END;
    total += (overtimeMin / 60) * 0.25; // 50분 반올림으로 이미 정각이므로 정확히 나눔
  }
  return Math.round(total * 100) / 100;
}

function calcDiff(calcVal: number | null, xerpGongsuA: string) {
  const aNum = parseFloat(xerpGongsuA);
  if (calcVal === null || isNaN(aNum)) return { diff: null, needsUpdate: false };
  const d = Math.round((calcVal - aNum) * 100) / 100;
  if (d > 0.001) return { diff: d, needsUpdate: true };
  return { diff: null, needsUpdate: false };
}

// ── 타입 ─────────────────────────────────────────────
interface ProcessedRow {
  rowIndex: number;
  팀명: string; 성명: string;
  xerpIn: string; xerpOut: string;
  pmisIn: string; pmisOut: string;
  rawInMin: number | null;
  rawOutMin: number | null;
  isJochul: boolean;
  effIn: string; effOut: string;
  xerpGongsuA: string;
  calcGongsuVal: number | null;
  diff: number | null;
  needsUpdate: boolean;
  // 상태 플래그
  isNoRecord: boolean;  // 출근 or 퇴근 기록 없음
  isLate: boolean;      // 지각 (적용 출근 > 07:00)
}

// ── 컴포넌트 ─────────────────────────────────────────
interface Props { isAdmin: boolean }

export default function XerpWorkReflection({ isAdmin }: Props) {
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 마운트 시 저장된 데이터 로드
  useEffect(() => {
    loadXerpWorkFS().then((data) => {
      if (data?.rows && data.rows.length > 0) {
        setRows(data.rows as ProcessedRow[]);
        setFileName(data.fileName ?? null);
        toast.info(`저장된 데이터를 불러왔습니다. (${data.fileName})`);
      }
    });
  }, []);

  // 조출 토글 → 해당 행만 재계산
  const toggleJochul = (rowIndex: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      const newJochul   = !r.isJochul;
      const effInMin    = resolveEffInMin(r.rawInMin, newJochul);
      const effIn       = effInMin !== null ? minToStr(effInMin) : "";
      const calcVal     = calcGongsu(effInMin, r.rawOutMin, newJochul);
      const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
      const isLate      = effInMin !== null && effInMin > STANDARD_START;
      return { ...r, isJochul: newJochul, effIn, calcGongsuVal: calcVal, diff, needsUpdate, isLate };
    }));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellStyles: true, cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      const rawFmt: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

      let dataStart = 0;
      for (let i = 0; i < Math.min(raw.length, 6); i++) {
        if ((raw[i] as unknown[]).some((c) =>
          ["팀명", "팀", "성명", "이름", "사번"].includes(String(c).trim())
        )) dataStart = i + 1;
      }

      const processed: ProcessedRow[] = [];

      for (let i = dataStart; i < raw.length; i++) {
        const row    = raw[i]    as unknown[];
        const rowFmt = rawFmt[i] as unknown[];
        if (row.every((c) => String(c).trim() === "")) continue;

        const 팀명 = String(row[0] ?? "").trim();
        const 성명 = String(row[3] ?? "").trim();
        if (!성명) continue;

        const xerpInRaw  = row[5] ?? "";
        const xerpOutRaw = row[6] ?? "";
        const pmisInRaw  = row[7] ?? "";
        const pmisOutRaw = row[8] ?? "";

        const xerpInStr  = String(rowFmt[5] ?? "").trim();
        const xerpOutStr = String(rowFmt[6] ?? "").trim();
        const pmisInStr  = String(rowFmt[7] ?? "").trim();
        const pmisOutStr = String(rowFmt[8] ?? "").trim();

        const xerpGongsuA = String(row[16] ?? "").trim();

        const xerpInMin = parseMin(xerpInRaw);
        const pmisInMin = parseMin(pmisInRaw);
        // 둘 다 있으면 더 이른 시간 채택 (X-ERP 지각 시 PMIS 확인)
        const rawInMin = xerpInMin !== null && pmisInMin !== null
          ? Math.min(xerpInMin, pmisInMin)
          : xerpInMin ?? pmisInMin;
        const rawOutMin = resolveEffOutMin(xerpOutRaw, pmisOutRaw);
        const effOut    = rawOutMin !== null ? minToStr(rawOutMin) : "";

        const isJochul  = false;
        const effInMin  = resolveEffInMin(rawInMin, isJochul);
        const effIn     = effInMin !== null ? minToStr(effInMin) : "";

        const calcVal = calcGongsu(effInMin, rawOutMin, isJochul);
        const { diff, needsUpdate } = calcDiff(calcVal, xerpGongsuA);

        // 상태 판단
        const isNoRecord = rawInMin === null || rawOutMin === null;
        const isLate     = !isNoRecord && effInMin !== null && effInMin > STANDARD_START;

        processed.push({
          rowIndex: i,
          팀명, 성명,
          xerpIn: xerpInStr, xerpOut: xerpOutStr,
          pmisIn: pmisInStr, pmisOut: pmisOutStr,
          rawInMin, rawOutMin,
          isJochul,
          effIn, effOut,
          xerpGongsuA,
          calcGongsuVal: calcVal,
          diff, needsUpdate,
          isNoRecord, isLate,
        });
      }

      setRows(processed);
      setWorkbook(wb);
      setFileName(file.name);

      const noRec  = processed.filter((r) => r.isNoRecord).length;
      const late   = processed.filter((r) => r.isLate).length;
      const needs  = processed.filter((r) => r.needsUpdate).length;
      toast.success(`${processed.length}명 불러옴 — 기록없음 ${noRec}명 · 지각 ${late}명 · 가산필요 ${needs}명`);
    } catch {
      toast.error("파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleSave = async () => {
    if (!rows.length || !fileName) return;
    setIsSaving(true);
    const ok = await saveXerpWorkFS(fileName, rows);
    setIsSaving(false);
    if (ok) toast.success("저장되었습니다.");
    else toast.error("저장 실패");
  };

  const handleDownload = () => {
    if (!workbook || !fileName) return;
    const wbCopy = XLSX.read(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }), {
      type: "array", cellStyles: true,
    });
    const ws = wbCopy.Sheets[wbCopy.SheetNames[0]];
    for (const row of rows) {
      if (row.needsUpdate && row.diff !== null) {
        const colAddr  = XLSX.utils.encode_col(19);
        const cellAddr = `${colAddr}${row.rowIndex + 1}`;
        const existing = ws[cellAddr];
        ws[cellAddr] = { ...(existing ?? {}), t: "n", v: row.diff, w: String(row.diff) };
      }
    }
    XLSX.writeFile(wbCopy, fileName.replace(/\.xlsx?$/i, "") + "_공수반영.xlsx", { cellStyles: true, bookType: "xlsx" });
    toast.success("수정된 파일을 다운로드했습니다.");
  };

  // 검색 필터
  const displayRows = useMemo(() => {
    const q = search.trim();
    if (!q) return rows;
    return rows.filter((r) => r.성명.includes(q) || r.팀명.includes(q));
  }, [rows, search]);

  const needCount   = rows.filter((r) => r.needsUpdate).length;
  const noRecCount  = rows.filter((r) => r.isNoRecord).length;
  const lateCount   = rows.filter((r) => r.isLate).length;

  const cell = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-border/40 last:border-r-0";
  const th   = "px-2 py-2 text-[11px] font-semibold text-muted-foreground bg-muted/50 text-center border-r border-border/40 last:border-r-0 sticky top-0 z-10";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-foreground shrink-0">XERP 공수 반영</h2>

      {/* 업로드 / 저장 / 다운로드 바 */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-border rounded-xl px-4 py-3 shadow-sm shrink-0">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Upload className="h-4 w-4" />
          엑셀 업로드
        </button>

        {fileName && (
          <span className="text-xs text-muted-foreground font-medium truncate max-w-[200px]">{fileName}</span>
        )}

        {rows.length > 0 && (
          <>
            {/* 요약 배지 */}
            {noRecCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg">
                <UserX className="h-3.5 w-3.5" /> 기록없음 {noRecCount}명
              </span>
            )}
            {lateCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1.5 rounded-lg">
                <Clock className="h-3.5 w-3.5" /> 지각 {lateCount}명
              </span>
            )}
            {needCount > 0 ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                <AlertTriangle className="h-3.5 w-3.5" /> 가산필요 {needCount}명
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
                <CheckCircle className="h-3.5 w-3.5" /> 전원일치
              </span>
            )}

            {/* 저장 버튼 */}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "저장 중..." : "저장"}
            </button>

            {/* 다운로드 버튼 (원본 엑셀 있을 때만) */}
            {workbook && (
              <button
                onClick={handleDownload}
                className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                수정 파일 다운로드
              </button>
            )}
          </>
        )}
      </div>

      {/* 검색창 */}
      {rows.length > 0 && (
        <div className="relative w-full max-w-xs shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 팀명 검색..."
            className="w-full pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* 범례 */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" /> 기록없음 (출·퇴근 중 하나 이상 미기록)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> 지각 (적용 출근 07:00 초과)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-300 inline-block" /> 가산공수 필요</span>
        </div>
      )}

      {/* 계산 규칙 안내 */}
      {rows.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700 space-y-1.5 shrink-0">
          <p className="font-bold text-blue-800 mb-2">공수 계산 규칙</p>
          <p>· <b>출근</b>: X-ERP 우선, 없으면 PMIS / 07:10 이전은 07:00 고정 (조출 미체크 시)</p>
          <p>· <b>퇴근</b>: X-ERP·PMIS 각각 50분 기준 반올림 후 최대값</p>
          <p>· <b>기본공수</b>: 07:00 ~ 17:00 = <b>1.0공</b></p>
          <p>· <b>연장공수</b>: 17:00 초과 → 시간당 <b>+0.25공</b> (50분 미만 미인정)</p>
          <p>· <b>조출공수</b>: 체크 시 07:00 이전 시간당 <b>+0.25공</b></p>
        </div>
      )}

      {/* 결과 테이블 */}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 300px)" }}>
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className={th}>팀명</th>
                <th className={th}>성명</th>
                <th className={`${th} bg-violet-50`}>조출근무</th>
                <th className={th}>XERP 출근</th>
                <th className={th}>XERP 퇴근</th>
                <th className={th}>PMIS 출근</th>
                <th className={th}>PMIS 퇴근</th>
                <th className={`${th} bg-blue-50`}>적용 출근</th>
                <th className={`${th} bg-blue-50`}>적용 퇴근</th>
                <th className={th}>공수A (XERP)</th>
                <th className={`${th} bg-emerald-50`}>계산 공수</th>
                <th className={`${th} bg-amber-50`}>가산B 신청</th>
                <th className={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-sm text-muted-foreground">
                    "{search}"에 해당하는 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => {
                  // 행 배경색 우선순위: 기록없음 > 지각 > 가산필요
                  const rowBg = row.isNoRecord
                    ? "bg-rose-50/60 hover:bg-rose-50"
                    : row.isLate
                      ? "bg-orange-50/60 hover:bg-orange-50"
                      : row.needsUpdate
                        ? "bg-amber-50/40 hover:bg-amber-50/70"
                        : "hover:bg-muted/20";

                  return (
                    <tr key={`${row.rowIndex}-${row.성명}`} className={`border-b border-border/60 last:border-0 transition-colors ${rowBg}`}>
                      <td className={cell}>{row.팀명 || "—"}</td>
                      <td className={`${cell} font-medium`}>{row.성명}</td>

                      {/* 조출 체크박스 */}
                      <td className={`${cell} bg-violet-50/30`}>
                        <label className="flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.isJochul}
                            onChange={() => toggleJochul(row.rowIndex)}
                            className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
                          />
                        </label>
                      </td>

                      <td className={`${cell} tabular-nums ${!row.xerpIn ? "text-rose-400 font-semibold" : "text-blue-600"}`}>
                        {row.xerpIn || "미기록"}
                      </td>
                      <td className={`${cell} tabular-nums ${!row.xerpOut ? "text-rose-400 font-semibold" : "text-red-600"}`}>
                        {row.xerpOut || "미기록"}
                      </td>
                      <td className={`${cell} tabular-nums ${!row.pmisIn ? "text-rose-400 font-semibold" : "text-blue-400"}`}>
                        {row.pmisIn || "미기록"}
                      </td>
                      <td className={`${cell} tabular-nums ${!row.pmisOut ? "text-rose-400 font-semibold" : "text-red-400"}`}>
                        {row.pmisOut || "미기록"}
                      </td>

                      {/* 적용 출근 — 지각 시 강조 */}
                      <td className={`${cell} bg-blue-50/40 font-semibold tabular-nums
                        ${row.isLate ? "text-orange-600" :
                          row.isJochul && row.rawInMin !== null && row.rawInMin < STANDARD_START ? "text-violet-700" : "text-blue-700"}`}>
                        {row.effIn || "—"}
                        {row.isLate && <span className="ml-1 text-[9px] font-bold text-orange-500">지각</span>}
                        {row.isJochul && row.rawInMin !== null && row.rawInMin < STANDARD_START && (
                          <span className="ml-1 text-[9px] font-bold text-violet-500">조출</span>
                        )}
                      </td>
                      <td className={`${cell} bg-blue-50/40 font-semibold tabular-nums ${row.rawOutMin === null ? "text-rose-400" : "text-blue-700"}`}>
                        {row.effOut || "—"}
                      </td>

                      <td className={`${cell} tabular-nums`}>{row.xerpGongsuA || "—"}</td>
                      <td className={`${cell} bg-emerald-50/40 font-bold text-emerald-700 tabular-nums`}>
                        {row.calcGongsuVal !== null ? row.calcGongsuVal.toFixed(2) : "—"}
                      </td>
                      <td className={`${cell} bg-amber-50/40 font-bold tabular-nums ${row.needsUpdate ? "text-amber-700" : "text-muted-foreground"}`}>
                        {row.needsUpdate && row.diff !== null ? `+${row.diff.toFixed(2)}` : "—"}
                      </td>

                      {/* 상태 */}
                      <td className={cell}>
                        <div className="flex flex-col items-center gap-0.5">
                          {row.isNoRecord && (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                              <UserX className="h-3 w-3" /> 기록없음
                            </span>
                          )}
                          {row.isLate && (
                            <span className="inline-flex items-center gap-1 text-orange-600 font-semibold">
                              <Clock className="h-3 w-3" /> 지각
                            </span>
                          )}
                          {!row.isNoRecord && row.needsUpdate && (
                            <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                              <AlertTriangle className="h-3 w-3" /> 가산필요
                            </span>
                          )}
                          {!row.isNoRecord && !row.isLate && !row.needsUpdate && row.calcGongsuVal !== null && (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                              <CheckCircle className="h-3 w-3" /> 정상
                            </span>
                          )}
                          {row.calcGongsuVal === null && !row.isNoRecord && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <MinusCircle className="h-3 w-3" /> 데이터없음
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
