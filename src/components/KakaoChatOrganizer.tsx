import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Loader2, Copy, Download, FileText, Link2, MessageSquare, Search, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { parseKakaoZip } from "@/lib/kakaoZip";
import {
  ATTENDANCE_CATEGORIES,
  PUNCH_PROBLEM_CATEGORY,
  categoryCounts,
  URL_RE,
  filterKakaoMessages,
  formatKakaoText,
  parseKakaoChat,
  pickImportant,
  summarizeKakao,
  type ImportantMessage,
  type KakaoFilter,
  type KakaoMessage,
  type KakaoParseResult,
} from "@/lib/kakaoChat";

const KakaoAttendancePanel = lazy(() => import("./KakaoAttendancePanel"));
const KakaoSavedHistoryLazy = lazy(() => import("./KakaoSavedHistory"));

const EMPTY_FILTER: KakaoFilter = { sender: "", keyword: "", from: "", to: "", onlyLinks: false, onlyFiles: false, hideMedia: true };
const PREF_KEY = "kakao_organizer_prefs";

const ALL_CATEGORIES = [PUNCH_PROBLEM_CATEGORY, ...ATTENDANCE_CATEGORIES].map(({ key, label }) => ({ key, label }));

function loadPrefs(): { disabled: string[]; extra: string } {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { disabled: [], extra: "", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { disabled: [], extra: "" };
}

function minutesOf(m: KakaoMessage) {
  return new Date(`${m.date}T${m.time}:00`).getTime() / 60000;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${date} (${WEEKDAYS[d.getDay()]})`;
}

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const kw = keyword.trim();
  if (!kw) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = kw.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(needle, i);
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={idx} className="rounded bg-yellow-200 px-0.5">{text.slice(idx, idx + kw.length)}</mark>);
    i = idx + kw.length;
    idx = lower.indexOf(needle, i);
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

function MessageText({ text, keyword }: { text: string; keyword: string }) {
  const pieces = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {pieces.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline">{p}</a>
        ) : (
          <Highlight key={i} text={p} keyword={keyword} />
        ),
      )}
    </>
  );
}

export default function KakaoChatOrganizer({ isAdmin = false }: { isAdmin?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<KakaoParseResult | null>(null);
  const [filter, setFilter] = useState<KakaoFilter>(EMPTY_FILTER);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [unmatchedImages, setUnmatchedImages] = useState<string[]>([]);
  const [withPhotos, setWithPhotos] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [mode, setMode] = useState<"중요" | "전체">("중요");
  const [view, setView] = useState<"대화" | "링크">("대화");
  const [tab, setTab] = useState<"근태" | "메시지">("근태");

  const messages = useMemo(() => parsed?.messages ?? [], [parsed]);
  const summary = useMemo(() => summarizeKakao(messages), [messages]);
  const filtered = useMemo(() => filterKakaoMessages(messages, filter), [messages, filter]);
  const importantOpts = useMemo(
    () => ({
      enabled: ALL_CATEGORIES.map((c) => c.key).filter((k) => !prefs.disabled.includes(k)),
      extraKeywords: prefs.extra.split(/[,\n]/).map((k) => k.trim()).filter(Boolean),
    }),
    [prefs],
  );
  const counts = useMemo(
    () => categoryCounts(filtered, { ...importantOpts, enabled: ALL_CATEGORIES.map((c) => c.key) }),
    [filtered, importantOpts],
  );
  const shown = useMemo<(KakaoMessage & Partial<ImportantMessage>)[]>(() => {
    if (mode === "전체") return filtered;
    const important = pickImportant(filterKakaoMessages(messages, { ...filter, hideMedia: false }), importantOpts);
    if (!withPhotos) return important;
    // 중요 메시지 직전 1분~직후 5분 사이에 올라온 사진도 함께 보여준다
    const marks = important.map(minutesOf);
    const have = new Set<KakaoMessage>(important);
    const photos = messages.filter((m) => {
      if (!m.images?.length || have.has(m)) return false;
      if (filter.sender && m.sender !== filter.sender) return false;
      const t = minutesOf(m);
      return marks.some((x) => t >= x - 1 && t <= x + 5);
    });
    return [...important, ...photos].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [filtered, messages, filter, mode, importantOpts, withPhotos]);
  const grouped = useMemo(() => {
    const map = new Map<string, (KakaoMessage & Partial<ImportantMessage>)[]>();
    for (const m of shown) {
      const arr = map.get(m.date);
      if (arr) arr.push(m);
      else map.set(m.date, [m]);
    }
    return [...map.entries()];
  }, [shown]);
  const links = useMemo(
    () => shown.flatMap((m) => (m.text.match(URL_RE) ?? []).map((url) => ({ url, date: m.date, time: m.time, sender: m.sender }))),
    [shown],
  );

  const updatePrefs = (p: Partial<typeof prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const isZip = /\.zip$/i.test(file.name);
      const result = isZip ? await parseKakaoZip(file) : parseKakaoChat(await file.text());
      setUnmatchedImages(isZip ? (result as Awaited<ReturnType<typeof parseKakaoZip>>).unmatchedImages : []);
      if (result.messages.length === 0) {
        toast.error("카카오톡 대화 형식을 찾지 못했습니다. 대화 내보내기(.txt 또는 .zip) 파일인지 확인하세요.");
        return;
      }
      setParsed(result);
      setFileName(file.name);
      setFilter(EMPTY_FILTER);
      toast.success(`${result.messages.length.toLocaleString()}개의 메시지를 정리했습니다.`);
    } catch {
      toast.error("파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(formatKakaoText(shown));
      toast.success(`${shown.length.toLocaleString()}개 메시지를 복사했습니다.`);
    } catch {
      toast.error("복사에 실패했습니다.");
    }
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const rows = shown.map((m) => ({ 날짜: m.date, 시간: m.time, 보낸사람: m.sender, 내용: m.text }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "대화내용");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summary.senders.map(([name, count]) => ({ 보낸사람: name, 메시지수: count }))),
      "발언통계",
    );
    if (links.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(links.map((l) => ({ 날짜: l.date, 시간: l.time, 보낸사람: l.sender, 링크: l.url }))),
        "링크모음",
      );
    }
    XLSX.writeFile(wb, `${(parsed?.chatTitle || "카톡대화").replace(/[\\/:*?"<>|]/g, "_")}_정리.xlsx`);
  };

  const patch = (p: Partial<KakaoFilter>) => setFilter((f) => ({ ...f, ...p }));
  const maxHour = Math.max(1, ...summary.byHour);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 md:p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-800">
              <MessageSquare className="h-5 w-5 text-yellow-500" /> 카톡 대화 정리
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              카카오톡 &gt; 채팅방 메뉴 &gt; 대화 내보내기로 저장한 .txt(사진까지 보려면 사진 포함 .zip) 파일을 올리세요. 파일은 브라우저 안에서만 처리됩니다. "근태 기록 저장"을 누르면 근태 관련 건만 클라우드에 남고, AI 분석을 쓸 때만 텍스트가 Anthropic으로 전송됩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} type="file" accept=".txt,.zip,text/plain,application/zip" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-bold text-white hover:bg-slate-700">
              <Upload className="h-4 w-4" /> {parsed ? "다른 파일" : "파일 올리기"}
            </button>
            {parsed && (
              <button type="button" onClick={() => { setParsed(null); setFileName(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <Trash2 className="h-4 w-4" /> 지우기
              </button>
            )}
          </div>
        </div>

        {!parsed && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className="mt-4 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 py-14 text-center text-sm text-slate-400 hover:border-slate-400 hover:bg-slate-50"
          >
            여기에 카톡 대화 .txt 또는 사진 포함 .zip 파일을 끌어다 놓거나 클릭해서 선택하세요
          </div>
        )}
      </div>

      {/* 파일을 올리기 전: 지난 업로드 내역과 저장된 근태 기록 */}
      {!parsed && (
        <Suspense fallback={null}>
          <KakaoSavedHistoryLazy isAdmin={isAdmin} />
        </Suspense>
      )}

      {parsed && (
        <>
          <div className="flex gap-1.5">
            {([
              ["근태", "근태 정리 (추천)"],
              ["메시지", "메시지 전체 보기"],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3.5 py-2 text-sm font-bold ${tab === key ? "bg-yellow-400 text-slate-900" : "border border-slate-200 bg-white text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "근태" && (
            <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}>
              <KakaoAttendancePanel key={fileName} messages={messages} isAdmin={isAdmin} chatName={`${parsed.chatTitle} ${fileName}`} fileName={fileName} chatTitle={parsed.chatTitle} />
            </Suspense>
          )}
          {tab === "메시지" && (
          <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { label: "대화방", value: parsed.chatTitle || fileName },
              { label: "기간", value: summary.dates.length ? `${summary.dates[0][0]} ~ ${summary.dates[summary.dates.length - 1][0]}` : "-" },
              { label: "메시지", value: `${messages.length.toLocaleString()}개` },
              { label: "참여자", value: `${summary.senders.length}명` },
              { label: "링크 · 파일 · 사진", value: `${summary.links} · ${summary.files} · ${summary.media}` },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-[11px] font-bold text-slate-400">{c.label}</p>
                <p className="mt-0.5 truncate text-sm font-extrabold text-slate-800">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-700"><Users className="h-4 w-4" /> 발언 많은 순 (클릭하면 해당 사람만 보기)</p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {summary.senders.map(([name, count]) => (
                  <button key={name} type="button" onClick={() => patch({ sender: filter.sender === name ? "" : name })} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-slate-50 ${filter.sender === name ? "bg-yellow-50 font-bold" : ""}`}>
                    <span className="w-24 shrink-0 truncate">{name}</span>
                    <span className="h-2 rounded bg-yellow-400" style={{ width: `${(count / summary.senders[0][1]) * 60}%`, minWidth: 2 }} />
                    <span className="text-slate-500">{count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-extrabold text-slate-700">시간대별 메시지</p>
              <div className="flex h-36 items-end gap-0.5">
                {summary.byHour.map((c, h) => (
                  <div key={h} className="flex h-full flex-1 flex-col items-center justify-end" title={`${h}시 ${c}개`}>
                    <div className="w-full rounded-t bg-slate-700" style={{ height: `${(c / maxHour) * 85}%` }} />
                    <span className="mt-1 text-[9px] text-slate-400">{h}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-yellow-200 bg-yellow-50/60 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-yellow-300 bg-white text-sm font-bold">
                {(["중요", "전체"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`px-3.5 py-1.5 ${mode === m ? "bg-yellow-400 text-slate-900" : "text-slate-500"}`}>
                    {m === "중요" ? "★ 중요한 것만" : "전체 보기"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[11px] font-bold text-slate-500">볼 항목 (눌러서 켜고 끄기)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ALL_CATEGORIES.map((c) => {
                const on = !prefs.disabled.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => updatePrefs({ disabled: on ? [...prefs.disabled, c.key] : prefs.disabled.filter((k) => k !== c.key) })}
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${on ? "border-yellow-400 bg-yellow-300 text-slate-900" : "border-slate-200 bg-white text-slate-400"}`}
                  >
                    {c.label} <span className="font-normal">{counts[c.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <label className="mt-3 block text-[11px] font-bold text-slate-500">
              추가로 볼 단어 (쉼표로 구분, 선택)
              <input value={prefs.extra} onChange={(e) => updatePrefs({ extra: e.target.value })} placeholder="예: 안전모, 출입증" className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-normal outline-none focus:border-slate-400" />
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input value={filter.keyword} onChange={(e) => patch({ keyword: e.target.value })} placeholder="검색어" className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-slate-400" />
              </div>
              <select value={filter.sender} onChange={(e) => patch({ sender: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
                <option value="">전체 참여자</option>
                {summary.senders.map(([n]) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input type="date" value={filter.from} onChange={(e) => patch({ from: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-2 text-sm" />
              <span className="text-slate-400">~</span>
              <input type="date" value={filter.to} onChange={(e) => patch({ to: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-2 text-sm" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> 중요 메시지 근처 사진 함께 보기</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={filter.hideMedia} onChange={(e) => patch({ hideMedia: e.target.checked })} /> 사진·이모티콘 숨기기</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={filter.onlyLinks} onChange={(e) => patch({ onlyLinks: e.target.checked })} /> 링크 포함만</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={filter.onlyFiles} onChange={(e) => patch({ onlyFiles: e.target.checked })} /> 파일 첨부만</label>
              <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className="font-bold text-slate-500 underline">필터 초기화</button>
              <span className="ml-auto font-bold text-slate-700">{shown.length.toLocaleString()}개 표시 <span className="font-normal text-slate-400">/ {filtered.length.toLocaleString()}</span></span>
              <button type="button" onClick={copyText} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> 복사</button>
              <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 font-bold text-white hover:bg-emerald-700"><Download className="h-3.5 w-3.5" /> 엑셀 저장</button>
            </div>
          </div>

          <div className="flex gap-1.5">
            {(["대화", "링크"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${view === v ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                {v === "대화" ? <FileText className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {v === "링크" ? `링크 모음 (${links.length})` : "날짜별 대화"}
              </button>
            ))}
          </div>

          {view === "대화" ? (
            <div className="space-y-4">
              {grouped.length === 0 && <p className="py-10 text-center text-sm text-slate-400">조건에 맞는 메시지가 없습니다. (중요 모드라면 "전체 보기"로 바꾸거나 볼 항목을 확인하세요)</p>}
              {grouped.slice(0, 200).map(([date, msgs]) => (
                <div key={date} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between rounded-t-2xl bg-slate-50 px-4 py-2 text-xs font-extrabold text-slate-600">
                    <span>{dayLabel(date)}</span><span className="font-medium text-slate-400">{msgs.length}개</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {msgs.map((m, i) => (
                      <div key={i} className="flex gap-3 px-4 py-2 text-sm">
                        <span className="w-12 shrink-0 pt-0.5 text-[11px] text-slate-400">{m.time}</span>
                        <span className="w-20 shrink-0 truncate font-bold text-slate-700">{m.sender}</span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-800">
                          <MessageText text={m.text} keyword={filter.keyword} />
                          {m.images && m.images.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              {m.images.map((u) => (
                                <img key={u} src={u} alt="첨부 사진" loading="lazy" onClick={() => setLightbox(u)} className="h-24 w-24 cursor-zoom-in rounded-md border border-slate-200 object-cover" />
                              ))}
                            </span>
                          )}
                          {m.tags && m.tags.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {m.reason && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{m.reason}</span>}
                              {m.tags.map((r) => <span key={r} className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-bold text-yellow-800">{r}</span>)}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {grouped.length > 200 && <p className="py-2 text-center text-xs text-slate-400">화면에는 앞 200일치만 표시됩니다. 전체는 복사/엑셀 저장으로 받으세요.</p>}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {links.length === 0 && <p className="py-10 text-center text-sm text-slate-400">링크가 없습니다.</p>}
              {links.map((l, i) => (
                <div key={i} className="flex gap-3 px-4 py-2 text-sm">
                  <span className="w-32 shrink-0 text-[11px] text-slate-400">{l.date} {l.time}</span>
                  <span className="w-20 shrink-0 truncate font-bold text-slate-700">{l.sender}</span>
                  <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all text-blue-600 underline">{l.url}</a>
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </>
      )}
      {unmatchedImages.length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-bold text-slate-600">대화와 연결하지 못한 사진 {unmatchedImages.length}장</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {unmatchedImages.map((u) => (
              <img key={u} src={u} alt="사진" loading="lazy" onClick={() => setLightbox(u)} className="h-24 w-24 cursor-zoom-in rounded-md border border-slate-200 object-cover" />
            ))}
          </div>
        </details>
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="확대 사진" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
