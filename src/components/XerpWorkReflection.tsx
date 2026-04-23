import { useState, useRef, useEffect, useMemo } from "react";
import { Upload, Download, AlertTriangle, CheckCircle, MinusCircle, Search, X, Save, Clock, UserX, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, History, ChevronDown, ChevronUp } from "lucide-react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { loadXerpWorkFS, loadXerpWorkDateMapFS, saveXerpWorkDateFS, deleteXerpWorkDateFS, loadXerpFS, saveXerpFS, loadXerpPH2FS, saveXerpPH2FS, loadNewEmpDateMapFS, saveNewEmpDateFS, loadSafetyEduDatesFS, saveSafetyEduDatesFS, loadDownloadHistoryFS, addDownloadHistoryFS, type DownloadHistoryEntry } from "@/lib/firestoreService";

// ── 시간 유틸 ─────────────────────────────────────────
function parseMin(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    const totalMin = Math.round(val * 24 * 60);
    return totalMin % (24 * 60);
  }
  const s = String(val).trim();
  if (!s) return null;
  // "H:MM AM/PM" or "HH:MM:SS AM/PM" (Excel 12-hour format)
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }
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

// ── 신규자 정보 타입 ──────────────────────────────────
interface NewEmpInfo { 생년월일: string; 단가: string; }

function excelSerialToDateStr(serial: unknown): string {
  const n = typeof serial === "number" ? serial : parseFloat(String(serial));
  if (isNaN(n) || n <= 0) return "";
  const date = new Date((n - 25569) * 86400 * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── 외주 팀 판별 ──────────────────────────────────────
function isWaejuTeam(팀명: string): boolean {
  return 팀명.includes("외주");
}

// ── 팀별 출근 기준 시간 ────────────────────────────────
interface TeamConfig { standardStart: number; jochulCutoff: number; breakStart: number; breakEnd: number; }
function getTeamConfig(팀명: string): TeamConfig {
  // 기본: 07:00 출근, 11:00~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  // 태화_S: 07:30 출근, 11:30~13:00 휴게+점심 (오전4h + 오후4h = 8h 기준)
  if (팀명.includes("태화_S")) return { standardStart: 7 * 60 + 30, jochulCutoff: 7 * 60 + 40, breakStart: 11 * 60 + 30, breakEnd: 13 * 60 };
  return { standardStart: 7 * 60, jochulCutoff: 7 * 60 + 10, breakStart: 11 * 60, breakEnd: 13 * 60 };
}

function roundBy50(min: number): number {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m >= 50 ? (h + 1) * 60 : h * 60;
}

/** 가산 사유 자동 추론 */
function inferGasanReason(row: {
  xerpIn: string; xerpOut: string;
  pmisIn: string;
  rawInMin: number | null; rawOutMin: number | null;
  isLate: boolean; standardStart: number;
}): string {
  const reasons: string[] = [];
  const noXerpIn  = !row.xerpIn;
  const noXerpOut = !row.xerpOut;
  const hasOvertime = row.rawOutMin !== null && row.rawOutMin > STANDARD_END;
  const jochulCutoff = row.standardStart + 10;

  const xerpInMin = parseMin(row.xerpIn);
  const pmisInMin = parseMin(row.pmisIn);

  // 출근 관련 사유 판별
  if (noXerpIn && noXerpOut) {
    reasons.push("출퇴근미타각(주간)");
  } else if (noXerpIn) {
    reasons.push("출근미타각(주간)");
  } else {
    // PMIS는 기준 전, XERP는 늦게 찍힌 경우 → 출근 타각 지연
    const pmisOnTime = pmisInMin !== null && pmisInMin <= row.standardStart;
    const xerpLate   = xerpInMin !== null && xerpInMin > row.standardStart;
    if (pmisOnTime && xerpLate) {
      reasons.push(`출근타각지연(XERP ${row.xerpIn})`);
    }
    // 유예 10분 내 지각 → 인정 처리 (isLate = false 이지만 rawInMin이 기준 초과)
    else if (
      row.rawInMin !== null &&
      row.rawInMin > row.standardStart &&
      row.rawInMin < jochulCutoff &&
      !row.isLate
    ) {
      if (xerpInMin !== null && xerpInMin > row.standardStart) {
        const lateMin = xerpInMin - row.standardStart;
        const types = hasOvertime ? "주간, 연장" : "주간";
        reasons.push(`지각${lateMin}분인정(${types})`);
      }
    }
  }

  // 퇴근 관련 사유
  if (noXerpOut && !noXerpIn) {
    reasons.push(hasOvertime ? "퇴근미타각(연장)" : "퇴근미타각(주간)");
  } else if (!noXerpOut && hasOvertime) {
    const h = (row.rawOutMin! - STANDARD_END) / 60;
    reasons.push(`${h}h 연장근무`);
  }

  return reasons.join(" / ");
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

  const { standardStart, breakStart, breakEnd } = cfg;
  // 팀 기준 하루 실근무 = 오전(breakStart-standardStart) + 오후(STANDARD_END-breakEnd)
  const standardWorkMin = (breakStart - standardStart) + (STANDARD_END - breakEnd);

  // 지각 시 출근 올림 처리 (standardStart 이후 지각만 적용)
  const ceiledIn = effInMin > standardStart ? ceilToHour(effInMin) : effInMin;
  const lateMin  = effInMin > standardStart ? (ceiledIn - standardStart) : 0;

  const stdIn  = Math.max(ceiledIn, standardStart);
  const stdOut = Math.min(effOutMin, STANDARD_END);

  // 오전 근무 (휴게 시작 전)
  const morningMin   = Math.max(0, Math.min(stdOut, breakStart) - stdIn);
  // 오후 근무 (휴게 종료 후)
  const afternoonMin = Math.max(0, stdOut - Math.max(stdIn, breakEnd));
  const stdWorkMin   = morningMin + afternoonMin;

  // 지각 손실분 차감 후 공수 계산
  const effectiveWorkMin = Math.min(stdWorkMin, standardWorkMin - lateMin);
  const stdGongsu = Math.max(0, effectiveWorkMin / standardWorkMin);

  // 연장 시간 (17:00 이후) — 주간 충족 여부에 따라 단가 분기
  const overtimeMin    = Math.max(0, effOutMin - STANDARD_END);
  const isStdMet       = stdGongsu >= 1.0;
  const overtimeGongsu = (overtimeMin / 60) * (isStdMet ? 0.25 : 0.125);

  // 조출 보너스: standardStart 이전 1시간마다 0.25 (체크 시에만)
  const jochulBonus = isJochul
    ? Math.max(0, Math.floor((standardStart - effInMin) / 60)) * 0.25
    : 0;

  return jochulBonus + stdGongsu + overtimeGongsu;
}

function calcDiff(calcVal: number | null, xerpGongsuA: string) {
  const aNum = parseFloat(xerpGongsuA);
  if (calcVal === null || isNaN(aNum)) return { diff: null, needsUpdate: false };
  const d = calcVal - aNum;
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
  가산사유: string;
  needsUpdate: boolean;
  isNoRecord: boolean;
  isLate: boolean;
  standardStart: number;
  isNewEmployee: boolean;
  isWaeju: boolean;
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
  const [teamFilter, setTeamFilter] = useState<string>("전체");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const [editingReason, setEditingReason] = useState("");
  const [showSpecialList, setShowSpecialList] = useState(false);
  const [showNewEmpList, setShowNewEmpList] = useState(false);
  const [newEmpData, setNewEmpData] = useState<Map<string, NewEmpInfo>>(new Map());
  const [newEmpFileName, setNewEmpFileName] = useState<string | null>(null);
  const [isSavingNewEmp, setIsSavingNewEmp] = useState(false);
  const [newEmpSavedCount, setNewEmpSavedCount] = useState<number | null>(null);

  // 공수반영 날짜 관리
  const [workDate, setWorkDate] = useState<string>(today());
  const [workDates, setWorkDates] = useState<string[]>([]);
  const [isLoadingDate, setIsLoadingDate] = useState(false);

  // 일괄 선택
  const [selectedIdxes, setSelectedIdxes] = useState<Set<number>>(new Set());

  // 정기안전교육
  const [safetyEduDates, setSafetyEduDates] = useState<Set<string>>(new Set());

  // 다운로드 이력
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // 정렬
  type SortColWR = "xerpIn" | "xerpOut" | "pmisIn" | "pmisOut";
  const [sortColWR, setSortColWR] = useState<SortColWR | null>(null);
  const [sortDirWR, setSortDirWR] = useState<"asc" | "desc">("asc");

  // XERP&PMIS 연동 설정
  const [syncSite, setSyncSite] = useState<"PH4" | "PH2">("PH4");
  const [syncDate, setSyncDate] = useState<string>(today());
  const [xerpDates, setXerpDates] = useState<string[]>([]);

  const fileRef    = useRef<HTMLInputElement>(null);
  const newEmpRef  = useRef<HTMLInputElement>(null);

  // 저장된 날짜 목록 로드 헬퍼
  const refreshWorkDates = async () => {
    const dm = await loadXerpWorkDateMapFS();
    if (dm) {
      const dates = Object.keys(dm).sort().reverse();
      setWorkDates(dates);
      return { dm, dates };
    }
    setWorkDates([]);
    return { dm: null, dates: [] };
  };

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

  // 정기안전교육 날짜 로드
  useEffect(() => {
    loadSafetyEduDatesFS().then((dates) => setSafetyEduDates(new Set(dates)));
    loadDownloadHistoryFS().then(setDownloadHistory);
  }, []);

  // workDate 변경 시 선택 초기화
  useEffect(() => { setSelectedIdxes(new Set()); }, [workDate]);

  // 신규자 명단 날짜별 로드 헬퍼 — 로드된 Map 반환
  const loadNewEmpForDate = async (date: string): Promise<Map<string, NewEmpInfo>> => {
    const newEmpMap = await loadNewEmpDateMapFS();
    if (newEmpMap?.[date]) {
      const entry = newEmpMap[date];
      const loaded = new Map<string, NewEmpInfo>(Object.entries(entry.data));
      setNewEmpData(loaded);
      setNewEmpFileName(entry.fileName);
      setNewEmpSavedCount(loaded.size);
      return loaded;
    } else {
      setNewEmpData(new Map());
      setNewEmpFileName(null);
      setNewEmpSavedCount(null);
      return new Map();
    }
  };

  // rows에 신규자 데이터 즉시 적용 (타이밍 이슈 방지용)
  const applyNewEmpToRows = (loadedRows: ProcessedRow[], empData: Map<string, NewEmpInfo>): ProcessedRow[] =>
    loadedRows.map((r) => {
      if (r.isWaeju) return r;
      const isNew = empData.has(r.성명);
      if (isNew && !r.isNewEmployee) {
        const gongsuA = parseFloat(r.xerpGongsuA) || 0;
        const d = 1.0 - gongsuA;
        return { ...r, isNewEmployee: true, calcGongsuVal: 1.0, diff: d > 0 ? d : null, needsUpdate: d > 0 };
      }
      if (!isNew && r.isNewEmployee) {
        const cfg = getTeamConfig(r.팀명);
        const effInMin = resolveEffInMin(r.rawInMin, r.isJochul, cfg);
        const calcVal = calcGongsu(effInMin, r.rawOutMin, r.isJochul, cfg);
        const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
        const 가산사유 = needsUpdate ? inferGasanReason(r) : "";
        return { ...r, isNewEmployee: false, calcGongsuVal: calcVal, diff, needsUpdate, 가산사유 };
      }
      return r;
    });

  const deleteNewEmp = (name: string) => {
    setNewEmpData((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setNewEmpSavedCount(null);
  };

  // 마운트 시 날짜 목록 + 가장 최근 날짜 데이터 로드
  useEffect(() => {
    (async () => {
      const { dm, dates } = await refreshWorkDates();
      if (dm && dates.length > 0) {
        const latest = dates[0];
        setWorkDate(latest);
        const empData = await loadNewEmpForDate(latest);
        const entry = dm[latest];
        if (entry?.rows?.length > 0) {
          setRows(applyNewEmpToRows(entry.rows as ProcessedRow[], empData));
          setFileName(entry.fileName ?? null);
          setRawExcelRows((entry.rawExcelRows ?? []) as RawExcelRow[]);
          toast.info(`저장된 데이터 불러옴 (${latest} / ${entry.fileName})`);
        }
      } else {
        // 레거시 단일 저장 마이그레이션
        loadXerpWorkFS().then((data) => {
          if (data?.rows && data.rows.length > 0) {
            setRows(data.rows as ProcessedRow[]);
            setFileName(data.fileName ?? null);
            toast.info(`저장된 데이터 불러옴 (${data.fileName})`);
          }
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });

      // 헤더 행 탐색 — 이름/성명/단가 컬럼 인덱스 찾기
      let nameColIdx  = -1;
      let bdayColIdx  = -1;  // 나이(생년월일) 컬럼
      let dankaColIdx = -1;  // 단가 컬럼
      let dataStart   = 0;
      for (let i = 0; i < Math.min(raw.length, 6); i++) {
        const row = raw[i] as unknown[];
        const nameIdx  = row.findIndex((c) => ["성명", "이름", "name"].includes(String(c).trim()));
        const bdayIdx  = row.findIndex((c) => ["나이", "생년월일", "생년"].includes(String(c).trim()));
        const dankaIdx = row.findIndex((c) => String(c).trim().startsWith("단가"));
        if (nameIdx !== -1) {
          nameColIdx  = nameIdx;
          if (bdayIdx  !== -1) bdayColIdx  = bdayIdx;
          if (dankaIdx !== -1) dankaColIdx = dankaIdx;
          dataStart = i + 1;
          break;
        }
      }
      if (nameColIdx === -1) { nameColIdx = 0; dataStart = 1; }

      const data = new Map<string, NewEmpInfo>();
      for (let i = dataStart; i < raw.length; i++) {
        const row  = raw[i] as unknown[];
        const name = String(row[nameColIdx] ?? "").trim();
        if (!name) continue;
        const 생년월일 = bdayColIdx  !== -1 ? excelSerialToDateStr(row[bdayColIdx])       : "";
        const 단가     = dankaColIdx !== -1 ? String(row[dankaColIdx] ?? "").trim()        : "";
        data.set(name, { 생년월일, 단가 });
      }

      setNewEmpData(data);
      setNewEmpFileName(file.name);
      setNewEmpSavedCount(null);
      toast.success(`신규자 명단 ${data.size}명 등록됨`);
    } catch {
      toast.error("신규자 명단 파일 읽기 오류");
    }
  };

  // 신규자 명단 저장
  const handleSaveNewEmp = async () => {
    if (!newEmpData.size || !newEmpFileName) return;
    setIsSavingNewEmp(true);
    const plainData = Object.fromEntries(newEmpData);
    const ok = await saveNewEmpDateFS(workDate, newEmpFileName, plainData);
    setIsSavingNewEmp(false);
    if (ok) {
      setNewEmpSavedCount(newEmpData.size);
      toast.success(`신규자 명단 저장됨 (${workDate} / ${newEmpData.size}명)`);
    } else {
      toast.error("신규자 명단 저장 실패");
    }
  };

  // 신규자 명단 변경 시 기존 rows 재계산
  useEffect(() => {
    if (rows.length === 0) return;
    setRows((prev) => prev.map((r) => {
      if (r.isWaeju) return r; // 외주는 항상 0 유지
      const isNew = newEmpData.has(r.성명);
      if (isNew) {
        const gongsuA = parseFloat(r.xerpGongsuA) || 0;
        const diff = 1.0 - gongsuA;
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
  }, [newEmpData]);

  // 조출 토글
  const toggleJochul = (rowIndex: number) => {
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      if (r.isWaeju) return r; // 외주는 조출 무시
      const newJochul = !r.isJochul;
      const cfg       = getTeamConfig(r.팀명);
      const effInMin  = resolveEffInMin(r.rawInMin, newJochul, cfg);
      const effIn     = effInMin !== null ? minToStr(effInMin) : "";
      const calcVal   = calcGongsu(effInMin, r.rawOutMin, newJochul, cfg);
      const { diff, needsUpdate } = calcDiff(calcVal, r.xerpGongsuA);
      const isLate    = effInMin !== null && effInMin > cfg.standardStart;
      const 가산사유 = needsUpdate ? (r.가산사유 || inferGasanReason(r)) : "";
      return { ...r, isJochul: newJochul, effIn, calcGongsuVal: calcVal, diff, needsUpdate, isLate, 가산사유 };
    }));
  };

  // 가산B 수기 편집
  const startEdit = (row: ProcessedRow) => {
    setEditingIdx(row.rowIndex);
    setEditingVal(row.diff !== null ? String(row.diff) : "");
    setEditingReason(row.가산사유 ?? "");
  };

  const commitEdit = (rowIndex: number) => {
    const num = parseFloat(editingVal);
    setRows((prev) => prev.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      if (isNaN(num) || num <= 0) {
        return { ...r, diff: null, 가산사유: "", needsUpdate: false };
      }
      const reason = editingReason.trim() || inferGasanReason(r);
      return { ...r, diff: num, 가산사유: reason, needsUpdate: true };
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
        const isWaeju       = isWaejuTeam(팀명);
        const isNewEmployee = !isWaeju && newEmpData.has(성명);
        const isNoRecord    = rawInMin === null || rawOutMin === null;
        const isLate        = !isWaeju && !isNoRecord && effInMin !== null && effInMin > cfg.standardStart;

        let calcGongsuVal: number | null;
        let diff: number | null;
        let needsUpdate: boolean;

        if (isWaeju) {
          calcGongsuVal = 0;
          diff = null;
          needsUpdate = false;
        } else if (isNewEmployee) {
          calcGongsuVal = 1.0;
          const gongsuA = parseFloat(xerpGongsuA) || 0;
          const d = 1.0 - gongsuA;
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
          calcGongsuVal, diff,
          가산사유: needsUpdate ? inferGasanReason({ xerpIn: xerpInStr, xerpOut: xerpOutStr, pmisIn: pmisInStr, rawInMin, rawOutMin, isLate, standardStart: cfg.standardStart }) : "",
          needsUpdate, isNoRecord, isLate,
          standardStart: cfg.standardStart,
          isNewEmployee, isWaeju,
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
      if (detectedDate) { setSyncDate(detectedDate); setWorkDate(detectedDate); }

      const noRec = processed.filter((r) => r.isNoRecord).length;
      const late  = processed.filter((r) => r.isLate).length;
      const needs = processed.filter((r) => r.needsUpdate).length;
      toast.success(`${processed.length}명 불러옴 — 기록없음 ${noRec}명 · 지각 ${late}명 · 가산필요 ${needs}명`);
    } catch {
      toast.error("파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  // 공수반영 데이터 저장
  const handleSave = async () => {
    if (!rows.length || !fileName) return;
    setIsSaving(true);
    const ok = await saveXerpWorkDateFS(workDate, fileName, rows, rawExcelRows);
    setIsSaving(false);
    if (ok) {
      toast.success(`저장되었습니다. (${workDate})`);
      await refreshWorkDates();
    } else {
      toast.error("저장 실패");
    }
  };

  // 날짜 선택 시 해당 날짜 데이터 로드
  const handleWorkDateChange = async (date: string) => {
    setWorkDate(date);
    if (!date) return;
    setIsLoadingDate(true);
    const [dm, empData] = await Promise.all([
      loadXerpWorkDateMapFS(),
      loadNewEmpForDate(date),
    ]);
    setIsLoadingDate(false);
    if (dm?.[date]) {
      const entry = dm[date];
      setRows(applyNewEmpToRows(entry.rows as ProcessedRow[], empData));
      setFileName(entry.fileName ?? null);
      setOriginalBuffer(null);
      setWorkbook(null);
      setRawExcelRows((entry.rawExcelRows ?? []) as RawExcelRow[]);
      toast.info(`${date} 데이터 불러옴 (${entry.fileName})`);
    } else {
      setRows([]);
      setFileName(null);
      setOriginalBuffer(null);
      setWorkbook(null);
      setRawExcelRows([]);
      toast.info(`${date} 저장된 데이터 없음`);
    }
  };

  // 날짜 삭제
  const handleDeleteWorkDate = async (date: string) => {
    if (!confirm(`${date} 데이터를 삭제하시겠습니까?`)) return;
    const ok = await deleteXerpWorkDateFS(date);
    if (ok) {
      toast.success(`${date} 삭제됨`);
      const { dates } = await refreshWorkDates();
      if (dates.length > 0) {
        handleWorkDateChange(dates[0]);
      } else {
        setWorkDate(today());
        setRows([]);
        setFileName(null);
      }
    }
  };

  // XERP&PMIS 전체 명단 반영 (파일 전체 데이터 교체)
  const handleSync = async () => {
    if (!rows.length) return;
    if (!rawExcelRows.length) {
      toast.error("원본 엑셀 데이터가 없습니다. 엑셀을 다시 업로드하거나 저장 후 시도해 주세요.");
      return;
    }
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

  const handleDownload = async () => {
    if (!originalBuffer || !fileName) return;
    try {
      // ExcelJS로 읽어야 테두리·셀병합 등 원본 서식이 완전 보존됨
      // (XLSX 무료판은 cellStyles 쓰기가 불완전하여 XERP 반영 불가)
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(originalBuffer);
      const ws = wb.worksheets[0];
      if (!ws) { toast.error("시트를 찾을 수 없습니다."); return; }

      // 헤더 행 Z열에 "가산사유" 삽입
      const firstDataRowIndex = rows.length > 0 ? Math.min(...rows.map((r) => r.rowIndex)) : -1;
      if (firstDataRowIndex > 0) {
        ws.getCell(firstDataRowIndex, 26).value = "가산사유";
      }

      for (const row of rows) {
        if (row.diff === null) continue;

        let effectiveDiff = row.diff;
        let effectiveReason = row.가산사유;
        if (isSafetyEduDate) {
          const outMin = parseMin(row.xerpOut);
          if (outMin !== null && outMin >= 16 * 60 + 20 && outMin <= 17 * 60) {
            const xerpA = parseFloat(row.xerpGongsuA) || 0;
            effectiveDiff = parseFloat(Math.max(0, 1.0 - xerpA).toFixed(2));
            effectiveReason = "정기안전교육으로 빠른퇴근타각";
          }
        }

        const excelRow = row.rowIndex + 1; // 0-based → 1-based

        // T열 (col 20, 0-based 19): 가산공수(B) 신청
        ws.getCell(excelRow, 20).value = effectiveDiff;

        // V열 (col 22, 0-based 21): 공수합계 (A+B)
        const gongsuA = parseFloat(row.xerpGongsuA) || 0;
        const gongsuAB = Math.round((gongsuA + effectiveDiff) * 100) / 100;
        ws.getCell(excelRow, 22).value = gongsuAB;

        // Z열 (col 26, 0-based 25): 가산사유 (X열은 작업내용 컬럼이므로 건드리지 않음)
        if (effectiveReason) {
          ws.getCell(excelRow, 26).value = effectiveReason;
        }
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const outName = fileName.replace(/\.xlsx?$/i, "") + "_공수반영.xlsx";
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("수정된 파일을 다운로드했습니다.");

      const entry: DownloadHistoryEntry = {
        downloadedAt: new Date().toISOString(),
        workDate,
        fileName: outName,
        rowCount: rows.filter((r) => r.diff !== null).length,
      };
      addDownloadHistoryFS(entry).then(() => {
        setDownloadHistory((prev) => [entry, ...prev].slice(0, 100));
      });
    } catch (e) {
      console.error("[handleDownload]", e);
      toast.error("다운로드 중 오류가 발생했습니다.");
    }
  };

  // 정기안전교육
  const isSafetyEduDate = safetyEduDates.has(workDate);

  const toggleSafetyEduDate = () => {
    if (!isAdmin) return;
    const next = new Set(safetyEduDates);
    if (next.has(workDate)) next.delete(workDate); else next.add(workDate);
    setSafetyEduDates(next);
    saveSafetyEduDatesFS([...next]).then((ok) => {
      if (!ok) toast.error("정기안전교육 설정 저장 실패");
    });
  };

  // 정렬 핸들러
  const handleSortWR = (col: SortColWR) => {
    if (sortColWR === col) setSortDirWR((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortColWR(col); setSortDirWR("asc"); }
  };

  const teamList = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.팀명).filter(Boolean))].sort();
    return ["전체", ...names];
  }, [rows]);

  const displayRows = useMemo(() => {
    const q = search.trim();
    let filtered = q
      ? rows.filter((r) => r.성명.includes(q) || r.팀명.includes(q))
      : [...rows];

    if (teamFilter !== "전체") {
      filtered = filtered.filter((r) => r.팀명 === teamFilter);
    }

    // 정기안전교육: 16:20~17:00 퇴근 → 계산공수 1, 가산사유 자동 설정
    if (isSafetyEduDate) {
      filtered = filtered.map((r) => {
        const outMin = parseMin(r.xerpOut);
        if (outMin !== null && outMin >= 16 * 60 + 20 && outMin <= 17 * 60) {
          const xerpA = parseFloat(r.xerpGongsuA) || 0;
          const newDiff = parseFloat(Math.max(0, 1.0 - xerpA).toFixed(2));
          return {
            ...r,
            calcGongsuVal: 1.0,
            가산사유: "정기안전교육으로 빠른퇴근타각",
            diff: newDiff > 0 ? newDiff : r.diff,
            needsUpdate: newDiff > 0 || r.needsUpdate,
          };
        }
        return r;
      });
    }

    // 정렬
    if (sortColWR) {
      filtered = [...filtered].sort((a, b) => {
        const av = a[sortColWR] || "9999";
        const bv = b[sortColWR] || "9999";
        const cmp = av.localeCompare(bv);
        return sortDirWR === "asc" ? cmp : -cmp;
      });
    }

    return filtered;
  }, [rows, search, teamFilter, isSafetyEduDate, sortColWR, sortDirWR]);

  // 일괄 선택
  const allSelected = displayRows.length > 0 && displayRows.every((r) => selectedIdxes.has(r.rowIndex));
  const someSelected = !allSelected && displayRows.some((r) => selectedIdxes.has(r.rowIndex));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIdxes((prev) => {
        const next = new Set(prev);
        displayRows.forEach((r) => next.delete(r.rowIndex));
        return next;
      });
    } else {
      setSelectedIdxes((prev) => {
        const next = new Set(prev);
        displayRows.forEach((r) => next.add(r.rowIndex));
        return next;
      });
    }
  };

  const toggleSelectRow = (idx: number) => {
    setSelectedIdxes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const totalCount    = rows.length;
  const needCount     = rows.filter((r) => r.needsUpdate).length;
  const noRecCount    = rows.filter((r) => r.isNoRecord).length;
  const lateCount     = rows.filter((r) => r.isLate).length;
  const zeroGongsuCount = rows.filter((r) =>
    !r.isWaeju && !r.isNoRecord && (parseFloat(r.xerpGongsuA) === 0 || r.calcGongsuVal === 0)
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
              {newEmpData.size}명 등록
            </span>
            {newEmpSavedCount !== null && (
              <span className="text-xs text-sky-600 bg-sky-50 border border-sky-200 px-2 py-1 rounded-lg">
                저장됨 {newEmpSavedCount}명
              </span>
            )}
            <button
              onClick={handleSaveNewEmp}
              disabled={isSavingNewEmp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingNewEmp ? "저장 중..." : `저장 (${workDate})`}
            </button>
            <button
              onClick={() => setShowNewEmpList((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-300 bg-sky-100 text-xs font-semibold text-sky-700 hover:bg-sky-200 transition-colors"
            >
              {showNewEmpList ? "명단 닫기" : "명단 보기"}
            </button>
            <button
              onClick={() => { setNewEmpData(new Map()); setNewEmpFileName(null); setNewEmpSavedCount(null); setShowNewEmpList(false); }}
              className="flex items-center gap-1 text-xs text-sky-500 hover:text-sky-700"
            >
              <X className="h-3.5 w-3.5" /> 초기화
            </button>
          </>
        ) : (
          <>
            <span className="text-[11px] text-sky-600">신규자 명단을 업로드하면 해당 인원은 출퇴근 무관 1.0공수 적용됩니다</span>
            {newEmpSavedCount !== null && (
              <span className="text-xs text-sky-600 bg-sky-50 border border-sky-200 px-2 py-1 rounded-lg">
                {workDate} 저장됨 {newEmpSavedCount}명
              </span>
            )}
          </>
        )}
      </div>

      {/* 신규자 명단 패널 */}
      {showNewEmpList && newEmpData.size > 0 && (() => {
        const newEmpRows = rows.filter((r) => r.isNewEmployee);
        const sth = "px-2 py-2 text-[11px] font-semibold text-center bg-sky-100 border-r border-sky-200 last:border-r-0 sticky top-0 z-10 whitespace-nowrap";
        const stc = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-sky-50 last:border-r-0";
        return (
          <div className="rounded-xl border border-sky-200 bg-white shadow-sm overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-sky-50 border-b border-sky-200">
              <span className="text-xs font-bold text-sky-800 flex items-center gap-1.5">
                신규자 명단 — {newEmpData.size}명 등록
                {newEmpRows.length > 0 && newEmpRows.length < newEmpData.size && (
                  <span className="text-[11px] font-normal text-sky-500">
                    (공수 데이터 매칭 {newEmpRows.length}명 / 미매칭 {newEmpData.size - newEmpRows.length}명)
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
                        <th className={sth}>생년월일</th>
                        <th className={sth}>단가</th>
                        <th className={sth}>XERP 출근</th>
                        <th className={sth}>XERP 퇴근</th>
                        <th className={sth}>PMIS 출근</th>
                        <th className={sth}>PMIS 퇴근</th>
                        <th className={sth}>공수A</th>
                        <th className={sth}>적용공수</th>
                        <th className={sth}>가산B</th>
                        <th className={sth}>삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newEmpRows.map((r) => {
                        const info = newEmpData.get(r.성명);
                        return (
                          <tr key={r.rowIndex} className="border-b border-sky-50 last:border-0 bg-sky-50/40 hover:bg-sky-50">
                            <td className={`${stc} text-muted-foreground`}>{r.팀명 || "—"}</td>
                            <td className={`${stc} font-semibold text-sky-800`}>{r.성명}</td>
                            <td className={`${stc} tabular-nums text-slate-600`}>{info?.생년월일 || "—"}</td>
                            <td className={`${stc} tabular-nums text-emerald-700 font-semibold`}>{info?.단가 ? Number(info.단가).toLocaleString() : "—"}</td>
                            <td className={`${stc} tabular-nums ${!r.xerpIn ? "text-rose-400" : "text-blue-600"}`}>{r.xerpIn || "미기록"}</td>
                            <td className={`${stc} tabular-nums ${!r.xerpOut ? "text-rose-400" : "text-red-600"}`}>{r.xerpOut || "미기록"}</td>
                            <td className={`${stc} tabular-nums ${!r.pmisIn ? "text-rose-400" : "text-blue-400"}`}>{r.pmisIn || "미기록"}</td>
                            <td className={`${stc} tabular-nums ${!r.pmisOut ? "text-rose-400" : "text-red-400"}`}>{r.pmisOut || "미기록"}</td>
                            <td className={`${stc} tabular-nums`}>{r.xerpGongsuA || "—"}</td>
                            <td className={`${stc} font-bold text-sky-700 tabular-nums`}>1.00</td>
                            <td className={`${stc} font-bold text-amber-600 tabular-nums`}>{r.diff !== null ? `+${r.diff.toFixed(2)}` : "—"}</td>
                            <td className={stc}>
                              <button onClick={() => deleteNewEmp(r.성명)} className="text-rose-400 hover:text-rose-600 transition-colors" title="신규자 해제">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-6 text-xs text-muted-foreground">XERP 공수 데이터와 매칭된 신규자가 없습니다. 메인 엑셀을 업로드하세요.</p>
                )}
              </div>
              {/* 우: 미매칭 신규자 (XERP 데이터 없음) */}
              {(() => {
                const matchedNames = new Set(newEmpRows.map((r) => r.성명));
                const unmatched = [...newEmpData.keys()].filter((n) => !matchedNames.has(n));
                if (unmatched.length === 0) return null;
                return (
                  <div className="border-l border-sky-200 min-w-[140px] bg-slate-50/60">
                    <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 border-b border-sky-100 sticky top-0 bg-slate-100">
                      XERP 미매칭 ({unmatched.length}명)
                    </div>
                    <ul className="p-2 space-y-1.5">
                      {unmatched.map((name) => {
                        const info = newEmpData.get(name);
                        return (
                          <li key={name} className="text-xs space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                              <span className="text-slate-700 font-semibold">{name}</span>
                              <button onClick={() => deleteNewEmp(name)} className="ml-auto text-rose-400 hover:text-rose-600 transition-colors" title="신규자 해제">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            {info?.생년월일 && <div className="pl-3 text-slate-400">{info.생년월일}</div>}
                            {info?.단가 && <div className="pl-3 text-emerald-600 font-medium">{Number(info.단가).toLocaleString()}원</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* 날짜 선택 패널 */}
      <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 shrink-0">
        <span className="text-xs font-bold text-indigo-800">날짜별 공수반영</span>

        {/* 날짜 직접 입력 */}
        <input
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
          className="border border-indigo-300 rounded-lg px-2 py-1.5 text-xs font-semibold bg-white outline-none focus:ring-1 focus:ring-indigo-400"
        />

        {/* 저장된 날짜 선택 드롭다운 */}
        {workDates.length > 0 && (
          <select
            value={workDate}
            onChange={(e) => handleWorkDateChange(e.target.value)}
            className="border border-indigo-300 rounded-lg px-2 py-1.5 text-xs font-semibold bg-white outline-none"
          >
            <option value="">— 저장된 날짜 선택 —</option>
            {workDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        {isLoadingDate && <span className="text-xs text-indigo-500 animate-pulse">불러오는 중...</span>}

        {workDates.length > 0 && workDate && workDates.includes(workDate) && (
          <button
            onClick={() => handleDeleteWorkDate(workDate)}
            className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-600 transition-colors"
            title="이 날짜 데이터 삭제"
          >
            <X className="h-3.5 w-3.5" /> 삭제
          </button>
        )}

        {workDates.length === 0 && (
          <span className="text-[11px] text-indigo-500">엑셀 업로드 후 저장하면 날짜별로 기록됩니다</span>
        )}
      </div>

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
              {isSaving ? "저장 중..." : `저장 (${workDate})`}
            </button>

            {originalBuffer && (
              <>
                <button
                  onClick={handleDownload}
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Download className="h-4 w-4 text-muted-foreground" />
                  수정 파일 다운로드
                </button>
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
                  title="다운로드 이력"
                >
                  <History className="h-4 w-4" />
                  이력
                  {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ── 다운로드 이력 패널 ── */}
      {showHistory && (
        <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden shrink-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
            <span className="text-sm font-bold flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              공수 반영 다운로드 이력
            </span>
            <span className="text-xs text-muted-foreground">최근 100건</span>
          </div>
          {downloadHistory.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">다운로드 이력이 없습니다.</div>
          ) : (
            <div className="overflow-auto max-h-52">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">다운로드 일시</th>
                    <th className="px-3 py-2 text-center font-semibold text-muted-foreground">작업 날짜</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">파일명</th>
                    <th className="px-3 py-2 text-center font-semibold text-muted-foreground">반영 건수</th>
                  </tr>
                </thead>
                <tbody>
                  {downloadHistory.map((h, i) => {
                    const dt = new Date(h.downloadedAt);
                    const dtStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
                    return (
                      <tr key={i} className={`border-b border-border/50 last:border-0 hover:bg-muted/20 ${i % 2 === 1 ? "bg-slate-50/40" : ""}`}>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{dtStr}</td>
                        <td className="px-3 py-2 text-center font-semibold tabular-nums">{h.workDate}</td>
                        <td className="px-3 py-2 text-blue-600 truncate max-w-[240px]">{h.fileName}</td>
                        <td className="px-3 py-2 text-center font-bold text-emerald-700">{h.rowCount}건</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
          !r.isWaeju && !r.isNoRecord && (parseFloat(r.xerpGongsuA) === 0 || r.calcGongsuVal === 0);
        const specialRows = rows.filter((r) => !r.isWaeju && (r.isNoRecord || r.isLate || r.needsUpdate || isZeroGongsu(r)));
        const sth = "px-2 py-2 text-[11px] font-semibold text-center bg-slate-200 border-r border-slate-300 last:border-r-0 sticky top-0 z-10 whitespace-nowrap";
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

      {/* 검색창 + 정기안전교육 + 정렬 + 범례 */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* 검색 */}
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

            {/* 팀명 필터 */}
            {teamList.length > 2 && (
              <select
                value={teamFilter}
                onChange={(e) => { setTeamFilter(e.target.value); setSelectedIdxes(new Set()); }}
                className="border border-border rounded-lg px-3 py-2 text-sm font-semibold text-foreground bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                {teamList.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}

            {/* 정기안전교육 체크칸 */}
            <label
              title={isAdmin ? "클릭하여 이 날짜를 정기안전교육 날짜로 설정/해제" : "정기안전교육 날짜 여부"}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors select-none
                ${isSafetyEduDate
                  ? "bg-amber-50 border-amber-400 text-amber-700"
                  : "bg-white border-border text-muted-foreground"}
                ${isAdmin ? "cursor-pointer hover:border-amber-400 hover:bg-amber-50/60" : "cursor-default"}`}
            >
              <input
                type="checkbox"
                checked={isSafetyEduDate}
                onChange={toggleSafetyEduDate}
                readOnly={!isAdmin}
                className="h-4 w-4 accent-amber-500"
              />
              <span className="text-xs font-semibold whitespace-nowrap">정기안전교육</span>
              {isSafetyEduDate && (
                <span className="text-[10px] font-normal opacity-70">· 16:20~17:00 퇴근 = 1공수</span>
              )}
            </label>

            {/* 정렬 버튼 */}
            <div className="flex items-center gap-1.5 bg-white border border-border rounded-lg px-3 py-1.5">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-1">정렬</span>
              {([
                { col: "xerpIn"  as const, label: "X출근" },
                { col: "xerpOut" as const, label: "X퇴근" },
                { col: "pmisIn"  as const, label: "P출근" },
                { col: "pmisOut" as const, label: "P퇴근" },
              ]).map(({ col, label }) => (
                <button
                  key={col}
                  onClick={() => handleSortWR(col)}
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors
                    ${sortColWR === col
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                >
                  {label}
                  {sortColWR === col
                    ? (sortDirWR === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                    : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                </button>
              ))}
              {sortColWR && (
                <button
                  onClick={() => { setSortColWR(null); setSortDirWR("asc"); }}
                  className="ml-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors"
                >
                  초기화
                </button>
              )}
            </div>
          </div>

          {/* 선택 행 액션바 */}
          {selectedIdxes.size > 0 && (
            <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2">
              <span className="text-xs font-semibold text-primary">{selectedIdxes.size}행 선택됨</span>
              <button
                onClick={() => setSelectedIdxes(new Set())}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                선택 해제
              </button>
            </div>
          )}

          {/* 범례 */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" /> 기록없음</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> 지각</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-300 inline-block" /> 가산필요</span>
            {isSafetyEduDate && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-400 inline-block" /> 정기안전교육(16:20~17:00)</span>}
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
                <th className={`${th} w-[36px]`}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 accent-primary cursor-pointer"
                    title="전체 선택"
                  />
                </th>
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
                <th className={`${th} bg-amber-50`}>가산사유</th>
                <th className={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-12 text-center text-sm text-muted-foreground">
                    "{search}"에 해당하는 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => {
                  const rowBg = row.isWaeju
                    ? "bg-slate-100/70 hover:bg-slate-100"
                    : row.isNewEmployee
                      ? "bg-sky-50/70 hover:bg-sky-50"
                      : row.isNoRecord
                        ? "bg-rose-50/60 hover:bg-rose-50"
                        : row.isLate
                          ? "bg-orange-50/60 hover:bg-orange-50"
                          : row.needsUpdate
                            ? "bg-amber-50/40 hover:bg-amber-50/70"
                            : "hover:bg-muted/20";

                  const outMin = parseMin(row.xerpOut);
                  const isEarlyOutHighlight = isSafetyEduDate && outMin !== null && outMin >= 16 * 60 + 20 && outMin <= 17 * 60;
                  const finalRowBg = isEarlyOutHighlight ? "bg-amber-50/60 hover:bg-amber-50/80" : rowBg;
                  return (
                    <tr key={`${row.rowIndex}-${row.성명}`} className={`border-b border-border/60 last:border-0 transition-colors ${finalRowBg}`}>
                      <td className={`${cell} w-[36px]`}>
                        <input
                          type="checkbox"
                          checked={selectedIdxes.has(row.rowIndex)}
                          onChange={() => toggleSelectRow(row.rowIndex)}
                          className="h-4 w-4 accent-primary cursor-pointer"
                        />
                      </td>
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
                            data-editing-row={row.rowIndex}
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={(e) => {
                              const next = e.relatedTarget as HTMLElement | null;
                              if (next?.dataset?.editingRow === String(row.rowIndex)) return;
                              commitEdit(row.rowIndex);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(row.rowIndex); if (e.key === "Tab") { e.preventDefault(); commitEdit(row.rowIndex); } if (e.key === "Escape") setEditingIdx(null); }}
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

                      {/* 가산사유 */}
                      <td className={`${cell} bg-amber-50/40 p-0`}>
                        {editingIdx === row.rowIndex ? (
                          <input
                            type="text"
                            value={editingReason}
                            placeholder="사유 입력"
                            data-editing-row={row.rowIndex}
                            onChange={(e) => setEditingReason(e.target.value)}
                            onBlur={(e) => {
                              const next = e.relatedTarget as HTMLElement | null;
                              if (next?.dataset?.editingRow === String(row.rowIndex)) return;
                              commitEdit(row.rowIndex);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(row.rowIndex); if (e.key === "Escape") setEditingIdx(null); }}
                            className="w-full min-w-[120px] px-2 py-1.5 text-xs bg-amber-100 border-0 outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(row)}
                            className="w-full px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-amber-100 transition-colors truncate max-w-[140px]"
                            title={row.가산사유 || "클릭하여 사유 입력"}
                          >
                            {row.가산사유 || <span className="text-muted-foreground/40">—</span>}
                          </button>
                        )}
                      </td>

                      <td className={cell}>
                        <div className="flex flex-col items-center gap-0.5">
                          {row.isWaeju && <span className="inline-flex items-center gap-1 text-slate-500 font-semibold"><MinusCircle className="h-3 w-3" /> 외주(0)</span>}
                          {!row.isWaeju && row.isNewEmployee && <span className="inline-flex items-center gap-1 text-sky-600 font-semibold"><CheckCircle className="h-3 w-3" /> 신규(1.0)</span>}
                          {!row.isWaeju && row.isNoRecord && <span className="inline-flex items-center gap-1 text-rose-600 font-semibold"><UserX className="h-3 w-3" /> 기록없음</span>}
                          {!row.isWaeju && row.isLate && <span className="inline-flex items-center gap-1 text-orange-600 font-semibold"><Clock className="h-3 w-3" /> 지각</span>}
                          {!row.isWaeju && !row.isNewEmployee && !row.isNoRecord && row.needsUpdate && <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="h-3 w-3" /> 가산필요</span>}
                          {!row.isWaeju && !row.isNewEmployee && !row.isNoRecord && !row.isLate && !row.needsUpdate && row.calcGongsuVal !== null && <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle className="h-3 w-3" /> 정상</span>}
                          {!row.isWaeju && row.calcGongsuVal === null && !row.isNoRecord && <span className="inline-flex items-center gap-1 text-muted-foreground"><MinusCircle className="h-3 w-3" /> 데이터없음</span>}
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
