import { useMemo, useRef, useState } from "react";
import { Clipboard, Download, FileText, MessageSquare, NotebookText, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  buildKakaoReply,
  extractLatestKakaoMessages,
  findManualMatches,
  normalizeManualEntries,
  type ManualEntry,
} from "@/lib/inquiryAssistant";
import { INQUIRY_MENU_OPTIONS, type InquiryMenu } from "@/lib/inquirySupport";

const MANUAL_STORAGE_KEY = "inquiry_manual_entries";

function loadManualEntries(): ManualEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANUAL_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? normalizeManualEntries(parsed as ManualEntry[]) : [];
  } catch {
    return [];
  }
}

function saveManualEntries(entries: ManualEntry[]) {
  localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(normalizeManualEntries(entries)));
}

interface InquirySupportProps {
  activeMenu?: InquiryMenu;
  onMenuChange?: (menu: InquiryMenu) => void;
}

export default function InquirySupport({ activeMenu: controlledActiveMenu, onMenuChange }: InquirySupportProps) {
  const [internalActiveMenu, setInternalActiveMenu] = useState<InquiryMenu>("kakao");
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>(() => loadManualEntries());
  const activeMenu = controlledActiveMenu ?? internalActiveMenu;
  const showInternalMenu = controlledActiveMenu === undefined;

  const handleMenuChange = (menu: InquiryMenu) => {
    if (onMenuChange) onMenuChange(menu);
    else setInternalActiveMenu(menu);
  };

  return (
    <div className="space-y-4">
      {showInternalMenu && (
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-1 sm:w-[320px]">
            {INQUIRY_MENU_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleMenuChange(option.value)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-extrabold transition-colors ${
                  activeMenu === option.value
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeMenu === "kakao" ? (
        <KakaoInquiryPanel manualEntries={manualEntries} />
      ) : (
        <ManualInquiryPanel manualEntries={manualEntries} onManualEntriesChange={setManualEntries} />
      )}
    </div>
  );
}

function KakaoInquiryPanel({ manualEntries }: { manualEntries: ManualEntry[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceText, setSourceText] = useState("");
  const [inquiryText, setInquiryText] = useState("");
  const [replyText, setReplyText] = useState("");
  const latestMessages = useMemo(() => extractLatestKakaoMessages(sourceText), [sourceText]);
  const matchedManuals = useMemo(() => findManualMatches(inquiryText || sourceText, manualEntries), [inquiryText, sourceText, manualEntries]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setSourceText(text);
      const messages = extractLatestKakaoMessages(text);
      setInquiryText(messages.join("\n"));
      toast.success(`${file.name} 대화 내용을 불러왔습니다.`);
    } catch {
      toast.error("카카오톡 대화 파일을 읽지 못했습니다.");
    }
  };

  const applyLatestMessages = () => {
    setInquiryText(latestMessages.join("\n"));
    if (latestMessages.length === 0) toast.error("추출할 문의 대화가 없습니다.");
  };

  const createReply = () => {
    const target = inquiryText.trim() || sourceText.trim();
    if (!target) {
      toast.error("문의 내용을 먼저 붙여넣거나 파일로 불러오세요.");
      return;
    }
    setReplyText(buildKakaoReply(target, manualEntries));
  };

  const copyReply = async () => {
    if (!replyText.trim()) {
      toast.error("복사할 답장 문구가 없습니다.");
      return;
    }
    await navigator.clipboard.writeText(replyText);
    toast.success("답장 문구를 복사했습니다.");
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100 text-yellow-700">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">카카오톡 문의</h2>
          <p className="text-sm font-semibold text-slate-400">카톡 문의 내용을 붙여넣고 답장 문구를 정리하는 공간입니다.</p>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".txt,.csv,.log" className="hidden" onChange={handleFileChange} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-slate-700"
        >
          <Download className="h-3.5 w-3.5" />
          카톡 대화파일 불러오기
        </button>
        <button
          type="button"
          onClick={applyLatestMessages}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600 transition-colors hover:bg-slate-50"
        >
          <FileText className="h-3.5 w-3.5" />
          최근 문의만 가져오기
        </button>
        <button
          type="button"
          onClick={createReply}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-emerald-700"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          답장 만들기
        </button>
        <button
          type="button"
          onClick={copyReply}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          <Clipboard className="h-3.5 w-3.5" />
          답장 복사
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-extrabold text-slate-500">카톡 대화 원문 / 붙여넣기</label>
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            className="min-h-[180px] w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-400 focus:bg-white"
            placeholder="카카오톡 대화 내용을 내려받아 불러오거나, 문의 내용을 여기에 붙여넣으세요."
          />
          <label className="block text-xs font-extrabold text-slate-500">답장할 문의 정리</label>
          <textarea
            value={inquiryText}
            onChange={(event) => setInquiryText(event.target.value)}
            className="min-h-[130px] w-full rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-400"
            placeholder="최근 문의만 가져오기 버튼을 누르거나, 답장할 내용을 직접 정리하세요."
          />
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-700">
              <NotebookText className="h-4 w-4" />
              매칭된 메뉴얼
            </div>
            {matchedManuals.length > 0 ? (
              <div className="space-y-2">
                {matchedManuals.map((manual) => (
                  <div key={manual.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-extrabold text-slate-900">{manual.title}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{manual.answer}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold leading-6 text-slate-400">매칭된 메뉴얼이 없습니다.</p>
            )}
          </div>
          <textarea
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
            className="min-h-[180px] w-full rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm font-bold leading-6 text-slate-900 outline-none focus:border-emerald-400 focus:bg-white"
            placeholder="답장 만들기 버튼을 누르면 카톡에 바로 붙여넣을 문구가 여기에 생성됩니다."
          />
        </div>
      </div>
    </section>
  );
}

function ManualInquiryPanel({
  manualEntries,
  onManualEntriesChange,
}: {
  manualEntries: ManualEntry[];
  onManualEntriesChange: (entries: ManualEntry[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [answer, setAnswer] = useState("");

  const updateManuals = (entries: ManualEntry[]) => {
    const normalized = normalizeManualEntries(entries);
    onManualEntriesChange(normalized);
    saveManualEntries(normalized);
  };

  const addManual = () => {
    const next = normalizeManualEntries([
      ...manualEntries,
      {
        id: `${Date.now()}`,
        title,
        keywords: [keywords],
        answer,
      },
    ]);
    if (next.length === manualEntries.length) {
      toast.error("제목과 답변 문구를 입력하세요.");
      return;
    }
    updateManuals(next);
    setTitle("");
    setKeywords("");
    setAnswer("");
    toast.success("메뉴얼 답변을 저장했습니다.");
  };

  const removeManual = (id: string) => {
    updateManuals(manualEntries.filter((entry) => entry.id !== id));
    toast.success("메뉴얼 답변을 삭제했습니다.");
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <NotebookText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">메뉴얼</h2>
          <p className="text-sm font-semibold text-slate-400">자주 오는 문의와 표준 답변을 정리하는 공간입니다.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
            placeholder="제목 예: 신규자 교육 장소"
          />
          <input
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400"
            placeholder="키워드 예: 신규자, 교육, 장소"
          />
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="min-h-[120px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 outline-none focus:border-slate-400"
            placeholder="답장 문구를 입력하세요."
          />
          <button
            type="button"
            onClick={addManual}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" />
            메뉴얼 저장
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <Save className="h-4 w-4" />
            저장된 메뉴얼 {manualEntries.length}개
          </div>
          {manualEntries.length > 0 ? (
            <div className="space-y-2">
              {manualEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold text-slate-950">{entry.title}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">{entry.keywords.join(", ")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeManual(entry.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      title="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{entry.answer}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-semibold leading-6 text-slate-400">
              자주 쓰는 답변 양식과 현장별 안내 문구를 저장하면 카카오톡 답장 만들기에서 자동으로 매칭됩니다.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
