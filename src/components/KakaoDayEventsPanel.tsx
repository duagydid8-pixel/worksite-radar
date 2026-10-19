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
  /** 해당 행의 가산사유를 바꾼다 */
  onApplyReason: (changes: { rowIndex: number; reason: string }[]) => void;
}

/** XERP 공수 반영 화면용: 선택한 날짜에 저장된 카톡 근태 이벤트를 보여주고 가산사유에 원인을 붙인다. */
export default function KakaoDayEventsPanel({ workDate, rows, onApplyReason }: Props) {
  const [events, setEvents] = useState<KakaoEvent[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) { setEvents([]); return; }
    let cancelled = false;
    loadKakaoEventsFS<KakaoEvent>(workDate.slice(0, 7)).then((list) => {
      if (!cancelled) setEvents(list.filter((e) => e.date === workDate));
    });
    return () => { cancelled = true; };
  }, [workDate]);

  const items = useMemo(() => events.map((e) => {
    const row = e.name ? rows.find((r) => normalizeName(r.성명) === e.name) : undefined;
    const nextReason = row && e.category === "punch" && e.cause && row.needsUpdate
      ? applyCauseToGasanReason(row.가산사유, e.cause)
      : null;
    return { event: e, row, nextReason: nextReason && nextReason !== row?.가산사유 ? nextReason : null };
  }), [events, rows]);

  if (!events.length) return null;
  const applicable = items.filter((i) => i.row && i.nextReason);

  return (
    <div className="rounded-2xl border border-yellow-200 bg-yellow-50/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
          <MessageSquare className="h-4 w-4 text-yellow-600" /> 카톡 근태 특이사항 {events.length}건 ({workDate})
        </button>
        {applicable.length > 0 && (
          <button
            type="button"
            onClick={() => onApplyReason(applicable.map((i) => ({ rowIndex: i.row!.rowIndex, reason: i.nextReason! })))}
            className="ml-auto rounded-md bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700"
          >
            가산사유에 카톡 원인 {applicable.length}건 모두 반영
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5 text-xs">
          {items.map(({ event: e, row, nextReason }) => (
            <li key={e.id} className="flex flex-wrap items-start gap-2">
              <span className="w-20 shrink-0 font-bold text-slate-800">{e.room && <span className="mr-1 text-[10px] font-medium text-slate-400">{e.room}</span>}{e.name || "이름?"}</span>
              <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{EVENT_CATEGORY_LABELS[e.category] ?? e.category}</span>
              <span className="min-w-0 flex-1 text-slate-600">{e.text.replace(/\n/g, " ")}</span>
              {!row && e.name && <span className="text-[10px] text-slate-400">이 날짜 공수 데이터에 없음</span>}
              {row && nextReason && (
                <button type="button" onClick={() => onApplyReason([{ rowIndex: row.rowIndex, reason: nextReason }])} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100" title={nextReason}>
                  → {nextReason}
                </button>
              )}
              {row && !nextReason && e.category === "punch" && <span className="text-[10px] text-slate-400">{row.needsUpdate ? "이미 반영됨" : "가산 대상 아님"}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
