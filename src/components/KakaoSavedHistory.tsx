import { useEffect, useMemo, useState } from "react";
import { CalendarRange, History, Loader2 } from "lucide-react";
import { loadKakaoEventsFS, loadKakaoUploadLogFS, type KakaoUploadLogEntry } from "@/lib/firestoreService";
import { EVENT_CATEGORY_LABELS, KAKAO_ROOMS, summarizeEventsByPerson, type KakaoEvent } from "@/lib/kakaoEvents";

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
  const [view, setView] = useState<"list" | "person">("list");

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
          <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
            <button type="button" onClick={() => setView("list")} className={`px-2.5 py-1 ${view === "list" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>목록</button>
            <button type="button" onClick={() => setView("person")} className={`px-2.5 py-1 ${view === "person" ? "bg-slate-800 text-white" : "bg-white text-slate-500"}`}>사람별</button>
          </div>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {events === null ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중</p>
          ) : shownEvents.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">{month} 에 저장된 근태 기록이 없습니다.</p>
          ) : view === "list" ? (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                <tr><th className="px-3 py-2">대상일</th><th className="px-3 py-2">대화방</th><th className="px-3 py-2">이름</th><th className="px-3 py-2">구분</th><th className="px-3 py-2">카톡 원문</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownEvents.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-700">{e.date.slice(5)}</td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-slate-500" title={e.chat ?? e.room ?? ""}>{e.chat ?? e.room ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-800">{e.name || "이름?"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{categoryBadge(e.category)}{e.cause && <span className="ml-1 text-[11px] text-slate-500">{e.cause}</span>}</td>
                    <td className="px-3 py-2 text-slate-600"><span className="mr-1 text-[10px] text-slate-400">{e.msgDate.slice(5)} {e.time} {e.sender}</span>{e.text.replace(/\n/g, " ")}</td>
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
