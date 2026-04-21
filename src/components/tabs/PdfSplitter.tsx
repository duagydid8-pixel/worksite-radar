import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Download, Trash2, Eye, Plus, Scissors } from "lucide-react";
import type { PdfSection, ThumbEntry, SplitResult } from "@/types/pdfSplitter.types";
import {
  renderThumbnails,
  renderHiRes,
  extractPageText,
  extractNameFromText,
  splitPdf,
  downloadAsZip,
  downloadSingle,
} from "@/utils/pdfSplitterUtils";

export default function PdfSplitter() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
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
      toast.error("PDF 렌더링 실패");
    } finally {
      setIsRendering(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const addSection = () => {
    const lastEnd = sections[sections.length - 1]?.endPage ?? 0;
    const start = Math.min(lastEnd + 1, totalPages);
    setSections((prev) => [
      ...prev,
      { id: crypto.randomUUID(), startPage: start, endPage: Math.min(start + 1, totalPages), name: "" },
    ]);
  };

  const updateSection = (id: string, field: keyof PdfSection, value: string | number) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const autoFillName = async (id: string, pageNum: number) => {
    if (!pdfBytes) return;
    try {
      const text = await extractPageText(pdfBytes, pageNum);
      const name = extractNameFromText(text);
      if (name) {
        updateSection(id, "name", name);
        toast.success(`이름 자동 인식: ${name}`);
      } else {
        toast.info("이름을 자동 인식하지 못했습니다. 직접 입력하세요.");
      }
    } catch {
      toast.error("텍스트 추출 실패");
    }
  };

  const openPreview = async (pageNum: number) => {
    if (!pdfBytes) return;
    setIsPreviewLoading(true);
    setPreview({ pageNum, dataUrl: "" });
    try {
      const dataUrl = await renderHiRes(pdfBytes, pageNum);
      setPreview({ pageNum, dataUrl });
    } catch {
      toast.error("고화질 렌더링 실패");
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
      toast.error("PDF 분리 실패");
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">PDF 분리 도구</h2>
        {pdfBytes && results.length > 0 && (
          <button
            onClick={() => downloadAsZip(results)}
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
          className="border-2 border-dashed border-border rounded-2xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
        >
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">PDF 파일을 드래그하거나 클릭해서 업로드</p>
          <p className="text-xs text-muted-foreground mt-1">근로계약서 등 여러 장이 합쳐진 PDF</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* 렌더링 중 */}
      {isRendering && (
        <div className="bg-white border border-border rounded-2xl p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold">썸네일 생성 중... {renderProgress}페이지</div>
            <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: totalPages ? `${(renderProgress / totalPages) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 썸네일 그리드 + 구간 설정 */}
      {thumbs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 썸네일 그리드 */}
          <div className="bg-white border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">페이지 미리보기 ({thumbs.length}/{totalPages})</h3>
              <button
                onClick={() => { setPdfBytes(null); setThumbs([]); setSections([]); setResults([]); setTotalPages(0); }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                파일 제거
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 max-h-[500px] overflow-y-auto pr-1">
              {thumbs.map((t) => (
                <div
                  key={t.pageNum}
                  className="relative group cursor-pointer rounded-lg overflow-hidden border border-border hover:border-primary transition-colors"
                  onClick={() => openPreview(t.pageNum)}
                >
                  <img src={t.dataUrl} alt={`p${t.pageNum}`} className="w-full object-contain bg-gray-50" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <Eye className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                    {t.pageNum}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 구간 설정 */}
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
              <div className="py-8 text-center text-sm text-muted-foreground">
                "구간 추가" 버튼으로 분리할 범위를 설정하세요
              </div>
            )}

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {sections.map((s, idx) => (
                <div key={s.id} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">구간 {idx + 1}</span>
                    <button onClick={() => removeSection(s.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground font-semibold">시작 페이지</label>
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={s.startPage}
                        onChange={(e) => updateSection(s.id, "startPage", Number(e.target.value))}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground font-semibold">끝 페이지</label>
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={s.endPage}
                        onChange={(e) => updateSection(s.id, "endPage", Number(e.target.value))}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground font-semibold">이름 (파일명)</label>
                      <input
                        type="text"
                        placeholder="홍길동"
                        value={s.name}
                        onChange={(e) => updateSection(s.id, "name", e.target.value)}
                        className="w-full border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                    <button
                      onClick={() => autoFillName(s.id, s.startPage)}
                      className="mt-4 px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors whitespace-nowrap"
                    >
                      자동 인식
                    </button>
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
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    분리 중... {splitProgress}%
                  </>
                ) : (
                  <>
                    <Scissors className="h-4 w-4" />
                    PDF 분리 ({sections.length}개)
                  </>
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
                  <p className="text-sm font-semibold">{r.name}.pdf</p>
                  <p className="text-xs text-muted-foreground">{r.pageCount}페이지</p>
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

      {/* 미리보기 모달 */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold">{preview.pageNum}페이지</span>
              <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground text-sm">닫기</button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-100">
              {isPreviewLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <img src={preview.dataUrl} alt={`p${preview.pageNum}`} className="max-w-full rounded-lg shadow-lg" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
