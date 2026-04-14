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

// 적용 출퇴근 계산
function calcEffective(xerpIn: unknown, xerpOut: unknown, pmisIn: unknown, pmisOut: unknown) {
  // 출근: X-ERP 우선 (표시용 문자열이 아닌 raw값으로 유무 판단)
  const xerpInMin = parseMin(xerpIn);
  const pmisInMin = parseMin(pmisIn);
  const effInMin = xerpInMin ?? pmisInMin;
  const effIn = effInMin !== null ? minToStr(effInMin) : "";

  // 퇴근: max(X-ERP 정각절사, PMIS 10분올림)
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);

  let effOutMin: number | null = null;
  if (xOMin !== null && pOMin !== null) {
    effOutMin = Math.max(truncateHour(xOMin), roundUp10(pOMin));
  } else if (xOMin !== null) {
    effOutMin = truncateHour(xOMin);
  } else if (pOMin !== null) {
    effOutMin = roundUp10(pOMin);
  }

  const effOut = effOutMin !== null ? minToStr(effOutMin) : "";
  return { effIn, effOut, effOutMin };
}

// 공수 계산
// 주간 07:00~17:00 (중식 2시간 제외) = 8시간 = 1.0공
// 17:00 초과분 → 분 단위 올림 후 시간당 0.25공
function calcGongsu(effIn: string, effOutMin: number | null): number | null {
  if (!effIn || effOutMin === null) return null;
  const inMin = parseMin(effIn);
  if (inMin === null) return null;

  const STANDARD_END = 17 * 60; // 1020

  // 표준 1.0공
  if (effOutMin <= STANDARD_END) return 1.0;

  // 연장 계산 (분 단위 올림)
  const overtimeMin = effOutMin - STANDARD_END;
  const overtimeHours = Math.ceil(overtimeMin / 60);
  return Math.round((1.0 + overtimeHours * 0.25) * 100) / 100;
}

// ── 타입 ─────────────────────────────────────────────
interface ProcessedRow {
  rowIndex: number;
  팀명: string;
  성명: string;
  xerpIn: string; xerpOut: string;
  pmisIn: string; pmisOut: string;
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

        // 시간: raw값(숫자 시리얼 가능) 사용 — parseMin이 양쪽 처리
        const xerpIn  = row[5]  ?? "";
        const xerpOut = row[6]  ?? "";
        const pmisIn  = row[7]  ?? "";
        const pmisOut = row[8]  ?? "";

        // 표시용 문자열: rawFmt(서식 적용)
        const xerpInStr  = String(rowFmt[5]  ?? "").trim();
        const xerpOutStr = String(rowFmt[6]  ?? "").trim();
        const pmisInStr  = String(rowFmt[7]  ?? "").trim();
        const pmisOutStr = String(rowFmt[8]  ?? "").trim();

        const xerpGongsuA = String(row[16] ?? "").trim();

        const { effIn, effOut, effOutMin } = calcEffective(xerpIn, xerpOut, pmisIn, pmisOut);
        const calcVal = calcGongsu(effIn, effOutMin);

        const aNum = parseFloat(xerpGongsuA);
        let diff: number | null = null;
        let needsUpdate = false;

        if (calcVal !== null && !isNaN(aNum)) {
          const d = Math.round((calcVal - aNum) * 100) / 100;
          if (d > 0.001) {
            diff = d;
            needsUpdate = true;
          }
        }

        processed.push({
          rowIndex: i,
          팀명, 성명,
          xerpIn: xerpInStr, xerpOut: xerpOutStr,
          pmisIn: pmisInStr, pmisOut: pmisOutStr,
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

    // 원본 워크북을 깊은 복사해서 서식 그대로 유지
    const wbCopy = XLSX.read(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }), {
      type: "array",
      cellStyles: true,
    });
    const ws = wbCopy.Sheets[wbCopy.SheetNames[0]];

    for (const row of rows) {
      if (row.needsUpdate && row.diff !== null) {
        // 가산신청 열: 열 인덱스 19 → 엑셀 컬럼 주소 변환 (A=0)
        const colAddr = XLSX.utils.encode_col(19);
        const cellAddr = `${colAddr}${row.rowIndex + 1}`; // sheet_to_json는 0-based 행
        const existingCell = ws[cellAddr];
        ws[cellAddr] = {
          ...(existingCell ?? {}),   // 기존 서식(s) 유지
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
  const th = "px-2 py-2 text-[11px] font-semibold text-muted-foreground bg-muted/50 text-center border-r border-border/40 last:border-r-0 sticky top-0 z-10";

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
          <p>· <b>기본공수</b>: 주간 07:00 ~ 17:00 (중식 2시간 제외) = 8시간 = <b>1.0공</b></p>
          <p>· <b>연장공수</b>: 17:00 초과분 → 분 단위 올림 → 시간당 <b>+0.25공</b></p>
          <p>· X-ERP 공수(A)보다 계산값이 크면 차이를 <b>가산공수(B) 신청</b>에 자동 기입</p>
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
                  <td className={`${cell} text-blue-600 tabular-nums`}>{row.xerpIn || "—"}</td>
                  <td className={`${cell} text-red-600 tabular-nums`}>{row.xerpOut || "—"}</td>
                  <td className={`${cell} text-blue-400 tabular-nums`}>{row.pmisIn || "—"}</td>
                  <td className={`${cell} text-red-400 tabular-nums`}>{row.pmisOut || "—"}</td>
                  <td className={`${cell} bg-blue-50/40 font-semibold text-blue-700 tabular-nums`}>{row.effIn || "—"}</td>
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
