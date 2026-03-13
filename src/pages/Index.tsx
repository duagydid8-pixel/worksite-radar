import { useState, useMemo, useCallback, useEffect } from "react";
import FileUploadZone from "@/components/FileUploadZone";
import StatCard from "@/components/StatCard";
import AttendanceTable from "@/components/AttendanceTable";
import { parseExcelFile, type ParsedData, type Employee } from "@/lib/parseExcel";
import { saveToSupabase, fetchFromSupabase } from "@/lib/supabaseSync";
import { toast } from "sonner";
import { Upload, CloudUpload, Loader2 } from "lucide-react";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const y1 = monday.getFullYear();
  const m1 = monday.getMonth() + 1;
  const d1 = monday.getDate();
  const m2 = sunday.getMonth() + 1;
  const d2 = sunday.getDate();
  return `${y1}년 ${m1}월 ${d1}일(${DAY_NAMES[monday.getDay()]}) ~ ${m2}월 ${d2}일(${DAY_NAMES[sunday.getDay()]})`;
}

type TeamFilter = "전체" | "한성" | "태화";

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

function formatUploadTime(isoStr: string): string {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}년 ${mo}월 ${day}일 ${h}:${mi}`;
}

const Index = () => {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("전체");
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingBuffer, setPendingBuffer] = useState<ArrayBuffer | null>(null);

  // On mount, fetch from Supabase
  useEffect(() => {
    (async () => {
      try {
        const result = await fetchFromSupabase();
        if (result) {
          setData(result.data);
          setLastUploadedAt(result.uploadedAt);
        }
      } catch {
        // silently fail, user can upload manually
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const monday = useMemo(() => getMonday(new Date(selectedDate)), [selectedDate]);

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [monday]);

  const handleFileLoaded = useCallback((buffer: ArrayBuffer) => {
    try {
      const parsed = parseExcelFile(buffer);
      setData(parsed);
      setPendingBuffer(buffer);
      toast.success(`${parsed.employees.length}명의 데이터를 불러왔습니다. "업로드 & 저장" 버튼을 눌러 저장하세요.`);
    } catch (err: any) {
      toast.error(err.message || "파일 파싱 오류");
    }
  }, []);

  const handleSaveToCloud = useCallback(async () => {
    if (!data || !fileName) {
      toast.error("먼저 엑셀 파일을 업로드하세요.");
      return;
    }
    setIsSaving(true);
    try {
      await saveToSupabase(data, fileName);
      setLastUploadedAt(new Date().toISOString());
      setPendingBuffer(null);
      toast.success("데이터가 클라우드에 저장되었습니다!");
    } catch (err: any) {
      toast.error(`저장 실패: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [data, fileName]);

  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const weekMonth = monday.getMonth() + 1;
    const weekYear = monday.getFullYear();

    let emps = data.employees.filter((e) => e.dataYear === weekYear && e.dataMonth === weekMonth);
    if (emps.length === 0) emps = data.employees;

    if (teamFilter === "한성") return emps.filter((e) => e.team === "한성_F");
    if (teamFilter === "태화") return emps.filter((e) => e.team === "태화_F");

    const hanseong = emps.filter((e) => e.team === "한성_F");
    const taehwa = emps.filter((e) => e.team === "태화_F");
    return [...hanseong, ...taehwa];
  }, [data, teamFilter, monday]);

  const anomalyMap = useMemo(() => {
    if (!data) return new Map();
    const map = new Map();
    for (const a of data.anomalies) map.set(a.name, a);
    return map;
  }, [data]);

  const stats = useMemo(() => {
    const total = filteredEmployees.length;
    let 지각 = 0;
    let 연차 = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekMonth = monday.getMonth() + 1;
    const weekYear = monday.getFullYear();
    const daysInMonth = new Date(weekYear, weekMonth, 0).getDate();

    for (const emp of filteredEmployees) {
      let empLate = 0;
      let empLeave = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(weekYear, weekMonth - 1, d);
        dateObj.setHours(0, 0, 0, 0);
        if (dateObj > today) break;
        const dow = dateObj.getDay();
        if (dow === 0 || dow === 6) continue;

        const leaveKey = `${weekYear}|${weekMonth}|${d}`;
        if (data?.annualLeaveMap[emp.name]?.[leaveKey]) {
          empLeave++;
          continue;
        }

        const key = `${weekYear}-${weekMonth}-${d}`;
        const rec = emp.dailyRecords[key];
        if (rec?.punchIn && isLate(rec.punchIn)) empLate++;
      }

      지각 += empLate;
      연차 += empLeave;
    }

    return { total, 지각, 연차 };
  }, [filteredEmployees, data, monday]);

  const filterButtons: { label: string; value: TeamFilter }[] = [
    { label: "전체", value: "전체" },
    { label: "한성", value: "한성" },
    { label: "태화", value: "태화" },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-foreground">📋 P4-PH4 초순수 현장 — 주간 근태보고</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            평택 한성크린텍 · XERP / 지문 기록 기반 자동집계
            {lastUploadedAt && (
              <span className="ml-3 text-secondary">
                📤 최종 업데이트: {formatUploadTime(lastUploadedAt)}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <FileUploadZone
              onFileLoaded={handleFileLoaded}
              fileName={fileName}
              onClear={() => { setData(null); setFileName(null); setPendingBuffer(null); }}
              onFileName={setFileName}
            />
          </div>
          {fileName && data && (
            <button
              onClick={handleSaveToCloud}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4" />
              )}
              {isSaving ? "저장 중..." : "업로드 & 저장"}
            </button>
          )}
        </div>

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5">
              <span className="text-[11px] font-bold text-muted-foreground bg-muted px-2.5 py-1 rounded">📅 보고기준일</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-[#1a2f4a] border-[1.5px] border-primary text-primary text-sm font-bold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="text-xs font-semibold text-secondary bg-secondary/10 border border-secondary/25 px-3 py-1.5 rounded-lg">
                {formatWeekRange(monday)}
              </div>
              <div className="flex gap-1.5 ml-auto">
                {filterButtons.map((btn) => (
                  <button
                    key={btn.value}
                    onClick={() => setTeamFilter(btn.value)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors border ${
                      teamFilter === btn.value
                        ? "bg-primary border-primary text-foreground"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2.5 flex-wrap">
              <StatCard label="조회 인원" value={stats.total} icon="👥" />
              <StatCard label="지각(이번달)" value={stats.지각} variant="yellow" icon="🕐" />
              <StatCard label="연차(이번달)" value={stats.연차} variant="teal" icon="📅" />
            </div>

            <AttendanceTable
              employees={filteredEmployees}
              anomalyMap={anomalyMap}
              annualLeaveMap={data.annualLeaveMap}
              weekDates={weekDates}
              dataYear={data.dataYear}
              dataMonth={data.dataMonth}
            />
          </>
        )}

        {!data && (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4">⬆️</div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              Excel 파일을 업로드하면 근태 현황이 자동 표시됩니다
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-muted px-1.5 py-0.5 rounded text-secondary text-[11px]">XERP 기록</code> +{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-secondary text-[11px]">지문 기록</code> 시트가 포함된 엑셀 파일
            </p>
            {lastUploadedAt && (
              <p className="text-xs text-muted-foreground mt-4">
                💡 저장된 데이터가 없습니다. 새 파일을 업로드하세요.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
