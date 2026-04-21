import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Download, Trash2, Eye, Plus, Scissors, X } from "lucide-react";
import type { PdfSection, ThumbEntry, SplitResult } from "@/types/pdfSplitter.types";
import {
  renderThumbnails,
  renderHiRes,
  splitPdf,
  downloadAsZip,
  downloadSingle,
} from "@/utils/pdfSplitterUtils";

export default function PdfSplitter() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfBaseName, setPdfBaseName] = useState("분리");
  const [totalPages, setTotalPages] = useState(0);
  const [thumbs, setThumbs] = useState<ThumbEntry[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  const [sections, setSections] = useState<PdfSection[]>([]);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState(0);
  const [results, setResults] = useState<SplitResult[]>([]);

  const [preview, setPreview] = useState<{ pageNum: number; dataUrl: string } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("PDF 파일만 업로드 가능합니다.");
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    setPdfBytes(bytes);
    setPdfBaseName(file.name.replace(/\.pdf$/i, ""));
    setThumbs([]);
    setSections([]);
    setResults([]);
    setIsRendering(true);
    setRenderProgress(0);

    try {
      const total = await renderThumbnails(bytes, (thumb) => {
        setThumbs((prev) => [...prev, thumb]);
        setRenderProgress(thumb.pageNum);
      });
      setTotalPages(total);
      toast.success(`${total}페이지 PDF 로드 완료`);
    } catch (e) {
      console.error("[PdfSplitter] 렌더링 실패:", e);
      toast.error(`PDF 렌더링 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsRendering(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = () => {
    setPdfBytes(null);
    setPdfBaseName("분리");
    setThumbs([]);
    setSections([]);
    setResults([]);
    setTotalPages(0);
  };

  const addSection = () => {
    const lastEnd = sections[sections.length - 1]?.endPage ?? 0;
    const start = Math.min(lastEnd + 1, totalPages);
    setSections((prev) => [
      ...prev,
      { id: crypto.randomUUID(), startPage: start, endPage: Math.min(start + 1, totalPages), name: "" },
    ]);
  };

  const updateSection = (id: string, patch: Partial<PdfSection>) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const openPreview = async (pageNum: number) => {
    if (!pdfBytes) return;
    setIsPreviewLoading(true);
    setPreview({ pageNum, dataUrl: "" });
    try {
      const dataUrl = await renderHiRes(pdfBytes, pageNum);
      setPreview({ pageNum, dataUrl });
    } catch (e) {
      console.error("[PdfSplitter] 고화질 렌더링 실패:", e);
      toast.error(`미리보기 실패: ${e instanceof Error ? e.message : String(e)}`);
      setPreview(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSplit = async () => {
    if (!pdfBytes || sections.length === 0) return;
    const invalid = sections.find((s) => !s.name.trim());
    if (invalid) { toast.error("모든 구간에 이름을 입력하세요."); return; }

    setIsSplitting(true);
    setSplitProgress(0);
    setResults([]);

    try {
      const splitResults = await splitPdf(pdfBytes, sections, (done, total) => {
        setSplitProgress(Math.round((done / total) * 100));
      });
      setResults(splitResults);
      toast.success(`${splitResults.length}개 파일 분리 완료`);
    } catch (e) {
      console.error("[PdfSplitter] 분리 실패:", e);
      toast.error(`PDF 분리 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">PDF 분리 도구</h2>
        {results.length > 0 && (
          <button
            onClick={() => downloadAsZip(results, pdfBaseName)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            전체 ZIP 다운로드
          </button>
        )}
      </div>

      {/* 업로드 존 */}
      {!pdfBytes && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-2xl p-14 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
        >
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">PDF 파일을 드래그하거나 클릭해서 업로드</p>
          <p className="text-xs text-muted-foreground mt-1">여러 장이 합쳐진 PDF → 이름별로 분리</p>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>
      )}

      {/* 썸네일 생성 중 */}
      {isRendering && (
        <div className="bg-white border border-border rounded-2xl p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">페이지 로드 중... {renderProgress} / {totalPages || "?"}</p>
            <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: totalPages ? `${(renderProgress / totalPages) * 100}%` : "0%" }} />
            </div>
          </div>
        </div>
      )}

      {/* 썸네일 + 구간 설정 */}
      {thumbs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* 왼쪽: 썸네일 그리드 */}
          <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                페이지 미리보기
                <span className="text-muted-foreground font-normal ml-1">({thumbs.length}/{totalPages})</span>
              </h3>
              <button onClick={reset} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                파일 제거
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">썸네일 클릭 시 고화질 확대</p>
            <div className="grid grid-cols-3 gap-2 max-h-[520px] overflow-y-auto pr-1">
              {thumbs.map((t) => (
                <div
                  key={t.pageNum}
                  onClick={() => openPreview(t.pageNum)}
                  className="relative group cursor-zoom-in rounded-lg overflow-hidden border border-border hover:border-primary transition-colors"
                >
                  <img src={t.dataUrl} alt={`p${t.pageNum}`} className="w-full object-contain bg-gray-50" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all flex items-center justify-center">
                    <Eye className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                    {t.pageNum}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 오른쪽: 구간 설정 */}
          <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">분리 구간 설정</h3>
              <button
                onClick={addSection}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> 구간 추가
              </button>
            </div>

            {sections.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                미리보기로 페이지를 확인 후 구간을 추가하세요
              </p>
            )}

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {sections.map((s, idx) => (
                <div key={s.id} className="border border-border rounded-xl p-3 space-y-2">
                  {/* 구간 헤더 */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">구간 {idx + 1}</span>
                    <button onClick={() => removeSection(s.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* 페이지 범위 */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground font-semibold">시작 페이지</label>
                      <input type="number" min={1} max={totalPages} value={s.startPage}
                        onChange={(e) => updateSection(s.id, { startPage: Number(e.target.value) })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground font-semibold">끝 페이지</label>
                      <input type="number" min={1} max={totalPages} value={s.endPage}
                        onChange={(e) => updateSection(s.id, { endPage: Number(e.target.value) })}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                    </div>
                  </div>

                  {/* 이름 입력 */}
                  <div>
                    <label className="text-[10px] text-muted-foreground font-semibold">이름 (파일명)</label>
                    <input
                      type="text"
                      placeholder="홍길동"
                      value={s.name}
                      onChange={(e) => updateSection(s.id, { name: e.target.value })}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    {s.name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        → [{s.name}]_p{s.startPage}-p{s.endPage}.pdf
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {sections.length > 0 && (
              <button
                onClick={handleSplit}
                disabled={isSplitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isSplitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />분리 중... {splitProgress}%</>
                ) : (
                  <><Scissors className="h-4 w-4" />PDF 분리 ({sections.length}개)</>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 분리 결과 */}
      {results.length > 0 && (
        <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-bold">분리 결과 ({results.length}개)</h3>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between p-3 border border-border rounded-xl">
                <div>
                  <p className="text-sm font-semibold">{r.fileName}.pdf</p>
                  <p className="text-xs text-muted-foreground">p{r.startPage}~p{r.endPage} · {r.pageCount}페이지</p>
                </div>
                <button
                  onClick={() => downloadSingle(r)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-sm font-semibold hover:bg-muted/80 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  다운로드
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 고화질 미리보기 팝업 */}
      {preview !== null && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-bold">{preview.pageNum}페이지 고화질 미리보기</span>
              <button
                onClick={() => setPreview(null)}
                className="p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-100">
              {isPreviewLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">고화질 렌더링 중...</p>
                </div>
              ) : (
                <img
                  src={preview.dataUrl}
                  alt={`p${preview.pageNum}`}
                  className="max-w-full rounded-lg shadow-lg"
                  style={{ imageRendering: "crisp-edges" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
