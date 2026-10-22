import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Copy, History, Loader2, RefreshCw, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  loadKakaoEventsFS,
  saveKakaoEventsFS,
  loadKakaoUploadLogFS,
  loadEmployeesPH4FS, saveEmployeesPH4FS,
  loadEmployeesPH2FS, saveEmployeesPH2FS,
  loadEmployeesP5PH1FS, saveEmployeesP5PH1FS,
  type KakaoUploadLogEntry,
} from "@/lib/firestoreService";
import { EVENT_CATEGORY_LABELS, KAKAO_ROOMS, normalizeName, reExtractSavedEvents, summarizeEventsByPerson, type KakaoEvent } from "@/lib/kakaoEvents";

interface Props {
  isAdmin: boolean;
  /** 지정하면 그 공지방만 보여준다(근태 정리 화면 안에서 쓸 때) */
  room?: string;
  defaultMonth?: string;
  /** 업로드 내역 표를 보여줄지 */
  showUploads?: boolean;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const formatSavedAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const roomLabel = (key?: string) => KAKAO_ROOMS.find((r) => r.key === key)?.label ?? "방 구분 없음";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : `${date} (${WEEKDAYS[d.getDay()]})`;
};
/** 24시간 "13:05" → "오후 1:05" */
const kakaoTimeLabel = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, "0")}`;
};

type RosterRow = Record<string, string> & { id: string; 이름: string; 퇴사일: string };
const ROSTER_SITES = [
  { key: "PH4", label: "P4-PH4", load: loadEmployeesPH4FS, save: saveEmployeesPH4FS },
  { key: "PH2", label: "P4-PH2", load: loadEmployeesPH2FS, save: saveEmployeesPH2FS },
  { key: "P5PH1", label: "P5-PH1", load: loadEmployeesP5PH1FS, save: saveEmployeesP5PH1FS },
] as const;
type RosterSiteKey = (typeof ROSTER_SITES)[number]["key"];

/** 이 기록이 어떤 카톡 공지에서 나왔는지 — 날짜·요일·오전오후 시각·보낸사람·원문 */
function Evidence({ event: e }: { event: KakaoEvent }) {
  return (
    <div className="mt-1.5 rounded-md border border-slate-100 bg-slate-50 p-2">
      <p className="text-[10px] font-bold text-slate-500">
        카톡 근거 · {dayLabel(e.msgDate)} {kakaoTimeLabel(e.time)} · {e.sender}
        {e.chat && <span className="ml-1 text-slate-400">· {e.chat}</span>}
        {e.date !== e.msgDate && <span className="ml-1 text-violet-600">→ 대상일 {e.date}</span>}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-slate-700">{e.text}</p>
    </div>
  );
}

/** 이름을 못 찾은(또는 잘못 잡힌) 기록의 이름을 직접 적는 칸. 명단 이름 자동완성, 칸을 벗어나거나 Enter를 누르면 저장. */
function NameInput({ value, missing, saving, onChange, onCommit }: {
  value: string; missing: boolean; saving: boolean;
  onChange: (v: string) => void; onCommit: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        list="kakao-saved-roster-names"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        onBlur={(ev) => onCommit(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }}
        placeholder="이름 입력"
        disabled={saving}
        className={`w-20 rounded border px-1.5 py-1 text-xs font-bold ${missing ? "border-amber-300 bg-amber-50 text-slate-800" : "border-slate-200 text-slate-800"}`}
      />
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
    </span>
  );
}

function categoryBadge(category: string) {
  const tone = category === "punch" ? "bg-red-100 text-red-700"
    : category === "resign" || category === "newbie" ? "bg-violet-100 text-violet-700"
    : "bg-yellow-100 text-yellow-800";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{EVENT_CATEGORY_LABELS[category] ?? category}</span>;
}

/** 지금까지 올린 카톡 파일 내역과, 월별로 저장된 근태 기록(목록/사람별)을 보여준다. */
export default function KakaoSavedHistory({ isAdmin, room, defaultMonth, showUploads = true }: Props) {
  const [uploads, setUploads] = useState<KakaoUploadLogEntry[] | null>(null);
  const [month, setMonth] = useState(defaultMonth || thisMonth());
  const [roomFilter, setRoomFilter] = useState<string>(room ?? "all");
  const [events, setEvents] = useState<KakaoEvent[] | null>(null);
  const [view, setView] = useState<"list" | "person" | "resign">("list");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [roster, setRoster] = useState<Record<RosterSiteKey, RosterRow[]>>({ PH4: [], PH2: [], P5PH1: [] });
  const [applying, setApplying] = useState("");
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({}); // 기록 id → 직접 적은 이름
  const [savingName, setSavingName] = useState("");
  const [recleaning, setRecleaning] = useState(false);

  useEffect(() => { if (defaultMonth) setMonth(defaultMonth); }, [defaultMonth]);
  useEffect(() => { if (room) setRoomFilter(room); }, [room]);

  // 업로드 내역 + 선택한 달 기록 불러오기 (카톡 근태를 새로 저장하면 다시 불러온다)
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = () => {
      if (showUploads) loadKakaoUploadLogFS().then((list) => { if (!cancelled) setUploads(list); });
      if (/^\d{4}-\d{2}$/.test(month)) {
        setEvents(null);
        loadKakaoEventsFS<KakaoEvent>(month).then((list) => { if (!cancelled) setEvents(list); });
      }
    };
    load();
    window.addEventListener("kakao-events-updated", load);
    return () => { cancelled = true; window.removeEventListener("kakao-events-updated", load); };
  }, [isAdmin, month, showUploads]);

  const shownUploads = useMemo(
    () => (uploads ?? []).filter((u) => roomFilter === "all" || u.room === roomFilter),
    [uploads, roomFilter],
  );
  // 방 구분이 없는 예전 기록은 어느 방에서나 보인다
  const shownEvents = useMemo(
    () => (events ?? [])
      .filter((e) => roomFilter === "all" || !e.room || e.room === roomFilter)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [events, roomFilter],
  );
  const summary = useMemo(() => summarizeEventsByPerson(shownEvents), [shownEvents]);
  const categories = useMemo(() => [...new Set(shownEvents.map((e) => e.category))], [shownEvents]);
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of shownEvents) counts[e.category] = (counts[e.category] ?? 0) + 1;
    return counts;
  }, [shownEvents]);
  const unnamedEvents = useMemo(() => shownEvents.filter((e) => !e.name), [shownEvents]);
  const listEvents = useMemo(
    () => categoryFilter === "all" ? shownEvents
      : categoryFilter === "noname" ? unnamedEvents
      : shownEvents.filter((e) => e.category === categoryFilter),
    [shownEvents, unnamedEvents, categoryFilter],
  );

  // 기술인 및 관리자 명단 — 퇴사일이 반영됐는지 보여주고, 여기서 바로 넣을 수 있게
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = () => {
      Promise.all(ROSTER_SITES.map((s) => s.load())).then((lists) => {
        if (cancelled) return;
        setRoster({
          PH4: (lists[0] ?? []) as RosterRow[],
          PH2: (lists[1] ?? []) as RosterRow[],
          P5PH1: (lists[2] ?? []) as RosterRow[],
        });
      });
    };
    load();
    window.addEventListener("employees-updated", load);
    return () => { cancelled = true; window.removeEventListener("employees-updated", load); };
  }, [isAdmin]);

  const findRosterRow = (name: string) => {
    for (const site of ROSTER_SITES) {
      const row = roster[site.key].find((r) => normalizeName(r.이름 ?? "") === normalizeName(name));
      if (row) return { site, row };
    }
    return null;
  };

  /** 자동완성용 — 세 현장 명단의 이름 전부 */
  const rosterNames = useMemo(
    () => [...new Set(ROSTER_SITES.flatMap((s) => roster[s.key].map((r) => normalizeName(r.이름 ?? ""))).filter(Boolean))].sort(),
    [roster],
  );

  /** 이름을 못 찾은 퇴사 공지 — 이름만 적어 주면 위 명단으로 올라간다 */
  const unnamedResign = useMemo(() => shownEvents.filter((e) => e.category === "resign" && !e.name), [shownEvents]);

  /** 그 달 퇴사 공지를 사람별로 묶는다 — 퇴사일은 가장 늦게 공지된 대상일로 본다 */
  const resignPeople = useMemo(() => {
    const map = new Map<string, { name: string; date: string; events: KakaoEvent[] }>();
    for (const e of shownEvents.filter((e) => e.category === "resign" && e.name)) {
      const key = normalizeName(e.name);
      const prev = map.get(key);
      if (prev) {
        prev.events.push(e);
        if (e.date > prev.date) prev.date = e.date;
      } else {
        map.set(key, { name: e.name, date: e.date, events: [e] });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }, [shownEvents]);

  const applyResignDate = async (name: string, date: string) => {
    const hit = findRosterRow(name);
    if (!hit) { toast.error(`${name} 은(는) 기술인 및 관리자 명단에 없습니다.`); return; }
    setApplying(name);
    try {
      const next = roster[hit.site.key].map((r) => (r.id === hit.row.id ? { ...r, 퇴사일: date } : r));
      if (!(await hit.site.save(next))) { toast.error("명단 저장에 실패했습니다."); return; }
      setRoster((prev) => ({ ...prev, [hit.site.key]: next }));
      window.dispatchEvent(new CustomEvent("employees-updated", { detail: { site: hit.site.key } }));
      toast.success(date ? `${name} 퇴사일을 ${date}로 입력했습니다 (${hit.site.label}).` : `${name} 퇴사일을 지웠습니다 (${hit.site.label}).`);
    } finally {
      setApplying("");
    }
  };

  /** 카톡이 못 찾은 이름을 직접 적어 그 달 저장 기록에 반영한다 (이름이 들어가면 사람별·퇴사자 집계에도 바로 잡힌다) */
  const saveEventName = async (id: string, raw: string) => {
    const name = normalizeName(raw);
    const all = events ?? [];
    const target = all.find((e) => e.id === id);
    const clear = () => setNameEdits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (!target || target.name === name) { clear(); return; }
    setSavingName(id);
    try {
      const next = all.map((e) => (e.id === id ? { ...e, name, edited: true } : e));
      if (!(await saveKakaoEventsFS(month, next))) { toast.error("이름 저장에 실패했습니다."); return; }
      setEvents(next);
      clear();
      window.dispatchEvent(new CustomEvent("kakao-events-updated"));
      if (!name) toast.success("이름을 지웠습니다.");
      else if (findRosterRow(name)) toast.success(`${name} 으로 저장했습니다. 명단에서 찾았습니다.`);
      else toast.warning(`${name} 으로 저장했지만 기술인 및 관리자 명단에는 없는 이름입니다. 이름을 다시 확인하거나 명단에 추가하세요.`);
    } finally {
      setSavingName("");
    }
  };

  /** 잘못 잡힌 기록(사람 근태가 아닌데 잡힌 공지)을 그 달 저장본에서 뺀다 */
  const deleteEvent = async (e: KakaoEvent) => {
    const what = `${e.date} ${e.name || "이름 없음"} · ${EVENT_CATEGORY_LABELS[e.category] ?? e.category}`;
    if (!window.confirm(`${what} 기록을 지울까요?
카톡 원문은 그대로이고 저장된 근태 기록에서만 빠집니다.`)) return;
    setSavingName(e.id);
    try {
      const next = (events ?? []).filter((x) => x.id !== e.id);
      if (!(await saveKakaoEventsFS(month, next))) { toast.error("저장에 실패했습니다."); return; }
      setEvents(next);
      window.dispatchEvent(new CustomEvent("kakao-events-updated"));
      toast.success("기록을 지웠습니다.");
    } finally {
      setSavingName("");
    }
  };

  /** 저장된 기록을 지금 규칙으로 다시 뽑는다 — 카톡 파일을 다시 올리지 않고 이름·구분을 바로잡는 용도 */
  const recleanMonth = async () => {
    const all = events ?? [];
    if (!all.length) return;
    if (!rosterNames.length) { toast.error("기술인 및 관리자 명단을 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요."); return; }
    const next = reExtractSavedEvents(all, rosterNames);
    const before = new Set(all.map((e) => e.id));
    const after = new Set(next.map((e) => e.id));
    const added = next.filter((e) => !before.has(e.id)).length;
    const removed = all.filter((e) => !after.has(e.id)).length;
    if (!added && !removed) { toast.success("이미 지금 규칙으로 정리돼 있습니다."); return; }
    const ok = window.confirm(`${month} 저장 기록 ${all.length}건을 지금 규칙으로 다시 정리합니다.
새로 잡히는 기록 ${added}건, 빠지는 기록 ${removed}건 (원문 300자 뒤에만 있던 키워드는 다시 잡히지 않아 빠집니다).
직접 적은 이름은 그대로 둡니다.`);
    if (!ok) return;
    setRecleaning(true);
    try {
      if (!(await saveKakaoEventsFS(month, next))) { toast.error("저장에 실패했습니다."); return; }
      setEvents(next);
      window.dispatchEvent(new CustomEvent("kakao-events-updated"));
      toast.success(`다시 정리했습니다. ${all.length}건 → ${next.length}건`);
    } finally {
      setRecleaning(false);
    }
  };

  const copyResignList = async () => {
    const text = resignPeople
      .map((p) => {
        const hit = findRosterRow(p.name);
        return [p.name, p.date, hit?.site.label ?? "명단없음", p.events[p.events.length - 1].text.replace(/\n/g, " ")].join("\t");
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(`이름\t퇴사일\t현장\t카톡 공지\n${text}`);
      toast.success(`${resignPeople.length}명을 복사했습니다. 엑셀에 붙여넣으면 표로 들어갑니다.`);
    } catch {
      toast.error("복사에 실패했습니다.");
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-xs font-semibold text-slate-400 shadow-sm">
        관리자 로그인 후 지난 업로드 내역과 저장된 근태 기록을 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showUploads && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800"><History className="h-4 w-4" /> 업로드 내역</p>
            <span className="text-[11px] text-slate-400">"근태 기록 저장"을 누른 파일만 남습니다 (원문은 저장하지 않음)</span>
            {!room && (
              <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
                {[{ key: "all", label: "전체" }, ...KAKAO_ROOMS].map((r) => (
                  <button key={r.key} type="button" onClick={() => setRoomFilter(r.key)} className={`px-2.5 py-1 ${roomFilter === r.key ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>{r.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {uploads === null ? (
              <p className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중</p>
            ) : shownUploads.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">아직 저장한 업로드가 없습니다.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                  <tr><th className="px-3 py-2">저장</th><th className="px-3 py-2">공지방</th><th className="px-3 py-2">파일</th><th className="px-3 py-2">대화 기간</th><th className="px-3 py-2 text-right">근태</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownUploads.map((u) => (
                    <tr key={u.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatSavedAt(u.savedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-700">{roomLabel(u.room)}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-slate-700" title={u.fileName}>{u.chatTitle || u.fileName}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {u.firstDate} ~ {u.lastDate}
                        <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">{u.period}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-slate-700">{u.eventCount}건</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => { setMonth(u.months[u.months.length - 1] ?? month); if (!room) setRoomFilter(u.room); }} className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">기록 보기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
            <CalendarRange className="h-4 w-4" /> 저장된 근태 기록{room ? ` · ${roomLabel(room)}` : roomFilter !== "all" ? ` · ${roomLabel(roomFilter)}` : ""}
          </p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <button
            type="button"
            onClick={recleanMonth}
            disabled={recleaning || !events?.length}
            title="카톡 파일을 다시 올리지 않고, 저장된 기록의 이름·구분을 지금 규칙으로 다시 뽑습니다"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {recleaning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 다시 정리
          </button>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
            <button type="button" onClick={() => setView("list")} className={`px-2.5 py-1 ${view === "list" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>목록</button>
            <button type="button" onClick={() => setView("person")} className={`px-2.5 py-1 ${view === "person" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>사람별</button>
            <button type="button" onClick={() => setView("resign")} className={`inline-flex items-center gap-1 px-2.5 py-1 ${view === "resign" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>
              <UserMinus className="h-3.5 w-3.5" /> 퇴사자 {categoryCounts.resign ? `(${resignPeople.length})` : ""}
            </button>
          </div>
        </div>
        {view === "list" && (categories.length > 1 || unnamedEvents.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
            {[
              ["all", `전체 ${shownEvents.length}`] as const,
              ...categories.map((c) => [c, `${EVENT_CATEGORY_LABELS[c] ?? c} ${categoryCounts[c]}`] as const),
              ...(unnamedEvents.length ? [["noname", `이름 미확인 ${unnamedEvents.length}`] as const] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${categoryFilter === key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}
              >
                {label}
              </button>
            ))}
            {categoryFilter === "noname" && (
              <span className="text-[11px] text-slate-500">이름 칸에 직접 적으면(명단 이름 자동완성) 그 달 기록에 바로 저장되고 사람별·퇴사자 집계에도 들어갑니다.</span>
            )}
          </div>
        )}
        <datalist id="kakao-saved-roster-names">{rosterNames.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="max-h-[480px] overflow-y-auto">
          {events === null ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중</p>
          ) : shownEvents.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              {month} 에 저장된 근태 기록이 없습니다.
              <br />카톡 파일을 올려 "근태 기록 저장"을 누르면 그 달 기록이 여기 남아, 다음부터는 파일 없이도 볼 수 있습니다.
            </p>
          ) : view === "resign" ? (
            <div className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-xs font-extrabold text-slate-700">{month} 퇴사 공지 {resignPeople.length}명</p>
                <span className="text-[11px] text-slate-400">퇴사일은 가장 늦게 공지된 날짜입니다. 카톡 공지라 실제와 다를 수 있으니 근거를 보고 반영하세요.</span>
                {resignPeople.length > 0 && (
                  <button type="button" onClick={copyResignList} className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                    <Copy className="h-3 w-3" /> 복사 (엑셀 붙여넣기)
                  </button>
                )}
              </div>
              {resignPeople.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">{month} 에 저장된 퇴사 공지가 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {resignPeople.map((p) => {
                    const hit = findRosterRow(p.name);
                    const current = hit?.row.퇴사일 ?? "";
                    return (
                      <li key={p.name} className="rounded-xl border border-slate-200 p-2.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-sm font-extrabold text-slate-800">{p.name}</span>
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">퇴사일 {p.date}</span>
                          {hit ? <span className="text-slate-500">{hit.site.label}</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">명단에 없음</span>}
                          {current === p.date ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">명단 반영됨</span>
                          ) : current ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">명단 퇴사일 {current} (다름)</span>
                          ) : (
                            hit && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">명단 미반영</span>
                          )}
                          {isAdmin && hit && current !== p.date && (
                            <button type="button" disabled={applying === p.name} onClick={() => applyResignDate(p.name, p.date)} className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-40">
                              명단에 퇴사일 {p.date} {current ? "수정" : "입력"}
                            </button>
                          )}
                          {isAdmin && hit && current && (
                            <button type="button" disabled={applying === p.name} onClick={() => applyResignDate(p.name, "")} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                              퇴사일 지우기
                            </button>
                          )}
                        </div>
                        {p.events.map((e) => <Evidence key={e.id} event={e} />)}
                      </li>
                    );
                  })}
                </ul>
              )}
              {unnamedResign.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-xs font-extrabold text-amber-800">이름을 못 찾은 퇴사 공지 {unnamedResign.length}건</p>
                  <p className="mt-0.5 text-[11px] text-amber-700">명단에 없는 이름이거나 문장이 길어 못 집어낸 경우입니다. 근거를 보고 이름을 적으면 바로 위 퇴사자 명단으로 올라갑니다.</p>
                  <ul className="mt-2 space-y-2">
                    {unnamedResign.map((e) => (
                      <li key={e.id} className="rounded-lg border border-amber-200 bg-white p-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <NameInput
                            value={nameEdits[e.id] ?? ""}
                            missing
                            saving={savingName === e.id}
                            onChange={(v) => setNameEdits((prev) => ({ ...prev, [e.id]: v }))}
                            onCommit={(v) => saveEventName(e.id, v)}
                          />
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">퇴사일 {e.date}</span>
                        </div>
                        <Evidence event={e} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : view === "list" ? (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                <tr><th className="px-3 py-2">대상일</th><th className="px-3 py-2">대화방</th><th className="px-3 py-2">이름</th><th className="px-3 py-2">구분</th><th className="px-3 py-2">카톡 원문</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listEvents.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-xs text-slate-400">고른 구분에 해당하는 기록이 없습니다.</td></tr>}
                {listEvents.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-700">{e.date.slice(5)}</td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-slate-500" title={e.chat ?? e.room ?? ""}>{e.chat ?? e.room ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <NameInput
                        value={nameEdits[e.id] ?? e.name}
                        missing={!e.name}
                        saving={savingName === e.id}
                        onChange={(v) => setNameEdits((prev) => ({ ...prev, [e.id]: v }))}
                        onCommit={(v) => saveEventName(e.id, v)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{categoryBadge(e.category)}{e.cause && <span className="ml-1 text-[11px] text-slate-500">{e.cause}</span>}</td>
                    <td className="px-3 py-2 text-slate-600"><span className="mr-1 text-[10px] text-slate-400">{e.msgDate.slice(5)} {e.time} {e.sender}</span>{e.text.replace(/\n/g, " ")}</td>
                    <td className="px-2 py-2">
                      <button type="button" title="이 기록 지우기" disabled={savingName === e.id} onClick={() => deleteEvent(e)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                <tr><th className="px-3 py-2">이름</th>{categories.map((c) => <th key={c} className="px-3 py-2">{EVENT_CATEGORY_LABELS[c] ?? c}</th>)}<th className="px-3 py-2">합계</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.map((r) => (
                  <tr key={r.name}><td className="px-3 py-1.5 font-bold text-slate-700">{r.name}</td>{categories.map((c) => <td key={c} className="px-3 py-1.5">{r.counts[c] ?? ""}</td>)}<td className="px-3 py-1.5 font-bold">{r.total}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
