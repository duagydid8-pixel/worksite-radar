import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { extractAdditionalWorkWithVision, type VisionExtractImage } from "@/lib/openaiAdditionalWorkExtractor";
import { loadEmployeesPH2FS, loadEmployeesPH4FS } from "@/lib/firestoreService";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

type Step = "idle" | "extracting" | "ready" | "applying" | "done";

interface TechnicalIdentity {
  name: string;
  residentNo: string;
  birthDate: string;
  trade: string;
  site: string;
}

function formatMoney(value: number): string {
  return value.toLocaleString("ko-KR");
}

function makeDownloadName(fileName: string): string {
  return fileName.replace(/\.xlsx?$/i, "") + "_추가공수반영.xlsx";
}

function formatRowsForText(rows: AdditionalWorkEntry[]): string {
  return rows.map((row) => `${row.name}\t${row.units.toFixed(2)}`).join("\n");
}

function publicAssetPath(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function collectKnownNames(payrollEmployees: PayrollEmployeeOption[], identities: TechnicalIdentity[]): string[] {
  const names = [
    ...payrollEmployees.map((employee) => employee.name),
    ...identities.map((identity) => identity.name),
  ].map(normalizeName).filter(Boolean);
  return Array.from(new Set(names));
}

function readField(row: unknown, field: string): string {
  if (!row || typeof row !== "object") return "";
  const value = (row as Record<string, unknown>)[field];
  return String(value ?? "").trim();
}

function birthFromResidentNo(residentNo: string): string {
  const raw = residentNo.replace(/[^0-9]/g, "");
  if (raw.length < 7) return "";
  const yy = Number(raw.slice(0, 2));
  const mm = raw.slice(2, 4);
  const dd = raw.slice(4, 6);
  const gender = raw[6];
  const century = gender === "1" || gender === "2" || gender === "5" || gender === "6" ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

function maskResidentNo(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "주민번호 없음";
  const raw = trimmed.replace(/[^0-9]/g, "");
  if (raw.length >= 7) return `${raw.slice(0, 6)}-${raw.slice(6, 7)}******`;
  return trimmed;
}

function candidateLabel(candidate: PayrollEmployeeOption, identities: TechnicalIdentity[]): string {
  const matchingIdentity = identities.find((identity) => {
    if (identity.residentNo && candidate.residentNo) {
      return identity.residentNo.replace(/[^0-9]/g, "").slice(0, 7) === candidate.residentNo.replace(/[^0-9]/g, "").slice(0, 7);
    }
    return normalizeName(identity.name) === normalizeName(candidate.name);
  });
  const birth = matchingIdentity?.birthDate || birthFromResidentNo(candidate.residentNo);
  const trade = matchingIdentity?.trade || candidate.jobTitle;
  return `${candidate.name} / ${trade || "직종 없음"} / ${birth || maskResidentNo(candidate.residentNo)} / ${candidate.rowKey}`;
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  return canvas;
}

function enhanceCanvasForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < image.data.length; i += 4) {
    const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const value = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function thresholdCanvasForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < image.data.length; i += 4) {
    const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const value = gray > 205 ? 255 : 0;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cropCanvas(
  source: HTMLCanvasElement,
  leftRatio: number,
  widthRatio: number,
  topRatio = 0,
  heightRatio = 1,
  scale = 1.8
): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(source.width * leftRatio));
  const sw = Math.min(source.width - sx, Math.floor(source.width * widthRatio));
  const sy = Math.max(0, Math.floor(source.height * topRatio));
  const sh = Math.min(source.height - sy, Math.floor(source.height * heightRatio));
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(sw * scale);
  canvas.height = Math.floor(sh * scale);
  canvas.getContext("2d")!.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeOcrRegions(source: HTMLCanvasElement): Array<{ canvas: HTMLCanvasElement; label: string }> {
  return [
    { canvas: cropCanvas(source, 0.05, 0.42, 0.16, 0.72), label: "표 왼쪽" },
    { canvas: cropCanvas(source, 0.10, 0.24, 0.16, 0.72, 2.4), label: "이름" },
  ];
}

function mergeOcrTexts(texts: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of texts) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const key = line.replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.join("\n");
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = image.width < 1200 ? 3 : image.width < 2200 ? 2 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToVisionImage(canvas: HTMLCanvasElement, label: string): VisionExtractImage {
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    label,
  };
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
    canvases.push(canvas);
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
  const [sourceOcrText, setSourceOcrText] = useState("");
  const [draftRows, setDraftRows] = useState<AdditionalWorkEntry[]>([]);
  const [payrollEmployees, setPayrollEmployees] = useState<PayrollEmployeeOption[]>([]);
  const [technicalIdentities, setTechnicalIdentities] = useState<TechnicalIdentity[]>([]);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const [outputBuffer, setOutputBuffer] = useState<ArrayBuffer | null>(null);
  const [result, setResult] = useState<AdditionalWorkPayrollResult | null>(null);

  const totalUnits = useMemo(() => draftRows.reduce((sum, row) => sum + row.units, 0), [draftRows]);
  const knownEmployeeNames = useMemo(
    () => collectKnownNames(payrollEmployees, technicalIdentities),
    [payrollEmployees, technicalIdentities]
  );
  const duplicateRows = useMemo(() => draftRows
    .map((row, index) => ({
      row,
      index,
      candidates: payrollEmployees.filter((employee) => normalizeName(employee.name) === normalizeName(row.name)),
    }))
    .filter((item) => item.candidates.length > 1 && !item.row.payrollRowKey),
  [draftRows, payrollEmployees]);

  useEffect(() => {
    Promise.all([loadEmployeesPH4FS(), loadEmployeesPH2FS()]).then(([ph4Rows, ph2Rows]) => {
      const next: TechnicalIdentity[] = [];
      for (const [site, rows] of [["PH4", ph4Rows], ["PH2", ph2Rows]] as const) {
        for (const row of rows ?? []) {
          const residentNo = readField(row, "주민번호");
          const name = readField(row, "이름") || readField(row, "성명");
          if (!name) continue;
          next.push({
            name,
            residentNo,
            birthDate: birthFromResidentNo(residentNo),
            trade: readField(row, "신청공종"),
            site,
          });
        }
      }
      setTechnicalIdentities(next);
    });
  }, []);

  useEffect(() => {
    if (!sourceOcrText.trim() || knownEmployeeNames.length === 0) return;
    const rows = parseAdditionalWorkText(sourceOcrText, { knownNames: knownEmployeeNames });
    if (rows.length <= draftRows.length) return;
    setDraftRows(rows);
    setRawText(formatRowsForText(rows));
    setResult(null);
    setOutputBuffer(null);
  }, [sourceOcrText, knownEmployeeNames, draftRows.length]);

  const createOcrWorker = useCallback(async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker("kor+eng", 1, {
      workerPath: publicAssetPath("tesseract/worker.min.js"),
      corePath: publicAssetPath("tesseract-core"),
      langPath: publicAssetPath("tessdata"),
      logger: (message: any) => {
        if (message?.status) {
          const pct = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
          setOcrMessage(`${message.status}${pct}`);
        }
      },
    } as any);
  }, []);

  const recognizeWithWorker = useCallback(async (worker: any, image: HTMLCanvasElement, pageSegMode: string): Promise<string> => {
    await worker.setParameters({
      tessedit_pageseg_mode: pageSegMode,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    } as any);
    const recognized = await worker.recognize(image as any);
    return recognized.data.text;
  }, []);

  const recognizeCanvasVariants = useCallback(async (worker: any, canvas: HTMLCanvasElement, label: string): Promise<string> => {
    const regions = makeOcrRegions(canvas);
    const variants = [
      { canvas: enhanceCanvasForOcr(regions[0].canvas), psm: "6", name: "표 왼쪽" },
      { canvas: enhanceCanvasForOcr(regions[1].canvas), psm: "6", name: "이름" },
    ];
    const texts: string[] = [];

    for (let i = 0; i < variants.length; i++) {
      setOcrMessage(`${label} OCR ${i + 1}/${variants.length} (${variants[i].name})`);
      texts.push(await recognizeWithWorker(worker, variants[i].canvas, variants[i].psm));
    }

    return mergeOcrTexts(texts);
  }, [recognizeWithWorker]);

  const extractCanvasesWithVision = useCallback(async (canvases: HTMLCanvasElement[], label: string) => {
    setOcrMessage(`${label} OpenAI Vision 추출 중`);
    const images = canvases.map((canvas, index) => canvasToVisionImage(canvas, `${label} ${index + 1}`));
    return extractAdditionalWorkWithVision(images, knownEmployeeNames);
  }, [knownEmployeeNames]);

  const extractScanFile = useCallback(async (file: File) => {
    setStep("extracting");
    setScanFileName(file.name);
    setRawText("");
    setSourceOcrText("");
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
          try {
            const visionResult = await extractCanvasesWithVision(canvases, "PDF");
            if (visionResult.rows.length > 0) {
              setSourceOcrText(visionResult.rawText);
              setDraftRows(visionResult.rows);
              setRawText(formatRowsForText(visionResult.rows));
              setStep("ready");
              toast.success(`${visionResult.rows.length}건의 추가공수 행을 OpenAI Vision으로 읽었습니다.`);
              return;
            }
          } catch (visionError) {
            console.warn("OpenAI Vision extraction failed, falling back to OCR.", visionError);
            setOcrMessage("OpenAI Vision 실패, 로컬 OCR 전환 중");
          }
          const ocrTexts: string[] = [];
          const worker = await createOcrWorker();
          try {
            for (let i = 0; i < canvases.length; i++) {
              ocrTexts.push(await recognizeCanvasVariants(worker, canvases[i], `페이지 ${i + 1}/${canvases.length}`));
            }
          } finally {
            await worker.terminate();
          }
          text = mergeOcrTexts(ocrTexts);
        }
      } else if (file.type.startsWith("image/")) {
        const canvas = await imageFileToCanvas(file);
        try {
          const visionResult = await extractCanvasesWithVision([canvas], "이미지");
          if (visionResult.rows.length > 0) {
            setSourceOcrText(visionResult.rawText);
            setDraftRows(visionResult.rows);
            setRawText(formatRowsForText(visionResult.rows));
            setStep("ready");
            toast.success(`${visionResult.rows.length}건의 추가공수 행을 OpenAI Vision으로 읽었습니다.`);
            return;
          }
        } catch (visionError) {
          console.warn("OpenAI Vision extraction failed, falling back to OCR.", visionError);
          setOcrMessage("OpenAI Vision 실패, 로컬 OCR 전환 중");
        }
        const worker = await createOcrWorker();
        try {
          text = await recognizeCanvasVariants(worker, canvas, "이미지");
        } finally {
          await worker.terminate();
        }
      } else {
        toast.error("PDF 또는 이미지 파일만 업로드할 수 있습니다.");
        setStep(rawText ? "ready" : "idle");
        return;
      }

      setSourceOcrText(text);
      const rows = parseAdditionalWorkText(text, { knownNames: knownEmployeeNames });
      setDraftRows(rows);
      setRawText(rows.length > 0 ? formatRowsForText(rows) : text);
      setStep("ready");
      const count = rows.length;
      if (count === 0) toast.warning("자동 추출이 실패했습니다. OCR 원문을 남겼으니 필요한 3개 항목만 정리해 주세요.");
      else toast.success(`${count}건의 추가공수 행을 읽었습니다.`);
    } catch (err: any) {
      toast.error(err?.message || "스캔본 텍스트 추출 중 오류가 발생했습니다.");
      setStep(rawText ? "ready" : "idle");
    } finally {
      setOcrMessage("");
    }
  }, [rawText, createOcrWorker, recognizeCanvasVariants, knownEmployeeNames, extractCanvasesWithVision]);

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
    const nextPayrollEmployees = readPayrollEmployeeOptions(buffer);
    setPayrollFileName(file.name);
    setPayrollBuffer(buffer);
    setPayrollEmployees(nextPayrollEmployees);
    setResult(null);
    setOutputBuffer(null);
    if (sourceOcrText.trim()) {
      const rows = parseAdditionalWorkText(sourceOcrText, {
        knownNames: collectKnownNames(nextPayrollEmployees, technicalIdentities),
      });
      if (rows.length > 0) {
        setDraftRows(rows);
        setRawText(formatRowsForText(rows));
      }
    }
    toast.success("급여대장을 불러왔습니다.");
  }, [sourceOcrText, technicalIdentities]);

  const handleApply = useCallback(async () => {
    if (!payrollBuffer || !payrollFileName) {
      toast.error("급여대장 엑셀을 먼저 업로드해 주세요.");
      return;
    }
    if (draftRows.length === 0) {
      toast.error("반영할 추가공수 행이 없습니다.");
      return;
    }
    if (duplicateRows.length > 0) {
      setDuplicateDialogOpen(true);
      toast.warning("동명이인이 있습니다. 적용할 대상을 먼저 선택해 주세요.");
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
    setSourceOcrText("");
    setDraftRows([]);
    setResult(null);
    setOutputBuffer(null);
    setStep("idle");
  }, []);

  const handleNeededTextChange = useCallback((value: string) => {
    setRawText(value);
    setDraftRows(parseAdditionalWorkText(value, { knownNames: knownEmployeeNames }));
    setResult(null);
    setOutputBuffer(null);
    if (value.trim()) setStep("ready");
  }, [knownEmployeeNames]);

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
    <div className="ops-scan mx-auto max-w-[1200px] space-y-4 p-4 md:p-6">
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>동명이인 선택 필요</DialogTitle>
            <DialogDescription>
              기술인 및 관리자 명단의 생년월일/주민번호 정보를 참고해서 급여대장에서 반영할 사람을 선택해 주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-extrabold text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">추출 이름</th>
                  <th className="px-3 py-2 text-right">공수</th>
                  <th className="px-3 py-2 text-left">선택</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {duplicateRows.map(({ row, index, candidates }) => (
                  <tr key={`${row.name}-${index}`}>
                    <td className="px-3 py-2 font-bold text-slate-900">{row.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.units.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={row.payrollRowKey ?? ""}
                        onChange={(event) => updateDraftRow(index, { payrollRowKey: event.target.value || undefined })}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="">선택 필요</option>
                        {candidates.map((candidate) => (
                          <option key={candidate.rowKey} value={candidate.rowKey}>
                            {candidateLabel(candidate, technicalIdentities)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDuplicateDialogOpen(false)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={() => setDuplicateDialogOpen(false)}
              disabled={duplicateRows.some((item) => !draftRows[item.index]?.payrollRowKey)}
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              선택 완료
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ScanText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-950">추가공수 스캔본 추출</h2>
            <p className="text-xs font-semibold text-slate-500">스캔본의 이름과 추가요청공수만 읽어서 급여대장 경비(2)에 반영</p>
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
              <p className="text-xs font-semibold text-slate-500">{scanFileName || "이름, 추가요청공수만 표시됩니다."}</p>
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
                placeholder={"예)\n송승석 1.00\n정회옥 1.00\n유진환 2.00"}
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
                      <th className="px-3 py-2 text-right">공수</th>
                      <th className="w-10 px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftRows.map((row: AdditionalWorkEntry, index) => (
                      <tr key={`${row.name}-${index}`}>
                        <td className="px-2 py-2">
                          <input
                            value={row.name}
                            list="payroll-employee-options"
                            onChange={(event) => updateDraftRow(index, { name: event.target.value, payrollRowKey: undefined })}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                          />
                          {payrollEmployees.filter((employee) => normalizeName(employee.name) === normalizeName(row.name)).length > 1 && (
                            <div className="mt-1 text-[11px] font-bold text-amber-700">동명이인 있음</div>
                          )}
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
                    <td className="px-3 py-2 text-right font-mono">{row.units.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.expense2Before)} → {formatMoney(row.expense2After)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(row.salaryBefore)} → {formatMoney(row.salaryAfter)}</td>
                    <td className="px-3 py-2 text-slate-500">{row.sheetName} {row.rowNumber}행</td>
                  </tr>
                ))}
                {result.unmatched.map((row) => (
                  <tr key={`unmatched-${row.name}`} className="bg-amber-50/60">
                    <td className="px-3 py-2 font-bold text-amber-900">{row.name}</td>
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
