import { useState, useRef } from "react";
import { Upload, Download, AlertTriangle, CheckCircle, MinusCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

// ── 시간 유틸 ─────────────────────────────────────────
function parseMin(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;

  // Excel 시간 시리얼 (하루 = 1.0, 예: 17:00 = 0.7083...)
  if (typeof val === "number") {
    const totalMin = Math.round(val * 24 * 60);
    return totalMin % (24 * 60);
  }

  const s = String(val).trim();
  if (!s) return null;

  // "HH:MM" 또는 "HH:MM:SS"
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);

  // "HHMM" 4자리 숫자 문자열
  const d4 = s.match(/^(\d{2})(\d{2})$/);
  if (d4) return parseInt(d4[1]) * 60 + parseInt(d4[2]);

  return null;
}

function minToStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// X-ERP 퇴근: 정각절사 (17:35 → 17:00)
function truncateHour(min: number): number {
  return Math.floor(min / 60) * 60;
}

// PMIS 퇴근: 10분올림 (17:35 → 17:40)
function roundUp10(min: number): number {
  return Math.ceil(min / 10) * 10;
}

const STANDARD_START = 7 * 60;  // 420 (07:00)
const STANDARD_END   = 17 * 60; // 1020 (17:00)
const JOCHUL_CUTOFF  = 7 * 60 + 10; // 430 (07:10)

// 적용 출근 계산 (조출 여부에 따라 분기)
function resolveEffInMin(rawInMin: number | null, isJochul: boolean): number | null {
  if (rawInMin === null) return null;
  if (!isJochul && rawInMin < JOCHUL_CUTOFF) return STANDARD_START; // 07:10 이전 → 07:00 고정
  return rawInMin;
}

// 적용 퇴근 계산
function resolveEffOutMin(xerpOut: unknown, pmisOut: unknown): number | null {
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);
  if (xOMin !== null && pOMin !== null) return Math.max(truncateHour(xOMin), roundUp10(pOMin));
  if (xOMin !== null) return truncateHour(xOMin);
  if (pOMin !== null) return roundUp10(pOMin);
  return null;
}

// 공수 계산
// · 조출 체크 O: 07:00 이전 시간 → 시간당 +0.25공
// · 표준: 07:00~17:00 = 1.0공
// · 연장: 17:00 초과 → 분 단위 올림 → 시간당 +0.25공
function calcGongsu(effInMin: number | null, effOutMin: number | null, isJochul: boolean): number | null {
  if (effInMin === null || effOutMin === null) return null;

  let total = 1.0;

  // 조출 공수 (07:00 이전 근무)
  if (isJochul && effInMin < STANDARD_START) {
    const jochulMin = STANDARD_START - effInMin;
    total += Math.ceil(jochulMin / 60) * 0.25;
  }

  // 연장 공수 (17:00 이후 근무)
  if (effOutMin > STANDARD_END) {
    const overtimeMin = effOutMin - STANDARD_END;
    total += Math.ceil(overtimeMin / 60) * 0.25;
  }

  return Math.round(total * 100) / 100;
}

// diff + needsUpdate 계산
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
  팀명: string;
  성명: string;
  xerpIn: string; xerpOut: string;
  pmisIn: string; pmisOut: string;
  rawInMin: number | null;   // X-ERP 우선 / PMIS 폴백한 실제 출근 분
  rawOutMin: number | null;  // 적용 퇴근 분 (고정)
  isJochul: boolean;
  effIn: string; effOut: string;
  xerpGongsuA: string;
  calcGongsuVal: number | null;
  diff: number | null;
  needsUpdate: boolean;
}

// ── 컴포넌트 ─────────────────────────────────────────
interface Props { isAdmin: boolean }

export default function XerpWorkReflection({ isAdmin }: Props) {
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 조출 토글 → 해당 행만 재계산
  const toggleJochul = (rowIndex: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      const newJochul = !r.isJochul;
      const effInMin  = resolveEffInMin(r.rawInMin, newJochul);
      const effIn     = effInMin !== null ? minToStr(effInMin) : "";
      const calcVal   = calcGongsu(effInMin, r.rawOutMin, newJochul);
      const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
      return { ...r, isJochul: newJochul, effIn, calcGongsuVal: calcVal, diff, needsUpdate };
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

      // 헤더 행 탐색
      let dataStart = 0;
      for (let i = 0; i < Math.min(raw.length, 6); i++) {
        if ((raw[i] as unknown[]).some((c) =>
          ["팀명", "팀", "성명", "이름", "사번"].includes(String(c).trim())
        )) {
          dataStart = i + 1;
        }
      }

      const processed: ProcessedRow[] = [];

      for (let i = dataStart; i < raw.length; i++) {
        const row    = raw[i]    as unknown[];
        const rowFmt = rawFmt[i] as unknown[];
        if (row.every((c) => String(c).trim() === "")) continue;

        const 팀명 = String(row[0] ?? "").trim();
        const 성명 = String(row[3] ?? "").trim();
        if (!성명) continue;

        // 시간 raw (숫자 시리얼 포함)
        const xerpInRaw  = row[5]  ?? "";
        const xerpOutRaw = row[6]  ?? "";
        const pmisInRaw  = row[7]  ?? "";
        const pmisOutRaw = row[8]  ?? "";

        // 표시용 문자열
        const xerpInStr  = String(rowFmt[5]  ?? "").trim();
        const xerpOutStr = String(rowFmt[6]  ?? "").trim();
        const pmisInStr  = String(rowFmt[7]  ?? "").trim();
        const pmisOutStr = String(rowFmt[8]  ?? "").trim();

        const xerpGongsuA = String(row[16] ?? "").trim();

        // rawInMin: X-ERP 우선, 없으면 PMIS
        const xerpInMin = parseMin(xerpInRaw);
        const pmisInMin = parseMin(pmisInRaw);
        const rawInMin  = xerpInMin ?? pmisInMin;

        // rawOutMin: 고정 (조출과 무관)
        const rawOutMin = resolveEffOutMin(xerpOutRaw, pmisOutRaw);
        const effOut    = rawOutMin !== null ? minToStr(rawOutMin) : "";

        // 초기 isJochul = false
        const isJochul  = false;
        const effInMin  = resolveEffInMin(rawInMin, isJochul);
        const effIn     = effInMin !== null ? minToStr(effInMin) : "";

        const calcVal = calcGongsu(effInMin, rawOutMin, isJochul);
        const { diff, needsUpdate } = calcDiff(calcVal, xerpGongsuA);

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
          diff,
          needsUpdate,
        });
      }

      setRows(processed);
      setWorkbook(wb);
      setFileName(file.name);

      const cnt = processed.filter((r) => r.needsUpdate).length;
      if (cnt > 0) toast.warning(`${cnt}명의 가산공수(B) 신청이 필요합니다.`);
      else toast.success("모든 공수가 X-ERP 기록과 일치합니다.");
    } catch {
      toast.error("파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleDownload = () => {
    if (!workbook || !fileName) return;

    const wbCopy = XLSX.read(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }), {
      type: "array",
      cellStyles: true,
    });
    const ws = wbCopy.Sheets[wbCopy.SheetNames[0]];

    for (const row of rows) {
      if (row.needsUpdate && row.diff !== null) {
        const colAddr  = XLSX.utils.encode_col(19);
        const cellAddr = `${colAddr}${row.rowIndex + 1}`;
        const existing = ws[cellAddr];
        ws[cellAddr] = {
          ...(existing ?? {}),
          t: "n",
          v: row.diff,
          w: String(row.diff),
        };
      }
    }

    XLSX.writeFile(wbCopy, fileName.replace(/\.xlsx?$/i, "") + "_공수반영.xlsx", { cellStyles: true, bookType: "xlsx" });
    toast.success("수정된 파일을 다운로드했습니다.");
  };

  const needCount = rows.filter((r) => r.needsUpdate).length;
  const cell = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-border/40 last:border-r-0";
  const th   = "px-2 py-2 text-[11px] font-semibold text-muted-foreground bg-muted/50 text-center border-r border-border/40 last:border-r-0 sticky top-0 z-10";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-foreground shrink-0">XERP 공수 반영</h2>

      {/* 업로드 + 다운로드 바 */}
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
          <span className="text-xs text-muted-foreground font-medium truncate max-w-[260px]">{fileName}</span>
        )}

        {rows.length > 0 && (
          <>
            {needCount > 0 ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                <AlertTriangle className="h-3.5 w-3.5" />
                가산공수 필요 {needCount}명
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                <CheckCircle className="h-3.5 w-3.5" />
                전원 일치
              </span>
            )}

            <button
              onClick={handleDownload}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              수정 파일 다운로드
            </button>
          </>
        )}
      </div>

      {/* 계산 규칙 안내 */}
      {rows.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700 space-y-1.5 shrink-0">
          <p className="font-bold text-blue-800 mb-2">공수 계산 규칙</p>
          <p>· <b>출근</b>: X-ERP 우선, 없으면 PMIS 적용</p>
          <p>· <b>퇴근</b>: X-ERP 정각절사 vs PMIS 10분올림 중 최대값</p>
          <p>· <b>기본공수</b>: 07:00 ~ 17:00 (중식 2시간 제외) = 8시간 = <b>1.0공</b></p>
          <p>· <b>연장공수</b>: 17:00 초과분 → 분 단위 올림 → 시간당 <b>+0.25공</b></p>
          <p>· <b>조출근무</b>: 체크 시 07:00 이전 시간도 시간당 <b>+0.25공</b> 추가</p>
          <p>· 조출 미체크 시 07:10 이전 출근은 적용출근을 <b>07:00으로 고정</b></p>
        </div>
      )}

      {/* 결과 테이블 */}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 260px)" }}>
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
              {rows.map((row) => (
                <tr
                  key={`${row.rowIndex}-${row.성명}`}
                  className={`border-b border-border/60 last:border-0 transition-colors
                    ${row.needsUpdate ? "bg-amber-50/40 hover:bg-amber-50/70" : "hover:bg-muted/20"}`}
                >
                  <td className={cell}>{row.팀명 || "—"}</td>
                  <td className={`${cell} font-medium`}>{row.성명}</td>

                  {/* 조출근무 체크박스 */}
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

                  <td className={`${cell} text-blue-600 tabular-nums`}>{row.xerpIn || "—"}</td>
                  <td className={`${cell} text-red-600 tabular-nums`}>{row.xerpOut || "—"}</td>
                  <td className={`${cell} text-blue-400 tabular-nums`}>{row.pmisIn || "—"}</td>
                  <td className={`${cell} text-red-400 tabular-nums`}>{row.pmisOut || "—"}</td>

                  <td className={`${cell} bg-blue-50/40 font-semibold tabular-nums
                    ${row.isJochul && row.rawInMin !== null && row.rawInMin < STANDARD_START
                      ? "text-violet-700" : "text-blue-700"}`}>
                    {row.effIn || "—"}
                    {row.isJochul && row.rawInMin !== null && row.rawInMin < STANDARD_START && (
                      <span className="ml-1 text-[9px] text-violet-500 font-bold">조출</span>
                    )}
                  </td>
                  <td className={`${cell} bg-blue-50/40 font-semibold text-blue-700 tabular-nums`}>{row.effOut || "—"}</td>

                  <td className={`${cell} tabular-nums`}>{row.xerpGongsuA || "—"}</td>
                  <td className={`${cell} bg-emerald-50/40 font-bold text-emerald-700 tabular-nums`}>
                    {row.calcGongsuVal !== null ? row.calcGongsuVal.toFixed(2) : "—"}
                  </td>
                  <td className={`${cell} bg-amber-50/40 font-bold tabular-nums ${row.needsUpdate ? "text-amber-700" : "text-muted-foreground"}`}>
                    {row.needsUpdate && row.diff !== null ? `+${row.diff.toFixed(2)}` : "—"}
                  </td>
                  <td className={cell}>
                    {row.needsUpdate ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                        <AlertTriangle className="h-3 w-3" /> 가산필요
                      </span>
                    ) : row.calcGongsuVal !== null ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                        <CheckCircle className="h-3 w-3" /> 일치
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <MinusCircle className="h-3 w-3" /> 데이터없음
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
