import { useCallback, useRef, useState } from "react";
import { Upload, Download, CheckCircle, Loader2, ChevronDown, ChevronUp, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { processPayroll, type PayrollCorrection } from "@/lib/payrollProcessor";
import { fetchAttendanceFS } from "@/lib/firestoreAttendance";
import { loadScheduleFS } from "@/lib/firestoreService";
import type { ScheduleData } from "@/lib/geminiService";

type Step = "idle" | "processing" | "done";

interface CorrectionCardProps {
  correction: PayrollCorrection;
}

function CorrectionCard({ correction }: CorrectionCardProps) {
  const [open, setOpen] = useState(false);
  const diff = correction.totalAfter - correction.totalBefore;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-white shadow-sm">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="font-bold text-sm text-foreground">{correction.name}</span>
            <span className="text-xs text-muted-foreground">{correction.jobTitle}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-red-500 font-mono">{correction.totalBefore.toFixed(3)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="text-green-600 font-bold font-mono">{correction.totalAfter.toFixed(3)}</span>
            <span className="ml-1 bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 text-[10px] font-bold">
              +{diff.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-xs">{correction.changes.length}건 수정</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border">
          <div className="mt-3 grid grid-cols-2 gap-4">
            {/* 수정 전 */}
            <div>
              <div className="text-[11px] font-bold text-red-500 mb-2">수정 전</div>
              <div className="space-y-1">
                {correction.changes.map((c) => (
                  <div key={c.day} className="flex items-center justify-between text-xs bg-red-50 rounded-lg px-3 py-1.5">
                    <span className="text-slate-600">{c.day}일</span>
                    <span className="font-mono text-red-500">{c.before.toFixed(1)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs bg-red-100 rounded-lg px-3 py-1.5 font-bold">
                  <span>총공수</span>
                  <span className="font-mono text-red-600">{correction.totalBefore.toFixed(3)}</span>
                </div>
              </div>
            </div>
            {/* 수정 후 */}
            <div>
              <div className="text-[11px] font-bold text-green-600 mb-2">수정 후</div>
              <div className="space-y-1">
                {correction.changes.map((c) => (
                  <div key={c.day} className="flex items-center justify-between text-xs bg-green-50 rounded-lg px-3 py-1.5">
                    <span className="text-slate-600">{c.day}일 <span className="text-[10px] text-muted-foreground">({c.reason})</span></span>
                    <span className="font-mono text-green-700 font-bold">{c.after.toFixed(1)} ✓</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs bg-green-100 rounded-lg px-3 py-1.5 font-bold">
                  <span>총공수</span>
                  <span className="font-mono text-green-700">{correction.totalAfter.toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PayrollPage() {
  const [step, setStep] = useState<Step>("idle");
  const [corrections, setCorrections] = useState<PayrollCorrection[]>([]);
  const [outputBuffer, setOutputBuffer] = useState<ArrayBuffer | null>(null);
  const [originalFileName, setOriginalFileName] = useState("");
  const [yearMonth, setYearMonth] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setStep("processing");
    setCorrections([]);
    setOutputBuffer(null);
    setOriginalFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();

      // Firestore에서 연차 데이터 및 주간일정 가져오기
      const [attendanceResult, scheduleData] = await Promise.all([
        fetchAttendanceFS(),
        loadScheduleFS().catch(() => null) as Promise<ScheduleData | null>,
      ]);

      const annualLeaveMap = attendanceResult?.data?.annualLeaveMap ?? {};
      const leaveDetails = attendanceResult?.data?.leaveDetails ?? [];
      const employees = attendanceResult?.data?.employees ?? [];

      const result = await processPayroll(buffer, annualLeaveMap, leaveDetails, employees, scheduleData);

      setCorrections(result.corrections);
      setOutputBuffer(result.outputBuffer);
      setYearMonth(`${result.year}년 ${result.month}월`);
      setStep("done");

      if (result.corrections.length === 0) {
        toast.info("보정이 필요한 월급제 직원이 없습니다.");
      } else {
        toast.success(`${result.corrections.length}명의 근태실적이 보정되었습니다.`);
      }
    } catch (err: any) {
      toast.error(err.message || "파일 처리 중 오류가 발생했습니다.");
      setStep("idle");
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".xlsx")) processFile(file);
    else toast.error("xlsx 파일만 업로드 가능합니다.");
  }, [processFile]);

  const handleDownload = useCallback(() => {
    if (!outputBuffer) return;
    const blob = new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = originalFileName.replace(".xlsx", "_보정완료.xlsx");
    a.click();
    URL.revokeObjectURL(url);
  }, [outputBuffer, originalFileName]);

  const handleReset = () => {
    setStep("idle");
    setCorrections([]);
    setOutputBuffer(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-lg font-extrabold text-foreground">급여대장</h2>
          <p className="text-xs text-muted-foreground">
            월급제 직원의 연차·공휴일·휴무일을 반영해 총공수 25를 자동 보정합니다
          </p>
        </div>
      </div>

      {/* 업로드 영역 */}
      {step === "idle" && (
        <div
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-bold text-foreground">급여대장 Excel 파일을 드래그하거나 클릭해서 업로드</p>
          <p className="text-xs text-muted-foreground mt-1">.xlsx 형식만 지원</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* 처리 중 */}
      {step === "processing" && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <div className="text-center">
            <p className="font-bold text-foreground">자동 보정 처리 중...</p>
            <p className="text-xs text-muted-foreground mt-1">연차현황 및 주간일정 확인 후 근태실적을 보정하고 있습니다</p>
          </div>
        </div>
      )}

      {/* 완료 */}
      {step === "done" && (
        <div className="space-y-4">
          {/* 결과 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="font-bold text-foreground">
                  {yearMonth} 급여대장 보정 완료
                </p>
                <p className="text-xs text-muted-foreground">
                  {corrections.length > 0
                    ? `월급제 직원 ${corrections.length}명 수정됨`
                    : "보정 대상 없음"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                다시 업로드
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Download className="h-4 w-4" />
                수정된 Excel 다운로드
              </button>
            </div>
          </div>

          {/* 수정 없음 메시지 */}
          {corrections.length === 0 && (
            <div className="rounded-xl border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              모든 월급제 직원의 총공수가 이미 정상입니다.
            </div>
          )}

          {/* 수정 카드 목록 */}
          {corrections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                수정된 직원 ({corrections.length}명) — 클릭하면 상세 확인
              </p>
              {corrections.map((c, i) => (
                <CorrectionCard key={i} correction={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
