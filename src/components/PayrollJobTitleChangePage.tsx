import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FilePenLine,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  changePayrollJobTitles,
  type PayrollJobTitleChange,
  type PayrollJobTitleChangeResult,
} from "@/lib/payrollJobTitleChanger";

type Step = "idle" | "processing" | "done";

const JOB_TITLE_LIST_URL = "/payroll-job-titles.xlsx";

function makeDownloadName(fileName: string): string {
  return fileName.replace(/\.xlsx?$/i, "") + "_직종변경완료.xlsx";
}

function reasonLabel(change: PayrollJobTitleChange): string {
  return change.reason === "manager" ? "관리자 정리" : "직종표 미등록";
}

async function fetchJobTitleListBuffer(): Promise<ArrayBuffer> {
  const response = await fetch(JOB_TITLE_LIST_URL);
  if (!response.ok) {
    throw new Error("직종표 파일을 불러오지 못했습니다.");
  }
  return response.arrayBuffer();
}

export default function PayrollJobTitleChangePage() {
  const [step, setStep] = useState<Step>("idle");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<PayrollJobTitleChangeResult | null>(null);
  const [outputBuffer, setOutputBuffer] = useState<ArrayBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("xlsx 파일만 업로드 가능합니다.");
      return;
    }

    setStep("processing");
    setFileName(file.name);
    setResult(null);
    setOutputBuffer(null);

    try {
      const [payrollBuffer, jobListBuffer] = await Promise.all([
        file.arrayBuffer(),
        fetchJobTitleListBuffer(),
      ]);
      const nextResult = await changePayrollJobTitles(payrollBuffer, jobListBuffer);
      setResult(nextResult);
      setOutputBuffer(nextResult.changes.length > 0 ? nextResult.outputBuffer : null);
      setStep("done");

      if (nextResult.changes.length === 0) {
        toast.info("변경할 직종이 없습니다.");
      } else {
        toast.success(`${nextResult.changes.length}건의 직종을 변경했습니다.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "직종변경 처리 중 오류가 발생했습니다.");
      setStep("idle");
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  }, [processFile]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  }, [processFile]);

  const handleDownload = useCallback(() => {
    if (!outputBuffer || !fileName) return;

    const blob = new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = makeDownloadName(fileName);
    a.click();
    URL.revokeObjectURL(url);
  }, [fileName, outputBuffer]);

  const handleReset = useCallback(() => {
    setStep("idle");
    setFileName("");
    setResult(null);
    setOutputBuffer(null);
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <FilePenLine className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-950">급여대장 직종변경</h2>
            <p className="text-xs font-semibold text-slate-500">
              관리자류는 관리자, 직종표 미등록 기술인은 보통인부로 정리
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={step === "processing"}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          급여대장 업로드
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
      </div>

      {step === "idle" && (
        <div
          className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-400"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <p className="text-sm font-extrabold text-slate-950">급여대장 Excel 파일을 드래그하거나 클릭해서 업로드</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">.xlsx 형식만 지원합니다.</p>
        </div>
      )}

      {step === "processing" && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white py-12 shadow-sm">
          <Loader2 className="h-10 w-10 animate-spin text-slate-900" />
          <div className="text-center">
            <p className="text-sm font-extrabold text-slate-950">직종 변경 처리 중</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{fileName}</p>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-extrabold text-slate-400">전체 변경</div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">{result.summary.total}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-extrabold text-slate-400">관리자 변경</div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">{result.summary.manager}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-extrabold text-slate-400">보통인부 변경</div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">{result.summary.fallback}</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {result.changes.length > 0 ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-slate-950">
                  {result.changes.length > 0 ? "직종변경 완료" : "변경할 직종 없음"}
                </p>
                <p className="truncate text-xs font-semibold text-slate-500">{fileName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              다시 업로드
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!outputBuffer}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              변경 파일 저장
            </button>
          </div>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-extrabold text-slate-950">변경 내역</h3>
            </div>
            {result.changes.length === 0 ? (
              <div className="p-8 text-center text-sm font-semibold text-slate-400">
                직종표 기준으로 변경할 행이 없습니다.
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-extrabold text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">행</th>
                      <th className="px-3 py-2 text-left">성명</th>
                      <th className="px-3 py-2 text-left">변경 전</th>
                      <th className="px-3 py-2 text-left">변경 후</th>
                      <th className="px-3 py-2 text-left">사유</th>
                      <th className="px-3 py-2 text-left">시트</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.changes.map((change) => (
                      <tr key={`${change.sheetName}-${change.rowNumber}`}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{change.rowNumber}</td>
                        <td className="px-3 py-2 font-bold text-slate-950">{change.name}</td>
                        <td className="px-3 py-2 text-slate-600">{change.before}</td>
                        <td className="px-3 py-2 font-bold text-slate-950">{change.after}</td>
                        <td className="px-3 py-2 text-xs font-bold text-slate-500">{reasonLabel(change)}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-xs text-slate-400">{change.sheetName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
