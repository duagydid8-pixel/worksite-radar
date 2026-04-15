import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, Trash2, Search, X, Download, Upload, Pencil, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  loadEmployeesPH4FS, saveEmployeesPH4FS,
  loadEmployeesPH2FS, saveEmployeesPH2FS,
} from "@/lib/firestoreService";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
    const date = XLSX.SSF.parse_date_code(val);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }
  const str = String(val).trim();
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  const dotSlash = str.replace(/[./]/g, "-");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dotSlash)) {
    const [y, m, d] = dotSlash.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return str;
}

const COL_POSITION_MAP: Record<number, keyof NewEmployee> = {
  1:  "현장구분",
  12: "신청공종",
  13: "단가",
  14: "단가변동",
  15: "은행명",
};

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
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return [];

  const headerRowIdx = 0;
  const headers = (raw[headerRowIdx] as unknown[]).map((h) => String(h).trim());

  const fieldMap: { colIdx: number; field: keyof NewEmployee }[] = [];
  const usedFields = new Set<keyof NewEmployee>();

  for (const [colStr, field] of Object.entries(COL_POSITION_MAP)) {
    const colIdx = Number(colStr);
    fieldMap.push({ colIdx, field });
    usedFields.add(field);
  }

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
      if (field === "주민번호") {
        // 엑셀이 숫자로 읽으면 앞자리 0이 사라지므로 13자리로 패딩
        if (typeof val === "number") {
          emp[field] = String(Math.round(val)).padStart(13, "0");
        } else {
          emp[field] = String(val ?? "").trim();
        }
      } else {
        emp[field] = DATE_FIELDS.has(field) ? excelDateToISO(val) : String(val ?? "").trim();
      }
    }
    // 이름과 주민번호가 모두 없는 행은 제외
    if (!emp.이름 && !emp.주민번호) continue;
    results.push(emp);
  }
  return results;
}

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

const RIGHT_FIELDS: (keyof NewEmployee)[] = ["신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소"];

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  주민번호: 150, 연락처: 120, 연령: 55, "남/여": 50,
  입사일: 100, 퇴사일: 100, 근속일수: 70, 근속개월: 70, 근속현황: 70,
  신청공종: 90, 단가: 70, 단가변동: 70, 은행명: 70, 계좌번호: 140, 주소: 200,
};

// ── 공통 탭 컨텐츠 컴포넌트 ─────────────────────────
interface EmployeeTabContentProps {
  loadFn: () => Promise<unknown[] | null>;
  saveFn: (rows: unknown[]) => Promise<boolean>;
}

function EmployeeTabContent({ loadFn, saveFn }: EmployeeTabContentProps) {
  const [rows, setRows] = useState<NewEmployee[]>([emptyRow()]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"전체" | "재직중" | "퇴사">("전체");
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<NewEmployee | null>(null);

  const getColW = (key: string) => colWidths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 80;

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 80;
    resizeRef.current = { key, startX: e.clientX, startW };

    const onMove = (me: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = me.clientX - resizeRef.current.startX;
      const newW = Math.max(40, resizeRef.current.startW + dx);
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const resetColWidth = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    setColWidths((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // 마운트 시 Firestore에서 로드
  useEffect(() => {
    loadFn().then((fsRows) => {
      if (Array.isArray(fsRows) && fsRows.length > 0) {
        setRows(fsRows as NewEmployee[]);
      }
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Firestore 저장 헬퍼
  const syncFS = useCallback((newRows: NewEmployee[]) => {
    saveFn(newRows).then((ok) => {
      if (!ok) toast.error("Firestore 저장 실패");
    });
  }, [saveFn]);

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
    return rows.filter((r) => {
      if (search.trim() && !r.이름.includes(search.trim())) return false;
      if (statusFilter !== "전체") {
        const { status } = calcTenure(r.입사일, r.퇴사일);
        if (status !== statusFilter) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  // 근속 10개월 이상 재직중 인원 경고
  const warningRows = useMemo(() => {
    return rows
      .filter((r) => {
        const { months, status } = calcTenure(r.입사일, r.퇴사일);
        return status === "재직중" && Number(months) >= 10;
      })
      .map((r) => {
        const { days, months } = calcTenure(r.입사일, r.퇴사일);
        const remaining = Math.max(0, 365 - Number(days));
        return { ...r, months: Number(months), days: Number(days), remaining };
      })
      .sort((a, b) => b.days - a.days); // 근속 많은 순
  }, [rows]);

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
    XLSX.utils.book_append_sheet(wb, ws, "기술인및관리자명단");
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `기술인및관리자명단_${dateStr}.xlsx`);
  };

  // sticky 열 공통 클래스
  const thBase = "px-2 py-2.5 text-center font-semibold text-foreground whitespace-nowrap bg-muted";
  const thSticky = (left: string, shadow = false) =>
    `${thBase} sticky top-0 z-30 ${left}${shadow ? " shadow-[2px_0_4px_-1px_rgba(0,0,0,0.12)]" : ""}`;
  const thNormal = `${thBase} sticky top-0 z-20`;

  const tdStickyBase = "bg-white group-hover:bg-muted/20 transition-colors";
  const tdSticky = (left: string, extra = "") =>
    `${tdStickyBase} sticky z-10 ${left}${extra ? ` ${extra}` : ""}`;

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
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-bold text-foreground">
                직원 정보 수정
                {draft.이름 && <span className="ml-2 text-primary">— {draft.이름}</span>}
              </h3>
              <button onClick={closeEdit} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1">
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

      {/* ── 근속 경고 배너 ── */}
      {warningRows.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-bold text-amber-800">
              계약 기간 만료 임박 — {warningRows.length}명
            </span>
            <span className="text-xs text-amber-600 ml-1">(근속 10개월 이상 재직중)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {warningRows.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  r.remaining <= 30
                    ? "bg-red-100 border-red-300 text-red-700"
                    : "bg-amber-100 border-amber-300 text-amber-800"
                }`}
              >
                <span>{r.이름}</span>
                <span className="opacity-60">·</span>
                <span>{r.months}개월 ({r.days}일)</span>
                {r.remaining <= 60 && (
                  <span className={`ml-0.5 px-1 py-0.5 rounded text-[10px] ${
                    r.remaining <= 30 ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-900"
                  }`}>
                    D-{r.remaining}
                  </span>
                )}
              </div>
            ))}
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
        {/* 재직/퇴사 필터 */}
        <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg border border-border">
          {(["전체", "재직중", "퇴사"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === opt
                  ? opt === "퇴사"
                    ? "bg-rose-500 text-white shadow-sm"
                    : opt === "재직중"
                    ? "bg-green-500 text-white shadow-sm"
                    : "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          ))}
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

      {/* 테이블 */}
      <div
        className="overflow-auto rounded-xl border border-border bg-white shadow-sm"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted border-b border-border">
              <th className={thSticky("left-0") + " w-[44px]"}>No</th>
              <th className={thSticky("left-[44px]") + " w-[90px]"}>현장구분</th>
              <th className={thSticky("left-[134px]", true)}>이름</th>
              {[
                "주민번호", "연락처", "연령", "남/여", "입사일", "퇴사일",
                "근속일수", "근속개월", "근속현황",
                "신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소",
              ].map((col) => (
                <th
                  key={col}
                  className={thNormal + " relative select-none"}
                  style={{ width: getColW(col), minWidth: getColW(col) }}
                >
                  <span className="pr-2">{col}</span>
                  {/* 드래그 리사이즈 핸들 */}
                  <div
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize z-10 flex items-center justify-center group/rh"
                    onMouseDown={(e) => startResize(col, e)}
                    onDoubleClick={(e) => resetColWidth(col, e)}
                    title="드래그: 너비 조절 / 더블클릭: 초기화"
                  >
                    <div className="w-px h-3/5 bg-border group-hover/rh:bg-primary/60 transition-colors" />
                  </div>
                </th>
              ))}
              <th className={thNormal}></th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={19} className="py-16 text-center text-muted-foreground text-sm">
                  {search || statusFilter !== "전체"
                    ? `조건에 해당하는 직원이 없습니다`
                    : "데이터가 없습니다. 행 추가 버튼을 눌러 입력하세요."}
                </td>
              </tr>
            ) : (
              displayRows.map((row, idx) => {
                const { days, months, status } = calcTenure(row.입사일, row.퇴사일);
                const age = calcAge(row.주민번호);
                return (
                  <tr key={row.id} className="group border-b border-border last:border-0">
                    <td className={tdSticky("left-0") + " px-3 py-1.5 text-center text-muted-foreground font-medium w-[44px]"}>
                      {idx + 1}
                    </td>
                    <td className={tdSticky("left-[44px]") + " px-3 py-1.5 w-[90px] text-xs"}>
                      {row.현장구분 || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={tdSticky("left-[134px]", "px-1 py-1 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.12)]")}>
                      <button
                        onClick={() => openEdit(row)}
                        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/10 text-primary font-medium text-xs min-w-[64px] w-full text-left transition-colors group/name"
                      >
                        <span className="flex-1">{row.이름 || <span className="text-muted-foreground font-normal">이름 없음</span>}</span>
                        <Pencil className="h-3 w-3 opacity-0 group-hover/name:opacity-60 shrink-0 transition-opacity" />
                      </button>
                    </td>
                    {(["주민번호", "연락처"] as const).map((field) => (
                      <td key={field} className="px-3 py-1.5 text-xs overflow-hidden text-ellipsis whitespace-nowrap"
                        style={{ width: getColW(field), maxWidth: getColW(field) }}>
                        {row[field] || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs overflow-hidden"
                      style={{ width: getColW("연령"), maxWidth: getColW("연령") }}>
                      {age || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs overflow-hidden"
                      style={{ width: getColW("남/여"), maxWidth: getColW("남/여") }}>
                      {row.남여 || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap overflow-hidden"
                      style={{ width: getColW("입사일"), maxWidth: getColW("입사일") }}>
                      {row.입사일 || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={`px-3 py-1.5 text-xs whitespace-nowrap overflow-hidden font-semibold ${row.퇴사일 ? "bg-rose-50 text-rose-600" : ""}`}
                      style={{ width: getColW("퇴사일"), maxWidth: getColW("퇴사일") }}>
                      {row.퇴사일 || <span className="text-muted-foreground/40 font-normal">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs overflow-hidden"
                      style={{ width: getColW("근속일수"), maxWidth: getColW("근속일수") }}>
                      {days ? `${days}일` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground text-xs overflow-hidden"
                      style={{ width: getColW("근속개월"), maxWidth: getColW("근속개월") }}>
                      {months ? `${months}개월` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center overflow-hidden"
                      style={{ width: getColW("근속현황"), maxWidth: getColW("근속현황") }}>
                      {status ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          status === "재직중" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {status}
                        </span>
                      ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                    </td>
                    {RIGHT_FIELDS.map((field) => {
                      const raw = (row[field] as string) || "";
                      const isMoney = field === "단가" || field === "단가변동";
                      const display = isMoney && raw
                        ? (() => { const n = parseFloat(raw.replace(/,/g, "")); return isNaN(n) ? raw : n.toLocaleString("ko-KR"); })()
                        : raw;
                      return (
                        <td key={field}
                          className={`px-3 py-1.5 text-xs whitespace-nowrap overflow-hidden text-ellipsis${isMoney ? " tabular-nums text-right" : ""}`}
                          style={{ width: getColW(field), maxWidth: getColW(field) }}>
                          {display || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      );
                    })}
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
        {displayRows.length !== rows.length
          ? `${displayRows.length}명 표시 / 전체 ${rows.length}명`
          : `총 ${rows.length}명`} · 연령 / 근속일수 / 근속개월 / 근속현황은 자동 계산됩니다
      </p>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────
export default function NewEmployeeList() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-foreground">기술인 및 관리자 명단</h2>
      <Tabs defaultValue="ph4">
        <TabsList className="mb-2">
          <TabsTrigger value="ph4">P4-PH4 초순수</TabsTrigger>
          <TabsTrigger value="ph2">P4-PH2 초순수</TabsTrigger>
        </TabsList>
        <TabsContent value="ph4">
          <EmployeeTabContent
            loadFn={loadEmployeesPH4FS}
            saveFn={saveEmployeesPH4FS}
          />
        </TabsContent>
        <TabsContent value="ph2">
          <EmployeeTabContent
            loadFn={loadEmployeesPH2FS}
            saveFn={saveEmployeesPH2FS}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
