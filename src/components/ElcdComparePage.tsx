import { useState, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, CheckCircle2, XCircle, BookOpen, Image, Upload } from "lucide-react";
import { loadXerpFS, loadXerpPH2FS, loadXerpP5PH1FS } from "@/lib/firestoreService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { decryptExcelPassword } from "@/utils/xlsxDecrypt";

type SiteKey = "PH4" | "PH2" | "P5PH1";
const SITES: { value: SiteKey; label: string }[] = [
  { value: "PH4", label: "P4-PH4" },
  { value: "PH2", label: "P4-PH2" },
  { value: "P5PH1", label: "P5-PH1" },
];

interface XerpRow {
  id: string;
  팀명: string; 직종: string; 사번: string; 성명: string; 생년월일: string;
  [key: string]: string;
}

interface ElcdRow {
  name: string;
  birthday: string;
  inTime?: string;
  outTime?: string;
  authMethod?: string;
}

interface CompareRow {
  팀명: string;
  직종: string;
  성명: string;
  생년월일: string;
  타각여부: "Y" | "N";
  출근: string;
  퇴근: string;
  인증방식: string;
}

function normBirth(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (d.length >= 13) return d.slice(0, 6);
  return d.length >= 8 ? d.slice(2, 8) : d.slice(0, 6);
}

function maskBirth(s: string): string {
  const t = (s || "").trim();
  if (t.includes("-")) return t.slice(0, 7) + "******";
  if (t.length >= 7) return t.slice(0, 6) + "-******";
  return t;
}

export default function ElcdComparePage({ isAdmin }: { isAdmin: boolean }) {
  const [site, setSite] = useState<SiteKey>("PH4");
  const [dateMap, setDateMap] = useState<Record<string, XerpRow[]> | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [elcdRows, setElcdRows] = useState<ElcdRow[] | null>(null);
  const [elcdFileName, setElcdFileName] = useState("");
  const [result, setResult] = useState<CompareRow[] | null>(null);
  const [filter, setFilter] = useState<"전체" | "타각" | "미타각">("전체");
  const [showGuide, setShowGuide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadXerp = async () => {
    setLoading(true);
    setDateMap(null);
    setResult(null);
    try {
      const fn = site === "PH4" ? loadXerpFS : site === "PH2" ? loadXerpPH2FS : loadXerpP5PH1FS;
      const data = await fn();
      if (!data) { toast.error("XERP 데이터가 없습니다."); return; }
      setDateMap(data as Record<string, XerpRow[]>);
      const dates = Object.keys(data).sort().reverse();
      setSelectedDate(dates[0] ?? "");
      toast.success(`${Object.keys(data).length}개 날짜 로드됨`);
    } catch {
      toast.error("로드 실패");
    } finally {
      setLoading(false);
    }
  };

  const currentRows: XerpRow[] = useMemo(
    () => (dateMap && selectedDate ? (dateMap[selectedDate] ?? []) : []),
    [dateMap, selectedDate]
  );

  const parseElcdExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let buffer = e.target?.result as ArrayBuffer;
        buffer = await decryptExcelPassword(buffer, "1234");

        // 복호화 결과 확인 (ZIP 매직: 50 4B)
        const magic = new Uint8Array(buffer);
        if (magic[0] !== 0x50 || magic[1] !== 0x4B) {
          toast.error("복호화 실패 — 비밀번호가 1234가 아닐 수 있습니다.");
          return;
        }

        const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];

        // 전체 행을 배열로 읽어 헤더 행을 탐색
        const all: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as string[][];

        const CANDIDATES = ["성명", "이름", "근로자", "생년월일", "출근", "퇴근"];
        const headerRowIdx = all.findIndex((row) =>
          row.some((cell) => CANDIDATES.some((c) => String(cell).includes(c)))
        );

        if (headerRowIdx === -1) {
          const sample = all.slice(0, 3).map((r) => r.slice(0, 5).join("|")).join(" / ");
          toast.error(`헤더 행을 찾지 못했습니다. 앞 3행 샘플: ${sample}`);
          return;
        }

        const headers = all[headerRowIdx].map(String);
        const dataRows = all.slice(headerRowIdx + 1).filter((r) => r.some((c) => c !== ""));

        const find = (...candidates: string[]) =>
          headers.findIndex((h) => candidates.some((c) => h.includes(c)));

        const nameIdx  = find("성명", "이름", "근로자명", "작업자명");
        const birthIdx = find("생년월일", "생년");
        const inIdx    = find("출근");
        const outIdx   = find("퇴근");
        const authIdx  = find("태그", "인증방식");

        if (nameIdx === -1 || birthIdx === -1) {
          toast.error(`컬럼 인식 실패. 헤더(${headerRowIdx + 1}행): ${headers.join(", ")}`);
          return;
        }

        // 같은 사람의 출근/퇴근 레코드 머지
        const map = new Map<string, ElcdRow>();
        dataRows.forEach((r) => {
          const name     = r[nameIdx]  || "";
          const birthday = r[birthIdx] || "";
          if (!name) return;
          const key        = name + "/" + normBirth(birthday);
          const inTime     = inIdx   !== -1 ? r[inIdx]   || "" : "";
          const outTime    = outIdx  !== -1 ? r[outIdx]  || "" : "";
          const authMethod = authIdx !== -1 ? r[authIdx] || "" : "";
          const existing   = map.get(key);
          if (existing) {
            map.set(key, {
              name: existing.name, birthday: existing.birthday,
              inTime: existing.inTime || inTime,
              outTime: existing.outTime || outTime,
              authMethod: existing.authMethod || authMethod,
            });
          } else {
            map.set(key, { name, birthday, inTime, outTime, authMethod });
          }
        });

        const rows = Array.from(map.values());
        setElcdRows(rows);
        setElcdFileName(file.name);
        setResult(null);
        toast.success(`${rows.length}명 로드됨 (원본 ${dataRows.length}건, 헤더 ${headerRowIdx + 1}행)`);
      } catch (err) {
        toast.error("엑셀 파싱 실패: " + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const compare = () => {
    if (!currentRows.length) { toast.error("먼저 XERP 데이터를 로드하세요."); return; }
    if (!elcdRows?.length) { toast.error("전자카드 엑셀을 업로드하세요."); return; }

    const tappedMap = new Map<string, ElcdRow>();
    elcdRows.forEach((r) => {
      const key = (r.name || "") + "|" + normBirth(r.birthday || "");
      const existing = tappedMap.get(key);
      if (existing) {
        tappedMap.set(key, {
          ...existing,
          inTime: existing.inTime || r.inTime,
          outTime: existing.outTime || r.outTime,
          authMethod: existing.authMethod || r.authMethod,
        });
      } else {
        tappedMap.set(key, r);
      }
    });

    const rows: CompareRow[] = currentRows.map((r) => {
      const key = r.성명 + "|" + normBirth(r.생년월일);
      const hit = tappedMap.get(key);
      return {
        팀명: r.팀명,
        직종: r.직종,
        성명: r.성명,
        생년월일: maskBirth(r.생년월일),
        타각여부: hit ? "Y" : "N",
        출근: hit?.inTime ?? "",
        퇴근: hit?.outTime ?? "",
        인증방식: hit?.authMethod ?? "",
      };
    });

    setResult(rows);
    const y = rows.filter((r) => r.타각여부 === "Y").length;
    toast.success(`대조 완료 — 타각 ${y}명 / 미타각 ${rows.length - y}명`);
  };

  const filtered = useMemo(() => {
    if (!result) return [];
    if (filter === "타각") return result.filter((r) => r.타각여부 === "Y");
    if (filter === "미타각") return result.filter((r) => r.타각여부 === "N");
    return result;
  }, [result, filter]);

  const exportExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(result);
    XLSX.utils.book_append_sheet(wb, ws, "전자카드대조");
    XLSX.writeFile(wb, `전자카드대조_${selectedDate.replace(/-/g, "")}.xlsx`);
  };

  const exportImage = async () => {
    if (!tableRef.current) return;
    const el = tableRef.current;
    const scrollDiv = el.querySelector<HTMLElement>(".overflow-auto");
    const prevMaxHeight = scrollDiv?.style.maxHeight ?? "";
    const prevOverflow = scrollDiv?.style.overflow ?? "";
    if (scrollDiv) { scrollDiv.style.maxHeight = "none"; scrollDiv.style.overflow = "visible"; }
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    if (scrollDiv) { scrollDiv.style.maxHeight = prevMaxHeight; scrollDiv.style.overflow = prevOverflow; }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `전자카드대조_${selectedDate.replace(/-/g, "")}.png`;
    a.click();
  };

  const tappedCount = result?.filter((r) => r.타각여부 === "Y").length ?? 0;
  const notTappedCount = result ? result.length - tappedCount : 0;

  const GuideDialog = () => (
    <Dialog open={showGuide} onOpenChange={setShowGuide}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-black">전자카드 엑셀 업로드 가이드</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-3">
            {[
              { n: 1, title: "eum.cw.or.kr 로그인", desc: "사업자 계정으로 로그인" },
              { n: 2, title: "전자카드 사용내역 조회", desc: "날짜 범위 설정 후 조회" },
              { n: 3, title: "엑셀 다운로드", desc: "조회 결과 엑셀로 저장" },
              { n: 4, title: "여기에 업로드", desc: "다운받은 엑셀 파일을 드래그하거나 클릭해서 업로드" },
            ].map(({ n, title, desc }) => (
              <div key={n} className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center">{n}</span>
                <div>
                  <p className="font-semibold text-slate-700">{title}</p>
                  <p className="text-xs text-slate-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <p className="font-bold mb-1">인식 가능한 컬럼명</p>
            <p>이름: 성명, 이름, 근로자명</p>
            <p>생년월일: 생년월일</p>
            <p>출근: "출근" 포함 컬럼</p>
            <p>퇴근: "퇴근" 포함 컬럼</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">

      <GuideDialog />

      {/* 설정 카드 */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900">전자카드 대조 설정</h2>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" /> 사용 가이드
          </button>
        </div>

        {/* 현장 + XERP 로드 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">현장</label>
            <div className="flex gap-1">
              {SITES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => { setSite(s.value); setDateMap(null); setResult(null); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                    site === s.value
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={loadXerp}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            XERP 데이터 로드
          </button>

          {dateMap && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">날짜 선택</label>
              <select
                value={selectedDate}
                onChange={(e) => { setSelectedDate(e.target.value); setResult(null); }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              >
                {Object.keys(dateMap).sort().reverse().map((d) => (
                  <option key={d} value={d}>{d} ({dateMap[d].length}명)</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 전자카드 엑셀 업로드 */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-500">
            전자카드 엑셀 <span className="text-slate-400 font-normal">— eum.cw.or.kr 에서 다운받은 엑셀 파일</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseElcdExcel(f); e.target.value = ""; }}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) parseElcdExcel(f);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-6 ${
              dragging
                ? "border-blue-400 bg-blue-50"
                : elcdRows
                ? "border-emerald-300 bg-emerald-50"
                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
            }`}
          >
            {elcdRows ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                <p className="text-sm font-bold text-emerald-700">{elcdRows.length}명 로드됨</p>
                <p className="text-xs text-slate-400">{elcdFileName} · 클릭해서 다시 업로드</p>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-slate-400" />
                <p className="text-sm font-semibold text-slate-600">엑셀 파일을 드래그하거나 클릭해서 업로드</p>
                <p className="text-xs text-slate-400">.xlsx / .xls</p>
              </>
            )}
          </div>
        </div>

        <button
          onClick={compare}
          disabled={!dateMap || !elcdRows?.length}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-40"
        >
          대조 실행
        </button>
      </div>

      {/* 결과 */}
      {result && (
        <div ref={tableRef} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

          {/* 요약 + 필터 */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <span className="text-sm font-extrabold text-slate-700">총 {result.length}명</span>
              <span className="flex items-center gap-1 text-sm font-bold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> 타각 {tappedCount}명
              </span>
              <span className="flex items-center gap-1 text-sm font-bold text-red-500">
                <XCircle className="h-4 w-4" /> 미타각 {notTappedCount}명
              </span>
            </div>
            <div className="flex items-center gap-2">
              {(["전체", "타각", "미타각"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors border ${
                    filter === f
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {f}
                </button>
              ))}
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> 엑셀
              </button>
              <button
                onClick={exportImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Image className="h-3.5 w-3.5" /> 이미지
              </button>
            </div>
          </div>

          {/* 테이블 */}
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["팀명","직종","성명","생년월일","타각여부","출근","퇴근","인증방식"].map((h) => (
                    <th key={h} className="px-3 py-2 text-center font-extrabold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${r.타각여부 === "N" ? "bg-red-50/60" : ""}`}>
                    <td className="px-3 py-1.5 text-center text-slate-600">{r.팀명}</td>
                    <td className="px-3 py-1.5 text-center text-slate-600">{r.직종}</td>
                    <td className="px-3 py-1.5 text-center font-semibold text-slate-800">{r.성명}</td>
                    <td className="px-3 py-1.5 text-center text-slate-500">{r.생년월일}</td>
                    <td className="px-3 py-1.5 text-center">
                      {r.타각여부 === "Y"
                        ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold"><CheckCircle2 className="h-3.5 w-3.5" /> 타각</span>
                        : <span className="inline-flex items-center gap-0.5 text-red-500 font-bold"><XCircle className="h-3.5 w-3.5" /> 미타각</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">{r.출근}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">{r.퇴근}</td>
                    <td className="px-3 py-1.5 text-center text-slate-500">{r.인증방식}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-sm text-slate-400">해당하는 결과가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
