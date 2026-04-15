import { useState, useRef, useEffect, useMemo } from "react";
import { Upload, Download, AlertTriangle, CheckCircle, MinusCircle, Search, X, Save, Clock, UserX, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { loadXerpWorkFS, saveXerpWorkFS, loadXerpFS, saveXerpFS, loadXerpPH2FS, saveXerpPH2FS } from "@/lib/firestoreService";

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

const STANDARD_END       = 17 * 60;  // 17:00
const STANDARD_WORK_MIN  = 8 * 60;   // 주간 1.0 공수 기준 = 8시간(480분)

// ── 팀별 출근 기준 시간 ────────────────────────────────
interface TeamConfig { standardStart: number; jochulCutoff: number; }
function getTeamConfig(팀명: string): TeamConfig {
  if (팀명.includes("태화_S")) return { standardStart: 7 * 60 + 30, jochulCutoff: 7 * 60 + 40 };
  return { standardStart: 7 * 60, jochulCutoff: 7 * 60 + 10 };
}

function roundBy50(min: number): number {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 50 ? (h + 1) * 60 : h * 60;
}

/** 지각 시 출근 시간을 다음 정각으로 올림 (ex. 16:37 → 17:00) */
function ceilToHour(min: number): number {
  const m = min % 60;
  return m === 0 ? min : (Math.floor(min / 60) + 1) * 60;
}

function resolveEffInMin(rawInMin: number | null, isJochul: boolean, cfg: TeamConfig): number | null {
  if (rawInMin === null) return null;
  if (!isJochul && rawInMin < cfg.jochulCutoff) return cfg.standardStart;
  return rawInMin;
}

function resolveEffOutMin(xerpOut: unknown, pmisOut: unknown): number | null {
  const xOMin = parseMin(xerpOut);
  const pOMin = parseMin(pmisOut);
  if (xOMin !== null && pOMin !== null) return Math.max(roundBy50(xOMin), roundBy50(pOMin));
  if (xOMin !== null) return roundBy50(xOMin);
  if (pOMin !== null) return roundBy50(pOMin);
  return null;
}

/**
 * 공수 계산
 *
 * ① 출근 시간이 standardStart 이후 지각이면 다음 정각으로 올림
 * ② standardStart~17:00 표준 시간대 내 근무분 / 480분 = 주간 공수 (최대 1.0)
 * ③ 17:00 이후 연장 시간:
 *    - 주간 8시간 충족(공수 1.0) 시 → 0.25/h (연장 단가)
 *    - 주간 8시간 미충족 시         → 0.125/h (기본 단가, 연장 할증 없음)
 * ④ 조출: standardStart 이전 1시간마다 +0.25
 */
function calcGongsu(effInMin: number | null, effOutMin: number | null, isJochul: boolean, cfg: TeamConfig): number | null {
  if (effInMin === null || effOutMin === null) return null;

  const { standardStart } = cfg;

  // 지각 시 출근 올림 처리 (standardStart 이후 지각만 적용)
  const ceiledIn = effInMin > standardStart ? ceilToHour(effInMin) : effInMin;

  // 표준 시간대(standardStart~17:00) 내 실근무 분
  const stdFrom    = Math.max(ceiledIn, standardStart);
  const stdMinutes = Math.max(0, Math.min(effOutMin, STANDARD_END) - stdFrom);

  // 주간 공수 (8시간 = 1.0 기준, 0.125/h)
  const stdGongsu = Math.min(stdMinutes / STANDARD_WORK_MIN, 1.0);

  // 연장 시간 (17:00 이후) — 주간 충족 여부에 따라 단가 분기
  const overtimeMin    = Math.max(0, effOutMin - STANDARD_END);
  const isStdMet       = stdGongsu >= 1.0;
  const overtimeGongsu = (overtimeMin / 60) * (isStdMet ? 0.25 : 0.125);

  // 조출 보너스: standardStart 이전 1시간마다 0.25 (체크 시에만)
  const jochulBonus = isJochul
    ? Math.max(0, Math.floor((standardStart - effInMin) / 60)) * 0.25
    : 0;

  return Math.round((jochulBonus + stdGongsu + overtimeGongsu) * 100) / 100;
}

function calcDiff(calcVal: number | null, xerpGongsuA: string) {
  const aNum = parseFloat(xerpGongsuA);
  if (calcVal === null || isNaN(aNum)) return { diff: null, needsUpdate: false };
  const d = Math.round((calcVal - aNum) * 100) / 100;
  if (d > 0.001) return { diff: d, needsUpdate: true };
  return { diff: null, needsUpdate: false };
}

// ── 파일명 유틸 ───────────────────────────────────────
function extractDateFromFilename(filename: string): string | null {
  const name = filename.replace(/\.[^.]+$/, "");
  const sep4 = name.match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (sep4) return `${sep4[1]}-${sep4[2]}-${sep4[3]}`;
  const sep2 = name.match(/(\d{2})[-./](\d{2})[-./](\d{2})/);
  if (sep2) {
    const [, y, m, d] = sep2;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `20${y}-${m}-${d}`;
  }
  const compact = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    const [, y, m, d] = compact;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
  }
  return null;
}

function detectSite(filename: string): "PH4" | "PH2" {
  return filename.toUpperCase().includes("PH2") ? "PH2" : "PH4";
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
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
  isNoRecord: boolean;
  isLate: boolean;
  standardStart: number;
  isNewEmployee: boolean;
}

// 엑셀 원본 전체 컬럼 (XERP&PMIS와 동일 구조)
interface RawExcelRow {
  rowIndex: number;
  cols: string[]; // 0~22 컬럼 전체
}

// ── 컴포넌트 ─────────────────────────────────────────
interface Props { isAdmin: boolean }

export default function XerpWorkReflection({ isAdmin }: Props) {
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [rawExcelRows, setRawExcelRows] = useState<RawExcelRow[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const [showSpecialList, setShowSpecialList] = useState(false);
  const [showNewEmpList, setShowNewEmpList] = useState(false);
  const [newEmployeeNames, setNewEmployeeNames] = useState<Set<string>>(new Set());
  const [newEmpFileName, setNewEmpFileName] = useState<string | null>(null);

  // XERP&PMIS 연동 설정
  const [syncSite, setSyncSite] = useState<"PH4" | "PH2">("PH4");
  const [syncDate, setSyncDate] = useState<string>(today());
  const [xerpDates, setXerpDates] = useState<string[]>([]);

  const fileRef    = useRef<HTMLInputElement>(null);
  const newEmpRef  = useRef<HTMLInputElement>(null);

  // 사이트 변경 시 XERP&PMIS 날짜 목록 로드
  useEffect(() => {
    const loadFn = syncSite === "PH2" ? loadXerpPH2FS : loadXerpFS;
    loadFn().then((dm) => {
      if (dm && typeof dm === "object") {
        const dates = Object.keys(dm).sort().reverse();
        setXerpDates(dates);
        if (dates.length > 0 && !dates.includes(syncDate)) setSyncDate(dates[0]);
      } else {
        setXerpDates([]);
      }
    });
  }, [syncSite]);

  // 마운트 시 저장된 데이터 로드
  useEffect(() => {
    loadXerpWorkFS().then((data) => {
      if (data?.rows && data.rows.length > 0) {
        setRows(data.rows as ProcessedRow[]);
        setFileName(data.fileName ?? null);
        toast.info(`저장된 데이터 불러옴 (${data.fileName})`);
      }
    });
  }, []);

  // 신규자 명단 업로드
  const handleNewEmpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // "성명" 또는 "이름" 헤더 컬럼 탐색
      let nameColIdx = -1;
      let dataStart  = 0;
      for (let i = 0; i < Math.min(raw.length, 5); i++) {
        const row = raw[i] as unknown[];
        const found = row.findIndex((c) => ["성명", "이름", "name"].includes(String(c).trim()));
        if (found !== -1) { nameColIdx = found; dataStart = i + 1; break; }
      }
      if (nameColIdx === -1) { nameColIdx = 0; dataStart = 1; } // 헤더 없으면 첫 컬럼 사용

      const names = new Set<string>();
      for (let i = dataStart; i < raw.length; i++) {
        const val = String((raw[i] as unknown[])[nameColIdx] ?? "").trim();
        if (val) names.add(val);
      }

      setNewEmployeeNames(names);
      setNewEmpFileName(file.name);
      toast.success(`신규자 명단 ${names.size}명 등록됨`);
    } catch {
      toast.error("신규자 명단 파일 읽기 오류");
    }
  };

  // 신규자 명단 변경 시 기존 rows 재계산
  useEffect(() => {
    if (rows.length === 0) return;
    setRows((prev) => prev.map((r) => {
      const isNew = newEmployeeNames.has(r.성명);
      if (isNew) {
        const gongsuA = parseFloat(r.xerpGongsuA) || 0;
        const diff = Math.round((1.0 - gongsuA) * 100) / 100;
        return { ...r, isNewEmployee: true, calcGongsuVal: 1.0, diff: diff > 0 ? diff : null, needsUpdate: diff > 0 };
      }
      // 신규자 해제 시 원래 값으로 재계산
      if (r.isNewEmployee) {
        const cfg = getTeamConfig(r.팀명);
        const effInMin = resolveEffInMin(r.rawInMin, r.isJochul, cfg);
        const calcVal  = calcGongsu(effInMin, r.rawOutMin, r.isJochul, cfg);
        const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
        return { ...r, isNewEmployee: false, calcGongsuVal: calcVal, diff, needsUpdate };
      }
      return r;
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newEmployeeNames]);

  // 조출 토글
  const toggleJochul = (rowIndex: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      const newJochul = !r.isJochul;
      const cfg       = getTeamConfig(r.팀명);
      const effInMin  = resolveEffInMin(r.rawInMin, newJochul, cfg);
      const effIn     = effInMin !== null ? minToStr(effInMin) : "";
      const calcVal   = calcGongsu(effInMin, r.rawOutMin, newJochul, cfg);
      const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
      const isLate    = effInMin !== null && effInMin > cfg.standardStart;
      return { ...r, isJochul: newJochul, effIn, calcGongsuVal: calcVal, diff, needsUpdate, isLate };
    }));
  };

  // 가산B 수기 편집
  const startEdit = (row: ProcessedRow) => {
    setEditingIdx(row.rowIndex);
    setEditingVal(row.diff !== null ? String(row.diff) : "");
  };

  const commitEdit = (rowIndex: number) => {
    const num = parseFloat(editingVal);
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      if (isNaN(num) || num <= 0) {
        return { ...r, diff: null, needsUpdate: false };
      }
      return { ...r, diff: Math.round(num * 100) / 100, needsUpdate: true };
    }));
    setEditingIdx(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const buffer = await file.arrayBuffer();
      setOriginalBuffer(buffer);
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
        const rawInMin  = xerpInMin !== null && pmisInMin !== null
          ? Math.min(xerpInMin, pmisInMin)
          : xerpInMin ?? pmisInMin;
        const rawOutMin = resolveEffOutMin(xerpOutRaw, pmisOutRaw);
        const effOut    = rawOutMin !== null ? minToStr(rawOutMin) : "";

        const isJochul      = false;
        const cfg           = getTeamConfig(팀명);
        const effInMin      = resolveEffInMin(rawInMin, isJochul, cfg);
        const effIn         = effInMin !== null ? minToStr(effInMin) : "";
        const isNewEmployee = newEmployeeNames.has(성명);
        const isNoRecord    = rawInMin === null || rawOutMin === null;
        const isLate        = !isNoRecord && effInMin !== null && effInMin > cfg.standardStart;

        let calcGongsuVal: number | null;
        let diff: number | null;
        let needsUpdate: boolean;

        if (isNewEmployee) {
          calcGongsuVal = 1.0;
          const gongsuA = parseFloat(xerpGongsuA) || 0;
          const d = Math.round((1.0 - gongsuA) * 100) / 100;
          diff = d > 0 ? d : null;
          needsUpdate = d > 0;
        } else {
          calcGongsuVal = calcGongsu(effInMin, rawOutMin, isJochul, cfg);
          ({ diff, needsUpdate } = calcDiff(calcGongsuVal, xerpGongsuA));
        }

        processed.push({
          rowIndex: i, 팀명, 성명,
          xerpIn: xerpInStr, xerpOut: xerpOutStr,
          pmisIn: pmisInStr, pmisOut: pmisOutStr,
          rawInMin, rawOutMin, isJochul,
          effIn, effOut, xerpGongsuA,
          calcGongsuVal, diff, needsUpdate, isNoRecord, isLate,
          standardStart: cfg.standardStart,
          isNewEmployee,
        });
      }

      // 전체 컬럼 원본 저장 (XERP&PMIS 동기화용)
      const allRawExcel: RawExcelRow[] = [];
      for (let i = dataStart; i < rawFmt.length; i++) {
        const rowFmt2 = rawFmt[i] as unknown[];
        if (rowFmt2.every((c) => String(c).trim() === "")) continue;
        if (!String(rowFmt2[3] ?? "").trim()) continue;
        allRawExcel.push({
          rowIndex: i,
          cols: Array.from({ length: 25 }, (_, ci) => String(rowFmt2[ci] ?? "").trim()),
        });
      }
      setRawExcelRows(allRawExcel);

      setRows(processed);
      setWorkbook(wb);
      setFileName(file.name);

      // 자동 사이트/날짜 감지
      const detectedSite = detectSite(file.name);
      const detectedDate = extractDateFromFilename(file.name);
      setSyncSite(detectedSite);
      if (detectedDate) setSyncDate(detectedDate);

      const noRec = processed.filter((r) => r.isNoRecord).length;
      const late  = processed.filter((r) => r.isLate).length;
      const needs = processed.filter((r) => r.needsUpdate).length;
      toast.success(`${processed.length}명 불러옴 — 기록없음 ${noRec}명 · 지각 ${late}명 · 가산필요 ${needs}명`);
    } catch {
      toast.error("파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  // 공수반영 데이터 저장 (Firestore xerp_work)
  const handleSave = async () => {
    if (!rows.length || !fileName) return;
    setIsSaving(true);
    const ok = await saveXerpWorkFS(fileName, rows);
    setIsSaving(false);
    if (ok) toast.success("저장되었습니다.");
    else toast.error("저장 실패");
  };

  // XERP&PMIS 전체 명단 반영 (파일 전체 데이터 교체)
  const handleSync = async () => {
    if (!rows.length || !rawExcelRows.length) return;
    setIsSyncing(true);
    try {
      const loadFn = syncSite === "PH2" ? loadXerpPH2FS : loadXerpFS;
      const saveFn = syncSite === "PH2" ? saveXerpPH2FS : saveXerpFS;

      const dateMap = (await loadFn() as Record<string, unknown[]> | null) ?? {};

      // 엑셀 전체 컬럼으로 완전한 XERP&PMIS 레코드 구성
      const newEntries = rawExcelRows.map((re) => {
        const c = re.cols;
        // ProcessedRow에서 계산된 값 찾기
        const pr = rows.find((r) => r.rowIndex === re.rowIndex);
        const gongsuA = parseFloat(c[16]) || 0;
        const gasanB  = pr?.diff ?? null;
        const gongsuAB = gasanB !== null
          ? String(Math.round((gongsuA + gasanB) * 100) / 100)
          : c[21];

        return {
          id: crypto.randomUUID(),
          팀명: c[0],  직종: c[1],  사번: c[2],  성명: c[3],  생년월일: c[4],
          xerp출근: c[5],  xerp퇴근: c[6],
          pmis출근: c[7],  pmis퇴근: c[8],
          조출: c[9],  오전: c[10], 오후: c[11], 연장: c[12],
          야간: c[13], 철야: c[14], 점심: c[15],
          공수합계A: c[16],
          초과당일: c[17], 초과합계: c[18],
          가산신청: gasanB !== null ? String(gasanB) : c[19],
          가산승인: c[20],
          공수합계AB: gongsuAB,
          월누계: c[22],
        };
      });

      const updated = { ...dateMap, [syncDate]: newEntries };
      await saveFn(updated as Record<string, unknown[]>);
      toast.success(`XERP&PMIS (${syncSite}, ${syncDate}) 반영 완료 — ${newEntries.length}명 전체 업데이트`);
    } catch (err) {
      toast.error("반영 중 오류: " + String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownload = () => {
    if (!originalBuffer || !fileName) return;
    // 원본 버퍼에서 직접 읽어 서식(테두리 등) 완전 보존
    const wbCopy = XLSX.read(new Uint8Array(originalBuffer), { type: "array", cellStyles: true });
    const ws = wbCopy.Sheets[wbCopy.SheetNames[0]];

    for (const row of rows) {
      if (row.diff === null) continue;

      // T열 (index 19): 가산공수(B) 신청
      const tAddr = `${XLSX.utils.encode_col(19)}${row.rowIndex + 1}`;
      const tCell = ws[tAddr];
      ws[tAddr] = { ...(tCell ?? {}), t: "n", v: row.diff, w: String(row.diff) };

      // V열 (index 21): 공수합계 (A+B) = Q열 + T열
      const gongsuA = parseFloat(row.xerpGongsuA) || 0;
      const gongsuAB = Math.round((gongsuA + row.diff) * 100) / 100;
      const vAddr = `${XLSX.utils.encode_col(21)}${row.rowIndex + 1}`;
      const vCell = ws[vAddr];
      ws[vAddr] = { ...(vCell ?? {}), t: "n", v: gongsuAB, w: String(gongsuAB) };
    }

    XLSX.writeFile(wbCopy, fileName.replace(/\.xlsx?$/i, "") + "_공수반영.xlsx", { cellStyles: true, bookType: "xlsx" });
    toast.success("수정된 파일을 다운로드했습니다.");
  };

  const displayRows = useMemo(() => {
    const q = search.trim();
    if (!q) return rows;
    return rows.filter((r) => r.성명.includes(q) || r.팀명.includes(q));
  }, [rows, search]);

  const totalCount    = rows.length;
  const needCount     = rows.filter((r) => r.needsUpdate).length;
  const noRecCount    = rows.filter((r) => r.isNoRecord).length;
  const lateCount     = rows.filter((r) => r.isLate).length;
  const zeroGongsuCount = rows.filter((r) =>
    !r.isNoRecord && (parseFloat(r.xerpGongsuA) === 0 || r.calcGongsuVal === 0)
  ).length;

  const cell = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-border/40 last:border-r-0";
  const th   = "px-2 py-2 text-[11px] font-semibold text-foreground bg-muted text-center border-r border-border/40 last:border-r-0 sticky top-0 z-10";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-foreground shrink-0">XERP 공수 반영</h2>

      {/* 신규자 명단 업로드 바 */}
      <div className="flex flex-wrap items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 shrink-0">
        <input ref={newEmpRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleNewEmpUpload} />
        <span className="text-xs font-bold text-sky-800">신규자 명단</span>
        <button
          onClick={() => newEmpRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          명단 업로드
        </button>
        {newEmpFileName ? (
          <>
            <span className="text-xs text-sky-700 font-medium truncate max-w-[220px]">{newEmpFileName}</span>
            <span className="text-xs font-bold text-sky-800 bg-sky-100 border border-sky-200 px-2 py-1 rounded-lg">
              {newEmployeeNames.size}명 등록
            </span>
            <button
              onClick={() => setShowNewEmpList((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-300 bg-sky-100 text-xs font-semibold text-sky-700 hover:bg-sky-200 transition-colors"
            >
              {showNewEmpList ? "명단 닫기" : "명단 보기"}
            </button>
            <button
              onClick={() => { setNewEmployeeNames(new Set()); setNewEmpFileName(null); setShowNewEmpList(false); }}
              className="flex items-center gap-1 text-xs text-sky-500 hover:text-sky-700"
            >
              <X className="h-3.5 w-3.5" /> 초기화
            </button>
          </>
        ) : (
          <span className="text-[11px] text-sky-600">신규자 명단을 업로드하면 해당 인원은 출퇴근 무관 1.0공수 적용됩니다</span>
        )}
      </div>

      {/* 신규자 명단 패널 */}
      {showNewEmpList && newEmployeeNames.size > 0 && (() => {
        const newEmpRows = rows.filter((r) => r.isNewEmployee);
        const sth = "px-2 py-2 text-[11px] font-semibold text-center bg-sky-50 border-r border-sky-100 last:border-r-0 sticky top-0 z-10 whitespace-nowrap";
        const stc = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-sky-50 last:border-r-0";
        return (
          <div className="rounded-xl border border-sky-200 bg-white shadow-sm overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-sky-50 border-b border-sky-200">
              <span className="text-xs font-bold text-sky-800 flex items-center gap-1.5">
                신규자 명단 — {newEmployeeNames.size}명 등록
                {newEmpRows.length > 0 && newEmpRows.length < newEmployeeNames.size && (
                  <span className="text-[11px] font-normal text-sky-500">
                    (공수 데이터 매칭 {newEmpRows.length}명 / 미매칭 {newEmployeeNames.size - newEmpRows.length}명)
                  </span>
                )}
              </span>
              <button onClick={() => setShowNewEmpList(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-0 overflow-auto" style={{ maxHeight: "340px" }}>
              {/* 좌: 공수 데이터 있는 신규자 */}
              <div className="flex-1 min-w-[400px]">
                {newEmpRows.length > 0 ? (
                  <table className="min-w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-sky-100">
                        <th className={sth}>팀명</th>
                        <th className={sth}>성명</th>
                        <th className={sth}>XERP 출근</th>
                        <th className={sth}>XERP 퇴근</th>
                        <th className={sth}>PMIS 출근</th>
                        <th className={sth}>PMIS 퇴근</th>
                        <th className={sth}>공수A</th>
                        <th className={sth}>적용공수</th>
                        <th className={sth}>가산B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newEmpRows.map((r) => (
                        <tr key={r.rowIndex} className="border-b border-sky-50 last:border-0 bg-sky-50/40 hover:bg-sky-50">
                          <td className={`${stc} text-muted-foreground`}>{r.팀명 || "—"}</td>
                          <td className={`${stc} font-semibold text-sky-800`}>{r.성명}</td>
                          <td className={`${stc} tabular-nums ${!r.xerpIn ? "text-rose-400" : "text-blue-600"}`}>{r.xerpIn || "미기록"}</td>
                          <td className={`${stc} tabular-nums ${!r.xerpOut ? "text-rose-400" : "text-red-600"}`}>{r.xerpOut || "미기록"}</td>
                          <td className={`${stc} tabular-nums ${!r.pmisIn ? "text-rose-400" : "text-blue-400"}`}>{r.pmisIn || "미기록"}</td>
                          <td className={`${stc} tabular-nums ${!r.pmisOut ? "text-rose-400" : "text-red-400"}`}>{r.pmisOut || "미기록"}</td>
                          <td className={`${stc} tabular-nums`}>{r.xerpGongsuA || "—"}</td>
                          <td className={`${stc} font-bold text-sky-700 tabular-nums`}>1.00</td>
                          <td className={`${stc} font-bold text-amber-600 tabular-nums`}>{r.diff !== null ? `+${r.diff.toFixed(2)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-xs text-muted-foreground">XERP 공수 데이터와 매칭된 신규자가 없습니다. 메인 엑셀을 업로드하세요.</p>
                )}
              </div>
              {/* 우: 미매칭 신규자 (XERP 데이터 없음) */}
              {(() => {
                const matchedNames = new Set(newEmpRows.map((r) => r.성명));
                const unmatched = [...newEmployeeNames].filter((n) => !matchedNames.has(n));
                if (unmatched.length === 0) return null;
                return (
                  <div className="border-l border-sky-200 min-w-[140px] bg-slate-50/60">
                    <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 border-b border-sky-100 sticky top-0 bg-slate-50">
                      XERP 미매칭 ({unmatched.length}명)
                    </div>
                    <ul className="p-2 space-y-1">
                      {unmatched.map((name) => (
                        <li key={name} className="flex items-center gap-1.5 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                          <span className="text-slate-600 font-medium">{name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

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
            <span className="flex items-center gap-1 text-xs font-semibold text-foreground bg-muted border border-border px-2.5 py-1.5 rounded-lg">
              총 {totalCount}명
            </span>
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

            {(noRecCount > 0 || lateCount > 0 || needCount > 0 || zeroGongsuCount > 0) && (
              <button
                onClick={() => setShowSpecialList((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {showSpecialList ? "명단 닫기" : "특이자 명단 보기"}
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "저장 중..." : "저장"}
            </button>

            {originalBuffer && (
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

      {/* XERP&PMIS 연동 패널 */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 shrink-0">
          <span className="text-xs font-bold text-emerald-800">XERP&PMIS 반영</span>

          <select
            value={syncSite}
            onChange={(e) => setSyncSite(e.target.value as "PH4" | "PH2")}
            className="border border-emerald-300 rounded-lg px-2 py-1.5 text-xs font-semibold bg-white outline-none"
          >
            <option value="PH4">P4-PH4</option>
            <option value="PH2">P4-PH2</option>
          </select>

          {xerpDates.length > 0 ? (
            <select
              value={syncDate}
              onChange={(e) => setSyncDate(e.target.value)}
              className="border border-emerald-300 rounded-lg px-2 py-1.5 text-xs font-semibold bg-white outline-none"
            >
              {xerpDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-emerald-600">XERP&PMIS에 저장된 날짜 없음</span>
          )}

          <button
            onClick={handleSync}
            disabled={isSyncing || xerpDates.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "반영 중..." : "XERP&PMIS에 반영"}
          </button>

          <span className="text-[11px] text-emerald-600">가산B 신청값을 선택한 날짜에 업데이트합니다</span>
        </div>
      )}

      {/* 특이자 명단 패널 */}
      {showSpecialList && rows.length > 0 && (() => {
        const isZeroGongsu = (r: ProcessedRow) =>
          !r.isNoRecord && (parseFloat(r.xerpGongsuA) === 0 || r.calcGongsuVal === 0);
        const specialRows = rows.filter((r) => r.isNoRecord || r.isLate || r.needsUpdate || isZeroGongsu(r));
        const sth = "px-2 py-2 text-[11px] font-semibold text-center bg-slate-100 border-r border-slate-200 last:border-r-0 sticky top-0 z-10 whitespace-nowrap";
        const stc = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-slate-100 last:border-r-0";
        return (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                특이사항 명단 — {specialRows.length}명
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {noRecCount > 0 && <span className="text-rose-500 mr-2">기록없음 {noRecCount}명</span>}
                  {lateCount > 0 && <span className="text-orange-500 mr-2">지각 {lateCount}명</span>}
                  {needCount > 0 && <span className="text-amber-500 mr-2">가산공수 {needCount}명</span>}
                  {zeroGongsuCount > 0 && <span className="text-red-500">공수0 {zeroGongsuCount}명</span>}
                </span>
              </span>
              <button onClick={() => setShowSpecialList(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto" style={{ maxHeight: "320px" }}>
              <table className="min-w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={sth}>구분</th>
                    <th className={sth}>팀명</th>
                    <th className={sth}>성명</th>
                    <th className={sth}>XERP 출근</th>
                    <th className={sth}>XERP 퇴근</th>
                    <th className={sth}>PMIS 출근</th>
                    <th className={sth}>PMIS 퇴근</th>
                    <th className={sth}>적용 출근</th>
                    <th className={sth}>적용 퇴근</th>
                    <th className={sth}>공수A</th>
                    <th className={sth}>계산공수</th>
                    <th className={sth}>가산B</th>
                  </tr>
                </thead>
                <tbody>
                  {specialRows.map((r) => {
                    const zeroGs = isZeroGongsu(r);
                    const tags: React.ReactNode[] = [];
                    if (r.isNoRecord) tags.push(<span key="nr" className="inline-flex items-center gap-0.5 text-rose-600 font-bold"><UserX className="h-3 w-3" /> 기록없음</span>);
                    if (r.isLate)     tags.push(<span key="lt" className="inline-flex items-center gap-0.5 text-orange-600 font-bold"><Clock className="h-3 w-3" /> 지각</span>);
                    if (!r.isNoRecord && r.needsUpdate) tags.push(<span key="gs" className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><AlertTriangle className="h-3 w-3" /> 가산</span>);
                    if (zeroGs) tags.push(<span key="zg" className="inline-flex items-center gap-0.5 text-red-600 font-bold"><MinusCircle className="h-3 w-3" /> 공수0</span>);
                    const rowBg = r.isNoRecord ? "bg-rose-50/60" : zeroGs ? "bg-red-50/60" : r.isLate ? "bg-orange-50/60" : "bg-amber-50/40";
                    return (
                      <tr key={r.rowIndex} className={`border-b border-slate-100 last:border-0 ${rowBg}`}>
                        <td className={stc}>
                          <div className="flex flex-col items-center gap-0.5">{tags}</div>
                        </td>
                        <td className={`${stc} text-muted-foreground`}>{r.팀명 || "—"}</td>
                        <td className={`${stc} font-semibold`}>{r.성명}</td>
                        <td className={`${stc} tabular-nums ${!r.xerpIn ? "text-rose-400" : "text-blue-600"}`}>{r.xerpIn || "미기록"}</td>
                        <td className={`${stc} tabular-nums ${!r.xerpOut ? "text-rose-400" : "text-red-600"}`}>{r.xerpOut || "미기록"}</td>
                        <td className={`${stc} tabular-nums ${!r.pmisIn ? "text-rose-400" : "text-blue-400"}`}>{r.pmisIn || "미기록"}</td>
                        <td className={`${stc} tabular-nums ${!r.pmisOut ? "text-rose-400" : "text-red-400"}`}>{r.pmisOut || "미기록"}</td>
                        <td className={`${stc} font-semibold tabular-nums ${r.isLate ? "text-orange-600" : "text-blue-700"}`}>
                          {r.effIn || "—"}
                          {r.isLate && <span className="ml-0.5 text-[9px] text-orange-500 font-bold">▲지각</span>}
                        </td>
                        <td className={`${stc} font-semibold tabular-nums ${!r.effOut ? "text-rose-400" : "text-blue-700"}`}>{r.effOut || "—"}</td>
                        <td className={`${stc} tabular-nums`}>{r.xerpGongsuA || "—"}</td>
                        <td className={`${stc} font-bold text-emerald-700 tabular-nums`}>{r.calcGongsuVal !== null ? r.calcGongsuVal.toFixed(2) : "—"}</td>
                        <td className={`${stc} font-bold text-amber-700 tabular-nums`}>{r.diff !== null ? `+${r.diff.toFixed(2)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* 검색창 + 범례 */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 shrink-0">
          <div className="relative w-full max-w-xs">
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
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" /> 기록없음</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> 지각</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-300 inline-block" /> 가산필요</span>
            <span className="text-[11px] text-muted-foreground">· 가산B 셀 클릭 시 수기 입력 가능</span>
          </div>
        </div>
      )}

      {/* 계산 규칙 안내 */}
      {rows.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700 space-y-1.5 shrink-0">
          <p className="font-bold text-blue-800 mb-2">공수 계산 규칙</p>
          <p>· <b>출근</b>: X-ERP·PMIS 중 더 이른 시간 / 07:10 이전은 07:00 고정 (조출 미체크)</p>
          <p>· <b>퇴근</b>: X-ERP·PMIS 각각 50분 기준 반올림 후 최대값</p>
          <p>· <b>기본공수</b>: 07:00 ~ 17:00 = <b>1.0공</b></p>
          <p>· <b>연장공수</b>: 17:00 초과 시간당 <b>+0.25공</b> (50분 미만 미인정)</p>
          <p>· <b>조출공수</b>: 체크 시 07:00 이전 시간당 <b>+0.25공</b></p>
        </div>
      )}

      {/* 결과 테이블 */}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-xl border border-border bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 330px)" }}>
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted">
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
                  const rowBg = row.isNewEmployee
                    ? "bg-sky-50/70 hover:bg-sky-50"
                    : row.isNoRecord
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

                      <td className={`${cell} bg-violet-50/30`}>
                        <label className="flex items-center justify-center cursor-pointer">
                          <input type="checkbox" checked={row.isJochul} onChange={() => toggleJochul(row.rowIndex)}
                            className="w-3.5 h-3.5 accent-violet-600 cursor-pointer" />
                        </label>
                      </td>

                      <td className={`${cell} tabular-nums ${!row.xerpIn ? "text-rose-400 font-semibold" : "text-blue-600"}`}>{row.xerpIn || "미기록"}</td>
                      <td className={`${cell} tabular-nums ${!row.xerpOut ? "text-rose-400 font-semibold" : "text-red-600"}`}>{row.xerpOut || "미기록"}</td>
                      <td className={`${cell} tabular-nums ${!row.pmisIn ? "text-rose-400 font-semibold" : "text-blue-400"}`}>{row.pmisIn || "미기록"}</td>
                      <td className={`${cell} tabular-nums ${!row.pmisOut ? "text-rose-400 font-semibold" : "text-red-400"}`}>{row.pmisOut || "미기록"}</td>

                      <td className={`${cell} bg-blue-50/40 font-semibold tabular-nums
                        ${row.isLate ? "text-orange-600" :
                          row.isJochul && row.rawInMin !== null && row.rawInMin < row.standardStart ? "text-violet-700" : "text-blue-700"}`}>
                        {row.effIn || "—"}
                        {row.isLate && <span className="ml-1 text-[9px] font-bold text-orange-500">지각</span>}
                        {row.standardStart !== 7 * 60 && (
                          <span className="ml-1 text-[9px] font-semibold text-slate-400">({minToStr(row.standardStart)}기준)</span>
                        )}
                        {row.isJochul && row.rawInMin !== null && row.rawInMin < row.standardStart && (
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

                      {/* 가산B — 클릭 시 수기 입력 */}
                      <td className={`${cell} bg-amber-50/40 p-0`}>
                        {editingIdx === row.rowIndex ? (
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            value={editingVal}
                            autoFocus
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={() => commitEdit(row.rowIndex)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(row.rowIndex); if (e.key === "Escape") setEditingIdx(null); }}
                            className="w-full px-2 py-1.5 text-xs text-center bg-amber-100 border-0 outline-none focus:ring-1 focus:ring-amber-400 tabular-nums"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(row)}
                            className={`w-full px-2 py-1.5 text-center font-bold tabular-nums hover:bg-amber-100 transition-colors
                              ${row.needsUpdate ? "text-amber-700" : "text-muted-foreground"}`}
                            title="클릭하여 수기 입력"
                          >
                            {row.diff !== null ? `+${row.diff.toFixed(2)}` : "—"}
                          </button>
                        )}
                      </td>

                      <td className={cell}>
                        <div className="flex flex-col items-center gap-0.5">
                          {row.isNewEmployee && <span className="inline-flex items-center gap-1 text-sky-600 font-semibold"><CheckCircle className="h-3 w-3" /> 신규(1.0)</span>}
                          {row.isNoRecord && <span className="inline-flex items-center gap-1 text-rose-600 font-semibold"><UserX className="h-3 w-3" /> 기록없음</span>}
                          {row.isLate && <span className="inline-flex items-center gap-1 text-orange-600 font-semibold"><Clock className="h-3 w-3" /> 지각</span>}
                          {!row.isNewEmployee && !row.isNoRecord && row.needsUpdate && <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="h-3 w-3" /> 가산필요</span>}
                          {!row.isNewEmployee && !row.isNoRecord && !row.isLate && !row.needsUpdate && row.calcGongsuVal !== null && <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle className="h-3 w-3" /> 정상</span>}
                          {row.calcGongsuVal === null && !row.isNoRecord && <span className="inline-flex items-center gap-1 text-muted-foreground"><MinusCircle className="h-3 w-3" /> 데이터없음</span>}
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
