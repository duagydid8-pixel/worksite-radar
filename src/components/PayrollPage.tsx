import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, CheckCircle, Loader2, ChevronDown, ChevronUp, FileSpreadsheet, CalendarX, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { processPayroll, type PayrollCorrection } from "@/lib/payrollProcessor";
import { fetchAttendanceFS } from "@/lib/firestoreAttendance";
import { loadManualAbsencesFS, loadScheduleFS, saveManualAbsencesFS } from "@/lib/firestoreService";
import type { ScheduleData } from "@/lib/scheduleTypes";
import { expandDateRange, type ManualAbsence } from "@/lib/manualAbsences";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Step = "idle" | "processing" | "done";

interface CorrectionCardProps {
  correction: PayrollCorrection;
}

function todayInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeAbsenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sortAbsences(rows: ManualAbsence[]): ManualAbsence[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function CorrectionCard({ correction }: CorrectionCardProps) {
  const [open, setOpen] = useState(false);
  const diff = correction.totalAfter - correction.totalBefore;
  const diffLabel = diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
  const diffClass = diff < 0
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-green-50 text-green-700 border-green-200";
  const afterClass = diff < 0 ? "text-red-600" : "text-green-600";

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
            <span className={`${afterClass} font-bold font-mono`}>{correction.totalAfter.toFixed(3)}</span>
            <span className={`ml-1 border rounded-full px-2 py-0.5 text-[10px] font-bold ${diffClass}`}>
              {diffLabel}
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
              <div className={`text-[11px] font-bold mb-2 ${diff < 0 ? "text-red-600" : "text-green-600"}`}>수정 후</div>
              <div className="space-y-1">
                {correction.changes.map((c) => (
                  <div key={c.day} className={`flex items-center justify-between text-xs rounded-lg px-3 py-1.5 ${c.after < c.before ? "bg-red-50" : "bg-green-50"}`}>
                    <span className="text-slate-600">{c.day}일 <span className="text-[10px] text-muted-foreground">({c.reason})</span></span>
                    <span className={`font-mono font-bold ${c.after < c.before ? "text-red-700" : "text-green-700"}`}>{c.after.toFixed(1)} ✓</span>
                  </div>
                ))}
                <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-1.5 font-bold ${diff < 0 ? "bg-red-100" : "bg-green-100"}`}>
                  <span>총공수</span>
                  <span className={`font-mono ${diff < 0 ? "text-red-700" : "text-green-700"}`}>{correction.totalAfter.toFixed(3)}</span>
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
  const [sourceBuffer, setSourceBuffer] = useState<ArrayBuffer | null>(null);
  const [originalFileName, setOriginalFileName] = useState("");
  const [yearMonth, setYearMonth] = useState("");
  const [dragging, setDragging] = useState(false);
  const [absenceDialogOpen, setAbsenceDialogOpen] = useState(false);
  const [manualAbsences, setManualAbsences] = useState<ManualAbsence[]>([]);
  const [absenceStartDate, setAbsenceStartDate] = useState(todayInputValue);
  const [absenceEndDate, setAbsenceEndDate] = useState("");
  const [absenceName, setAbsenceName] = useState("");
  const [absenceMemo, setAbsenceMemo] = useState("");
  const [savingAbsence, setSavingAbsence] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadManualAbsencesFS().then((rows) => setManualAbsences(sortAbsences(rows)));
  }, []);

  const processBuffer = useCallback(async (
    buffer: ArrayBuffer,
    fileName: string,
    manualAbsenceOverride?: ManualAbsence[]
  ) => {
    setStep("processing");
    setCorrections([]);
    setOutputBuffer(null);
    setSourceBuffer(buffer);
    setOriginalFileName(fileName);

    const [attendanceResult, scheduleData, savedManualAbsences] = await Promise.all([
      fetchAttendanceFS(),
      loadScheduleFS().catch(() => null) as Promise<ScheduleData | null>,
      manualAbsenceOverride ? Promise.resolve(manualAbsenceOverride) : loadManualAbsencesFS(),
    ]);

    const annualLeaveMap = attendanceResult?.data?.annualLeaveMap ?? {};
    const leaveDetails = attendanceResult?.data?.leaveDetails ?? [];
    const employees = attendanceResult?.data?.employees ?? [];
    setManualAbsences(sortAbsences(savedManualAbsences));

    const result = await processPayroll(buffer, annualLeaveMap, leaveDetails, employees, scheduleData, savedManualAbsences);

    setCorrections(result.corrections);
    setOutputBuffer(result.outputBuffer);
    setYearMonth(`${result.year}년 ${result.month}월`);
    setStep("done");

    if (result.corrections.length === 0) {
      toast.info("보정이 필요한 월급제 직원이 없습니다.");
    } else {
      toast.success(`${result.corrections.length}명의 근태실적이 보정되었습니다.`);
    }
  }, []);

  const reprocessCurrentFile = useCallback(async (nextAbsences: ManualAbsence[]) => {
    if (!sourceBuffer || !originalFileName) return;
    try {
      await processBuffer(sourceBuffer, originalFileName, nextAbsences);
      toast.success("결근 변경사항을 급여대장에 다시 반영했습니다.");
    } catch (err: any) {
      toast.error(err.message || "결근 변경사항 재반영 중 오류가 발생했습니다.");
    }
  }, [originalFileName, processBuffer, sourceBuffer]);

  const persistManualAbsences = useCallback(async (next: ManualAbsence[]): Promise<ManualAbsence[] | null> => {
    const sorted = sortAbsences(next);
    setManualAbsences(sorted);
    const ok = await saveManualAbsencesFS(sorted);
    if (!ok) toast.error("결근 목록 저장에 실패했습니다.");
    return ok ? sorted : null;
  }, []);

  const handleAbsenceSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const startDate = absenceStartDate.trim();
    const endDate = absenceEndDate.trim();
    const name = absenceName.trim();
    const memo = absenceMemo.trim();

    if (!startDate || !name) {
      toast.error("시작일과 이름을 입력해주세요.");
      return;
    }

    const dates = expandDateRange(startDate, endDate);
    if (dates.length === 0) {
      toast.error("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }

    const existingKeys = new Set(manualAbsences.map((row) => `${row.date}|${row.name.trim()}`));
    const createdAt = new Date().toISOString();
    const additions = dates
      .filter((date) => !existingKeys.has(`${date}|${name}`))
      .map((date) => ({ id: makeAbsenceId(), date, name, memo, createdAt }));

    if (additions.length === 0) {
      toast.info("선택한 기간은 이미 모두 입력되어 있습니다.");
      return;
    }

    setSavingAbsence(true);
    const next = [...manualAbsences, ...additions];
    const saved = await persistManualAbsences(next);
    setSavingAbsence(false);
    if (!saved) return;

    setAbsenceName("");
    setAbsenceMemo("");
    toast.success(`${additions.length}건의 결근이 저장되었습니다.`);
    await reprocessCurrentFile(saved);
  }, [absenceEndDate, absenceMemo, absenceName, absenceStartDate, manualAbsences, persistManualAbsences, reprocessCurrentFile]);

  const handleDeleteAbsence = useCallback(async (id: string) => {
    const next = manualAbsences.filter((row) => row.id !== id);
    const saved = await persistManualAbsences(next);
    if (saved) {
      toast.success("결근이 삭제되었습니다.");
      await reprocessCurrentFile(saved);
    }
  }, [manualAbsences, persistManualAbsences, reprocessCurrentFile]);

  const processFile = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      await processBuffer(buffer, file.name);
    } catch (err: any) {
      toast.error(err.message || "파일 처리 중 오류가 발생했습니다.");
      setStep("idle");
    }
  }, [processBuffer]);

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
    setSourceBuffer(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h2 className="text-lg font-extrabold text-foreground">급여대장</h2>
          <p className="text-xs text-muted-foreground">
            월급제 직원의 연차·공휴일·휴무일을 반영해 총공수 25를 자동 보정합니다
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbsenceDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
        >
          <CalendarX className="h-4 w-4" />
          결근 입력
          {manualAbsences.length > 0 && (
            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-rose-700">{manualAbsences.length}</span>
          )}
        </button>
      </div>

      <Dialog open={absenceDialogOpen} onOpenChange={setAbsenceDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>결근 직접 입력</DialogTitle>
            <DialogDescription>
              하루만 입력하거나 기간을 선택하면 해당 날짜 공수를 0으로 처리합니다.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAbsenceSubmit} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[150px_150px_1fr]">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-muted-foreground">시작일</span>
                <input
                  type="date"
                  value={absenceStartDate}
                  onChange={(e) => setAbsenceStartDate(e.target.value)}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-muted-foreground">종료일</span>
                <input
                  type="date"
                  value={absenceEndDate}
                  onChange={(e) => setAbsenceEndDate(e.target.value)}
                  min={absenceStartDate}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-muted-foreground">이름</span>
                <input
                  value={absenceName}
                  onChange={(e) => setAbsenceName(e.target.value)}
                  placeholder="이름"
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={absenceMemo}
              onChange={(e) => setAbsenceMemo(e.target.value)}
              placeholder="메모"
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={savingAbsence}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
            >
              {savingAbsence ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              추가
            </button>
            </div>
          </form>

          <div className="max-h-80 overflow-auto rounded-xl border border-border">
            {manualAbsences.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">입력된 결근이 없습니다.</div>
            ) : (
              <div className="divide-y divide-border">
                {manualAbsences.map((row) => (
                  <div key={row.id} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 px-4 py-3 text-sm">
                    <span className="font-mono text-slate-600">{row.date}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-foreground">{row.name}</div>
                      {row.memo && <div className="truncate text-xs text-muted-foreground">{row.memo}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteAbsence(row.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-700"
                      aria-label={`${row.name} ${row.date} 결근 삭제`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
