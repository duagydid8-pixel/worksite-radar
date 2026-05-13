import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { AlertCircle, CheckCircle2, Clipboard, Download, FileSpreadsheet, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  convertRcmWorkbookToImages,
  fetchRcmDraftImageStatus,
  getRcmImageDataUrl,
  type RcmDraftImageItem,
  type RcmDraftImageStatus,
} from "@/lib/rcmDraftImageClient";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function base64ToBlob(base64: string, type = "image/png") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const RCM_TITLE_LABELS: Record<string, string> = {
  "#2": "#2 기술인 신규채용 품의서",
  "#3": "#3 단가 책정 검토",
  "#4": "#4 근로자 계정 검토",
  "#6": "#6 현장 월간 출역 검토",
  "#7": "#7 현장 인건비 지급 검토",
};

function getSheetNumber(sheetName: string) {
  return sheetName.match(/^#\d+(?:-\d+)?/)?.[0] ?? "";
}

function getBaseSheetNumber(sheetName: string) {
  return sheetName.match(/^#\d+/)?.[0] ?? "";
}

function buildDraftTitle(sheetName: string, projectLabel: string, targetMonth: string, draftDate: string) {
  const sheetNumber = getBaseSheetNumber(sheetName);
  const titleLabel = RCM_TITLE_LABELS[sheetNumber] ?? sheetName;
  return `[사업1본부] ${projectLabel} 초순수_${targetMonth} RCM ${titleLabel}_ ${draftDate}`;
}

function getTodayDraftDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function getPreviousMonthLabel() {
  const now = new Date();
  const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const shortYear = String(previousMonthDate.getFullYear()).slice(2);
  const month = String(previousMonthDate.getMonth() + 1).padStart(2, "0");
  return `${shortYear}년 ${month}월`;
}

export default function RcmDraftImageExport() {
  const [status, setStatus] = useState<RcmDraftImageStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<RcmDraftImageItem[]>([]);
  const [projectLabel, setProjectLabel] = useState("P4 PH4");
  const [targetMonth, setTargetMonth] = useState(getPreviousMonthLabel);
  const [draftDate, setDraftDate] = useState(getTodayDraftDate);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const ready = status?.ready === true;
  const expectedText = useMemo(() => "#2, #3, #4, #6, #7 시트의 인쇄영역", []);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const nextStatus = await fetchRcmDraftImageStatus();
      setStatus(nextStatus);
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void checkStatus();
  }, []);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("RCM 엑셀은 xlsx 파일만 업로드해 주세요.");
      return;
    }

    setConverting(true);
    setProgress(8);
    setProgressText("엑셀 파일 준비 중");
    setFileName(file.name);
    setItems([]);
    const progressTimer = window.setInterval(() => {
      setProgress((value) => {
        if (value < 35) return value + 4;
        if (value < 70) return value + 2;
        if (value < 88) return value + 1;
        return value;
      });
    }, 700);
    try {
      setProgressText("Excel 인쇄영역을 이미지로 변환 중");
      const result = await convertRcmWorkbookToImages(file);
      setProgress(100);
      setProgressText("변환 완료");
      setItems(result.items);
      setStatus({ ready: true, engine: result.engine, port: 8791 });
      if (result.items.length === 0) {
        toast.error("변환할 #2~#7 인쇄영역을 찾지 못했습니다.");
      } else {
        toast.success(`${result.items.length}개 인쇄영역을 PNG로 변환했습니다.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "RCM 이미지 변환 중 오류가 발생했습니다.";
      toast.error(message);
    } finally {
      window.clearInterval(progressTimer);
      setConverting(false);
      window.setTimeout(() => {
        setProgress(0);
        setProgressText("");
      }, 900);
    }
  };

  const downloadOne = (item: RcmDraftImageItem) => {
    downloadBlob(base64ToBlob(item.imageBase64), item.fileName);
  };

  const copyOne = async (item: RcmDraftImageItem) => {
    try {
      const blob = base64ToBlob(item.imageBase64);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다.");
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      toast.success(`${item.sheetName} 이미지를 복사했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 복사에 실패했습니다.";
      toast.error(`${message} PNG 다운로드를 사용해 주세요.`);
    }
  };

  const copyTitle = async (title: string) => {
    try {
      await navigator.clipboard.writeText(title);
      toast.success("제목을 복사했습니다.");
    } catch {
      toast.error("제목 복사에 실패했습니다. 제목을 직접 선택해서 복사해 주세요.");
    }
  };

  const jumpToSheet = (sheetName: string) => {
    const sheetNumber = getSheetNumber(sheetName);
    cardRefs.current[sheetNumber]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const downloadZip = async () => {
    if (items.length === 0) return;
    const zip = new JSZip();
    for (const item of items) {
      zip.file(item.fileName, item.imageBase64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const baseName = fileName.replace(/\.xlsx$/i, "") || "RCM_기안서";
    downloadBlob(blob, `${baseName}_인쇄영역_PNG.zip`);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-extrabold text-blue-700">
                <FileSpreadsheet className="h-4 w-4" />
                본사 송부용
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">RCM 기안서 송부</h1>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                RCM 취합 엑셀에서 {expectedText}을 실제 Excel 기준 PNG 이미지로 변환합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={checkStatus}
              disabled={checking}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              서버 확인
            </button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`flex items-start gap-3 rounded-md border p-3 ${
                ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
              }`}>
                {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5" /> : <AlertCircle className="mt-0.5 h-5 w-5" />}
                <div className="text-sm font-bold">
                  <p>{ready ? "RCM 변환 서버 연결됨" : "RCM 변환 서버가 필요합니다"}</p>
                  <p className="mt-1 text-xs font-semibold opacity-80">
                    {ready ? `${status?.engine ?? "Excel"} 엔진 사용 중` : "PowerShell에서 npm run rcm:image를 실행하세요."}
                  </p>
                </div>
              </div>

              <label
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragActive(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
                className={`mt-4 flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 text-center transition-colors ${
                  dragActive
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
                }`}
              >
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  disabled={converting}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleFile(file);
                  }}
                />
                {converting ? (
                  <Loader2 className="h-9 w-9 animate-spin text-blue-600" />
                ) : (
                  <FileSpreadsheet className="h-9 w-9 text-slate-500" />
                )}
                <p className="mt-3 text-sm font-black text-slate-900">
                  {converting ? "Excel 인쇄영역 변환 중..." : dragActive ? "여기에 파일 놓기" : "RCM 엑셀 업로드"}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {fileName || "초순수_RCM_#2~7취합 파일을 클릭하거나 끌어다 놓으세요."}
                </p>
              </label>

              <div className="mt-4 rounded-md bg-slate-100 p-3 text-xs font-semibold leading-5 text-slate-600">
                <p>변환 대상: {expectedText}</p>
                <p>정확도 기준: Excel 인쇄영역 그대로 캡처</p>
                <p>누락 확인: #5 시트가 없으면 자동 제외</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-black text-slate-950">제목 공통값</h2>
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-500">프로젝트</span>
                  <input
                    value={projectLabel}
                    onChange={(event) => setProjectLabel(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-500">대상월</span>
                  <input
                    value={targetMonth}
                    onChange={(event) => setTargetMonth(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-extrabold text-slate-500">작성날짜</span>
                  <input
                    value={draftDate}
                    onChange={(event) => setDraftDate(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-blue-500"
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={downloadZip}
              disabled={items.length === 0}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Download className="h-4 w-4" />
              전체 PNG ZIP 다운로드
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {items.length > 0 ? (
              <div className="space-y-5">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-slate-200 bg-white/95 p-3 backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-black text-slate-500">바로 이동</span>
                    {items.map((item) => {
                      const sheetNumber = getSheetNumber(item.sheetName);
                      return (
                        <button
                          key={`jump-${item.sheetName}`}
                          type="button"
                          onClick={() => jumpToSheet(item.sheetName)}
                          className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {sheetNumber.replace("#", "")}번
                        </button>
                      );
                    })}
                  </div>
                </div>
                {items.map((item) => (
                  <article
                    key={`${item.sheetName}-${item.range}`}
                    ref={(node) => {
                      cardRefs.current[getSheetNumber(item.sheetName)] = node;
                    }}
                    className="scroll-mt-20 rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex flex-col gap-3 border-b border-slate-200 p-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-sm font-black text-slate-950">{item.sheetName}</h2>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          인쇄영역 {item.range} · {formatBytes(item.size)}
                        </p>
                        <p className="mt-2 max-w-4xl rounded-md bg-slate-50 px-2 py-1.5 text-xs font-bold leading-5 text-slate-700">
                          {buildDraftTitle(item.sheetName, projectLabel, targetMonth, draftDate)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => copyTitle(buildDraftTitle(item.sheetName, projectLabel, targetMonth, draftDate))}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                        >
                          <Clipboard className="h-4 w-4" />
                          제목 복사
                        </button>
                        <button
                          type="button"
                          onClick={() => copyOne(item)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-blue-700"
                        >
                          <Clipboard className="h-4 w-4" />
                          이미지 복사
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadOne(item)}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          PNG 다운로드
                        </button>
                      </div>
                    </div>
                    <div className="bg-slate-100 p-4">
                      <div className="mx-auto w-full max-w-[900px] rounded-sm border border-slate-200 bg-white shadow-sm">
                        <img
                          src={getRcmImageDataUrl(item)}
                          alt={`${item.sheetName} 인쇄영역`}
                          className="block h-auto w-full"
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
                <ImageIcon className="h-10 w-10 text-slate-400" />
                <p className="mt-3 text-sm font-black text-slate-800">변환된 이미지가 없습니다</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">왼쪽에서 RCM 엑셀 파일을 업로드하면 여기서 바로 확인할 수 있습니다.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {(converting || progress > 0) && (
        <div className="fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-32px))] rounded-lg border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              {progress >= 100 ? <CheckCircle2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-black text-slate-950">{progressText || "변환 준비 중"}</p>
                <span className="text-xs font-black text-blue-700">{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                {progress >= 100 ? "잠시 후 자동으로 닫힙니다." : "Excel에서 인쇄영역을 PNG로 만드는 중입니다."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
