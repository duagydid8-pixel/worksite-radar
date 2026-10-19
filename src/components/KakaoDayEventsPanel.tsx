import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { loadKakaoEventsFS } from "@/lib/firestoreService";
import {
  EVENT_CATEGORY_LABELS,
  applyCauseToGasanReason,
  normalizeName,
  type KakaoEvent,
} from "@/lib/kakaoEvents";

interface RowLite {
  rowIndex: number;
  성명: string;
  xerpIn: string;
  xerpOut: string;
  가산사유: string;
  needsUpdate: boolean;
}

interface Props {
  workDate: string;
  rows: RowLite[];
  /** 공수 반영 화면의 이름 검색어 — 입력했을 때만 그 사람의 카톡 근태를 보여준다 */
  search: string;
  /** 해당 행의 가산사유를 바꾼다 */
  onApplyReason: (changes: { rowIndex: number; reason: string }[]) => void;
}

const categoryTone = (c: string) =>
  c === "punch" ? "bg-red-100 text-red-700" : c === "resign" || c === "newbie" ? "bg-violet-100 text-violet-700" : "bg-yellow-100 text-yellow-800";

/**
 * XERP 공수 반영 화면용: 이름을 검색하면 그 사람의 이번 달 카톡 근태 공지를 보여준다.
 * 선택한 날짜의 타각 문제는 가산사유에 원인(안전교육/xerp 오류 등)을 붙이는 버튼을 단다.
 */
export default function KakaoDayEventsPanel({ workDate, rows, search, onApplyReason }: Props) {
  const [monthEvents, setMonthEvents] = useState<KakaoEvent[]>([]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) { setMonthEvents([]); return; }
    let cancelled = false;
    const load = () => loadKakaoEventsFS<KakaoEvent>(workDate.slice(0, 7)).then((list) => {
      if (!cancelled) setMonthEvents(list);
    });
    load();
    // 카톡 정리 화면에서 새로 저장하면 다시 불러온다
    window.addEventListener("kakao-events-updated", load);
    return () => { cancelled = true; window.removeEventListener("kakao-events-updated", load); };
  }, [workDate]);

  const query = normalizeName(search);
  const withReason = useMemo(() => monthEvents.map((e) => {
    const row = e.date === workDate && e.name ? rows.find((r) => normalizeName(r.성명) === e.name) : undefined;
    const next = row && e.category === "punch" && e.cause && row.needsUpdate ? applyCauseToGasanReason(row.가산사유, e.cause) : null;
    return { event: e, row, nextReason: next && next !== row?.가산사유 ? next : null };
  }), [monthEvents, rows, workDate]);
  const items = useMemo(
    () => (query
      ? withReason.filter(({ event: e }) => e.name && e.name.includes(query)).sort((a, b) => (b.event.date + b.event.time).localeCompare(a.event.date + a.event.time))
      : []),
    [withReason, query],
  );
  // 선택일에 가산사유로 바로 반영할 수 있는 건 (같은 행은 마지막 것 하나만)
  const applicable = useMemo(() => {
    const byRow = new Map<number, string>();
    for (const i of withReason) if (i.row && i.nextReason) byRow.set(i.row.rowIndex, i.nextReason);
    return [...byRow].map(([rowIndex, reason]) => ({ rowIndex, reason }));
  }, [withReason]);
  const dayCount = monthEvents.filter((e) => e.date === workDate).length;

  if (!monthEvents.length) return null;

  // 검색 전: 한 줄 요약 + 일괄 반영만
  if (!query) {
    if (!dayCount) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50/70 px-4 py-2 text-xs">
        <MessageSquare className="h-3.5 w-3.5 text-yellow-600" />
        <span className="font-bold text-slate-700">선택일 카톡 근태 공지 {dayCount}건</span>
        <span className="text-slate-500">· 이름을 검색하면 내용이 보입니다</span>
        {applicable.length > 0 && (
          <button
            type="button"
            onClick={() => onApplyReason(applicable)}
            className="ml-auto rounded-md bg-slate-800 px-3 py-1 text-[11px] font-bold text-white hover:bg-slate-700"
          >
            가산사유에 카톡 원인 {applicable.length}명 모두 반영
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50/70 px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
        <MessageSquare className="h-3.5 w-3.5 text-yellow-600" />
        "{search.trim()}" 카톡 근태 공지 · {workDate.slice(0, 7)} {items.length ? `${items.length}건` : "없음"}
      </p>
      {items.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {items.map(({ event: e, row, nextReason }) => (
            <li key={e.id} className={`flex flex-wrap items-start gap-2 rounded-lg px-2 py-1.5 ${e.date === workDate ? "bg-white ring-1 ring-yellow-300" : ""}`}>
              <span className={`w-20 shrink-0 tabular-nums ${e.date === workDate ? "font-extrabold text-slate-900" : "text-slate-500"}`}>{e.date.slice(5)}{e.date === workDate && " (선택일)"}</span>
              <span className="w-14 shrink-0 font-bold text-slate-800">{e.name}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${categoryTone(e.category)}`}>{EVENT_CATEGORY_LABELS[e.category] ?? e.category}{e.cause ? ` · ${e.cause}` : ""}</span>
              <span className="min-w-0 flex-1 text-slate-600">{e.text.replace(/\n/g, " ")}</span>
              {nextReason && row && (
                <button type="button" onClick={() => onApplyReason([{ rowIndex: row.rowIndex, reason: nextReason }])} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100" title="가산사유에 반영">
                  가산사유 → {nextReason}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
