import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, Upload, X, ChevronDown, ChevronUp, Scissors, Loader2, Download, Trash2, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { loadContractsFS, uploadContractFS, deleteContractFS } from "@/lib/firestoreService";
import type { ContractMeta } from "@/lib/firestoreService";

// pdfjs worker 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PageThumb {
  pageNum: number; // 1-based
  dataUrl: string;
}

interface ContractSection {
  id: string;
  name: string;
  startPage: number; // 1-based
  endPage: number;   // 1-based (inclusive)
}

interface PreviewModal {
  pageNum: number;
  dataUrl: string;
}

interface Props {
  isAdmin: boolean;
  employeeNames?: string[]; // 기존 직원 이름 목록 (자동완성용)
}

export default function ContractUploadPanel({ isAdmin, employeeNames = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [thumbs, setThumbs] = useState<PageThumb[]>([]);
  const [sections, setSections] = useState<ContractSection[]>([]);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [savedContracts, setSavedContracts] = useState<ContractMeta[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [preview, setPreview] = useState<PreviewModal | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 저장된 계약서 목록 로드
  const refreshContracts = useCallback(async () => {
    const list = await loadContractsFS();
    setSavedContracts(list.sort((a, b) => a.name.localeCompare(b.name, "ko")));
  }, []);

  useEffect(() => {
    if (open) refreshContracts();
  }, [open, refreshContracts]);

  // PDF 업로드 → 썸네일 렌더링
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("PDF 파일만 업로드할 수 있습니다.");
      return;
    }

    setIsRendering(true);
    setThumbs([]);
    setSections([]);

    try {
      const buffer = await file.arrayBuffer();
      setPdfBytes(buffer);

      const pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      const count = pdfDoc.numPages;
      setTotalPages(count);

      // 초기 섹션: 전체를 하나의 섹션으로 (이름 비어있음)
      setSections([{ id: crypto.randomUUID(), name: "", startPage: 1, endPage: count }]);

      // 썸네일 렌더링 (최대 50장, 이후는 지연)
      const rendered: PageThumb[] = [];
      const scale = 0.35;
      for (let i = 1; i <= count; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        rendered.push({ pageNum: i, dataUrl: canvas.toDataURL("image/jpeg", 0.6) });
      }
      setThumbs(rendered);
      toast.success(`${count}페이지 로드 완료`);
    } catch {
      toast.error("PDF를 읽는 중 오류가 발생했습니다.");
    } finally {
      setIsRendering(false);
    }
  };

  // 특정 페이지에서 새 계약서 구간 분리
  const splitAt = (pageNum: number) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.startPage <= pageNum && pageNum <= s.endPage);
      if (idx === -1 || pageNum === prev[idx].startPage) return prev;
      const target = prev[idx];
      const before: ContractSection = { ...target, endPage: pageNum - 1 };
      const after: ContractSection  = { id: crypto.randomUUID(), name: "", startPage: pageNum, endPage: target.endPage };
      return [...prev.slice(0, idx), before, after, ...prev.slice(idx + 1)];
    });
  };

  // 구간 삭제 (앞 구간에 합침)
  const mergeSection = (id: string) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === 0) return prev;
      const merged: ContractSection = { ...prev[idx - 1], endPage: prev[idx].endPage };
      return [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 1)];
    });
  };

  // 이름 업데이트
  const updateName = (id: string, name: string) => {
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, name } : s));
  };

  // 개인별 PDF 분리 후 Firebase Storage 업로드
  const handleSplit = async () => {
    if (!pdfBytes) return;
    const unnamed = sections.filter((s) => !s.name.trim());
    if (unnamed.length > 0) {
      toast.error(`이름이 비어있는 구간이 ${unnamed.length}개 있습니다.`);
      return;
    }
    const dupNames = sections.map((s) => s.name.trim()).filter((n, i, arr) => arr.indexOf(n) !== i);
    if (dupNames.length > 0) {
      toast.error(`중복된 이름이 있습니다: ${[...new Set(dupNames)].join(", ")}`);
      return;
    }

    setIsSplitting(true);
    let successCount = 0;

    try {
      const srcPdf = await PDFDocument.load(pdfBytes);

      for (const section of sections) {
        const newPdf = await PDFDocument.create();
        const indices = Array.from(
          { length: section.endPage - section.startPage + 1 },
          (_, i) => section.startPage - 1 + i
        );
        const pages = await newPdf.copyPages(srcPdf, indices);
        pages.forEach((p) => newPdf.addPage(p));
        const bytes = await newPdf.save();
        const meta = await uploadContractFS(section.name.trim(), bytes, indices.length);
        if (meta) {
          successCount++;
        } else {
          toast.error(`${section.name} 저장 실패`);
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount}명 근로계약서 저장 완료`);
        await refreshContracts();
        setShowSaved(true);
        // 업로드 상태 초기화
        setThumbs([]);
        setSections([]);
        setPdfBytes(null);
        setTotalPages(0);
      }
    } catch (e) {
      toast.error("분리 중 오류: " + String(e));
    } finally {
      setIsSplitting(false);
    }
  };

  // 계약서 삭제
  const handleDelete = async (name: string) => {
    if (!confirm(`${name}의 근로계약서를 삭제하시겠습니까?`)) return;
    const ok = await deleteContractFS(name);
    if (ok) {
      toast.success(`${name} 계약서 삭제됨`);
      await refreshContracts();
    } else {
      toast.error("삭제 실패");
    }
  };

  // 각 페이지가 어느 섹션에 속하는지
  const getSectionForPage = (pageNum: number) => sections.find((s) => s.startPage <= pageNum && pageNum <= s.endPage);

  // 섹션별 색상
  const SECTION_COLORS = [
    "border-blue-300 bg-blue-50",
    "border-emerald-300 bg-emerald-50",
    "border-violet-300 bg-violet-50",
    "border-amber-300 bg-amber-50",
    "border-rose-300 bg-rose-50",
    "border-cyan-300 bg-cyan-50",
    "border-orange-300 bg-orange-50",
    "border-teal-300 bg-teal-50",
  ];
  const getSectionColor = (id: string) => {
    const idx = sections.findIndex((s) => s.id === id);
    return SECTION_COLORS[idx % SECTION_COLORS.length];
  };

  if (!isAdmin) return null;

  return (
    <>
    {/* 페이지 확대 미리보기 모달 */}
    {preview && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        onClick={() => setPreview(null)}
      >
        <div
          className="relative bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-bold text-gray-700">{preview.pageNum}페이지 미리보기</span>
            <div className="flex items-center gap-2">
              {/* 이전/다음 페이지 */}
              <button
                disabled={preview.pageNum <= 1}
                onClick={() => {
                  const prev = thumbs.find(t => t.pageNum === preview.pageNum - 1);
                  if (prev) setPreview(prev);
                }}
                className="px-2 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >← 이전</button>
              <button
                disabled={preview.pageNum >= totalPages}
                onClick={() => {
                  const next = thumbs.find(t => t.pageNum === preview.pageNum + 1);
                  if (next) setPreview(next);
                }}
                className="px-2 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >다음 →</button>
              <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
          </div>
          <div className="overflow-auto max-h-[75vh] flex items-center justify-center bg-gray-50 p-4">
            <img src={preview.dataUrl} alt={`page ${preview.pageNum}`} className="max-w-full h-auto shadow-md rounded" />
          </div>
          {/* 이 페이지에서 분리 버튼 */}
          {preview.pageNum > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
              <button
                onClick={() => { splitAt(preview.pageNum); setPreview(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                {preview.pageNum}p부터 새 계약서로 분리
              </button>
              <span className="text-[11px] text-gray-400">이름을 확인 후 구간을 나눠주세요</span>
            </div>
          )}
        </div>
      </div>
    )}
    <div className="rounded-xl border border-rose-200 bg-rose-50 shrink-0">
      {/* 헤더 */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
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

          {/* PDF 업로드 버튼 */}
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isRendering}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
            >
              {isRendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isRendering ? "렌더링 중..." : "PDF 업로드"}
            </button>
            <span className="text-[11px] text-rose-600">스캔된 근로계약서 PDF를 업로드하면 페이지별 미리보기가 표시됩니다</span>

            {/* 저장된 목록 토글 */}
            {savedContracts.length > 0 && (
              <button
                onClick={() => setShowSaved((v) => !v)}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
              >
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
                {savedContracts.map((c) => (
                  <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rose-50/50">
                    <FileText className="h-4 w-4 text-rose-400 shrink-0" />
                    <span className="text-xs font-semibold text-gray-800 flex-1">{c.name}</span>
                    <span className="text-[10px] text-gray-400">{c.pageCount}p</span>
                    <span className="text-[10px] text-gray-400">{c.uploadedAt.slice(0, 10)}</span>
                    <a
                      href={c.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"
                      title="열기"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={c.downloadUrl}
                      download={`${c.name}_근로계약서.pdf`}
                      className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors"
                      title="다운로드"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => handleDelete(c.name)}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 transition-colors"
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 페이지 썸네일 + 구간 편집 */}
          {thumbs.length > 0 && (
            <>
              {/* 구간 목록 */}
              <div className="rounded-xl border border-rose-200 bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-gray-700">계약서 구간 설정 ({sections.length}명)</span>
                  <span className="text-[11px] text-gray-400">썸네일 위 [여기서 분리] 버튼으로 구간을 나눕니다</span>
                </div>
                <div className="flex flex-col gap-2">
                  {sections.map((s, i) => (
                    <div key={s.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${getSectionColor(s.id)}`}>
                      <span className="text-[10px] font-bold text-gray-500 shrink-0 min-w-[60px]">
                        {s.startPage}~{s.endPage}p
                      </span>
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => updateName(s.id, e.target.value)}
                        placeholder="이름 입력..."
                        list={`emp-list-${s.id}`}
                        className="flex-1 border-0 bg-transparent text-xs font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                      />
                      <datalist id={`emp-list-${s.id}`}>
                        {employeeNames.map((n) => <option key={n} value={n} />)}
                      </datalist>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {s.endPage - s.startPage + 1}페이지
                      </span>
                      {i > 0 && (
                        <button
                          onClick={() => mergeSection(s.id)}
                          title="앞 구간과 합치기"
                          className="p-1 rounded hover:bg-white/70 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 분리 저장 버튼 */}
              <button
                onClick={handleSplit}
                disabled={isSplitting || sections.some((s) => !s.name.trim())}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors disabled:opacity-50 self-start"
              >
                {isSplitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                {isSplitting ? "저장 중..." : `개인별 분리 저장 (${sections.length}명)`}
              </button>

              {/* 썸네일 그리드 */}
              <div className="overflow-x-auto">
                <div className="flex flex-wrap gap-3 min-w-0">
                  {thumbs.map((thumb) => {
                    const section = getSectionForPage(thumb.pageNum);
                    const sectionColor = section ? getSectionColor(section.id) : "";
                    const isFirstInSection = section?.startPage === thumb.pageNum;

                    return (
                      <div key={thumb.pageNum} className="flex flex-col items-center gap-1" style={{ width: 100 }}>
                        {/* 구간 분리 버튼 (첫 페이지 제외) */}
                        {thumb.pageNum > 1 && (
                          <button
                            onClick={() => splitAt(thumb.pageNum)}
                            className="w-full flex items-center justify-center gap-1 py-0.5 rounded text-[9px] font-semibold text-rose-500 hover:bg-rose-100 border border-dashed border-rose-300 transition-colors"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            여기서 분리
                          </button>
                        )}

                        {/* 구간 이름 배지 (구간 첫 페이지에만) */}
                        {isFirstInSection && section && (
                          <div className={`w-full text-center text-[9px] font-bold px-1 py-0.5 rounded border truncate ${sectionColor}`}>
                            {section.name || "이름 미입력"}
                          </div>
                        )}

                        {/* 페이지 썸네일 — 클릭 시 확대 */}
                        <div
                          className={`rounded-lg border-2 overflow-hidden ${sectionColor} shadow-sm cursor-zoom-in hover:opacity-80 transition-opacity`}
                          onClick={() => setPreview(thumb)}
                          title="클릭하면 크게 볼 수 있습니다"
                        >
                          <img
                            src={thumb.dataUrl}
                            alt={`page ${thumb.pageNum}`}
                            className="block"
                            style={{ width: 96, height: "auto" }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 font-medium">{thumb.pageNum}p</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {isRendering && (
            <div className="flex items-center gap-2 text-xs text-rose-600 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              PDF 페이지 렌더링 중... 잠시만 기다려 주세요
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
