import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, Trash2, Search, X, Download, Upload, Pencil } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { loadEmployeesFS, saveEmployeesFS } from "@/lib/firestoreService";

interface NewEmployee {
  id: string;
  현장구분: string;
  이름: string;
  주민번호: string;
  연락처: string;
  남여: string;
  입사일: string;
  퇴사일: string;
  신청공종: string;
  단가: string;
  단가변동: string;
  은행명: string;
  계좌번호: string;
  주소: string;
}

function calcAge(jumin: string): string {
  if (!jumin || jumin.replace(/-/g, "").length < 7) return "";
  const raw = jumin.replace(/-/g, "");
  const yy = parseInt(raw.slice(0, 2), 10);
  const mm = parseInt(raw.slice(2, 4), 10);
  const dd = parseInt(raw.slice(4, 6), 10);
  const genderDigit = parseInt(raw[6], 10);
  if (isNaN(yy) || isNaN(mm) || isNaN(dd) || isNaN(genderDigit)) return "";
  const fullYear = genderDigit <= 2 ? 1900 + yy : 2000 + yy;
  const birthDate = new Date(fullYear, mm - 1, dd);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const mDiff = today.getMonth() - birthDate.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return isNaN(age) || age < 0 || age > 120 ? "" : String(age);
}

function calcTenure(
  입사일: string,
  퇴사일: string
): { days: string; months: string; status: string } {
  if (!입사일) return { days: "", months: "", status: "" };
  const start = new Date(입사일);
  if (isNaN(start.getTime())) return { days: "", months: "", status: "" };
  const end = 퇴사일 ? new Date(퇴사일) : new Date();
  if (isNaN(end.getTime())) return { days: "", months: "", status: "" };
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return { days: "", months: "", status: "" };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30.4375);
  return {
    days: String(days),
    months: String(months),
    status: 퇴사일 ? "퇴사" : "재직중",
  };
}

// 엑셀 셀 값을 YYYY-MM-DD 문자열로 변환
function excelDateToISO(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    // Excel 시리얼 날짜
    const date = XLSX.SSF.parse_date_code(val);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }
  const str = String(val).trim();
  // YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  // YYYY.MM.DD / YYYY/MM/DD
  const dotSlash = str.replace(/[./]/g, "-");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dotSlash)) {
    const [y, m, d] = dotSlash.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return str;
}

// 열 위치(0-based) → 필드 고정 매핑
// B=1, M=12, N=13, O=14, P=15
const COL_POSITION_MAP: Record<number, keyof NewEmployee> = {
  1:  "현장구분",  // B열: FIELD/SHOP 구분
  12: "신청공종", // M열: 공종
  13: "단가",     // N열: 26.01 기준 현 단가
  14: "단가변동", // O열: 단가 변동
  15: "은행명",   // P열: 은행명
};

// 헤더 이름 → 필드 보조 매핑 (위치 매핑에 없는 나머지 열)
const HEADER_MAP: Record<string, keyof NewEmployee> = {
  이름: "이름", 성명: "이름",
  주민번호: "주민번호", 주민등록번호: "주민번호",
  연락처: "연락처", 전화번호: "연락처", 휴대폰: "연락처", 휴대전화: "연락처",
  "남/여": "남여", 성별: "남여",
  입사일: "입사일",
  퇴사일: "퇴사일",
  계좌번호: "계좌번호", 계좌: "계좌번호",
  주소: "주소",
};

const DATE_FIELDS = new Set<keyof NewEmployee>(["입사일", "퇴사일"]);

function parseImportedSheet(wb: XLSX.WorkBook): NewEmployee[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  // 헤더 1행, 데이터 2행부터
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return [];

  // 헤더는 항상 0번째 행(1행)
  const headerRowIdx = 0;
  const headers = (raw[headerRowIdx] as unknown[]).map((h) => String(h).trim());

  // 열별 최종 필드 결정: 위치 매핑 우선, 없으면 헤더명 매핑
  const fieldMap: { colIdx: number; field: keyof NewEmployee }[] = [];
  const usedFields = new Set<keyof NewEmployee>();

  // 1) 위치 기반 매핑 먼저 등록
  for (const [colStr, field] of Object.entries(COL_POSITION_MAP)) {
    const colIdx = Number(colStr);
    fieldMap.push({ colIdx, field });
    usedFields.add(field);
  }

  // 2) 헤더명 기반 매핑 (위치 매핑에 이미 포함된 필드는 건너뜀)
  headers.forEach((h, idx) => {
    const field = HEADER_MAP[h];
    if (field && !usedFields.has(field)) {
      fieldMap.push({ colIdx: idx, field });
      usedFields.add(field);
    }
  });

  const results: NewEmployee[] = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (row.every((c) => String(c).trim() === "")) continue;

    const emp = emptyRow();
    for (const { colIdx, field } of fieldMap) {
      const val = row[colIdx];
      emp[field] = DATE_FIELDS.has(field) ? excelDateToISO(val) : String(val ?? "").trim();
    }
    results.push(emp);
  }
  return results;
}

const STORAGE_KEY = "worksite_new_employees";

function emptyRow(): NewEmployee {
  return {
    id: crypto.randomUUID(),
    현장구분: "",
    이름: "",
    주민번호: "",
    연락처: "",
    남여: "",
    입사일: "",
    퇴사일: "",
    신청공종: "",
    단가: "",
    단가변동: "",
    은행명: "",
    계좌번호: "",
    주소: "",
  };
}

const TEXT_FIELDS: (keyof NewEmployee)[] = ["현장구분", "이름", "주민번호", "연락처"];
const RIGHT_FIELDS: (keyof NewEmployee)[] = ["신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소"];

export default function NewEmployeeList() {
  const [rows, setRows] = useState<NewEmployee[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [emptyRow()];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [emptyRow()];
    } catch {
      return [emptyRow()];
    }
  });
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달 편집 상태
  const [draft, setDraft] = useState<NewEmployee | null>(null);

  // 마운트 시 Firestore에서 로드
  useEffect(() => {
    loadEmployeesFS().then((fsRows) => {
      if (Array.isArray(fsRows) && fsRows.length > 0) {
        const typed = fsRows as NewEmployee[];
        setRows(typed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(typed));
      }
    });
  }, []);

  // localStorage 자동 동기화
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  // Firestore 저장 헬퍼
  const syncFS = useCallback((newRows: NewEmployee[]) => {
    saveEmployeesFS(newRows).then((ok) => {
      if (!ok) toast.error("Firestore 저장 실패");
    });
  }, []);

  const openEdit = useCallback((row: NewEmployee) => {
    setDraft({ ...row });
  }, []);

  const closeEdit = useCallback(() => setDraft(null), []);

  const updateDraft = useCallback((field: keyof NewEmployee, value: string) => {
    setDraft((prev) => prev ? { ...prev, [field]: value } : prev);
  }, []);

  const saveEdit = useCallback(() => {
    if (!draft) return;
    const updated = rows.map((r) => (r.id === draft.id ? { ...draft } : r));
    setRows(updated);
    syncFS(updated);
    toast.success("저장되었습니다.");
    setDraft(null);
  }, [draft, rows, syncFS]);

  const displayRows = useMemo(() => {
    if (!search.trim()) return rows;
    return rows.filter((r) => r.이름.includes(search.trim()));
  }, [rows, search]);

  const addRow = () => {
    const next = [...rows, emptyRow()];
    setRows(next);
    syncFS(next);
  };

  const deleteRow = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    syncFS(next);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // input 초기화 (같은 파일 재업로드 허용)
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const imported = parseImportedSheet(wb);
        if (imported.length === 0) {
          toast.error("데이터를 찾을 수 없습니다. 헤더 행을 확인하세요.");
          return;
        }
        setRows(imported);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
        syncFS(imported);
        toast.success(`${imported.length}명의 데이터를 불러왔습니다.`);
      } catch {
        toast.error("파일을 읽는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportToExcel = () => {
    const headers = [
      "No", "현장구분", "이름", "주민번호", "연락처", "연령", "남/여",
      "입사일", "퇴사일", "근속일수", "근속개월", "근속현황",
      "신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소",
    ];
    const dataRows = rows.map((r, i) => {
      const { days, months, status } = calcTenure(r.입사일, r.퇴사일);
      return [
        i + 1, r.현장구분, r.이름, r.주민번호, r.연락처,
        calcAge(r.주민번호), r.남여, r.입사일, r.퇴사일,
        days, months, status,
        r.신청공종, r.단가, r.단가변동, r.은행명, r.계좌번호, r.주소,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [
      { wch: 4 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 14 },
      { wch: 5 }, { wch: 5 }, { wch: 11 }, { wch: 11 },
      { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 32 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "신규자명단");
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `신규자명단_${dateStr}.xlsx`);
  };

  // sticky 열 공통 클래스
  const thBase = "px-2 py-2.5 text-center font-semibold text-muted-foreground whitespace-nowrap bg-muted/50";
  const thSticky = (left: string, shadow = false) =>
    `${thBase} sticky top-0 z-30 ${left}${shadow ? " shadow-[2px_0_4px_-1px_rgba(0,0,0,0.12)]" : ""}`;
  const thNormal = `${thBase} sticky top-0 z-20`;

  const tdStickyBase = "bg-white group-hover:bg-muted/20 transition-colors";
  const tdSticky = (left: string, extra = "") =>
    `${tdStickyBase} sticky z-10 ${left}${extra ? ` ${extra}` : ""}`;

  // 모달용 계산값
  const draftTenure = draft ? calcTenure(draft.입사일, draft.퇴사일) : null;
  const draftAge = draft ? calcAge(draft.주민번호) : "";

  return (
    <div className="flex flex-col gap-3">
      {/* ── 편집 모달 ── */}
      {draft && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-bold text-foreground">
                직원 정보 수정
                {draft.이름 && <span className="ml-2 text-primary">— {draft.이름}</span>}
              </h3>
              <button onClick={closeEdit} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 모달 바디 */}
            <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1">

              {/* 기본정보 */}
              <section>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-3">기본정보</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["현장구분", "이름", "주민번호", "연락처"] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">{field}</label>
                      <input
                        type="text"
                        value={draft[field]}
                        onChange={(e) => updateDraft(field, e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">연령 (자동)</label>
                    <div className="px-3 py-2 border border-border/50 rounded-lg text-sm bg-muted/30 text-muted-foreground">
                      {draftAge || "—"}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">남/여</label>
                    <select
                      value={draft.남여}
                      onChange={(e) => updateDraft("남여", e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                    >
                      <option value="">선택</option>
                      <option value="남">남</option>
                      <option value="여">여</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* 근무정보 */}
              <section>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-3">근무정보</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">입사일</label>
                    <input
                      type="date"
                      value={draft.입사일}
                      onChange={(e) => updateDraft("입사일", e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">퇴사일</label>
                    <input
                      type="date"
                      value={draft.퇴사일}
                      onChange={(e) => updateDraft("퇴사일", e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">근속일수 (자동)</label>
                    <div className="px-3 py-2 border border-border/50 rounded-lg text-sm bg-muted/30 text-muted-foreground">
                      {draftTenure?.days ? `${draftTenure.days}일` : "—"}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">근속개월 (자동)</label>
                    <div className="px-3 py-2 border border-border/50 rounded-lg text-sm bg-muted/30 text-muted-foreground">
                      {draftTenure?.months ? `${draftTenure.months}개월` : "—"}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">근속현황 (자동)</label>
                    <div className="px-3 py-2 border border-border/50 rounded-lg text-sm bg-muted/30">
                      {draftTenure?.status ? (
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          draftTenure.status === "재직중" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {draftTenure.status}
                        </span>
                      ) : "—"}
                    </div>
                  </div>
                </div>
              </section>

              {/* 급여 / 계좌 */}
              <section>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-3">급여 / 계좌</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["신청공종", "단가", "단가변동", "은행명", "계좌번호"] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">{field}</label>
                      <input
                        type="text"
                        value={draft[field]}
                        onChange={(e) => updateDraft(field, e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">주소</label>
                    <input
                      type="text"
                      value={draft.주소}
                      onChange={(e) => updateDraft("주소", e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* 모달 푸터 */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
              <button
                onClick={closeEdit}
                className="px-5 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <h2 className="text-lg font-bold text-foreground flex-1">신규자 명단</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 검색..."
            className="pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-44"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          행 추가
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          엑셀 업로드
        </button>
        <button
          onClick={exportToExcel}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          엑셀 내보내기
        </button>
      </div>

      {/* 테이블 — 화면 높이에 맞게 고정, 내부 스크롤 */}
      <div
        className="overflow-auto rounded-xl border border-border bg-white shadow-sm"
        style={{ maxHeight: "calc(100vh - 220px)" }}
      >
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {/* No — sticky top + left */}
              <th className={thSticky("left-0") + " w-[44px]"}>No</th>
              {/* 현장구분 — sticky top + left */}
              <th className={thSticky("left-[44px]") + " w-[90px]"}>현장구분</th>
              {/* 이름 — sticky top + left, 우측 구분선 */}
              <th className={thSticky("left-[134px]", true)}>이름</th>
              {/* 나머지 — sticky top only */}
              {[
                "주민번호", "연락처", "연령", "남/여", "입사일", "퇴사일",
                "근속일수", "근속개월", "근속현황",
                "신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소", "",
              ].map((col, i) => (
                <th key={i} className={thNormal}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={19} className="py-16 text-center text-muted-foreground text-sm">
                  {search
                    ? `"${search}"에 해당하는 직원이 없습니다`
                    : "데이터가 없습니다. 행 추가 버튼을 눌러 입력하세요."}
                </td>
              </tr>
            ) : (
              displayRows.map((row, idx) => {
                const { days, months, status } = calcTenure(row.입사일, row.퇴사일);
                const age = calcAge(row.주민번호);
                return (
                  <tr
                    key={row.id}
                    className="group border-b border-border last:border-0"
                  >
                    {/* No — sticky left */}
                    <td className={tdSticky("left-0") + " px-3 py-1.5 text-center text-muted-foreground font-medium w-[44px]"}>
                      {idx + 1}
                    </td>

                    {/* 현장구분 — sticky left */}
                    <td className={tdSticky("left-[44px]") + " px-3 py-1.5 w-[90px] text-xs"}>
                      {row.현장구분 || <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* 이름 — sticky left, 클릭 시 모달 */}
                    <td className={tdSticky("left-[134px]", "px-1 py-1 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.12)]")}>
                      <button
                        onClick={() => openEdit(row)}
                        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/10 text-primary font-medium text-xs min-w-[64px] w-full text-left transition-colors group/name"
                      >
                        <span className="flex-1">{row.이름 || <span className="text-muted-foreground font-normal">이름 없음</span>}</span>
                        <Pencil className="h-3 w-3 opacity-0 group-hover/name:opacity-60 shrink-0 transition-opacity" />
                      </button>
                    </td>

                    {/* 주민번호, 연락처 */}
                    {(["주민번호", "연락처"] as const).map((field) => (
                      <td key={field} className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {row[field] || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}

                    {/* 연령 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs">{age || "—"}</td>

                    {/* 남/여 */}
                    <td className="px-2 py-1.5 text-center text-xs">
                      {row.남여 || <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* 입사일 */}
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                      {row.입사일 || <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* 퇴사일 */}
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                      {row.퇴사일 || <span className="text-muted-foreground/40">—</span>}
                    </td>

                    {/* 근속일수 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs">
                      {days ? `${days}일` : "—"}
                    </td>

                    {/* 근속개월 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs">
                      {months ? `${months}개월` : "—"}
                    </td>

                    {/* 근속현황 (자동계산) */}
                    <td className="px-2 py-1.5 text-center">
                      {status ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          status === "재직중" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {status}
                        </span>
                      ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                    </td>

                    {/* 신청공종, 단가, 단가변동, 은행명, 계좌번호, 주소 */}
                    {RIGHT_FIELDS.map((field) => (
                      <td key={field} className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {(row[field] as string) || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}

                    {/* 삭제 */}
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => deleteRow(row.id)}
                        title="행 삭제"
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground shrink-0">
        총 {rows.length}명 · 연령 / 근속일수 / 근속개월 / 근속현황은 자동 계산됩니다
      </p>
    </div>
  );
}
