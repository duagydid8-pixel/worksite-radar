import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, Upload, X, ChevronDown, ChevronUp, Scissors, Loader2, Download, Trash2, ExternalLink, Plus, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadContractsFS, uploadContractsBatchFS, deleteContractFS } from "@/lib/firestoreService";
import type { ContractMeta } from "@/lib/firestoreService";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ── 이름 추출 패턴 ────────────────────────────────────
function extractNameFromText(text: string): string {
  const patterns = [
    /근로자\s*[\(（]?을[\)）]?\s*[:：]?\s*([가-힣]{2,5})/,
    /성\s*명\s*[:：]?\s*([가-힣]{2,5})/,
    /성명\s*[:：]?\s*([가-힣]{2,5})/,
    /이\s*름\s*[:：]?\s*([가-힣]{2,5})/,
    /을\s*[:：]\s*([가-힣]{2,5})/,
    /서\s*명\s*[:：]?\s*([가-힣]{2,5})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

interface PageThumb { pageNum: number; dataUrl: string; }

interface ContractSection {
  id: string;
  name: string;
  ocrName: string;    // 자동 추출된 이름
  ocrStatus: "idle" | "running" | "done" | "none";
  startPage: number;
  endPage: number;
}

interface PreviewState {
  pageNum: number;
  thumbDataUrl: string;   // 저해상도 (즉시 표시)
  hiResDataUrl: string | null; // 고해상도 (비동기 로딩)
  hiResLoading: boolean;
}

interface Props {
  isAdmin: boolean;
  employeeNames?: string[];
}

export default function ContractUploadPanel({ isAdmin, employeeNames = [] }: Props) {
  const [open, setOpen]             = useState(false);
  const [thumbs, setThumbs]         = useState<PageThumb[]>([]);
  const [sections, setSections]     = useState<ContractSection[]>([]);
  const [pdfBytes, setPdfBytes]     = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState({ done: 0, total: 0 });
  const [savedContracts, setSavedContracts] = useState<ContractMeta[]>([]);
  const [showSaved, setShowSaved]   = useState(false);
  const [preview, setPreview]       = useState<PreviewState | null>(null);

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  const refreshContracts = useCallback(async () => {
    const list = await loadContractsFS();
    setSavedContracts(list.sort((a, b) => a.name.localeCompare(b.name, "ko")));
  }, []);

  useEffect(() => { if (open) refreshContracts(); }, [open, refreshContracts]);

  // ── 페이지 OCR (텍스트 레이어 추출) ──────────────────
  const extractNameFromPage = useCallback(async (pageNum: number): Promise<string> => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc) return "";
    try {
      const page    = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const text    = content.items.map((it: unknown) => (it as { str: string }).str).join(" ");
      return extractNameFromText(text);
    } catch {
      return "";
    }
  }, []);

  // ── 특정 페이지 고해상도 렌더링 ───────────────────────
  const renderHiRes = useCallback(async (pageNum: number): Promise<string> => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc) return "";
    const page     = await pdfDoc.getPage(pageNum);
    const scale    = 2.2;
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement("canvas");
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  // ── OCR 실행 후 섹션 이름 자동 입력 ──────────────────
  const runOcrForSection = useCallback(async (sectionId: string, pageNum: number) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, ocrStatus: "running" } : s));
    const name = await extractNameFromPage(pageNum);
    setSections(prev => prev.map(s =>
      s.id === sectionId
        ? { ...s, ocrStatus: name ? "done" : "none", ocrName: name, name: name || s.name }
        : s
    ));
  }, [extractNameFromPage]);

  // ── PDF 업로드 ────────────────────────────────────────
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("PDF 파일만 업로드할 수 있습니다.");
      return;
    }

    setIsRendering(true);
    setRenderProgress(0);
    setThumbs([]);
    setSections([]);

    try {
      const buffer = await file.arrayBuffer();
      setPdfBytes(buffer);

      const pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      pdfDocRef.current = pdfDoc;
      const count = pdfDoc.numPages;
      setTotalPages(count);

      const firstSectionId = crypto.randomUUID();
      setSections([{ id: firstSectionId, name: "", ocrName: "", ocrStatus: "idle", startPage: 1, endPage: count }]);

      // 썸네일 렌더링 — 페이지마다 즉시 화면에 추가 (스트리밍)
      for (let i = 1; i <= count; i++) {
        const page     = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 0.35 });
        const canvas   = document.createElement("canvas");
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
        setThumbs(prev => [...prev, { pageNum: i, dataUrl }]);
        setRenderProgress(Math.round((i / count) * 100));
      }

      // 첫 섹션 OCR (렌더링 완료 후 비동기)
      runOcrForSection(firstSectionId, 1);
    } catch {
      toast.error("PDF를 읽는 중 오류가 발생했습니다.");
    } finally {
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  // ── 구간 분리 ─────────────────────────────────────────
  const splitAt = (pageNum: number) => {
    setSections(prev => {
      const idx = prev.findIndex(s => s.startPage <= pageNum && pageNum <= s.endPage);
      if (idx === -1 || pageNum === prev[idx].startPage) return prev;
      const target = prev[idx];
      const before: ContractSection = { ...target, endPage: pageNum - 1 };
      const newId = crypto.randomUUID();
      const after: ContractSection  = {
        id: newId, name: "", ocrName: "", ocrStatus: "idle",
        startPage: pageNum, endPage: target.endPage,
      };
      const next = [...prev.slice(0, idx), before, after, ...prev.slice(idx + 1)];
      // 새 구간 OCR 자동 실행
      setTimeout(() => runOcrForSection(newId, pageNum), 0);
      return next;
    });
  };

  const mergeSection = (id: string) => {
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === 0) return prev;
      const merged: ContractSection = { ...prev[idx - 1], endPage: prev[idx].endPage };
      return [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 1)];
    });
  };

  const updateName = (id: string, name: string) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, name } : s));

  // ── 썸네일 클릭 → 고해상도 모달 ─────────────────────
  const openPreview = async (thumb: PageThumb) => {
    setPreview({ pageNum: thumb.pageNum, thumbDataUrl: thumb.dataUrl, hiResDataUrl: null, hiResLoading: true });
    const hiRes = await renderHiRes(thumb.pageNum);
    setPreview(p => p?.pageNum === thumb.pageNum ? { ...p, hiResDataUrl: hiRes, hiResLoading: false } : p);
  };

  const navigatePreview = async (pageNum: number) => {
    const thumb = thumbs.find(t => t.pageNum === pageNum);
    if (!thumb) return;
    setPreview({ pageNum, thumbDataUrl: thumb.dataUrl, hiResDataUrl: null, hiResLoading: true });
    const hiRes = await renderHiRes(pageNum);
    setPreview(p => p?.pageNum === pageNum ? { ...p, hiResDataUrl: hiRes, hiResLoading: false } : p);
  };

  // ── 분리 저장 (병렬 처리) ────────────────────────────
  const handleSplit = async () => {
    if (!pdfBytes) return;
    const unnamed = sections.filter(s => !s.name.trim());
    if (unnamed.length > 0) { toast.error(`이름이 비어있는 구간이 ${unnamed.length}개 있습니다.`); return; }
    const dups = sections.map(s => s.name.trim()).filter((n, i, arr) => arr.indexOf(n) !== i);
    if (dups.length > 0) { toast.error(`중복 이름: ${[...new Set(dups)].join(", ")}`); return; }

    setIsSplitting(true);
    setSplitProgress({ done: 0, total: sections.length });
    try {
      const src = await PDFDocument.load(pdfBytes);

      // 1. PDF 분리 전부 병렬
      const splitItems = await Promise.all(
        sections.map(async s => {
          const newPdf  = await PDFDocument.create();
          const indices = Array.from({ length: s.endPage - s.startPage + 1 }, (_, i) => s.startPage - 1 + i);
          const pages   = await newPdf.copyPages(src, indices);
          pages.forEach(p => newPdf.addPage(p));
          const bytes = await newPdf.save();
          setSplitProgress(p => ({ ...p, done: p.done + 1 }));
          return { name: s.name.trim(), pdfBytes: bytes, pageCount: indices.length };
        })
      );

      // 2. Storage 업로드 병렬 + Firestore 1회 쓰기
      setSplitProgress({ done: 0, total: sections.length }); // 업로드 단계 리셋
      const { success, failed } = await uploadContractsBatchFS(splitItems);

      if (failed.length > 0) toast.error(`저장 실패: ${failed.join(", ")}`);
      if (success.length > 0) {
        toast.success(`${success.length}명 근로계약서 저장 완료`);
        await refreshContracts();
        setShowSaved(true);
        setThumbs([]); setSections([]); setPdfBytes(null); setTotalPages(0);
        pdfDocRef.current = null;
      }
    } catch (err) {
      toast.error("분리 중 오류: " + String(err));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`${name}의 근로계약서를 삭제하시겠습니까?`)) return;
    const ok = await deleteContractFS(name);
    if (ok) { toast.success(`${name} 계약서 삭제됨`); await refreshContracts(); }
    else toast.error("삭제 실패");
  };

  const getSectionForPage = (n: number) => sections.find(s => s.startPage <= n && n <= s.endPage);
  const COLORS = [
    "border-blue-300 bg-blue-50", "border-emerald-300 bg-emerald-50",
    "border-violet-300 bg-violet-50", "border-amber-300 bg-amber-50",
    "border-rose-300 bg-rose-50", "border-cyan-300 bg-cyan-50",
    "border-orange-300 bg-orange-50", "border-teal-300 bg-teal-50",
  ];
  const getSectionColor = (id: string) => COLORS[sections.findIndex(s => s.id === id) % COLORS.length];

  const canSave = thumbs.length > 0 && sections.length > 0 && sections.every(s => s.name.trim());
  const hasUnnamed = thumbs.length > 0 && sections.some(s => !s.name.trim());

  if (!isAdmin) return null;

  return (
    <>
      {/* ── 고해상도 미리보기 모달 ── */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPreview(null)}>
          <div className="relative bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-bold text-gray-700">{preview.pageNum}페이지 미리보기</span>
              <div className="flex items-center gap-2">
                <button disabled={preview.pageNum <= 1} onClick={() => navigatePreview(preview.pageNum - 1)}
                  className="px-2 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30">← 이전</button>
                <button disabled={preview.pageNum >= totalPages} onClick={() => navigatePreview(preview.pageNum + 1)}
                  className="px-2 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30">다음 →</button>
                <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </div>
            </div>

            {/* 이미지 영역 */}
            <div className="overflow-auto max-h-[72vh] flex items-center justify-center bg-gray-100 relative min-h-[200px]">
              {/* 저해상도 → 고해상도 교체 */}
              <img
                src={preview.hiResDataUrl ?? preview.thumbDataUrl}
                alt={`page ${preview.pageNum}`}
                className={`max-w-full h-auto shadow-md rounded transition-opacity duration-300 ${preview.hiResLoading ? "opacity-40" : "opacity-100"}`}
              />
              {preview.hiResLoading && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-gray-500 text-xs">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  고해상도 렌더링 중...
                </div>
              )}
            </div>

            {/* 분리 버튼 */}
            {preview.pageNum > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
                <button
                  onClick={() => { splitAt(preview.pageNum); setPreview(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {preview.pageNum}p부터 새 계약서로 분리
                </button>
                <span className="text-[11px] text-gray-400">이름 확인 후 구간을 나눠주세요</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 하단 고정 저장 바 ── */}
      {(canSave || hasUnnamed || isSplitting) && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-4 px-6 py-3 bg-white border-t-2 border-rose-300 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
          {/* 좌: 구간 요약 */}
          <div className="flex items-center gap-2 overflow-x-auto shrink-0 max-w-[60%]">
            {sections.map((s, i) => (
              <span key={s.id} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border whitespace-nowrap ${getSectionColor(s.id)}`}>
                <span className="text-gray-400">{i + 1}.</span>
                {s.name || <span className="text-rose-400">이름 없음</span>}
                <span className="text-gray-400 font-normal">{s.startPage}~{s.endPage}p</span>
              </span>
            ))}
          </div>

          {/* 우: 저장 버튼 */}
          <div className="flex items-center gap-3 shrink-0">
            {isSplitting && (
              <div className="flex flex-col items-end gap-0.5 min-w-[140px]">
                <div className="w-full h-1.5 bg-rose-100 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full transition-all duration-300"
                    style={{ width: splitProgress.total > 0 ? `${(splitProgress.done / splitProgress.total) * 100}%` : "5%" }} />
                </div>
                <span className="text-[10px] text-rose-500">
                  {splitProgress.done < sections.length
                    ? `PDF 분리 ${splitProgress.done}/${splitProgress.total}`
                    : "Storage 업로드 중..."}
                </span>
              </div>
            )}
            {hasUnnamed && !isSplitting && (
              <span className="text-xs text-rose-500 font-semibold">이름을 모두 입력해주세요</span>
            )}
            <button
              onClick={handleSplit}
              disabled={isSplitting || !canSave}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 active:bg-rose-800 transition-colors disabled:opacity-40 shadow-lg"
            >
              {isSplitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {isSplitting ? "저장 중..." : `저장 (${sections.length}명)`}
            </button>
          </div>
        </div>
      )}

      {/* ── 패널 본체 ── */}
      <div className="rounded-xl border border-rose-200 bg-rose-50 shrink-0">
        {/* 헤더 */}
        <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(v => !v)}>
          <FileText className="h-4 w-4 text-rose-600 shrink-0" />
          <span className="text-xs font-bold text-rose-800 flex-1">근로계약서 관리</span>
          {savedContracts.length > 0 && (
            <span className="text-[11px] font-semibold text-rose-600 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-full">
              {savedContracts.length}명 저장됨
            </span>
          )}
          {open ? <ChevronUp className="h-4 w-4 text-rose-400" /> : <ChevronDown className="h-4 w-4 text-rose-400" />}
        </button>

        {open && (
          <div className="border-t border-rose-200 px-4 py-4 flex flex-col gap-4">

            {/* 업로드 버튼 */}
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
              <button onClick={() => fileRef.current?.click()} disabled={isRendering}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">
                {isRendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {isRendering ? "렌더링 중..." : "PDF 업로드"}
              </button>
              <span className="text-[11px] text-rose-600">썸네일 클릭 시 고해상도로 이름 확인 가능 · 텍스트 PDF는 이름 자동 추출</span>
              {savedContracts.length > 0 && (
                <button onClick={() => setShowSaved(v => !v)}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors">
                  <FileText className="h-3.5 w-3.5" />
                  {showSaved ? "목록 닫기" : `저장된 계약서 (${savedContracts.length}명)`}
                </button>
              )}
            </div>

            {/* 저장된 계약서 목록 */}
            {showSaved && savedContracts.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-xs font-bold text-rose-800">
                  저장된 근로계약서 — {savedContracts.length}명
                </div>
                <div className="divide-y divide-rose-50 max-h-60 overflow-y-auto">
                  {savedContracts.map(c => (
                    <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rose-50/50">
                      <FileText className="h-4 w-4 text-rose-400 shrink-0" />
                      <span className="text-xs font-semibold text-gray-800 flex-1">{c.name}</span>
                      <span className="text-[10px] text-gray-400">{c.pageCount}p</span>
                      <span className="text-[10px] text-gray-400">{c.uploadedAt.slice(0, 10)}</span>
                      <a href={c.downloadUrl} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="열기">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <a href={c.downloadUrl} download={`${c.name}_근로계약서.pdf`}
                        className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors" title="다운로드">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button onClick={() => handleDelete(c.name)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 transition-colors" title="삭제">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 구간 목록 + 이름 입력 */}
            {thumbs.length > 0 && (
              <>
                <div className="rounded-xl border border-rose-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-gray-700">계약서 구간 설정 ({sections.length}명)</span>
                    <span className="text-[11px] text-gray-400">썸네일 클릭 → 고해상도 확인 · [여기서 분리]로 구간 나누기</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {sections.map((s, i) => (
                      <div key={s.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${getSectionColor(s.id)}`}>
                        <span className="text-[10px] font-bold text-gray-500 shrink-0 min-w-[56px]">{s.startPage}~{s.endPage}p</span>

                        {/* 이름 입력 */}
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={s.name}
                            onChange={e => updateName(s.id, e.target.value)}
                            placeholder={s.ocrStatus === "running" ? "이름 추출 중..." : "이름 입력..."}
                            list={`emp-list-${s.id}`}
                            className="w-full border-0 bg-transparent text-xs font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                          />
                          <datalist id={`emp-list-${s.id}`}>
                            {employeeNames.map(n => <option key={n} value={n} />)}
                          </datalist>
                        </div>

                        {/* OCR 상태 배지 */}
                        {s.ocrStatus === "running" && (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-400 shrink-0" />
                        )}
                        {s.ocrStatus === "done" && s.ocrName && (
                          <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                            자동 추출
                          </span>
                        )}
                        {s.ocrStatus === "none" && (
                          <span className="text-[9px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                            직접 입력
                          </span>
                        )}

                        <span className="text-[10px] text-gray-400 shrink-0">{s.endPage - s.startPage + 1}p</span>

                        {i > 0 && (
                          <button onClick={() => mergeSection(s.id)} title="앞 구간과 합치기"
                            className="p-1 rounded hover:bg-white/70 text-gray-400 hover:text-gray-600 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 분리 저장 버튼 */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={handleSplit}
                    disabled={isSplitting || sections.some(s => !s.name.trim())}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors disabled:opacity-50">
                    {isSplitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                    {isSplitting
                      ? splitProgress.done < sections.length
                        ? `PDF 분리 중... ${splitProgress.done}/${sections.length}`
                        : `업로드 중... (${sections.length}명 병렬)`
                      : `개인별 분리 저장 (${sections.length}명)`}
                  </button>
                  {isSplitting && (
                    <div className="flex-1 min-w-[160px]">
                      <div className="h-2 bg-rose-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full transition-all duration-300"
                          style={{ width: splitProgress.total > 0 ? `${(splitProgress.done / splitProgress.total) * 100}%` : "0%" }}
                        />
                      </div>
                      <p className="text-[10px] text-rose-500 mt-1">
                        {splitProgress.done < sections.length
                          ? `PDF 분리 ${splitProgress.done}/${splitProgress.total}`
                          : "Firebase Storage 업로드 중..."}
                      </p>
                    </div>
                  )}
                </div>

                {/* 썸네일 그리드 */}
                <div className="flex flex-wrap gap-3">
                  {thumbs.map(thumb => {
                    const section       = getSectionForPage(thumb.pageNum);
                    const color         = section ? getSectionColor(section.id) : "";
                    const isFirst       = section?.startPage === thumb.pageNum;

                    return (
                      <div key={thumb.pageNum} className="flex flex-col items-center gap-1" style={{ width: 100 }}>
                        {thumb.pageNum > 1 && (
                          <button onClick={() => splitAt(thumb.pageNum)}
                            className="w-full flex items-center justify-center gap-1 py-0.5 rounded text-[9px] font-semibold text-rose-500 hover:bg-rose-100 border border-dashed border-rose-300 transition-colors">
                            <Plus className="h-2.5 w-2.5" /> 여기서 분리
                          </button>
                        )}
                        {isFirst && section && (
                          <div className={`w-full text-center text-[9px] font-bold px-1 py-0.5 rounded border truncate ${color}`}>
                            {section.ocrStatus === "running"
                              ? "추출 중..."
                              : section.name || "이름 미입력"}
                          </div>
                        )}
                        {/* 썸네일 — 클릭 시 고해상도 모달 */}
                        <div className={`rounded-lg border-2 overflow-hidden ${color} shadow-sm cursor-zoom-in hover:opacity-80 transition-opacity relative group`}
                          onClick={() => openPreview(thumb)}
                          title="클릭하면 고해상도로 볼 수 있습니다">
                          <img src={thumb.dataUrl} alt={`page ${thumb.pageNum}`} className="block" style={{ width: 96, height: "auto" }} />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                            <ZoomIn className="h-5 w-5 text-white drop-shadow" />
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 font-medium">{thumb.pageNum}p</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {isRendering && (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="flex items-center gap-2 text-xs text-rose-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  페이지 렌더링 중... {renderProgress > 0 ? `${renderProgress}%` : ""}
                </div>
                {renderProgress > 0 && (
                  <div className="w-48 h-1.5 bg-rose-100 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-400 rounded-full transition-all duration-200" style={{ width: `${renderProgress}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
