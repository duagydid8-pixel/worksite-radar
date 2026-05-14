import { useRef, useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Search, X, LogIn, LogOut, Users, AlertTriangle, ArrowRight, Clock, HelpCircle, Trash2, CalendarDays, Save } from "lucide-react";
import { toast } from "sonner";
import { savePmisLogFS, loadPmisLogFS, listPmisLogDatesFS, deletePmisLogFS } from "@/lib/firestoreService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  departureTime: string | null;
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
    let departureTime: string | null = null;
    const outings: Outing[] = [];
    let currentOutTime: string | null = null;

    for (let idx = 0; idx < events.length; idx++) {
      const e = events[idx];
      const isLastEvent = idx === events.length - 1;

      if (e.구분 === "IN") {
        if (firstIn === null) firstIn = e.시간;
        if (currentOutTime !== null) {
          outings.push({ outTime: currentOutTime, inTime: e.시간 });
          currentOutTime = null;
        }
        departureTime = null;
      } else if (e.구분 === "OUT") {
        if (isLastEvent) {
          // Last event OUT = 퇴근
          departureTime = e.시간;
          currentOutTime = null;
        } else if (currentOutTime === null) {
          currentOutTime = e.시간;
        }
      }
    }

    const hasUnreturnedOuting = currentOutTime !== null;

    result.push({
      이름: name,
      범주: firstLog.범주,
      직종: firstLog.직종,
      firstIn,
      departureTime,
      outings,
      hasUnreturnedOuting,
      totalEvents: events.length,
    });
  }

  return result.sort((a, b) => (a.firstIn ?? "").localeCompare(b.firstIn ?? ""));
}

// CSV(파이프 구분) → ParsedPmisData (Python build_xlsx 없이 앱에서 직접 변환)
// 헤더: company|category|name|maskedName|birth|trade|job|date|time|type|formType|teamLeader
function parseCsv(text: string, fileName: string): ParsedPmisData {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new Error("데이터가 없습니다.");

  const logs: LogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("|");
    if (c.length < 10 || !c[2]) continue;
    logs.push({
      회사: c[0] || "",
      범주: c[1] || "",
      이름: c[2] || "",
      일자: c[7] || "",
      시간: c[8] || "",
      구분: (c[9] || "") as "IN" | "OUT",
      출역형태: c[10] || "",
      직종: c[6] || "",
    });
  }

  // 사람별 정리 도출
  const byName = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!byName.has(l.이름)) byName.set(l.이름, []);
    byName.get(l.이름)!.push(l);
  }
  const persons: PersonRow[] = [];
  for (const [name, evs] of byName) {
    const sorted = [...evs].sort((a, b) => a.시간.localeCompare(b.시간));
    const ins = sorted.filter((e) => e.구분 === "IN");
    const outs = sorted.filter((e) => e.구분 === "OUT");
    const first = sorted[0];
    const lastEv = sorted[sorted.length - 1];
    persons.push({
      이름: name,
      마스킹: "",
      범주: first.범주,
      직종: first.직종,
      처음IN: ins[0]?.시간 || "",
      마지막OUT: lastEv?.구분 === "OUT" ? lastEv.시간 : "",
      IN횟수: ins.length,
      OUT횟수: outs.length,
      총이벤트: evs.length,
      비고: ins.length !== outs.length ? "IN≠OUT" : "",
    });
  }
  persons.sort((a, b) => a.처음IN.localeCompare(b.처음IN));

  const inCount = logs.filter((l) => l.구분 === "IN").length;
  const outCount = logs.filter((l) => l.구분 === "OUT").length;
  const summary: Summary = {
    기준일: logs[0]?.일자 || "",
    출역자수: String(byName.size),
    IN이벤트: String(inCount),
    OUT이벤트: String(outCount),
  };

  const dateMatch = fileName.match(/\d{4}-\d{2}-\d{2}/);
  return {
    fileName,
    dateLabel: dateMatch ? dateMatch[0] : (logs[0]?.일자 || ""),
    persons,
    logs,
    summary,
  };
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

function SavedDatesCalendar({
  savedDates,
  activeDateLabel,
  onLoad,
  onDelete,
}: {
  savedDates: string[];
  activeDateLabel: string | null;
  onLoad: (date: string) => void;
  onDelete: (date: string) => void;
}) {
  const savedSet = useMemo(() => new Set(savedDates), [savedDates]);

  const initYM = () => {
    const ref = savedDates[0] ?? new Date().toISOString().slice(0, 10);
    const [y, m] = ref.split("-").map(Number);
    return { year: y, month: m - 1 };
  };
  const [{ year, month }, setYM] = useState(initYM);

  const p2 = (n: number) => String(n).padStart(2, "0");
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonth = () => setYM(({ year: y, month: m }) => m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 });
  const nextMonth = () => setYM(({ year: y, month: m }) => m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 });

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 select-none w-52 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold">‹</button>
        <span className="text-xs font-extrabold text-slate-800">{year}년 {month + 1}월</span>
        <button type="button" onClick={nextMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold">›</button>
      </div>
      <div className="grid grid-cols-7 mb-0.5">
        {["일","월","화","수","목","금","토"].map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-extrabold py-0.5 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-400"}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${p2(month + 1)}-${p2(day)}`;
          const hasSaved = savedSet.has(dateStr);
          const isActive = dateStr === activeDateLabel;
          const isToday = dateStr === todayStr;
          const col = (firstWeekday + i) % 7;
          return (
            <div key={day} className="relative group flex items-center justify-center py-0.5">
              {hasSaved ? (
                <>
                  <button
                    type="button"
                    onClick={() => onLoad(dateStr)}
                    title={`${dateStr} 로드`}
                    className={`w-7 h-6 rounded text-[11px] font-extrabold transition-colors ${
                      isActive ? "bg-blue-600 text-white shadow-sm" : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    }`}
                  >
                    {day}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(dateStr); }}
                    className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-400 text-white text-[9px] font-black items-center justify-center hidden group-hover:flex z-10 leading-none"
                  >×</button>
                </>
              ) : (
                <span className={`text-[11px] ${isToday ? "font-extrabold text-blue-500 underline" : col === 0 ? "text-red-300" : col === 6 ? "text-blue-300" : "text-slate-300"}`}>
                  {day}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {savedDates.length === 0 && (
        <p className="text-center text-[10px] text-slate-400 mt-1 font-semibold">저장된 데이터 없음</p>
      )}
    </div>
  );
}

type ViewMode = "persons" | "outings" | "logs";

const PMIS_LOADER_SCRIPT = `void function(){
window.collectAllPages=async function(){var ifr=document.querySelector("iframe");if(!ifr)return JSON.stringify({error:"no iframe"});var w=ifr.contentWindow;var grid=w.$find&&w.$find("WebDataGrid1");if(!grid)return JSON.stringify({error:"no grid"});var paging=grid.get_behaviors().get_paging();var totalPages=paging.get_pageCount();window.__items=[];var seen=new Set();function extractCurrent(){var d=ifr.contentDocument;var els=d.querySelectorAll('[onclick^="popupTimebook"]');var added=0;els.forEach(function(el){var oc=el.getAttribute("onclick");var args=(oc.match(/'([^']*)'/g)||[]).map(function(s){return s.slice(1,-1)});var k=args[0]+"|"+args[1];if(!seen.has(k)){seen.add(k);var tr=el.closest("tr");var tds=tr?Array.from(tr.querySelectorAll("td")).map(function(c){return c.textContent.trim().replace(/\\s+/g," ")}):[];window.__items.push({mpw_idx:args[0],mpw_chk_idx:args[1],mpw_type:args[2]||"S",tds:tds.slice(0,20)});added++}});return added}function postback(suffix){var d=ifr.contentDocument;d.querySelector('[name="__EVENTTARGET"]').value="WebDataGrid1$ctl01$ucPagerControl$"+suffix;d.querySelector('[name="__EVENTARGUMENT"]').value="";d.forms[0].submit()}postback("btnFirst");await new Promise(function(r){setTimeout(r,4000)});extractCurrent();for(var p=1;p<totalPages;p++){postback("btnNext");await new Promise(function(r){setTimeout(r,4000)});var added=extractCurrent();if(added===0)break}return JSON.stringify({totalPages:totalPages,collected:window.__items.length})};
window.getPjtCd=function(){var ifr=document.querySelector("iframe");if(!ifr)return JSON.stringify({error:"no iframe"});var w=ifr.contentWindow;if(typeof w.popupTimebook!=="function")return JSON.stringify({error:"no popupTimebook"});var src=w.popupTimebook.toString();var m=src.match(/pjt_cd=([A-Z0-9]+)/);if(!m)return JSON.stringify({error:"pjt_cd not found"});window.__pjtCd=m[1];return JSON.stringify({pjtCd:m[1]})};
window.fetchAllInOut=async function(workDate,pjtCd,startIdx,endIdx){var items=window.__items;if(!items||!items.length)return JSON.stringify({error:"no items"});pjtCd=pjtCd||window.__pjtCd||"SECLP00001";startIdx=startIdx||0;endIdx=endIdx||items.length;if(endIdx>items.length)endIdx=items.length;var base="https://sena.doallpmis.com/Manpower/ManpowerStatus/InOut_List.aspx";window.__inout_html=window.__inout_html||{};var ok=0,err=0,redir=0;for(var i=startIdx;i<endIdx;i++){var it=items[i];var url=base+"?pjt_cd="+pjtCd+"&mnu_cd=L3_DailyStatusSearch&internal_type=N&group_type=L3_ManpowerList&mpw_idx="+it.mpw_idx+"&mpw_chk_idx="+it.mpw_chk_idx+"&mpw_type="+it.mpw_type+"&work_date="+workDate;try{var r=await fetch(url,{credentials:"include"});var txt=await r.text();if(txt.length<1000||txt.indexOf("Login.aspx")>=0){redir++;if(redir>=3)return JSON.stringify({error:"session expired",ok:ok,atIdx:i});continue}window.__inout_html[i]=txt;ok++}catch(e){err++}}return JSON.stringify({ok:ok,err:err,redir:redir,total:items.length,fetched:Object.keys(window.__inout_html).length})};
window.parseAndJoin=function(){function pe(html){var doc=new DOMParser().parseFromString(html,"text/html");var ev=[];doc.querySelectorAll("tr").forEach(function(r){var cells=Array.from(r.children).filter(function(c){return c.tagName==="TD"});if(cells.length>=5){var t=cells.map(function(c){return c.textContent.trim()});if((t[2]==="IN"||t[2]==="OUT")&&t[1].match(/\\d{4}-\\d{2}-\\d{2}/))ev.push({name:t[0],type:t[2],fullTime:t[4]})}});return ev}var items=window.__items;var html=window.__inout_html;if(!items||!html)return JSON.stringify({error:"run collectAllPages+fetchAllInOut first"});var rows=[];Object.keys(html).forEach(function(k){var i=Number(k);var evs=pe(html[k]);var it=items[i];var tds=it.tds;var m={company:tds[1]||"",category:tds[2]||"",maskedName:tds[3]||"",birth:tds[5]||"",trade:tds[6]||"",job:tds[7]||"",formType:tds[14]||"",teamLeader:tds[17]||""};evs.forEach(function(e){rows.push({company:m.company,category:m.category,name:e.name,maskedName:m.maskedName,birth:m.birth,trade:m.trade,job:m.job,date:e.fullTime?e.fullTime.slice(0,10):"",time:e.fullTime?e.fullTime.slice(11):"",type:e.type,formType:m.formType,teamLeader:m.teamLeader})})});rows.sort(function(a,b){return(a.date+" "+a.time).localeCompare(b.date+" "+b.time)});var hdr=["company","category","name","maskedName","birth","trade","job","date","time","type","formType","teamLeader"];var lines=[hdr.join("|")];rows.forEach(function(r){lines.push(hdr.map(function(h){return(r[h]||"").replace(/\\|/g," ")}).join("|"))});window.__csv=lines.join("\\n");return JSON.stringify({total:rows.length,IN:rows.filter(function(r){return r.type==="IN"}).length,OUT:rows.filter(function(r){return r.type==="OUT"}).length,len:window.__csv.length})};
window.downloadCsv=function(filename){filename=filename||("inout_log_"+new Date().toISOString().slice(0,10)+".csv");var csv=window.__csv;if(!csv)return JSON.stringify({error:"no csv"});var blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8"});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(url)},5000);return JSON.stringify({ok:true,filename:filename,size:csv.length})};
console.log("OK v6: collectAllPages / getPjtCd / fetchAllInOut / parseAndJoin / downloadCsv");
}()`;

interface Props {
  site: string;
  data: ParsedPmisData | null;
  onDataLoaded: (d: ParsedPmisData) => void;
  onClear: () => void;
  xerpNames?: Set<string> | null;
}

export default function PmisInOutLogTab({ site, data, onDataLoaded, onClear, xerpNames }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<ViewMode>("persons");
  const [search, setSearch] = useState("");
  const [outingsOnly, setOutingsOnly] = useState(true);
  const [hideNonXerp, setHideNonXerp] = useState(false);
  const [savedDates, setSavedDates] = useState<string[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listPmisLogDatesFS(site).then(setSavedDates).catch(() => {});
  }, [site]);

  const isInXerp = (name: string) => !xerpNames || !hideNonXerp || xerpNames.has(name);
  const nonXerpCount = xerpNames && data
    ? data.persons.filter((p) => !xerpNames.has(p.이름)).length
    : 0;

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    const ok = await savePmisLogFS(site, data.dateLabel, data);
    setSaving(false);
    if (ok) {
      setSavedDates((prev) => Array.from(new Set([data.dateLabel, ...prev])).sort().reverse());
      toast.success(`${data.dateLabel} 저장 완료`);
    } else {
      toast.error("저장 실패");
    }
  };

  const handleLoadDate = async (date: string) => {
    const loaded = await loadPmisLogFS(site, date);
    if (loaded) {
      onDataLoaded(loaded as ParsedPmisData);
      setSearch("");
      toast.success(`${date} 로드 완료`);
    } else {
      toast.error("데이터를 불러올 수 없습니다.");
    }
  };

  const handleDeleteDate = async (date: string) => {
    await deletePmisLogFS(site, date);
    setSavedDates((prev) => prev.filter((d) => d !== date));
    if (data?.dateLabel === date) onClear();
    toast.success(`${date} 삭제됨`);
  };

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    const isXlsx = name.endsWith(".xlsx");
    if (!isCsv && !isXlsx) {
      toast.error("xlsx 또는 csv 파일만 업로드해 주세요.");
      return;
    }
    try {
      let parsed: ParsedPmisData;
      if (isCsv) {
        const text = await file.text();
        parsed = parseCsv(text, file.name);
      } else {
        parsed = await parseXlsx(file);
      }
      if (parsed.persons.length === 0 && parsed.logs.length === 0) {
        toast.error("출역 데이터를 찾지 못했습니다.");
        return;
      }
      onDataLoaded(parsed);
      setSearch("");
      toast.success(`${parsed.dateLabel} 출역로그 로드 완료 (${parsed.persons.length}명)`);
    } catch {
      toast.error("파일 파싱 중 오류가 발생했습니다.");
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

  const ManualDialog = () => (
    <Dialog open={showManual} onOpenChange={setShowManual}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-black">PMIS 콘솔 추출 가이드</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="font-black text-slate-800">① 준비</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600 font-semibold">
              <li>Chrome에서 <span className="font-mono text-xs bg-white border border-slate-200 px-1 rounded">sena.doallpmis.com</span> 로그인</li>
              <li>인력관리 → 일일 출역현황 → <strong>일일 출역현황 상세</strong></li>
              <li>날짜를 원하는 날짜로 변경 후 조회 클릭</li>
            </ol>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="font-black text-slate-800">② 함수 로드 (F12 → Console)</p>
            <p className="text-slate-600 font-semibold">아래 버튼으로 스크립트를 클립보드에 복사한 뒤 콘솔에 <strong>Ctrl+V → Enter</strong></p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(PMIS_LOADER_SCRIPT).then(() => {
                  toast.success("스크립트 복사됨 — 콘솔에 Ctrl+V 후 Enter");
                }).catch(() => toast.error("복사 실패"));
              }}
              className="w-full flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-extrabold text-blue-700 hover:bg-blue-100"
            >
              📋 PMIS 스크립트 클립보드 복사
            </button>
            <p className="text-xs text-emerald-700 font-bold">✓ "OK v6: collectAllPages / ..." 메시지 확인</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
            <p className="font-black text-slate-800">③ 순서대로 실행</p>
            <div className="space-y-2">
              {[
                { step: "전체 페이지 수집 (자동, ~20초)", code: "await collectAllPages()" },
                { step: "프로젝트 코드 확인", code: "getPjtCd()" },
                { step: "IN/OUT 데이터 수집 (날짜·코드 맞게 수정)", code: 'await fetchAllInOut("2026-05-13", "SECLP00002")' },
                { step: "파싱", code: "parseAndJoin()" },
                { step: "CSV 다운로드", code: 'downloadCsv("inout_log_2026-05-13.csv")' },
              ].map(({ step, code }, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="font-semibold text-slate-700">{step}</p>
                    <code className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded block mt-0.5">{code}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
            <p className="font-black text-emerald-800">④ 앱에 업로드</p>
            <p className="text-slate-600 font-semibold text-xs">
              다운받은 <span className="font-mono bg-white border border-slate-200 px-1 rounded">inout_log_YYYY-MM-DD.csv</span> 파일을 이 페이지의 업로드 영역에 드래그&드롭하거나 클릭해서 선택하면 바로 표시됩니다.
            </p>
            <p className="text-xs text-emerald-700 font-bold">✓ Python 변환 불필요 — CSV 직접 업로드 가능</p>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="font-black text-amber-800">주의</p>
            <ul className="list-disc list-inside text-amber-700 text-xs font-semibold space-y-1 mt-1">
              <li>allow pasting 입력 후 Enter해야 붙여넣기 가능</li>
              <li>비밀번호는 직접 입력 (절대 저장/공유 금지)</li>
              <li>날짜 바꿀 때마다 collectAllPages() 다시 실행</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (!data) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
        <ManualDialog />
        <div className="flex gap-4 items-start">
          {/* 달력 */}
          <SavedDatesCalendar
            savedDates={savedDates}
            activeDateLabel={null}
            onLoad={(date) => void handleLoadDate(date)}
            onDelete={(date) => void handleDeleteDate(date)}
          />
          {/* 업로드 영역 */}
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
            className={`flex-1 flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
              dragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
            }`}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }} />
            <FileSpreadsheet className="h-12 w-12 text-slate-400" />
            <p className="mt-4 text-base font-black text-slate-800">PMIS 출역 IN/OUT 로그 업로드</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              <span className="font-mono">.xlsx</span> 또는 <span className="font-mono">.csv</span> 파일을 끌어다 놓거나 클릭
            </p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowManual(true); }}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-blue-600"
            >
              <HelpCircle className="h-4 w-4" /> 콘솔 추출 방법
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <ManualDialog />
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">{data.dateLabel} 출역 IN/OUT 로그</h2>
          <p className="text-xs font-semibold text-slate-500">{data.fileName}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-extrabold transition-colors ${
              showCalendar ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> 날짜 선택 {savedDates.length > 0 && `(${savedDates.length})`}
          </button>
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
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "저장중..." : "저장"}
          </button>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-extrabold text-slate-400 hover:text-blue-600 hover:border-blue-300"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" /> 파일 변경
          </button>
        </div>
      </div>

      {/* 달력 패널 */}
      {showCalendar && (
        <div className="flex gap-4 items-start">
          <SavedDatesCalendar
            savedDates={savedDates}
            activeDateLabel={data.dateLabel}
            onLoad={(date) => void handleLoadDate(date)}
            onDelete={(date) => void handleDeleteDate(date)}
          />
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
            className={`flex-1 flex min-h-[100px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
              dragActive ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
            }`}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }} />
            <FileSpreadsheet className="h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-bold text-slate-400">다른 날짜 CSV/XLSX 업로드</p>
          </div>
        </div>
      )}

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
                {/* 출근 */}
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-bold text-emerald-800">
                  <LogIn className="h-3.5 w-3.5" />
                  출근 {d.firstIn ?? "-"}
                </span>

                {/* 외출 → 복귀 사이클 */}
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

                {/* 퇴근 */}
                {d.departureTime && (
                  <>
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2.5 py-1 font-bold text-slate-700">
                      <LogOut className="h-3.5 w-3.5" />
                      퇴근 {d.departureTime}
                    </span>
                  </>
                )}
                {/* 외출중 (mid-outing unresolved, no departure yet) */}
                {d.hasUnreturnedOuting && (
                  <>
                    <ArrowRight className="h-3 w-3 text-slate-300" />
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1 font-bold text-amber-700">
                      <Clock className="h-3 w-3" />
                      외출중
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
