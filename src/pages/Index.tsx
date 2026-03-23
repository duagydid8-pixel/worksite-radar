import { useState, useMemo, useCallback, useEffect } from "react";
import FileUploadZone from "@/components/FileUploadZone";
import StatCard from "@/components/StatCard";
import AttendanceTable from "@/components/AttendanceTable";
import AnnualLeavePanel from "@/components/AnnualLeavePanel";
import { parseExcelFile, type ParsedData } from "@/lib/parseExcel";
import { saveToSupabase, fetchFromSupabase, saveRowOrder, fetchRowOrder } from "@/lib/supabaseSync";
import { toast } from "sonner";
import { CloudUpload, Loader2, Search, X, Download } from "lucide-react";
import { exportAttendanceExcel } from "@/lib/exportExcel";

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
type ActiveTab = "근태보고" | "연차관리";

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

function formatUploadTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const ROW_ORDER_CONTEXTS = ["attendance_한성_F", "attendance_태화_F", "leave"];

const Index = () => {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("전체");
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingBuffer, setPendingBuffer] = useState<ArrayBuffer | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("근태보고");
  const [rowOrders, setRowOrders] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 8000);
    (async () => {
      try {
        const [result, ...orders] = await Promise.all([
          fetchFromSupabase(),
          ...ROW_ORDER_CONTEXTS.map((ctx) => fetchRowOrder(ctx).then((names) => ({ ctx, names }))),
        ]);
        if (result) {
          setData(result.data);
          setLastUploadedAt(result.uploadedAt);
        }
        const orderMap: Record<string, string[]> = {};
        for (const o of orders as { ctx: string; names: string[] }[]) {
          orderMap[o.ctx] = o.names;
        }
        setRowOrders(orderMap);
      } catch {
        // silently fail
      } finally {
        clearTimeout(timeout);
        setIsLoading(false);
      }
    })();
  }, []);

  const monday = useMemo(() => getMonday(new Date(selectedDate)), [selectedDate]);

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    }),
  [monday]);

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
    if (!data || !fileName) { toast.error("먼저 엑셀 파일을 업로드하세요."); return; }
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

  const handleOrderChange = useCallback(async (context: string, names: string[]) => {
    setRowOrders((prev) => ({ ...prev, [context]: names }));
    try {
      await saveRowOrder(context, names);
    } catch {
      // silently fail
    }
  }, []);

  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const weekMonth = monday.getMonth() + 1;
    const weekYear = monday.getFullYear();
    let emps = data.employees.filter((e) => e.dataYear === weekYear && e.dataMonth === weekMonth);
    if (emps.length === 0) emps = data.employees;
    if (teamFilter === "한성") return emps.filter((e) => e.team === "한성_F");
    if (teamFilter === "태화") return emps.filter((e) => e.team === "태화_F");
    const sorted = [...emps.filter((e) => e.team === "한성_F"), ...emps.filter((e) => e.team === "태화_F")];
    if (!searchQuery.trim()) return sorted;
    return sorted.filter((e) => e.name.includes(searchQuery.trim()));
  }, [data, teamFilter, monday, searchQuery]);

  const anomalyMap = useMemo(() => {
    if (!data) return new Map();
    const map = new Map();
    for (const a of data.anomalies) map.set(a.name, a);
    return map;
  }, [data]);

  // 이번주 stats
  const weekStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let lateEmps = 0;
    let uncheckEmps = 0;
    let leaveEmps = 0;

    for (const emp of filteredEmployees) {
      let empLate = false;
      let empUncheck = false;
      let empLeave = false;

      for (let i = 0; i < 6; i++) {
        const wd = weekDates[i];
        if (!wd) continue;
        const cellDate = new Date(wd);
        cellDate.setHours(0, 0, 0, 0);
        if (cellDate > today) continue;
        const dow = wd.getDay();
        if (dow === 0 || dow === 6) continue;

        const leaveKey = `${wd.getFullYear()}|${wd.getMonth() + 1}|${wd.getDate()}`;
        if (data?.annualLeaveMap[emp.name]?.[leaveKey]) { empLeave = true; continue; }

        const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
        const rec = emp.dailyRecords[key];
        if (rec?.punchIn && isLate(rec.punchIn)) empLate = true;
        const isToday = cellDate.getTime() === today.getTime();
        if (!isToday && emp.team === "태화_F" && rec?.punchIn && !rec.punchOut) empUncheck = true;
      }

      if (empLate) lateEmps++;
      if (empUncheck) uncheckEmps++;
      if (empLeave) leaveEmps++;
    }

    return { total: filteredEmployees.length, late: lateEmps, uncheck: uncheckEmps, leave: leaveEmps };
  }, [filteredEmployees, weekDates, data]);

  // 이번달 stats
  const monthStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekMonth = monday.getMonth() + 1;
    const weekYear = monday.getFullYear();
    const daysInMonth = new Date(weekYear, weekMonth, 0).getDate();
    let lateTotal = 0;
    let uncheckTotal = 0;
    let leaveTotal = 0;

    for (const emp of filteredEmployees) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(weekYear, weekMonth - 1, d);
        dateObj.setHours(0, 0, 0, 0);
        if (dateObj > today) break;
        const dow = dateObj.getDay();
        if (dow === 0 || dow === 6) continue;

        const leaveKey = `${weekYear}|${weekMonth}|${d}`;
        if (data?.annualLeaveMap[emp.name]?.[leaveKey]) { leaveTotal++; continue; }

        const key = `${weekYear}-${weekMonth}-${d}`;
        const rec = emp.dailyRecords[key];
        if (rec?.punchIn && isLate(rec.punchIn)) lateTotal++;
        const isToday = dateObj.getTime() === today.getTime();
        if (!isToday && emp.team === "태화_F" && rec?.punchIn && !rec.punchOut) uncheckTotal++;
      }
    }

    return { total: filteredEmployees.length, late: lateTotal, uncheck: uncheckTotal, leave: leaveTotal };
  }, [filteredEmployees, data, monday]);

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
      {/* Header */}
      <div className="border-b border-border bg-white px-6 py-4 flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="회사 로고" className="h-14 w-auto object-contain shrink-0 cursor-pointer" onClick={() => window.location.reload()} />
          <div className="w-px h-8 bg-border shrink-0" />
          <div>
            <h1 className="text-base font-bold text-foreground leading-tight">
              P4-PH4 초순수 현장 — 근태관리
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              평택 한성크린텍 · XERP / 지문 기록 기반 자동집계
              {lastUploadedAt && (
                <span className="ml-3 text-secondary">
                  최종 업데이트: {formatUploadTime(lastUploadedAt)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {(["근태보고", "연차관리"] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearchQuery(""); }}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
                activeTab === tab
                  ? "bg-primary border-primary text-white"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-3">
        {/* File upload + save */}
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
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              {isSaving ? "저장 중..." : "업로드 & 저장"}
            </button>
          )}
        </div>

        {data && activeTab === "근태보고" && (
          <>
            {/* Date / filter bar */}
            <div className="flex flex-wrap items-center gap-3 bg-white border border-border rounded-xl px-4 py-2.5 shadow-sm">
              <span className="text-xs font-semibold text-muted-foreground">보고기준일</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white border border-border text-foreground text-sm font-bold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <div className="text-xs font-semibold text-secondary bg-secondary/10 border border-secondary/20 px-3 py-1.5 rounded-lg">
                {formatWeekRange(monday)}
              </div>
              <div className="flex gap-1.5 ml-auto">
                {(["전체", "한성", "태화"] as TeamFilter[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTeamFilter(v)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                      teamFilter === v
                        ? "bg-primary border-primary text-white"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* 검색창 + 다운로드 버튼 */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름으로 검색..."
                  className="w-full bg-white border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                onClick={() => exportAttendanceExcel(filteredEmployees, data.annualLeaveMap, weekDates)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors shrink-0"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
                엑셀 다운로드
              </button>
            </div>

            {/* Stats: 이번주 + 이번달 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 이번주 */}
              <div className="bg-white border border-border rounded-xl px-4 pt-3 pb-3 shadow-sm">
                <p className="text-xs font-bold text-muted-foreground mb-2">이번주</p>
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="총 인원" value={weekStats.total} unit="명" />
                  <StatCard label="지각" value={weekStats.late} unit="명" variant="late" />
                  <StatCard label="미체크" value={weekStats.uncheck} unit="명" variant="uncheck" />
                  <StatCard label="연차" value={weekStats.leave} unit="명" variant="leave" />
                </div>
              </div>
              {/* 이번달 */}
              <div className="bg-white border border-border rounded-xl px-4 pt-3 pb-3 shadow-sm">
                <p className="text-xs font-bold text-muted-foreground mb-2">이번달</p>
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="총 인원" value={monthStats.total} unit="명" />
                  <StatCard label="지각" value={monthStats.late} unit="건" variant="late" />
                  <StatCard label="미체크" value={monthStats.uncheck} unit="건" variant="uncheck" />
                  <StatCard label="연차" value={monthStats.leave} unit="일" variant="leave" />
                </div>
              </div>
            </div>

            {filteredEmployees.length === 0 && searchQuery ? (
              <div className="py-12 text-center bg-white border border-border rounded-xl">
                <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-semibold text-muted-foreground">검색 결과가 없습니다</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">"{searchQuery}"</span>에 해당하는 직원이 없습니다
                </p>
              </div>
            ) : (
              <AttendanceTable
                employees={filteredEmployees}
                anomalyMap={anomalyMap}
                annualLeaveMap={data.annualLeaveMap}
                weekDates={weekDates}
                dataYear={data.dataYear}
                dataMonth={data.dataMonth}
                rowOrders={rowOrders}
                onOrderChange={handleOrderChange}
              />
            )}
          </>
        )}

        {data && activeTab === "연차관리" && (
          <AnnualLeavePanel
            leaveEmployees={data.leaveEmployees}
            leaveDetails={data.leaveDetails}
            rowOrder={rowOrders["leave"] || []}
            onOrderChange={handleOrderChange}
          />
        )}

        {!data && (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4">⬆️</div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              Excel 파일을 업로드하면 근태 현황이 자동 표시됩니다
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-muted px-1.5 py-0.5 rounded text-secondary text-[11px]">XERP 기록</code>{" "}+{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-secondary text-[11px]">지문 기록</code> 시트가 포함된 엑셀 파일
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
