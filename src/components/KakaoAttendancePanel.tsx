import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Loader2, Save, Sparkles, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { KakaoMessage } from "@/lib/kakaoChat";
import {
  EVENT_CATEGORY_LABELS,
  KAKAO_ROOMS,
  causePrefix,
  crossCheckKakaoWithXerp,
  extractKakaoEvents,
  guessKakaoRoom,
  mergeKakaoEvents,
  messageMonths,
  monthKeyOf,
  normalizeName,
  summarizeEventsByPerson,
  type CrossCheckIssue,
  type KakaoEvent,
  type KakaoRoomKey,
  type XerpRowLite,
} from "@/lib/kakaoEvents";
import {
  loadEmployeesP5PH1FS,
  loadEmployeesPH2FS,
  loadEmployeesPH4FS,
  loadKakaoEventsFS,
  loadXerpWorkRowsForDatesFS,
  saveEmployeesP5PH1FS,
  saveEmployeesPH2FS,
  saveEmployeesPH4FS,
  saveKakaoEventsFS,
} from "@/lib/firestoreService";

const AI_KEY_STORAGE = "kakao_ai_api_key";
const AI_MODEL_STORAGE = "kakao_ai_model";
// 공지방별로 한 번이라도 저장했으면 다음부터는 "해당 월만"을 기본으로 한다
const roomSavedKey = (room: string) => `kakao_room_saved_${room}`;

type EmployeeRow = Record<string, string> & { id: string; 이름: string; 입사일: string; 퇴사일: string };
type SiteKey = "PH4" | "PH2" | "P5PH1";
const SITES: { key: SiteKey; label: string; load: () => Promise<unknown[] | null>; save: (rows: unknown[]) => Promise<boolean> }[] = [
  { key: "PH4", label: "P4-PH4", load: loadEmployeesPH4FS, save: saveEmployeesPH4FS },
  { key: "PH2", label: "P4-PH2", load: loadEmployeesPH2FS, save: saveEmployeesPH2FS },
  { key: "P5PH1", label: "P5-PH1", load: loadEmployeesP5PH1FS, save: saveEmployeesP5PH1FS },
];

const EMPLOYEE_FIELDS = ["현장구분", "이름", "주민번호", "연락처", "남여", "입사일", "퇴사일", "이관처", "신청공종", "단가", "단가변동", "은행명", "계좌번호", "주소", "메모"];

function readStorage(key: string, fallback = ""): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function categoryBadge(e: KakaoEvent) {
  const tone = e.category === "punch" ? "bg-red-100 text-red-700"
    : e.category === "resign" || e.category === "newbie" ? "bg-violet-100 text-violet-700"
    : "bg-yellow-100 text-yellow-800";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{EVENT_CATEGORY_LABELS[e.category] ?? e.category}</span>;
}

interface Props {
  messages: KakaoMessage[];
  isAdmin: boolean;
  /** 대화방 이름 또는 파일명 — P4/P5 공지방 추정용 */
  chatName?: string;
}

export default function KakaoAttendancePanel({ messages: allMessages, isAdmin, chatName = "" }: Props) {
  const months = useMemo(() => messageMonths(allMessages), [allMessages]);
  const [room, setRoom] = useState<KakaoRoomKey>(() => guessKakaoRoom(chatName) ?? "P4");
  const [period, setPeriod] = useState<"all" | "month">(() => (readStorage(roomSavedKey(guessKakaoRoom(chatName) ?? "P4")) ? "month" : "all"));
  const [month, setMonth] = useState(() => months[months.length - 1] ?? "");
  const messages = useMemo(
    () => (period === "month" && month ? allMessages.filter((m) => m.date.startsWith(month)) : allMessages),
    [allMessages, period, month],
  );
  const roomSites = KAKAO_ROOMS.find((r) => r.key === room)!.sites as readonly SiteKey[];
  const [employeesBySite, setEmployeesBySite] = useState<Record<SiteKey, EmployeeRow[]>>({ PH4: [], PH2: [], P5PH1: [] });
  const [method, setMethod] = useState<"rule" | "ai">("rule");
  const [aiModel, setAiModel] = useState(() => readStorage(AI_MODEL_STORAGE, "claude-opus-5-5"));
  const [apiKey, setApiKey] = useState(() => readStorage(AI_KEY_STORAGE));
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiEvents, setAiEvents] = useState<KakaoEvent[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}); // id → 바꾼 이름
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<CrossCheckIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [historyMonth, setHistoryMonth] = useState("");
  const [history, setHistory] = useState<KakaoEvent[] | null>(null);
  const [newbieSite, setNewbieSite] = useState<SiteKey>(roomSites[0]);

  // 방이나 기간을 바꾸면 이전 범위로 돌린 AI 결과·대조 결과는 버린다
  useEffect(() => {
    setAiEvents(null);
    setIssues(null);
    setNewbieSite(KAKAO_ROOMS.find((r) => r.key === room)!.sites[0]);
  }, [room, period, month]);

  const changeRoom = (next: KakaoRoomKey) => {
    setRoom(next);
    setPeriod(readStorage(roomSavedKey(next)) ? "month" : "all");
  };

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all(SITES.map((s) => s.load())).then((lists) => {
      setEmployeesBySite({
        PH4: (lists[0] ?? []) as EmployeeRow[],
        PH2: (lists[1] ?? []) as EmployeeRow[],
        P5PH1: (lists[2] ?? []) as EmployeeRow[],
      });
    });
  }, [isAdmin]);

  const roster = useMemo(
    () => [...new Set(roomSites.flatMap((k) => employeesBySite[k]).map((r) => normalizeName(r.이름 ?? "")).filter(Boolean))],
    [employeesBySite, roomSites],
  );

  const ruleEvents = useMemo(() => extractKakaoEvents(messages, roster), [messages, roster]);
  const baseEvents = method === "ai" && aiEvents ? aiEvents : ruleEvents;
  const events = useMemo(
    () => baseEvents.filter((e) => !removed.has(e.id)).map((e) => ({ ...e, room, ...(e.id in edits ? { name: normalizeName(edits[e.id]) } : {}) })),
    [baseEvents, edits, removed, room],
  );

  useEffect(() => {
    const eventMonths = [...new Set(events.map((e) => monthKeyOf(e.date)))].sort();
    if (!historyMonth && eventMonths.length) setHistoryMonth(eventMonths[eventMonths.length - 1]);
  }, [events, historyMonth]);

  const runAi = async () => {
    if (!apiKey.trim()) { toast.error("Anthropic API 키를 입력하세요."); return; }
    setAiRunning(true);
    setAiProgress("준비 중...");
    try {
      const { extractKakaoEventsWithAi } = await import("@/lib/kakaoAi");
      const result = await extractKakaoEventsWithAi(messages, {
        apiKey: apiKey.trim(),
        model: aiModel as "claude-opus-5-5",
        roster,
        onProgress: (done, total) => setAiProgress(`${done}/${total} 묶음 분석 중...`),
      });
      setAiEvents(result);
      setEdits({});
      setRemoved(new Set());
      setIssues(null);
      toast.success(`AI가 근태 관련 ${result.length}건을 찾았습니다.`);
    } catch (e) {
      const { describeAiError } = await import("@/lib/kakaoAi");
      toast.error("AI 분석 실패", { description: describeAiError(e) });
    } finally {
      setAiRunning(false);
      setAiProgress("");
    }
  };

  const saveEvents = async () => {
    if (!events.length) return;
    setSaving(true);
    try {
      const byMonth = new Map<string, KakaoEvent[]>();
      for (const e of events) {
        const key = monthKeyOf(e.date);
        byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
      }
      let ok = true;
      for (const [month, list] of byMonth) {
        const existing = await loadKakaoEventsFS<KakaoEvent>(month);
        ok = (await saveKakaoEventsFS(month, mergeKakaoEvents(existing, list))) && ok;
      }
      if (ok) {
        writeStorage(roomSavedKey(room), new Date().toISOString());
        toast.success(`${KAKAO_ROOMS.find((r) => r.key === room)!.label} ${events.length}건을 ${[...byMonth.keys()].join(", ")} 근태 기록에 저장했습니다.`);
      }
      else toast.error("일부 근태 기록을 저장하지 못했습니다.");
      if (historyMonth && byMonth.has(historyMonth)) setHistory(await loadKakaoEventsFS<KakaoEvent>(historyMonth));
    } finally {
      setSaving(false);
    }
  };

  const runCrossCheck = async () => {
    setChecking(true);
    try {
      const chatDates = new Set(messages.map((m) => m.date));
      const dates = [...new Set([...chatDates, ...events.map((e) => e.date)])];
      const raw = await loadXerpWorkRowsForDatesFS(dates);
      const xerpByDate = raw as Record<string, XerpRowLite[]>;
      if (!Object.keys(xerpByDate).length) {
        toast.info("이 기간에 저장된 XERP 공수 반영 데이터가 없습니다.");
        setIssues([]);
        return;
      }
      setIssues(crossCheckKakaoWithXerp(events, xerpByDate, chatDates));
    } finally {
      setChecking(false);
    }
  };

  const loadHistory = async (month: string) => {
    setHistoryMonth(month);
    if (!month) return;
    setHistory(await loadKakaoEventsFS<KakaoEvent>(month));
  };

  // ── 기술인 및 관리자 명단 반영 제안 ──
  const findEmployee = (name: string) => {
    for (const s of SITES) {
      const row = employeesBySite[s.key].find((r) => normalizeName(r.이름 ?? "") === name);
      if (row) return { site: s, row };
    }
    return null;
  };
  const resignSuggestions = events
    .filter((e) => e.category === "resign" && e.name)
    .map((e) => ({ event: e, hit: findEmployee(e.name) }))
    .filter((x) => x.hit && !x.hit.row.퇴사일);
  const newbieSuggestions = events.filter((e) => e.category === "newbie" && e.name && !findEmployee(e.name));

  const updateSiteRows = async (siteKey: SiteKey, next: EmployeeRow[], message: string) => {
    const site = SITES.find((s) => s.key === siteKey)!;
    if (await site.save(next)) {
      setEmployeesBySite((prev) => ({ ...prev, [siteKey]: next }));
      toast.success(message);
    } else {
      toast.error("명단 저장에 실패했습니다.");
    }
  };
  const applyResign = (e: KakaoEvent) => {
    const hit = findEmployee(e.name);
    if (!hit) return;
    const next = employeesBySite[hit.site.key].map((r) => (r.id === hit.row.id ? { ...r, 퇴사일: e.date } : r));
    updateSiteRows(hit.site.key, next, `${e.name} 퇴사일을 ${e.date}로 입력했습니다 (${hit.site.label}).`);
  };
  const applyNewbie = (e: KakaoEvent) => {
    const row = Object.fromEntries(EMPLOYEE_FIELDS.map((f) => [f, ""])) as EmployeeRow;
    row.id = crypto.randomUUID();
    row.이름 = e.name;
    row.입사일 = e.date;
    row.메모 = `카톡 공지(${e.msgDate} ${e.time})로 추가`;
    const site = SITES.find((s) => s.key === newbieSite)!;
    updateSiteRows(newbieSite, [...employeesBySite[newbieSite], row], `${e.name}을(를) ${site.label} 명단에 추가했습니다. 주민번호 등은 명단 화면에서 채워 주세요.`);
  };

  const unnamed = events.filter((e) => !e.name).length;
  // 방 구분이 없는 예전 기록은 어느 방에서나 보인다
  const roomHistory = useMemo(() => (history ? history.filter((e) => !e.room || e.room === room) : null), [history, room]);
  const historySummary = useMemo(() => (roomHistory ? summarizeEventsByPerson(roomHistory) : []), [roomHistory]);
  const historyCategories = useMemo(() => [...new Set((roomHistory ?? []).map((e) => e.category))], [roomHistory]);

  return (
    <div className="space-y-4">
      {/* 공지방 · 분석 기간 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-extrabold text-slate-700">공지방</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold">
            {KAKAO_ROOMS.map((r) => (
              <button key={r.key} type="button" onClick={() => changeRoom(r.key)} className={`px-3 py-1.5 ${room === r.key ? "bg-yellow-400 text-slate-900" : "bg-white text-slate-500"}`}>{r.label}</button>
            ))}
          </div>
          <span className="ml-2 text-sm font-extrabold text-slate-700">기간</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold">
            <button type="button" onClick={() => setPeriod("all")} className={`px-3 py-1.5 ${period === "all" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>전체 기간</button>
            <button type="button" onClick={() => setPeriod("month")} className={`px-3 py-1.5 ${period === "month" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>해당 월만</button>
          </div>
          {period === "month" && (
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
              {[...months].reverse().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <span className="text-xs text-slate-500">
            메시지 {messages.length.toLocaleString()}개 분석
            {period === "all" && months.length > 1 && ` (${months[0]} ~ ${months[months.length - 1]})`}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          처음 한 번은 전체 기간으로 정리해 저장하고, 그다음부터는 "해당 월만"으로 올리면 됩니다. 이 방을 한 번 저장하면 다음에는 자동으로 해당 월만 선택됩니다.
          원문 대화는 저장하지 않고 근태 건만 저장합니다.
        </p>
      </div>

      {/* 분석 방식 선택 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-extrabold text-slate-700">분석 방식</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold">
            <button type="button" onClick={() => setMethod("rule")} className={`px-3 py-1.5 ${method === "rule" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>기본 (키워드 규칙)</button>
            <button type="button" onClick={() => setMethod("ai")} className={`inline-flex items-center gap-1 px-3 py-1.5 ${method === "ai" ? "bg-violet-600 text-white" : "bg-white text-slate-500"}`}><Sparkles className="h-3.5 w-3.5" /> AI 분석</button>
          </div>
          <span className="text-xs text-slate-500">{method === "rule" ? "무료·즉시. 정해진 단어로 찾습니다." : "돌려 말한 표현까지 문맥으로 판단합니다. 사용료가 듭니다."}</span>
        </div>
        {method === "ai" && (
          <div className="mt-3 space-y-2 rounded-xl bg-violet-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={aiModel} onChange={(e) => { setAiModel(e.target.value); writeStorage(AI_MODEL_STORAGE, e.target.value); }} className="rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm">
                <option value="claude-opus-5-5">Claude Opus 5.5 (가장 정확)</option>
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (균형)</option>
                <option value="claude-haiku-5-5">Claude Haiku 5.5 (가장 저렴)</option>
              </select>
              <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); writeStorage(AI_KEY_STORAGE, e.target.value); }} placeholder="Anthropic API 키 (sk-ant-...)" className="min-w-[220px] flex-1 rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm" />
              <button type="button" disabled={aiRunning || !messages.length} onClick={runAi} className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                {aiRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {aiRunning ? aiProgress : "AI로 분석"}
              </button>
            </div>
            <p className="text-[11px] text-violet-800">
              ⚠ AI 분석을 누르면 이 대화의 텍스트 메시지(사진 제외)가 Anthropic으로 전송됩니다. API 키는 이 브라우저에만 저장됩니다.
              {aiEvents ? ` · 현재 AI 결과 ${aiEvents.length}건 표시 중` : " · 아직 AI 분석 전이라 기본 결과를 보여줍니다."}
            </p>
          </div>
        )}
      </div>

      {/* 근태 이벤트 */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-extrabold text-slate-800">근태 정리 {events.length}건 <span className="ml-1 text-xs font-medium text-slate-400">({method === "ai" && aiEvents ? "AI" : "기본"})</span></p>
            <p className="text-[11px] text-slate-500">
              {isAdmin ? `명단 ${roster.length}명과 이름을 맞췄습니다.` : "관리자 로그인하면 명단과 이름을 맞추고 저장할 수 있습니다."}
              {unnamed > 0 && ` 이름을 못 찾은 ${unnamed}건은 직접 입력하세요.`}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!isAdmin || checking || !events.length} onClick={runCrossCheck} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />} XERP 기록과 대조
            </button>
            <button type="button" disabled={!isAdmin || saving || !events.length} onClick={saveEvents} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 근태 기록 저장
            </button>
          </div>
        </div>
        <datalist id="kakao-roster-names">{roster.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
              <tr><th className="px-3 py-2">대상일</th><th className="px-3 py-2">이름</th><th className="px-3 py-2">구분</th><th className="px-3 py-2">원인/가산사유</th><th className="px-3 py-2">카톡 원문</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">근태 관련 메시지를 찾지 못했습니다.</td></tr>}
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-700">{e.date}{e.date !== e.msgDate && <div className="text-[10px] font-normal text-slate-400">{e.msgDate} 공지</div>}</td>
                  <td className="px-3 py-2">
                    <input list="kakao-roster-names" value={edits[e.id] ?? e.name} onChange={(ev) => setEdits((p) => ({ ...p, [e.id]: ev.target.value }))} placeholder="이름 입력" className={`w-20 rounded border px-1.5 py-1 ${e.name ? "border-slate-200" : "border-amber-300 bg-amber-50"}`} />
                  </td>
                  <td className="px-3 py-2">{categoryBadge(e)}</td>
                  <td className="px-3 py-2 text-slate-600">{e.cause ? `${causePrefix(e.cause)}…` : "-"}</td>
                  <td className="max-w-[420px] px-3 py-2 text-slate-700"><span className="text-[10px] text-slate-400">{e.time} {e.sender}</span><div className="whitespace-pre-wrap break-words">{e.text}</div></td>
                  <td className="px-2 py-2"><button type="button" title="이 건 제외" onClick={() => setRemoved((p) => new Set(p).add(e.id))} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 대조 결과 */}
      {issues && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-amber-800"><AlertTriangle className="h-4 w-4" /> 확인 필요 {issues.length}건</p>
          {issues.length === 0 ? <p className="text-xs text-slate-500">카톡 내용과 XERP 기록 사이에 어긋난 곳이 없습니다.</p> : (
            <ul className="space-y-1 text-xs">
              {issues.map((i, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${i.kind === "conflict" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"}`}>{i.kind === "conflict" ? "불일치" : "사유 없음"}</span>
                  <span className="w-20 shrink-0 text-slate-500">{i.date}</span>
                  <span className="w-16 shrink-0 font-bold text-slate-700">{i.name}</span>
                  <span className="text-slate-700">{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 기술인 및 관리자 명단 반영 */}
      {isAdmin && (resignSuggestions.length > 0 || newbieSuggestions.length > 0) && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-violet-800"><UserCheck className="h-4 w-4" /> 기술인 및 관리자 명단 반영 제안</p>
          <ul className="space-y-1.5 text-xs">
            {resignSuggestions.map(({ event: e, hit }) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{e.name}</span><span className="text-slate-500">{hit!.site.label} · 퇴사 공지 ({e.date})</span>
                <button type="button" onClick={() => applyResign(e)} className="rounded border border-violet-300 bg-white px-2 py-0.5 font-bold text-violet-700 hover:bg-violet-100">퇴사일 {e.date} 입력</button>
              </li>
            ))}
            {newbieSuggestions.length > 0 && (
              <li className="flex items-center gap-2 pt-1 text-slate-500">신규자 추가 현장:
                <select value={newbieSite} onChange={(ev) => setNewbieSite(ev.target.value as SiteKey)} className="rounded border border-violet-200 bg-white px-1.5 py-0.5">
                  {SITES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </li>
            )}
            {newbieSuggestions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{e.name}</span><span className="text-slate-500">명단에 없음 · 입사/투입 공지 ({e.date})</span>
                <button type="button" onClick={() => applyNewbie(e)} className="rounded border border-violet-300 bg-white px-2 py-0.5 font-bold text-violet-700 hover:bg-violet-100">명단에 추가</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 월간 이력 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700"><CalendarRange className="h-4 w-4" /> 저장된 월간 근태 이력 · {KAKAO_ROOMS.find((r) => r.key === room)!.label}</p>
          <input type="month" value={historyMonth} onChange={(e) => loadHistory(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <button type="button" disabled={!isAdmin || !historyMonth} onClick={() => loadHistory(historyMonth)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">불러오기</button>
          {!isAdmin && <span className="text-[11px] text-slate-400">관리자 로그인 후 볼 수 있습니다.</span>}
        </div>
        {roomHistory && (roomHistory.length === 0 ? <p className="text-xs text-slate-400">이 달에 저장된 기록이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr><th className="px-3 py-2">이름</th>{historyCategories.map((c) => <th key={c} className="px-3 py-2">{EVENT_CATEGORY_LABELS[c] ?? c}</th>)}<th className="px-3 py-2">합계</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historySummary.map((r) => (
                  <tr key={r.name}><td className="px-3 py-1.5 font-bold text-slate-700">{r.name}</td>{historyCategories.map((c) => <td key={c} className="px-3 py-1.5">{r.counts[c] ?? ""}</td>)}<td className="px-3 py-1.5 font-bold">{r.total}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
