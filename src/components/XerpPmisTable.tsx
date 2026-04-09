import { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Download, Upload, CalendarDays, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

// ── 타입 ──────────────────────────────────────────────
interface XerpPmisRow {
  id: string;
  팀명: string; 직종: string; 사번: string; 성명: string; 생년월일: string;
  xerp출근: string; xerp퇴근: string;
  pmis출근: string; pmis퇴근: string;
  조출: string; 오전: string; 오후: string; 연장: string;
  야간: string; 철야: string; 점심: string; 공수합계A: string;
  초과당일: string; 초과합계: string;
  가산신청: string; 가산승인: string;
  공수합계AB: string; 월누계: string;
}

type DateMap = Record<string, XerpPmisRow[]>; // key = "YYYY-MM-DD"

// ── 열 위치(0-based) 매핑 ────────────────────────────
const COL_MAP: Record<number, keyof XerpPmisRow> = {
  0:"팀명", 1:"직종", 2:"사번", 3:"성명", 4:"생년월일",
  5:"xerp출근", 6:"xerp퇴근", 7:"pmis출근", 8:"pmis퇴근",
  9:"조출", 10:"오전", 11:"오후", 12:"연장", 13:"야간", 14:"철야", 15:"점심", 16:"공수합계A",
  17:"초과당일", 18:"초과합계", 19:"가산신청", 20:"가산승인",
  21:"공수합계AB", 22:"월누계",
};

const HEADER_KEYWORDS = new Set(["팀명","팀","직종","사번","성명","이름","생년월일"]);
function isHeaderRow(row: unknown[]): boolean {
  return row.some((c) => HEADER_KEYWORDS.has(String(c).trim()));
}

function emptyRow(): XerpPmisRow {
  return {
    id: crypto.randomUUID(),
    팀명:"", 직종:"", 사번:"", 성명:"", 생년월일:"",
    xerp출근:"", xerp퇴근:"", pmis출근:"", pmis퇴근:"",
    조출:"", 오전:"", 오후:"", 연장:"", 야간:"", 철야:"", 점심:"", 공수합계A:"",
    초과당일:"", 초과합계:"", 가산신청:"", 가산승인:"",
    공수합계AB:"", 월누계:"",
  };
}

function parseSheet(wb: XLSX.WorkBook): XerpPmisRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length === 0) return [];
  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    if (isHeaderRow(raw[i])) dataStart = i + 1;
  }
  const results: XerpPmisRow[] = [];
  for (let i = dataStart; i < raw.length; i++) {
    const row = raw[i];
    if (row.every((c) => String(c).trim() === "")) continue;
    const emp = emptyRow();
    for (const [colStr, field] of Object.entries(COL_MAP)) {
      emp[field] = String(row[Number(colStr)] ?? "").trim();
    }
    results.push(emp);
  }
  return results;
}

// ── 날짜 유틸 ─────────────────────────────────────────
function toDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatLabel(dateStr: string): string {
  const [y, m, dd] = dateStr.split("-");
  return `${y}년 ${Number(m)}월 ${Number(dd)}일`;
}

// ── 상수 ─────────────────────────────────────────────
const STORAGE_KEY = "worksite_xerp_pmis";
const TODAY = toDateStr();

const cell = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-border/40 last:border-r-0";
const cellNum = `${cell} tabular-nums`;

// ── localStorage 초기 로드 (구버전 배열 → 날짜맵 자동 마이그레이션) ──
function loadDateMap(): DateMap {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      // 구버전: 단일 배열 → 오늘 날짜로 마이그레이션
      return parsed.length > 0 ? { [TODAY]: parsed } : {};
    }
    if (typeof parsed === "object" && parsed !== null) return parsed as DateMap;
    return {};
  } catch { return {}; }
}

// ── 컴포넌트 ──────────────────────────────────────────
interface Props { isAdmin: boolean }

export default function XerpPmisTable({ isAdmin }: Props) {
  const [dateMap, setDateMap] = useState<DateMap>(loadDateMap);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const map = loadDateMap();
    const dates = Object.keys(map).sort().reverse();
    return dates[0] ?? TODAY; // 가장 최근 날짜, 없으면 오늘
  });
  const [uploadDate, setUploadDate] = useState<string>(TODAY);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // localStorage 동기화
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dateMap));
  }, [dateMap]);

  // 날짜 목록 (최신순)
  const availableDates = useMemo(
    () => Object.keys(dateMap).sort().reverse(),
    [dateMap]
  );

  // 현재 선택 날짜의 행
  const currentRows = dateMap[selectedDate] ?? [];

  const displayRows = useMemo(() => {
    const q = search.trim();
    if (!q) return currentRows;
    return currentRows.filter((r) => r.성명.includes(q) || r.사번.includes(q));
  }, [currentRows, search]);

  // ── 업로드 ──
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const imported = parseSheet(wb);
        if (imported.length === 0) {
          toast.error("데이터를 찾을 수 없습니다. 헤더 행을 확인하세요.");
          return;
        }
        setDateMap((prev) => ({ ...prev, [uploadDate]: imported }));
        setSelectedDate(uploadDate); // 업로드한 날짜로 자동 전환
        toast.success(`${formatLabel(uploadDate)} — ${imported.length}건 저장되었습니다.`);
      } catch {
        toast.error("파일을 읽는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 날짜 삭제 ──
  const handleDeleteDate = (date: string) => {
    if (!window.confirm(`${formatLabel(date)} 데이터를 삭제하시겠습니까?`)) return;
    setDateMap((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
    // 삭제 후 선택 날짜 조정
    const remaining = Object.keys(dateMap).filter((d) => d !== date).sort().reverse();
    setSelectedDate(remaining[0] ?? TODAY);
    toast.success(`${formatLabel(date)} 데이터를 삭제했습니다.`);
  };

  // ── 내보내기 ──
  const handleExport = () => {
    if (currentRows.length === 0) { toast.error("내보낼 데이터가 없습니다."); return; }
    const headers = [
      "팀명","직종","사번","성명","생년월일",
      "X-ERP 출근","X-ERP 퇴근","PMIS 출근","PMIS 퇴근",
      "조출","오전","오후","연장","야간","철야","점심","공수합계A",
      "초과당일","초과합계","가산신청","가산승인","공수합계(A+B)","월누계",
    ];
    const dataRows = currentRows.map((r) => [
      r.팀명,r.직종,r.사번,r.성명,r.생년월일,
      r.xerp출근,r.xerp퇴근,r.pmis출근,r.pmis퇴근,
      r.조출,r.오전,r.오후,r.연장,r.야간,r.철야,r.점심,r.공수합계A,
      r.초과당일,r.초과합계,r.가산신청,r.가산승인,r.공수합계AB,r.월누계,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = headers.map(() => ({ wch: 10 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "XERP_PMIS");
    XLSX.writeFile(wb, `XERP_PMIS_${selectedDate.replace(/-/g,"")}.xlsx`);
  };

  // ── th 헬퍼 ──
  const th = (extra = "") =>
    `px-2 py-2 text-[11px] font-semibold text-muted-foreground whitespace-nowrap bg-muted/50 text-center border-r border-border/40 last:border-r-0 sticky top-0 z-20 ${extra}`;

  return (
    <div className="flex flex-col gap-3">
      {isAdmin && (
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
      )}

      {/* ── 제목 ── */}
      <h2 className="text-lg font-bold text-foreground shrink-0">XERP &amp; PMIS</h2>

      {/* ── 날짜 조회 바 ── */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-border rounded-xl px-4 py-2.5 shadow-sm shrink-0">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground">날짜 조회</span>

        {availableDates.length === 0 ? (
          <span className="text-xs text-muted-foreground">저장된 날짜 없음</span>
        ) : (
          <select
            value={selectedDate}
            onChange={(e) => { setSelectedDate(e.target.value); setSearch(""); }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-foreground bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {formatLabel(d)} ({(dateMap[d]?.length ?? 0)}건)
              </option>
            ))}
          </select>
        )}

        {/* 선택 날짜 삭제 (관리자) */}
        {isAdmin && availableDates.length > 0 && (
          <button
            onClick={() => handleDeleteDate(selectedDate)}
            title="선택 날짜 데이터 삭제"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 border border-red-200 transition-colors ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        )}
      </div>

      {/* ── 툴바 ── */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {/* 검색 */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 사번 검색..."
            className="w-full pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 업로드 날짜 + 버튼 (관리자 전용) */}
        {isAdmin && (
          <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">업로드 날짜</span>
            <input
              type="date"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              className="border-0 bg-transparent text-sm font-semibold text-foreground outline-none"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              업로드
            </button>
          </div>
        )}

        {/* 내보내기 */}
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          엑셀 내보내기
        </button>
      </div>

      {/* ── 테이블 ── */}
      <div
        className="overflow-auto rounded-xl border border-border bg-white shadow-sm"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th rowSpan={2} className={th("w-[72px]")}>팀명</th>
              <th rowSpan={2} className={th("w-[72px]")}>직종</th>
              <th rowSpan={2} className={th("w-[72px]")}>사번</th>
              <th rowSpan={2} className={th("w-[72px]")}>성명</th>
              <th rowSpan={2} className={th("w-[88px]")}>생년월일</th>
              <th colSpan={2} className={th()}>X-ERP 체크시간</th>
              <th colSpan={2} className={th()}>PMIS 체크시간</th>
              <th colSpan={8} className={th()}>공수 체크A</th>
              <th colSpan={2} className={th()}>초과근무</th>
              <th colSpan={2} className={th()}>가산공수B</th>
              <th rowSpan={2} className={th()}>공수합계<br />(A+B)</th>
              <th rowSpan={2} className={th()}>월누계</th>
            </tr>
            <tr className="border-b border-border bg-muted/40">
              <th className={th()}>출근</th><th className={th()}>퇴근</th>
              <th className={th()}>출근</th><th className={th()}>퇴근</th>
              <th className={th()}>조출</th><th className={th()}>오전</th>
              <th className={th()}>오후</th><th className={th()}>연장</th>
              <th className={th()}>야간</th><th className={th()}>철야</th>
              <th className={th()}>점심</th><th className={th()}>합계</th>
              <th className={th()}>당일</th><th className={th()}>합계</th>
              <th className={th()}>신청</th><th className={th()}>승인</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={23} className="py-16 text-center text-muted-foreground text-sm">
                  {availableDates.length === 0
                    ? isAdmin ? "엑셀을 업로드하여 날짜별 데이터를 저장하세요." : "저장된 데이터가 없습니다."
                    : search
                      ? `"${search}"에 해당하는 데이터가 없습니다.`
                      : `${formatLabel(selectedDate)}에 저장된 데이터가 없습니다.`}
                </td>
              </tr>
            ) : (
              displayRows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className={cell}>{row.팀명||"—"}</td>
                  <td className={cell}>{row.직종||"—"}</td>
                  <td className={cell}>{row.사번||"—"}</td>
                  <td className={`${cell} font-medium`}>{row.성명||"—"}</td>
                  <td className={cell}>{row.생년월일||"—"}</td>
                  <td className={cellNum}>{row.xerp출근||"—"}</td>
                  <td className={cellNum}>{row.xerp퇴근||"—"}</td>
                  <td className={cellNum}>{row.pmis출근||"—"}</td>
                  <td className={cellNum}>{row.pmis퇴근||"—"}</td>
                  <td className={cellNum}>{row.조출||"—"}</td>
                  <td className={cellNum}>{row.오전||"—"}</td>
                  <td className={cellNum}>{row.오후||"—"}</td>
                  <td className={cellNum}>{row.연장||"—"}</td>
                  <td className={cellNum}>{row.야간||"—"}</td>
                  <td className={cellNum}>{row.철야||"—"}</td>
                  <td className={cellNum}>{row.점심||"—"}</td>
                  <td className={`${cellNum} font-semibold bg-blue-50/50`}>{row.공수합계A||"—"}</td>
                  <td className={cellNum}>{row.초과당일||"—"}</td>
                  <td className={`${cellNum} font-semibold`}>{row.초과합계||"—"}</td>
                  <td className={cellNum}>{row.가산신청||"—"}</td>
                  <td className={cellNum}>{row.가산승인||"—"}</td>
                  <td className={`${cellNum} font-bold bg-primary/5 text-primary`}>{row.공수합계AB||"—"}</td>
                  <td className={`${cellNum} font-bold`}>{row.월누계||"—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground shrink-0">
        {availableDates.length > 0
          ? `${formatLabel(selectedDate)} — 총 ${currentRows.length}건 (검색 결과 ${displayRows.length}건) · 저장된 날짜 ${availableDates.length}개`
          : "저장된 날짜 없음"}
        {!isAdmin && <span className="ml-2 text-amber-600">· 업로드는 관리자만 가능합니다</span>}
      </p>
    </div>
  );
}
