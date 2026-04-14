import { useState, useMemo, useCallback, useEffect } from "react";
import FileUploadZone from "@/components/FileUploadZone";
import StatCard from "@/components/StatCard";
import AttendanceTable from "@/components/AttendanceTable";
import AnnualLeavePanel from "@/components/AnnualLeavePanel";
import NewEmployeeList from "@/components/NewEmployeeList";
import XerpPmisTable from "@/components/XerpPmisTable";
import XerpWorkReflection from "@/components/XerpWorkReflection";
import { WeeklySchedule } from "@/components/WeeklySchedule";
import { parseExcelFile, type ParsedData } from "@/lib/parseExcel";
import { saveAttendanceFS, fetchAttendanceFS, saveRowOrderFS, fetchRowOrderFS } from "@/lib/firestoreAttendance";
import { toast } from "sonner";
import { CloudUpload, Loader2, Search, X, Download, Users, ClipboardList, CalendarDays, GitBranch, Database, Home, LogOut, KeyRound, CalendarRange, Calculator } from "lucide-react";
import { exportMonthlyExcel } from "@/lib/exportExcel";
import OrgChart from "@/components/OrgChart";
import { useAdminAuth } from "@/components/AdminLoginDialog";
import HomePage from "@/components/HomePage";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock } from "lucide-react";

function XerpPmisPageWrapper({ isAdmin }: { isAdmin: boolean }) {
  const [xerpSite, setXerpSite] = useState<"PH4" | "PH2">("PH4");
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">
      {/* 서브탭 */}
      <div className="flex gap-2">
        {(["PH4", "PH2"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setXerpSite(s)}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all border ${
              xerpSite === s
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-white text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            P4-{s}
          </button>
        ))}
      </div>
      <XerpPmisTable isAdmin={isAdmin} site={xerpSite} key={xerpSite} />
    </div>
  );
}

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
type ActiveTab = "홈" | "신규자명단" | "근태보고" | "연차관리" | "조직도" | "XERP&PMIS" | "주간일정" | "XERP공수반영";

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

function formatUploadTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const ROW_ORDER_CONTEXTS = ["attendance_한성_F", "attendance_태화_F", "leave"];

interface NavItem {
  key: ActiveTab;
  label: string;
  icon: React.ReactNode;
  adminOnly: boolean;
}

const NAV_PUBLIC: NavItem[] = [
  { key: "홈", label: "홈", icon: <Home className="h-4 w-4" />, adminOnly: false },
  { key: "근태보고", label: "근태보고", icon: <ClipboardList className="h-4 w-4" />, adminOnly: false },
  { key: "연차관리", label: "연차관리", icon: <CalendarDays className="h-4 w-4" />, adminOnly: false },
  { key: "조직도", label: "조직도", icon: <GitBranch className="h-4 w-4" />, adminOnly: false },
];

const NAV_ADMIN: NavItem[] = [
  { key: "주간일정", label: "주간일정", icon: <CalendarRange className="h-4 w-4" />, adminOnly: true },
  { key: "신규자명단", label: "기술인 및 관리자 명단", icon: <Users className="h-4 w-4" />, adminOnly: true },
];

const NAV_SEMI_PUBLIC: NavItem[] = [
  { key: "XERP&PMIS", label: "XERP & PMIS", icon: <Database className="h-4 w-4" />, adminOnly: false },
  { key: "XERP공수반영", label: "XERP 공수 반영", icon: <Calculator className="h-4 w-4" />, adminOnly: false },
];

const NAV_ITEMS: NavItem[] = [...NAV_PUBLIC, ...NAV_SEMI_PUBLIC, ...NAV_ADMIN];

const Index = () => {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem("attendance_selected_date");
    if (saved) return saved;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [pendingDate, setPendingDate] = useState(selectedDate);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("전체");
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingBuffer, setPendingBuffer] = useState<ArrayBuffer | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("홈");
  const [rowOrders, setRowOrders] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const { isAdmin, login, logout } = useAdminAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(loginId, loginPw)) {
      toast.success("관리자로 로그인되었습니다.");
      setLoginDialogOpen(false);
      setLoginId(""); setLoginPw("");
    } else {
      toast.error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 8000);
    (async () => {
      try {
        const [result, ...orders] = await Promise.all([
          fetchAttendanceFS(),
          ...ROW_ORDER_CONTEXTS.map((ctx) => fetchRowOrderFS(ctx).then((names) => ({ ctx, names }))),
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
      await saveAttendanceFS(data, fileName);
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
      await saveRowOrderFS(context, names);
    } catch {
      // silently fail
    }
  }, []);

  const handleNavClick = (key: ActiveTab, adminOnly: boolean) => {
    if (adminOnly && !isAdmin) {
      toast.error("관리자 로그인이 필요합니다.");
      return;
    }
    setActiveTab(key);
    setSearchQuery("");
  };

  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const [weekYear, weekMonth] = selectedDate.split("-").map(Number);
    let emps = data.employees.filter((e) => e.dataYear === weekYear && e.dataMonth === weekMonth);
    if (emps.length === 0) emps = data.employees;

    const mondayYear = monday.getFullYear();
    const mondayMonth = monday.getMonth() + 1;
    if (mondayYear !== weekYear || mondayMonth !== weekMonth) {
      const prevEmps = data.employees.filter(
        (e) => e.dataYear === mondayYear && e.dataMonth === mondayMonth
      );
      if (prevEmps.length > 0) {
        emps = emps.map((emp) => {
          const prev = prevEmps.find((p) => p.name === emp.name && p.team === emp.team);
          if (!prev) return emp;
          return { ...emp, dailyRecords: { ...prev.dailyRecords, ...emp.dailyRecords } };
        });
      }
    }

    if (teamFilter === "한성") return emps.filter((e) => e.team === "한성_F");
    if (teamFilter === "태화") return emps.filter((e) => e.team === "태화_F");
    const sorted = [...emps.filter((e) => e.team === "한성_F"), ...emps.filter((e) => e.team === "태화_F")];
    if (!searchQuery.trim()) return sorted;
    return sorted.filter((e) => e.name.includes(searchQuery.trim()));
  }, [data, teamFilter, monday, searchQuery, selectedDate]);

  const anomalyMap = useMemo(() => {
    if (!data) return new Map();
    const map = new Map();
    for (const a of data.anomalies) map.set(a.name, a);
    return map;
  }, [data]);

  const weekStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let lateEmps = 0, uncheckEmps = 0, leaveEmps = 0;
    for (const emp of filteredEmployees) {
      let empLate = false, empUncheck = false, empLeave = false;
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

  const monthStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [weekYear, weekMonth] = selectedDate.split("-").map(Number);
    const daysInMonth = new Date(weekYear, weekMonth, 0).getDate();
    let lateTotal = 0, uncheckTotal = 0, leaveTotal = 0;
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
  }, [filteredEmployees, data, monday, selectedDate]);

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
    <div className="flex h-screen bg-[#F0F2F5]">
      {/* 관리자 로그인 다이얼로그 */}
      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary" />
              관리자 로그인
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLoginSubmit} className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">아이디</label>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">비밀번호</label>
              <input
                type="password"
                value={loginPw}
                onChange={(e) => setLoginPw(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              로그인
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside className="w-56 shrink-0 bg-white flex flex-col shadow-[2px_0_12px_rgba(0,0,0,0.06)] z-20">

        {/* 로고 */}
        <div
          className="px-5 py-5 border-b border-gray-100 cursor-pointer shrink-0"
          onClick={() => window.location.reload()}
        >
          <div
            className="text-2xl font-extrabold leading-tight tracking-tight"
            style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            한성크린텍
          </div>
          <div className="text-[13px] text-gray-400 font-medium mt-1">현장 관리 시스템</div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-0.5">
          {[...NAV_PUBLIC, ...NAV_SEMI_PUBLIC].map(({ key, label, icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleNavClick(key, false)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                  isActive ? "text-[#2d3a8a] font-semibold shadow-[0_2px_8px_rgba(168,200,248,0.35)]" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
                style={isActive ? { background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" } : {}}
              >
                <span className="shrink-0">{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}

          {/* 관리자 전용 구분선 */}
          <div className="flex items-center gap-2 px-2 pt-4 pb-1">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[10px] text-gray-300 font-semibold uppercase tracking-wider whitespace-nowrap">관리자 전용</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {NAV_ADMIN.map(({ key, label, icon, adminOnly }) => {
            const isActive = activeTab === key;
            const locked = !isAdmin;
            return (
              <button
                key={key}
                onClick={() => handleNavClick(key, adminOnly)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                  isActive
                    ? "text-[#2d3a8a] font-semibold shadow-[0_2px_8px_rgba(168,200,248,0.35)]"
                    : locked
                      ? "text-gray-300 hover:bg-gray-50"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
                style={isActive ? { background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" } : {}}
              >
                <span className="shrink-0">{icon}</span>
                <span className="flex-1">{label}</span>
                {locked && <Lock className="h-3 w-3 opacity-30 shrink-0" />}
              </button>
            );
          })}
        </nav>

        {/* 하단 로그인/로그아웃 */}
        <div className="px-4 py-4 border-t border-gray-100 shrink-0">
          {isAdmin ? (
            <button
              onClick={() => { logout(); toast.info("로그아웃 되었습니다."); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          ) : (
            <button
              onClick={() => setLoginDialogOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#c8d8f8] text-sm font-semibold text-[#4a6aaa] hover:bg-[#f0f4ff] transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              관리자 로그인
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────── */}
      <main className="flex-1 overflow-auto">

        {/* 홈 */}
        {activeTab === "홈" && (
          <HomePage lastUploadedAt={lastUploadedAt ? formatUploadTime(lastUploadedAt) : null} selectedDate={selectedDate} isAdmin={isAdmin} />
        )}

        {/* 신규자 명단 (관리자 전용) */}
        {activeTab === "신규자명단" && isAdmin && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <NewEmployeeList />
          </div>
        )}

        {/* 근태보고 */}
        {activeTab === "근태보고" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">
            <>
              {/* File upload + save (admin only) */}
                {isAdmin && (
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
                )}

                {data && (
                  <>
                    {/* Date / filter bar */}
                    <div className="flex flex-wrap items-center gap-3 bg-white border border-border rounded-xl px-4 py-2.5 shadow-sm">
                      <span className="text-xs font-semibold text-muted-foreground">보고기준일</span>
                      <input
                        type="date"
                        value={pendingDate}
                        onChange={(e) => setPendingDate(e.target.value)}
                        className="bg-white border border-border text-foreground text-sm font-bold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                      <button
                        onClick={() => { setSelectedDate(pendingDate); localStorage.setItem("attendance_selected_date", pendingDate); }}
                        disabled={pendingDate === selectedDate}
                        className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                      >
                        적용
                      </button>
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
                        onClick={() => exportMonthlyExcel(data.employees, data.annualLeaveMap, anomalyMap, data.dataYear, data.dataMonth)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors shrink-0"
                      >
                        <Download className="h-4 w-4 text-muted-foreground" />
                        엑셀 다운로드
                      </button>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white border border-border rounded-xl px-4 pt-3 pb-3 shadow-sm">
                        <p className="text-xs font-bold text-muted-foreground mb-2">이번주</p>
                        <div className="grid grid-cols-4 gap-2">
                          <StatCard label="총 인원" value={weekStats.total} unit="명" />
                          <StatCard label="지각" value={weekStats.late} unit="명" variant="late" />
                          <StatCard label="미체크" value={weekStats.uncheck} unit="명" variant="uncheck" />
                          <StatCard label="연차" value={weekStats.leave} unit="명" variant="leave" />
                        </div>
                      </div>
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
              </>
          </div>
        )}

        {/* 연차관리 */}
        {activeTab === "연차관리" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">
            {data ? (
              <AnnualLeavePanel
                leaveEmployees={data.leaveEmployees}
                leaveDetails={data.leaveDetails}
                rowOrder={rowOrders["leave"] || []}
                onOrderChange={handleOrderChange}
              />
            ) : (
              <div className="py-16 text-center">
                <div className="text-5xl mb-4">⬆️</div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                  근태보고 탭에서 Excel 파일을 먼저 업로드하세요
                </h2>
              </div>
            )}
          </div>
        )}

        {/* 조직도 */}
        {activeTab === "조직도" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <OrgChart />
          </div>
        )}

        {/* 주간일정 */}
        {activeTab === "주간일정" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <WeeklySchedule />
          </div>
        )}

        {/* XERP & PMIS */}
        {activeTab === "XERP&PMIS" && (
          <XerpPmisPageWrapper isAdmin={isAdmin} />
        )}

        {/* XERP 공수 반영 */}
        {activeTab === "XERP공수반영" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <XerpWorkReflection isAdmin={isAdmin} />
          </div>
        )}

      </main>
    </div>
  );
};

export default Index;
