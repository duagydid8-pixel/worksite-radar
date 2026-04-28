import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Loader2, ScanText, Upload, Wand2, X } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import {
  applyAdditionalWorkToPayroll,
  parseAdditionalWorkText,
  readPayrollEmployeeOptions,
  type AdditionalWorkEntry,
  type AdditionalWorkPayrollResult,
  type PayrollEmployeeOption,
} from "@/lib/additionalWorkProcessor";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

type Step = "idle" | "extracting" | "ready" | "applying" | "done";

function formatMoney(value: number): string {
  return value.toLocaleString("ko-KR");
}

function makeDownloadName(fileName: string): string {
  return fileName.replace(/\.xlsx?$/i, "") + "_추가공수반영.xlsx";
}

function formatRowsForText(rows: AdditionalWorkEntry[]): string {
  return rows.map((row) => `${row.name}\t${row.trade}\t${row.units.toFixed(2)}`).join("\n");
}

function preprocessCanvasForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < image.data.length; i += 4) {
    const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const value = gray > 175 ? 255 : 0;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = image.width < 2200 ? 2 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const texts: string[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join("\n");
    if (pageText.trim()) texts.push(pageText);
  }

  return texts.join("\n");
}

async function renderPdfPages(buffer: ArrayBuffer): Promise<HTMLCanvasElement[]> {
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    canvases.push(preprocessCanvasForOcr(canvas));
  }

  return canvases;
}

export default function AdditionalWorkScanPage() {
  const scanInputRef = useRef<HTMLInputElement>(null);
  const payrollInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("idle");
  const [scanFileName, setScanFileName] = useState("");
  const [payrollFileName, setPayrollFileName] = useState("");
  const [payrollBuffer, setPayrollBuffer] = useState<ArrayBuffer | null>(null);
  const [rawText, setRawText] = useState("");
  const [draftRows, setDraftRows] = useState<AdditionalWorkEntry[]>([]);
  const [payrollEmployees, setPayrollEmployees] = useState<PayrollEmployeeOption[]>([]);
  const [ocrMessage, setOcrMessage] = useState("");
  const [outputBuffer, setOutputBuffer] = useState<ArrayBuffer | null>(null);
  const [result, setResult] = useState<AdditionalWorkPayrollResult | null>(null);

  const totalUnits = useMemo(() => draftRows.reduce((sum, row) => sum + row.units, 0), [draftRows]);

  const recognizeImage = useCallback(async (image: File | HTMLCanvasElement): Promise<string> => {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("kor+eng", 1, {
      logger: (message: any) => {
        if (message?.status) {
          const pct = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
          setOcrMessage(`${message.status}${pct}`);
        }
      },
    } as any);
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      } as any);
      const recognized = await worker.recognize(image as any);
      return recognized.data.text;
    } finally {
      await worker.terminate();
    }
  }, []);

  const extractScanFile = useCallback(async (file: File) => {
    setStep("extracting");
    setScanFileName(file.name);
    setRawText("");
    setDraftRows([]);
    setResult(null);
    setOutputBuffer(null);
    setOcrMessage("파일 읽는 중");

    try {
      let text = "";
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

      if (isPdf) {
        const buffer = await file.arrayBuffer();
        const embeddedText = await extractPdfText(buffer);
        if (parseAdditionalWorkText(embeddedText).length > 0) {
          text = embeddedText;
        } else {
          const canvases = await renderPdfPages(buffer);
          const ocrTexts: string[] = [];
          for (let i = 0; i < canvases.length; i++) {
            setOcrMessage(`OCR ${i + 1}/${canvases.length}`);
            ocrTexts.push(await recognizeImage(canvases[i]));
          }
          text = ocrTexts.join("\n");
        }
      } else if (file.type.startsWith("image/")) {
        setOcrMessage("OCR 준비 중");
        const canvas = preprocessCanvasForOcr(await imageFileToCanvas(file));
        text = await recognizeImage(canvas);
      } else {
        toast.error("PDF 또는 이미지 파일만 업로드할 수 있습니다.");
        setStep(rawText ? "ready" : "idle");
        return;
      }

      const rows = parseAdditionalWorkText(text);
      setDraftRows(rows);
      setRawText(formatRowsForText(rows));
      setStep("ready");
      const count = rows.length;
      if (count === 0) toast.warning("자동으로 읽은 행이 없습니다. 텍스트를 직접 수정해서 다시 확인해 주세요.");
      else toast.success(`${count}건의 추가공수 행을 읽었습니다.`);
    } catch (err: any) {
      toast.error(err?.message || "스캔본 텍스트 추출 중 오류가 발생했습니다.");
      setStep(rawText ? "ready" : "idle");
    } finally {
      setOcrMessage("");
    }
  }, [rawText, recognizeImage]);

  const handleScanChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void extractScanFile(file);
    event.target.value = "";
  }, [extractScanFile]);

  const handlePayrollChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error("급여대장은 xlsx 파일만 업로드해 주세요.");
      return;
    }

    const buffer = await file.arrayBuffer();
    setPayrollFileName(file.name);
    setPayrollBuffer(buffer);
    setPayrollEmployees(readPayrollEmployeeOptions(buffer));
    setResult(null);
    setOutputBuffer(null);
    toast.success("급여대장을 불러왔습니다.");
  }, []);

  const handleApply = useCallback(async () => {
    if (!payrollBuffer || !payrollFileName) {
      toast.error("급여대장 엑셀을 먼저 업로드해 주세요.");
      return;
    }
    if (draftRows.length === 0) {
      toast.error("반영할 추가공수 행이 없습니다.");
      return;
    }

    setStep("applying");
    try {
      const nextResult = await applyAdditionalWorkToPayroll(payrollBuffer, draftRows);
      setResult(nextResult);
      setOutputBuffer(nextResult.outputBuffer);
      setStep("done");
      toast.success(`${nextResult.applied.length}명에게 추가공수를 반영했습니다.`);
    } catch (err: any) {
      toast.error(err?.message || "급여대장 반영 중 오류가 발생했습니다.");
      setStep("ready");
    }
  }, [draftRows, payrollBuffer, payrollFileName]);

  const handleDownload = useCallback(() => {
    if (!outputBuffer || !payrollFileName) return;
    const blob = new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = makeDownloadName(payrollFileName);
    a.click();
    URL.revokeObjectURL(url);
  }, [outputBuffer, payrollFileName]);

  const handleClearText = useCallback(() => {
    setRawText("");
    setDraftRows([]);
    setResult(null);
    setOutputBuffer(null);
    setStep("idle");
  }, []);

  const handleNeededTextChange = useCallback((value: string) => {
    setRawText(value);
    setDraftRows(parseAdditionalWorkText(value));
    setResult(null);
    setOutputBuffer(null);
    if (value.trim()) setStep("ready");
  }, []);

  const updateDraftRow = useCallback((index: number, patch: Partial<AdditionalWorkEntry>) => {
    setDraftRows((rows) => {
      const next = rows.map((row, i) => i === index ? { ...row, ...patch } : row);
      setRawText(formatRowsForText(next));
      return next;
    });
    setResult(null);
    setOutputBuffer(null);
  }, []);

  const deleteDraftRow = useCallback((index: number) => {
    setDraftRows((rows) => {
      const next = rows.filter((_, i) => i !== index);
      setRawText(formatRowsForText(next));
      return next;
    });
    setResult(null);
    setOutputBuffer(null);
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ScanText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-950">추가공수 스캔본 추출</h2>
            <p className="text-xs font-semibold text-slate-500">스캔본의 이름, 공종, 추가요청공수를 읽어서 급여대장 경비(2)에 반영</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            disabled={step === "extracting" || step === "applying"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            스캔본 업로드
          </button>
          <button
            type="button"
            onClick={() => payrollInputRef.current?.click()}
            disabled={step === "extracting" || step === "applying"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            급여대장 업로드
          </button>
        </div>
        <input ref={scanInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleScanChange} />
        <input ref={payrollInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handlePayrollChange} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-950">필요 항목만 추출</h3>
              <p className="text-xs font-semibold text-slate-500">{scanFileName || "이름, 공종, 추가요청공수만 표시됩니다."}</p>
            </div>
            {rawText && (
              <button
                type="button"
                onClick={handleClearText}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
                초기화
              </button>
            )}
          </div>
          <div className="p-4">
            {step === "extracting" ? (
              <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-slate-600">
                <Loader2 className="h-8 w-8 animate-spin text-slate-900" />
                <div className="text-sm font-bold">텍스트 추출 중</div>
                <div className="text-xs font-semibold text-slate-500">{ocrMessage}</div>
              </div>
            ) : (
              <textarea
                value={rawText}
                onChange={(event) => handleNeededTextChange(event.target.value)}
                placeholder={"예)\n송승석 공구장 1.00\n정회옥 유도원 1.00\n유진환 신호수 2.00"}
                className="h-[420px] w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              />
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-950">반영 준비</h3>
              <p className="text-xs font-semibold text-slate-500">{payrollFileName || "급여대장 엑셀을 업로드해 주세요."}</p>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-extrabold text-slate-400">추출 행</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-950">{draftRows.length}건</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-extrabold text-slate-400">총 추가공수</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-950">{totalUnits.toFixed(2)}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleApply}
                disabled={!payrollBuffer || draftRows.length === 0 || step === "extracting" || step === "applying"}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700 disabled:opacity-45"
              >
                {step === "applying" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                급여대장 경비(2) 반영
              </button>
              {outputBuffer && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  반영 파일 다운로드
                </button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-950">추출 행 미리보기</h3>
            </div>
            <div className="max-h-[320px] overflow-auto">
              {draftRows.length === 0 ? (
                <div className="p-6 text-center text-xs font-semibold text-slate-400">읽은 행이 없습니다.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-extrabold text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">이름</th>
                      <th className="px-3 py-2 text-left">공종</th>
                      <th className="px-3 py-2 text-right">공수</th>
                      <th className="w-10 px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftRows.map((row: AdditionalWorkEntry, index) => (
                      <tr key={`${row.name}-${row.trade}-${index}`}>
                        <td className="px-2 py-2">
                          <input
                            value={row.name}
                            list="payroll-employee-options"
                            onChange={(event) => updateDraftRow(index, { name: event.target.value })}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={row.trade}
                            onChange={(event) => updateDraftRow(index, { trade: event.target.value })}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.125"
                            value={row.units}
                            onChange={(event) => updateDraftRow(index, { units: Number(event.target.value) || 0 })}
                            className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-right font-mono text-sm text-slate-900 outline-none focus:border-slate-400"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => deleteDraftRow(index)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            aria-label={`${row.name} 삭제`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <datalist id="payroll-employee-options">
                {payrollEmployees.map((employee) => (
                  <option key={`${employee.name}-${employee.jobTitle}`} value={employee.name}>
                    {employee.jobTitle}
                  </option>
                ))}
              </datalist>
            </div>
          </section>
        </aside>
      </div>

      {result && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-950">반영 결과</h3>
              <p className="text-xs font-semibold text-slate-500">경비(2)는 추가요청공수 × 단가, 급여액은 경비(2) 변경분만큼 조정</p>
            </div>
            <div className="flex gap-2 text-xs font-extrabold">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                <CheckCircle className="h-3.5 w-3.5" />
                반영 {result.applied.length}
              </span>
              {result.unmatched.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  미반영 {result.unmatched.length}
                </span>
              )}
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-[11px] font-extrabold text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">이름</th>
                  <th className="px-3 py-2 text-left">공종</th>
                  <th className="px-3 py-2 text-right">공수</th>
                  <th className="px-3 py-2 text-right">단가</th>
                  <th className="px-3 py-2 text-right">경비(2)</th>
                  <th className="px-3 py-2 text-right">급여액</th>
                  <th className="px-3 py-2 text-left">위치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.applied.map((row) => (
                  <tr key={`${row.sheetName}-${row.rowNumber}-${row.name}`}>
                    <td className="px-3 py-2 font-bold text-slate-900">{row.name}</td>
                    <td className="px-3 py-2 text-slate-600">{row.trade}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.units.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.expense2Before)} → {formatMoney(row.expense2After)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.salaryBefore)} → {formatMoney(row.salaryAfter)}</td>
                    <td className="px-3 py-2 text-slate-500">{row.sheetName} {row.rowNumber}행</td>
                  </tr>
                ))}
                {result.unmatched.map((row) => (
                  <tr key={`unmatched-${row.name}-${row.trade}`} className="bg-amber-50/60">
                    <td className="px-3 py-2 font-bold text-amber-900">{row.name}</td>
                    <td className="px-3 py-2 text-amber-800">{row.trade}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-900">{row.units.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-amber-700" colSpan={4}>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
