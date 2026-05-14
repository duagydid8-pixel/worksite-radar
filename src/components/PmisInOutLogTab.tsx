import { useRef, useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Search, X, LogIn, LogOut, Users, AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";

export interface PersonRow {
  이름: string;
  마스킹: string;
  범주: string;
  직종: string;
  처음IN: string;
  마지막OUT: string;
  IN횟수: number;
  OUT횟수: number;
  총이벤트: number;
  비고: string;
}

export interface LogRow {
  회사: string;
  범주: string;
  이름: string;
  일자: string;
  시간: string;
  구분: "IN" | "OUT" | string;
  출역형태: string;
  직종: string;
}

export interface Summary {
  기준일: string;
  출역자수: string;
  IN이벤트: string;
  OUT이벤트: string;
}

export interface ParsedPmisData {
  fileName: string;
  dateLabel: string;
  persons: PersonRow[];
  logs: LogRow[];
  summary: Summary | null;
}

interface Outing {
  outTime: string;
  inTime: string | null;
}

interface PersonDetail {
  이름: string;
  범주: string;
  직종: string;
  firstIn: string | null;
  lastOut: string | null;
  outings: Outing[];
  hasUnreturnedOuting: boolean;
  totalEvents: number;
}

function computePersonDetails(logs: LogRow[]): PersonDetail[] {
  const byPerson = new Map<string, LogRow[]>();
  for (const log of logs) {
    if (!byPerson.has(log.이름)) byPerson.set(log.이름, []);
    byPerson.get(log.이름)!.push(log);
  }

  const result: PersonDetail[] = [];
  for (const [name, events] of byPerson) {
    events.sort((a, b) => a.시간.localeCompare(b.시간));
    const firstLog = events[0];
    let firstIn: string | null = null;
    let lastOut: string | null = null;
    const outings: Outing[] = [];
    let currentOutTime: string | null = null;

    for (const e of events) {
      if (e.구분 === "IN") {
        if (firstIn === null) firstIn = e.시간;
        if (currentOutTime !== null) {
          outings.push({ outTime: currentOutTime, inTime: e.시간 });
          currentOutTime = null;
        }
      } else if (e.구분 === "OUT") {
        lastOut = e.시간;
        if (currentOutTime === null) currentOutTime = e.시간;
      }
    }

    const hasUnreturnedOuting = currentOutTime !== null;

    result.push({
      이름: name,
      범주: firstLog.범주,
      직종: firstLog.직종,
      firstIn,
      lastOut,
      outings,
      hasUnreturnedOuting,
      totalEvents: events.length,
    });
  }

  return result.sort((a, b) => (a.firstIn ?? "").localeCompare(b.firstIn ?? ""));
}

function parseXlsx(file: File): Promise<ParsedPmisData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });

        const personSheetName = wb.SheetNames.find((n) => n.includes("사람별 정리") || n.includes("사람별정리"));
        const persons: PersonRow[] = [];
        if (personSheetName) {
          const ws = wb.Sheets[personSheetName];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const headerIdx = rows.findIndex((r) => String((r as string[])[0]).trim().includes("이름"));
          const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
          for (let i = dataStart; i < rows.length; i++) {
            const r = rows[i] as string[];
            if (!r[0]) continue;
            persons.push({
              이름: String(r[0] ?? ""),
              마스킹: String(r[1] ?? ""),
              범주: String(r[2] ?? ""),
              직종: String(r[3] ?? ""),
              처음IN: String(r[4] ?? ""),
              마지막OUT: String(r[5] ?? ""),
              IN횟수: Number(r[6] ?? 0),
              OUT횟수: Number(r[7] ?? 0),
              총이벤트: Number(r[8] ?? 0),
              비고: String(r[9] ?? ""),
            });
          }
        }

        const logSheetName = wb.SheetNames.find((n) => n.includes("출역로그") || n.includes("로그"));
        const logs: LogRow[] = [];
        if (logSheetName) {
          const ws = wb.Sheets[logSheetName];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const headerIdx = rows.findIndex((r) => {
            const row = r as string[];
            return row.some((c) => String(c).trim() === "이름" || String(c).trim() === "구분");
          });
          const dataStart = headerIdx >= 0 ? headerIdx + 1 : 3;
          for (let i = dataStart; i < rows.length; i++) {
            const r = rows[i] as string[];
            if (!r[2]) continue;
            logs.push({
              회사: String(r[0] ?? ""),
              범주: String(r[1] ?? ""),
              이름: String(r[2] ?? ""),
              일자: String(r[7] ?? ""),
              시간: String(r[8] ?? ""),
              구분: String(r[9] ?? "") as "IN" | "OUT",
              출역형태: String(r[10] ?? ""),
              직종: String(r[6] ?? ""),
            });
          }
        }

        const summarySheetName = wb.SheetNames.find((n) => n.includes("요약"));
        let summary: Summary | null = null;
        if (summarySheetName) {
          const ws = wb.Sheets[summarySheetName];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const get = (key: string) => {
            const row = rows.find((r) => String((r as string[])[0]).includes(key));
            return row ? String((row as string[])[1] ?? "") : "";
          };
          summary = {
            기준일: get("기준일"),
            출역자수: get("출역자"),
            IN이벤트: get("IN"),
            OUT이벤트: get("OUT"),
          };
        }

        const dateMatch = file.name.match(/\d{4}-\d{2}-\d{2}/);
        resolve({
          fileName: file.name,
          dateLabel: dateMatch ? dateMatch[0] : (summary?.기준일 ?? ""),
          persons,
          logs,
          summary,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsArrayBuffer(file);
  });
}

type ViewMode = "persons" | "outings" | "logs";

interface Props {
  data: ParsedPmisData | null;
  onDataLoaded: (d: ParsedPmisData) => void;
  onClear: () => void;
  xerpNames?: Set<string> | null;
}

export default function PmisInOutLogTab({ data, onDataLoaded, onClear, xerpNames }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<ViewMode>("persons");
  const [search, setSearch] = useState("");
  const [outingsOnly, setOutingsOnly] = useState(true);
  const [hideNonXerp, setHideNonXerp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isInXerp = (name: string) => !xerpNames || !hideNonXerp || xerpNames.has(name);
  const nonXerpCount = xerpNames && data
    ? data.persons.filter((p) => !xerpNames.has(p.이름)).length
    : 0;

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("xlsx 파일만 업로드해 주세요.");
      return;
    }
    try {
      const parsed = await parseXlsx(file);
      if (parsed.persons.length === 0 && parsed.logs.length === 0) {
        toast.error("출역 데이터를 찾지 못했습니다. 스킬 생성 엑셀인지 확인해 주세요.");
        return;
      }
      onDataLoaded(parsed);
      setSearch("");
      toast.success(`${parsed.dateLabel} 출역로그 로드 완료 (${parsed.persons.length}명)`);
    } catch {
      toast.error("엑셀 파싱 중 오류가 발생했습니다.");
    }
  };

  const personDetails = useMemo(() => computePersonDetails(data?.logs ?? []), [data?.logs]);

  const filteredPersons = useMemo(() =>
    (data?.persons ?? []).filter((p) =>
      isInXerp(p.이름) &&
      (!search || p.이름.includes(search) || p.직종.includes(search) || p.범주.includes(search))
    ), [data?.persons, search, hideNonXerp, xerpNames]);

  const filteredLogs = useMemo(() =>
    (data?.logs ?? []).filter((l) =>
      isInXerp(l.이름) &&
      (!search || l.이름.includes(search) || l.구분.includes(search) || l.직종.includes(search))
    ), [data?.logs, search, hideNonXerp, xerpNames]);

  const filteredDetails = useMemo(() => {
    let list = personDetails;
    if (hideNonXerp && xerpNames) list = list.filter((d) => xerpNames.has(d.이름));
    if (outingsOnly) list = list.filter((d) => d.outings.length > 0);
    if (search) list = list.filter((d) => d.이름.includes(search) || d.직종.includes(search) || d.범주.includes(search));
    return list;
  }, [personDetails, outingsOnly, search, hideNonXerp, xerpNames]);

  if (!data) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <div
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex min-h-[320px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
            dragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
          }`}
        >
          <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }} />
          <FileSpreadsheet className="h-12 w-12 text-slate-400" />
          <p className="mt-4 text-base font-black text-slate-800">PMIS 출역 IN/OUT 로그 업로드</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            스킬로 생성한 <span className="font-mono">일일출역로그_YYYY-MM-DD.xlsx</span> 파일을 끌어다 놓거나 클릭
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">{data.dateLabel} 출역 IN/OUT 로그</h2>
          <p className="text-xs font-semibold text-slate-500">{data.fileName}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {data.summary && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
                <Users className="h-3.5 w-3.5" /> {data.summary.출역자수}명
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-800">
                <LogIn className="h-3.5 w-3.5" /> IN {data.summary.IN이벤트}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-extrabold text-orange-800">
                <LogOut className="h-3.5 w-3.5" /> OUT {data.summary.OUT이벤트}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-extrabold text-violet-800">
                <ArrowRight className="h-3.5 w-3.5" /> 중간외출 {personDetails.filter((d) => d.outings.length > 0).length}명
              </span>
            </>
          )}
          {xerpNames && nonXerpCount > 0 && (
            <button
              type="button"
              onClick={() => setHideNonXerp((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-extrabold transition-colors ${
                hideNonXerp
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <X className="h-3.5 w-3.5" />
              XERP 미등록 {nonXerpCount}명 {hideNonXerp ? "숨김중" : "숨기기"}
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" /> 파일 변경
          </button>
        </div>
      </div>

      {/* 뷰 토글 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {([
            { v: "persons", label: `사람별 정리 (${data.persons.length}명)` },
            { v: "outings", label: `중간외출 (${personDetails.filter((d) => d.outings.length > 0).length}명)` },
            { v: "logs", label: `전체 로그 (${data.logs.length}건)` },
          ] as { v: ViewMode; label: string }[]).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-all ${
                view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "outings" && (
          <label className="flex items-center gap-1.5 cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={outingsOnly}
              onChange={(e) => setOutingsOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-violet-600"
            />
            <span className="text-xs font-bold text-slate-600">외출 있는 사람만</span>
          </label>
        )}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·직종 검색"
            className="h-8 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 w-48"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* 사람별 정리 테이블 */}
      {view === "persons" && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["이름", "범주", "직종", "처음 IN", "마지막 OUT", "IN", "OUT", "비고"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-extrabold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPersons.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm font-semibold text-slate-400">데이터 없음</td></tr>
              ) : filteredPersons.map((p, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-900">{p.이름}</td>
                  <td className="px-3 py-2 text-slate-600">{p.범주}</td>
                  <td className="px-3 py-2 text-slate-600">{p.직종}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-700">{p.처음IN}</td>
                  <td className="px-3 py-2 font-mono font-bold text-orange-700">
                    {p.마지막OUT || <span className="text-amber-500 font-semibold">(퇴근전)</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-emerald-700">{p.IN횟수}</td>
                  <td className="px-3 py-2 text-center font-bold text-orange-700">{p.OUT횟수}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {p.비고 && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                        <AlertTriangle className="h-3 w-3" />{p.비고}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 중간외출 뷰 */}
      {view === "outings" && (
        <div className="space-y-2">
          {filteredDetails.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">
              {outingsOnly ? "중간외출 기록이 없습니다." : "데이터 없음"}
            </div>
          ) : filteredDetails.map((d, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                <span className="font-black text-slate-900 text-sm">{d.이름}</span>
                <span className="text-xs font-semibold text-slate-500">{d.범주}</span>
                <span className="text-xs font-semibold text-slate-400">{d.직종}</span>
                {d.outings.length > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-extrabold text-violet-800">
                    <ArrowRight className="h-3 w-3" /> 외출 {d.outings.length}회
                  </span>
                )}
                {d.hasUnreturnedOuting && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-700">
                    <Clock className="h-3 w-3" /> 미복귀
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 px-4 py-2.5 text-xs">
                {/* 처음 입장 */}
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-bold text-emerald-800">
                  <LogIn className="h-3.5 w-3.5" />
                  입장 {d.firstIn ?? "-"}
                </span>

                {/* 중간외출 사이클 */}
                {d.outings.map((o, oi) => (
                  <span key={oi} className="inline-flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-orange-200 px-2.5 py-1 font-bold text-orange-800">
                      <LogOut className="h-3.5 w-3.5" />
                      외출 {o.outTime}
                    </span>
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-bold text-emerald-800">
                      <LogIn className="h-3.5 w-3.5" />
                      복귀 {o.inTime ?? "-"}
                    </span>
                  </span>
                ))}

                {/* 최종 퇴장 */}
                {d.lastOut && !d.hasUnreturnedOuting && (
                  <>
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2.5 py-1 font-bold text-slate-700">
                      <LogOut className="h-3.5 w-3.5" />
                      퇴장 {d.lastOut}
                    </span>
                  </>
                )}
                {d.hasUnreturnedOuting && (
                  <>
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1 font-bold text-amber-700">
                      <LogOut className="h-3.5 w-3.5" />
                      외출중 {d.lastOut}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 전체 로그 테이블 */}
      {view === "logs" && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["이름", "범주", "직종", "일자", "시간", "구분", "출역형태"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-extrabold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm font-semibold text-slate-400">데이터 없음</td></tr>
              ) : filteredLogs.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-900">{l.이름}</td>
                  <td className="px-3 py-2 text-slate-600">{l.범주}</td>
                  <td className="px-3 py-2 text-slate-600">{l.직종}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{l.일자}</td>
                  <td className="px-3 py-2 font-mono font-bold text-slate-800">{l.시간}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-extrabold ${
                      l.구분 === "IN" ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"
                    }`}>
                      {l.구분 === "IN" ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                      {l.구분}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{l.출역형태}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
