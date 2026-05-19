import { useState, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, CheckCircle2, XCircle, AlertCircle, BookOpen, Image, Upload, Share2 } from "lucide-react";
import { loadXerpFS, loadXerpPH2FS, loadXerpP5PH1FS } from "@/lib/firestoreService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { decryptExcelPassword } from "@/utils/xlsxDecrypt";
import { detectSensitiveInfo, summarizeSensitiveInfoFindings } from "@/lib/sensitiveInfoGuard";
import { canCopyResidentNumber, displayResidentNumber } from "@/lib/elcdResidentNumber";
import { buildElcdCompareRows, normBirth, type CompareRow, type ElcdRow, type XerpCompareRow } from "@/lib/elcdCompare";

const EXCLUDED_STORAGE_KEY = "elcd_excluded_teams";

type SiteKey = "PH4" | "PH2" | "P5PH1";
const SITES: { value: SiteKey; label: string }[] = [
  { value: "PH4", label: "P4-PH4" },
  { value: "PH2", label: "P4-PH2" },
  { value: "P5PH1", label: "P5-PH1" },
];

type ResultFilter = "전체" | "타각" | "미타각" | "착오태그" | "이름불일치" | "XERP출근미타각";

function maskBirth(s: string): string {
  return displayResidentNumber(s, false);
}

export default function ElcdComparePage({ isAdmin }: { isAdmin: boolean }) {
  const [site, setSite] = useState<SiteKey>("PH4");
  const [dateMap, setDateMap] = useState<Record<string, XerpCompareRow[]> | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [elcdRows, setElcdRows] = useState<ElcdRow[] | null>(null);
  const [elcdFileName, setElcdFileName] = useState("");
  const [result, setResult] = useState<CompareRow[] | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("전체");
  const [showGuide, setShowGuide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excludedTeams, setExcludedTeams] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(EXCLUDED_STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const tableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveExclusions = () => {
    localStorage.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify([...excludedTeams]));
    toast.success("제외 팀 목록이 저장되었습니다.");
  };

  const toggleTeam = (team: string) => {
    setExcludedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  };

  const loadXerp = async () => {
    setLoading(true);
    setDateMap(null);
    setResult(null);
    try {
      const fn = site === "PH4" ? loadXerpFS : site === "PH2" ? loadXerpPH2FS : loadXerpP5PH1FS;
      const data = await fn();
      if (!data) { toast.error("XERP 데이터가 없습니다."); return; }
      setDateMap(data as Record<string, XerpCompareRow[]>);
      const dates = Object.keys(data).sort().reverse();
      setSelectedDate(dates[0] ?? "");
      toast.success(`${Object.keys(data).length}개 날짜 로드됨`);
    } catch {
      toast.error("로드 실패");
    } finally {
      setLoading(false);
    }
  };

  const currentRows: XerpCompareRow[] = useMemo(
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

        const nameIdx    = find("성명", "이름", "근로자명", "작업자명");
        const birthIdx   = find("생년월일", "생년");
        const inIdx      = find("출근");
        const outIdx     = find("퇴근");
        const authIdx    = find("태그", "인증방식");
        const companyIdx = find("업체명", "소속업체", "업체", "소속회사");

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
          const inTime     = inIdx      !== -1 ? r[inIdx]      || "" : "";
          const outTime    = outIdx     !== -1 ? r[outIdx]     || "" : "";
          const authMethod = authIdx    !== -1 ? r[authIdx]    || "" : "";
          const company    = companyIdx !== -1 ? r[companyIdx] || "" : "";
          const existing   = map.get(key);
          if (existing) {
            map.set(key, {
              name: existing.name, birthday: existing.birthday,
              company: existing.company || company,
              inTime: existing.inTime || inTime,
              outTime: existing.outTime || outTime,
              authMethod: existing.authMethod || authMethod,
            });
          } else {
            map.set(key, { name, birthday, company, inTime, outTime, authMethod });
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

    const allRows = buildElcdCompareRows({
      xerpRows: currentRows,
      elcdRows,
      maskBirth,
    });
    setResult(allRows);
    const y = allRows.filter((r) => r.타각여부 === "Y").length;
    const nm = allRows.filter((r) => r.타각여부 === "이름불일치").length;
    const missedXerp = allRows.filter((r) => r.타각여부 === "XERP출근미타각").length;
    const extra = allRows.filter((r) => r.팀명 === "미등록").length;
    toast.success(
      `대조 완료 — 타각 ${y}명 / 미타각 ${allRows.filter((r) => r.타각여부 === "N").length}명` +
      (nm > 0 ? ` / 이름불일치 ${nm}명` : "") +
      (missedXerp > 0 ? ` / XERP출근미타각 ${missedXerp}명` : "") +
      (extra > 0 ? ` (XERP 미등록 ${extra}명 포함)` : "")
    );
  };

  const uniqueTeams = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.map((r) => r.팀명))].sort();
  }, [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    if (filter === "타각") return result.filter((r) => r.타각여부 === "Y");
    if (filter === "미타각") return result.filter((r) => r.타각여부 === "N" && !excludedTeams.has(r.팀명));
    if (filter === "착오태그") return result.filter((r) => r.타각여부 === "착오");
    if (filter === "이름불일치") return result.filter((r) => r.타각여부 === "이름불일치");
    if (filter === "XERP출근미타각") return result.filter((r) => r.타각여부 === "XERP출근미타각");
    return result;
  }, [result, filter, excludedTeams]);

  const exportExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const exportRows = result.map(({ rawResidentNumber: _rawResidentNumber, ...row }) => row);
    const ws = XLSX.utils.json_to_sheet(exportRows);
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

  const exportShareImage = async () => {
    const missingRows = result?.filter((r) => r.타각여부 === "N" && !excludedTeams.has(r.팀명)) ?? [];
    if (!missingRows.length) { toast.error("미타각 인원이 없습니다."); return; }
    const visibleShareRows = missingRows.map(({ rawResidentNumber: _rawResidentNumber, ...row }) => row);
    const sensitiveFindings = detectSensitiveInfo(JSON.stringify(visibleShareRows));
    if (sensitiveFindings.length > 0) {
      toast.warning(`공유 이미지에 민감정보 의심 항목이 있습니다: ${summarizeSensitiveInfoFindings(sensitiveFindings)}`);
    }

    const byTeam = missingRows.reduce<Record<string, CompareRow[]>>((acc, r) => {
      (acc[r.팀명] ??= []).push(r);
      return acc;
    }, {});

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:640px;background:#ffffff;font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;border-radius:20px;overflow:hidden;";

    wrap.innerHTML = `
      <div style="background:#1e293b;color:#fff;padding:28px 32px 22px;text-align:center;">
        <div style="font-size:28px;font-weight:900;letter-spacing:-0.5px;margin-bottom:6px;">미타각 명단</div>
        <div style="font-size:15px;color:#94a3b8;">${selectedDate} &nbsp;·&nbsp; 총 ${missingRows.length}명 미타각</div>
      </div>
      ${Object.entries(byTeam).map(([team, rows]) => `
        <div style="padding:18px 24px 14px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:12px;font-weight:800;color:#64748b;margin-bottom:12px;letter-spacing:0.08em;">${team} · ${rows.length}명</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${rows.map((r) => `
              <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:10px 16px;text-align:center;min-width:72px;">
                <div style="font-size:20px;font-weight:900;color:#1e293b;line-height:1.2;">${r.성명}</div>
                ${r.생년월일 ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:500;">${r.생년월일.slice(0, 6)}</div>` : ""}
              </div>
            `).join("")}
          </div>
        </div>
      `).join("")}
      <div style="background:#f8fafc;padding:10px;text-align:center;">
        <span style="font-size:11px;color:#cbd5e1;">worksite-radar</span>
      </div>
    `;

    document.body.appendChild(wrap);
    try {
      const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `미타각명단_${selectedDate.replace(/-/g, "")}.png`;
      a.click();
    } finally {
      document.body.removeChild(wrap);
    }
  };

  const copyResidentNumber = async (value: string) => {
    if (!canCopyResidentNumber(value, isAdmin)) return;
    await navigator.clipboard.writeText(displayResidentNumber(value, true));
    toast.success("주민번호를 복사했습니다.");
  };

  const tappedCount = result?.filter((r) => r.타각여부 === "Y").length ?? 0;
  const wrongTagCount = result?.filter((r) => r.타각여부 === "착오").length ?? 0;
  const nameMismatchCount = result?.filter((r) => r.타각여부 === "이름불일치").length ?? 0;
  const missedXerpCheckInCount = result?.filter((r) => r.타각여부 === "XERP출근미타각").length ?? 0;
  const notTappedCount = result
    ? result.filter((r) => r.타각여부 === "N" && !excludedTeams.has(r.팀명)).length
    : 0;

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
              {wrongTagCount > 0 && (
                <span className="flex items-center gap-1 text-sm font-bold text-amber-500">
                  <AlertCircle className="h-4 w-4" /> 착오태그 {wrongTagCount}명
                </span>
              )}
              {nameMismatchCount > 0 && (
                <span className="flex items-center gap-1 text-sm font-bold text-violet-500">
                  <CheckCircle2 className="h-4 w-4" /> 이름불일치 {nameMismatchCount}명
                </span>
              )}
              {missedXerpCheckInCount > 0 && (
                <span className="flex items-center gap-1 text-sm font-bold text-blue-600">
                  <AlertCircle className="h-4 w-4" /> XERP출근미타각 {missedXerpCheckInCount}명
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(["전체", "타각", "미타각", "XERP출근미타각", "착오태그", "이름불일치"] as const).map((f) => (
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
              {isAdmin && (
                <button
                  onClick={saveExclusions}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  저장
                </button>
              )}
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> 엑셀
              </button>
              <button
                onClick={exportShareImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-bold text-red-600 hover:bg-red-100 transition-colors"
                title="미타각 명단 공유용 이미지 (모바일 최적화)"
              >
                <Share2 className="h-3.5 w-3.5" /> 미타각 공유
              </button>
              <button
                onClick={exportImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Image className="h-3.5 w-3.5" /> 이미지
              </button>
            </div>
          </div>

          {/* 관리자 팀 제외 설정 */}
          {isAdmin && (
            <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-xs font-bold text-slate-500 shrink-0">미타각 제외 팀:</span>
              {uniqueTeams.map((team) => (
                <label key={team} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={excludedTeams.has(team)}
                    onChange={() => toggleTeam(team)}
                    className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-slate-700">{team}</span>
                </label>
              ))}
            </div>
          )}

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
                  <tr key={i} className={`border-b border-slate-100 ${
                    r.타각여부 === "N" && excludedTeams.has(r.팀명)
                      ? "opacity-40 bg-slate-50"
                      : r.타각여부 === "착오"
                      ? "bg-amber-50/60"
                      : r.타각여부 === "이름불일치"
                      ? "bg-violet-50/60"
                      : r.타각여부 === "XERP출근미타각"
                      ? "bg-blue-50/60"
                      : r.타각여부 === "N"
                      ? "bg-red-50/60"
                      : ""
                  }`}>
                    <td className="px-3 py-1.5 text-center text-slate-600">{r.팀명}</td>
                    <td className="px-3 py-1.5 text-center text-slate-600">{r.직종}</td>
                    <td className="px-3 py-1.5 text-center font-semibold text-slate-800">{r.성명}</td>
                    <td className="px-3 py-1.5 text-center text-slate-500">
                      {canCopyResidentNumber(r.rawResidentNumber ?? r.생년월일, isAdmin) ? (
                        <button
                          type="button"
                          onClick={() => copyResidentNumber(r.rawResidentNumber ?? r.생년월일)}
                          className="rounded px-1.5 py-0.5 font-semibold text-slate-700 underline decoration-dotted underline-offset-2 hover:bg-slate-100 hover:text-slate-950"
                          title="클릭하면 주민번호가 복사됩니다."
                        >
                          {displayResidentNumber(r.rawResidentNumber ?? r.생년월일, true)}
                        </button>
                      ) : (
                        r.생년월일
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {r.타각여부 === "Y"
                        ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-bold"><CheckCircle2 className="h-3.5 w-3.5" /> 타각</span>
                        : r.타각여부 === "착오"
                        ? <span className="inline-flex flex-col items-center gap-0 text-amber-500 font-bold">
                            <span className="inline-flex items-center gap-0.5"><AlertCircle className="h-3.5 w-3.5" /> 타업체 착오태그</span>
                            {r.소속업체 && <span className="text-xs font-normal text-amber-400">{r.소속업체}</span>}
                          </span>
                        : r.타각여부 === "이름불일치"
                        ? <span className="inline-flex flex-col items-center gap-0 text-violet-600 font-bold">
                            <span className="inline-flex items-center gap-0.5"><CheckCircle2 className="h-3.5 w-3.5" /> 이름불일치 타각</span>
                            {r.elcdName && <span className="text-xs font-normal text-violet-400">전자카드: {r.elcdName}</span>}
                          </span>
                        : r.타각여부 === "XERP출근미타각"
                        ? <span className="inline-flex flex-col items-center gap-0 text-blue-600 font-bold">
                            <span className="inline-flex items-center gap-0.5"><AlertCircle className="h-3.5 w-3.5" /> XERP출근미타각</span>
                            {r.elcdName && <span className="text-xs font-normal text-blue-400">전자카드: {r.elcdName}</span>}
                          </span>
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
