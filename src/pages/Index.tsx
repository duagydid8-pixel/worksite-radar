import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import FileUploadZone from "@/components/FileUploadZone";
import StatCard from "@/components/StatCard";
import AttendanceTable from "@/components/AttendanceTable";
import AnnualLeavePanel from "@/components/AnnualLeavePanel";
import NewEmployeeList from "@/components/NewEmployeeList";
import XerpPmisTable from "@/components/XerpPmisTable";
import XerpWorkReflection from "@/components/XerpWorkReflection";
import { WeeklySchedule } from "@/components/WeeklySchedule";
import PdfSplitter from "@/components/tabs/PdfSplitter";
import ExpenseReportTab from "@/components/ExpenseReport";
import HeadOfficeMailRequest from "@/components/HeadOfficeMailRequest";
import { MAIL_REQUEST_MENU_OPTIONS, type MailRequestMenu } from "@/lib/headOfficeMail";
import { parseExcelFile, type ParsedData } from "@/lib/parseExcel";
import { saveAttendanceFS, fetchAttendanceFS, saveRowOrderFS, fetchRowOrderFS } from "@/lib/firestoreAttendance";
import { toast } from "sonner";
import { CloudUpload, Loader2, Search, X, Download, Users, ClipboardList, GitBranch, Database, Home, LogOut, KeyRound, CalendarRange, Calculator, Scissors, Receipt, Mail, BookText, ScanText, ListChecks, ArrowRight, Plus, Trash2 } from "lucide-react";
import { exportMonthlyExcel } from "@/lib/exportExcel";
import OrgChart from "@/components/OrgChart";
import { useAdminAuth } from "@/components/AdminLoginDialog";
import HomePage from "@/components/HomePage";
import PayrollPage from "@/components/PayrollPage";
import AdditionalWorkScanPage from "@/components/AdditionalWorkScanPage";
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
type ActiveTab = "홈" | "신규자명단" | "근태관리" | "조직도" | "XERP&PMIS" | "오늘할일관리" | "주간일정" | "XERP공수반영" | "PDF분리" | "지출결의서" | "본사메일송부" | "급여대장";
type AttendanceSubTab = "근태현황" | "연차현황";
type PayrollSubTab = "급여대장보정" | "추가공수스캔";

const ATTENDANCE_SUB_TABS: AttendanceSubTab[] = ["근태현황", "연차현황"];
const PAYROLL_SUB_TABS: { value: PayrollSubTab; label: string; icon: React.ReactNode }[] = [
  { value: "급여대장보정", label: "경비 업로드", icon: <BookText className="h-3.5 w-3.5" /> },
  { value: "추가공수스캔", label: "추가공수 스캔추출", icon: <ScanText className="h-3.5 w-3.5" /> },
];

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
  { key: "근태관리", label: "근태관리", icon: <ClipboardList className="h-4 w-4" />, adminOnly: false },
  { key: "조직도", label: "조직도", icon: <GitBranch className="h-4 w-4" />, adminOnly: false },
];

const NAV_ADMIN: NavItem[] = [
  { key: "오늘할일관리", label: "오늘 할 일 관리", icon: <ListChecks className="h-4 w-4" />, adminOnly: true },
  { key: "주간일정", label: "주간일정", icon: <CalendarRange className="h-4 w-4" />, adminOnly: true },
  { key: "신규자명단", label: "기술인 및 관리자 명단", icon: <Users className="h-4 w-4" />, adminOnly: true },
  { key: "XERP공수반영", label: "XERP 공수 반영", icon: <Calculator className="h-4 w-4" />, adminOnly: true },
  { key: "본사메일송부", label: "본사 메일송부", icon: <Mail className="h-4 w-4" />, adminOnly: true },
  { key: "PDF분리", label: "PDF 분리 도구", icon: <Scissors className="h-4 w-4" />, adminOnly: true },
  { key: "지출결의서", label: "지출결의서", icon: <Receipt className="h-4 w-4" />, adminOnly: true },
  { key: "급여대장", label: "급여대장", icon: <BookText className="h-4 w-4" />, adminOnly: true },
];

const NAV_SEMI_PUBLIC: NavItem[] = [
  { key: "XERP&PMIS", label: "XERP & PMIS", icon: <Database className="h-4 w-4" />, adminOnly: false },
];

const NAV_ITEMS: NavItem[] = [...NAV_PUBLIC, ...NAV_SEMI_PUBLIC, ...NAV_ADMIN];
const ADMIN_TOP_NAV_KEY = "__admin";
const ADMIN_TODO_HIDE_PREFIX = "admin_todo_hidden_";
const ADMIN_DAILY_TASKS_PREFIX = "admin_daily_tasks_";

interface AdminDailyTask {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readAdminDailyTasks(dateKey: string): AdminDailyTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${ADMIN_DAILY_TASKS_PREFIX}${dateKey}`) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<AdminDailyTask>;
      if (typeof record.id !== "string" || typeof record.text !== "string") return [];
      return [{
        id: record.id,
        text: record.text,
        done: record.done === true,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
      }];
    });
  } catch {
    return [];
  }
}

const Index = () => {
  const topbarRef = useRef<HTMLElement | null>(null);
  const adminTodoShownRef = useRef(false);
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
  const [attendanceSubTab, setAttendanceSubTab] = useState<AttendanceSubTab>("근태현황");
  const [payrollSubTab, setPayrollSubTab] = useState<PayrollSubTab>("급여대장보정");
  const [mailSubTab, setMailSubTab] = useState<MailRequestMenu>("certificate");
  const [rowOrders, setRowOrders] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const { isAdmin, login, logout } = useAdminAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [adminTodoDialogOpen, setAdminTodoDialogOpen] = useState(false);
  const [hideAdminTodoToday, setHideAdminTodoToday] = useState(false);
  const [adminTodoDate, setAdminTodoDate] = useState(() => getLocalDateKey());
  const [adminTodoDraft, setAdminTodoDraft] = useState("");
  const [adminDailyTasks, setAdminDailyTasks] = useState<AdminDailyTask[]>([]);
  const [subnavOffsets, setSubnavOffsets] = useState({ primary: 18, admin: 18, nested: 18 });

  const adminTodoTodayKey = useMemo(() => getLocalDateKey(), []);
  const adminTodoHideStorageKey = `${ADMIN_TODO_HIDE_PREFIX}${adminTodoTodayKey}`;

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

  const handleAdminTodoDialogChange = (open: boolean) => {
    if (!open && hideAdminTodoToday) {
      localStorage.setItem(adminTodoHideStorageKey, "true");
    }
    setAdminTodoDialogOpen(open);
  };

  const saveAdminDailyTasks = useCallback((nextTasks: AdminDailyTask[]) => {
    setAdminDailyTasks(nextTasks);
    localStorage.setItem(`${ADMIN_DAILY_TASKS_PREFIX}${adminTodoDate}`, JSON.stringify(nextTasks));
  }, [adminTodoDate]);

  const handleAddAdminDailyTask = (e: React.FormEvent) => {
    e.preventDefault();
    const text = adminTodoDraft.trim();
    if (!text) return;

    saveAdminDailyTasks([
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...adminDailyTasks,
    ]);
    setAdminTodoDraft("");
  };

  const handleToggleAdminDailyTask = (id: string) => {
    saveAdminDailyTasks(
      adminDailyTasks.map((task) => task.id === id ? { ...task, done: !task.done } : task)
    );
  };

  const handleDeleteAdminDailyTask = (id: string) => {
    saveAdminDailyTasks(adminDailyTasks.filter((task) => task.id !== id));
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

  useEffect(() => {
    setAdminDailyTasks(readAdminDailyTasks(adminTodoDate));
  }, [adminTodoDate]);

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

  const handleAdminTodoMove = (key: ActiveTab, payrollTab?: PayrollSubTab) => {
    if (key === "급여대장" && payrollTab) {
      setPayrollSubTab(payrollTab);
    }
    handleNavClick(key, true);
    setAdminTodoDialogOpen(false);
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

  const adminTodoItems = useMemo(() => [
    {
      title: "근태 파일 확인",
      description: lastUploadedAt ? `최근 저장: ${formatUploadTime(lastUploadedAt)}` : "오늘 근태 파일 업로드 상태를 먼저 확인하세요.",
      badge: lastUploadedAt ? "확인" : "필요",
      tone: lastUploadedAt ? "ok" : "warn",
      icon: <ClipboardList className="h-4 w-4" />,
      target: "근태관리" as ActiveTab,
    },
    {
      title: "주간 작업일정 점검",
      description: `${formatWeekRange(monday)} 구역별 조출·연장·야간 일정을 확인하세요.`,
      badge: "일정",
      tone: "base",
      icon: <CalendarRange className="h-4 w-4" />,
      target: "주간일정" as ActiveTab,
    },
    {
      title: "추가공수 스캔 추출",
      description: "스캔본/PDF 요청서에서 이름과 공수를 추출해 급여대장에 반영하세요.",
      badge: "스캔",
      tone: "warn",
      icon: <ScanText className="h-4 w-4" />,
      target: "급여대장" as ActiveTab,
      payrollTab: "추가공수스캔" as PayrollSubTab,
    },
    {
      title: "본사 메일 송부",
      description: "증명서, 퇴직공제, 산재 개시·종료 요청 건을 확인하세요.",
      badge: "메일",
      tone: "base",
      icon: <Mail className="h-4 w-4" />,
      target: "본사메일송부" as ActiveTab,
    },
    {
      title: "신규자 명단 정리",
      description: "신규 기술인과 관리자 명단 변경 사항을 반영하세요.",
      badge: "명단",
      tone: "base",
      icon: <Users className="h-4 w-4" />,
      target: "신규자명단" as ActiveTab,
    },
  ], [lastUploadedAt, monday]);

  useEffect(() => {
    if (!isAdmin) {
      adminTodoShownRef.current = false;
      setAdminTodoDialogOpen(false);
      return;
    }

    const hiddenToday = localStorage.getItem(adminTodoHideStorageKey) === "true";
    setHideAdminTodoToday(hiddenToday);

    if (!hiddenToday && !adminTodoShownRef.current) {
      adminTodoShownRef.current = true;
      setAdminTodoDate(adminTodoTodayKey);
      setAdminTodoDialogOpen(true);
    }
  }, [adminTodoHideStorageKey, isAdmin]);

  const primaryNavItems = [...NAV_PUBLIC, ...NAV_SEMI_PUBLIC];
  const isAdminSection = NAV_ADMIN.some((item) => item.key === activeTab);
  const activePrimarySubnavKey = activeTab === "근태관리" ? activeTab : isAdminSection ? ADMIN_TOP_NAV_KEY : null;
  const activeNestedSubnavKey = activeTab === "본사메일송부" || activeTab === "급여대장" ? activeTab : null;

  const updateSubnavOffsets = useCallback(() => {
    const topbar = topbarRef.current;
    if (!topbar) return;

    const topbarRect = topbar.getBoundingClientRect();
    const measureLeft = (element: HTMLElement | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return Math.max(12, Math.round(rect.left - topbarRect.left));
    };

    const findByData = (selector: string, datasetKey: "navKey" | "adminKey", value: string) =>
      Array.from(topbar.querySelectorAll<HTMLElement>(selector)).find(
        (element) => element.dataset[datasetKey] === value
      );

    const primaryLeft = activePrimarySubnavKey
      ? measureLeft(findByData("[data-nav-key]", "navKey", activePrimarySubnavKey))
      : null;
    const adminLeft = measureLeft(findByData("[data-nav-key]", "navKey", ADMIN_TOP_NAV_KEY));
    const nestedLeft = activeNestedSubnavKey
      ? measureLeft(findByData("[data-admin-key]", "adminKey", activeNestedSubnavKey))
      : null;

    setSubnavOffsets((current) => {
      const next = {
        primary: primaryLeft ?? current.primary,
        admin: adminLeft ?? current.admin,
        nested: nestedLeft ?? adminLeft ?? current.nested,
      };
      return next.primary === current.primary && next.admin === current.admin && next.nested === current.nested
        ? current
        : next;
    });
  }, [activeNestedSubnavKey, activePrimarySubnavKey]);

  useLayoutEffect(() => {
    updateSubnavOffsets();

    const topbar = topbarRef.current;
    if (!topbar) return;

    const handleLayoutChange = () => updateSubnavOffsets();
    window.addEventListener("resize", handleLayoutChange);

    const scrollers = topbar.querySelectorAll(".ops-topnav, .ops-admin-strip");
    scrollers.forEach((element) => element.addEventListener("scroll", handleLayoutChange, { passive: true }));

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(handleLayoutChange);
    resizeObserver?.observe(topbar);

    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      scrollers.forEach((element) => element.removeEventListener("scroll", handleLayoutChange));
      resizeObserver?.disconnect();
    };
  }, [updateSubnavOffsets, isAdmin]);

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
    <div className="ops-shell flex flex-col h-[100dvh]">
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

      <Dialog open={adminTodoDialogOpen} onOpenChange={handleAdminTodoDialogChange}>
        <DialogContent className="admin-todo-dialog sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="admin-todo-title">
              <span className="admin-todo-title-icon">
                <ListChecks className="h-5 w-5" />
              </span>
              <span>
                오늘 할 일 캘린더
                <small>{adminTodoDate.replaceAll("-", ".")} 기준</small>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="admin-todo-greeting">
            <strong>한성크린텍 P4 현장관리</strong>
            <p>관리자님, 등록된 업무를 확인하고 완료 상태를 체크하세요.</p>
          </div>

          <div className="admin-task-calendar">
            <div className="admin-task-calendar-head">
              <div>
                <strong>업무 확인</strong>
                <span>할 일 작성은 관리자 메뉴의 오늘 할 일 관리에서 처리합니다.</span>
              </div>
              <input
                type="date"
                value={adminTodoDate}
                onChange={(event) => setAdminTodoDate(event.target.value || adminTodoTodayKey)}
              />
            </div>

            <div className="admin-task-list">
              {adminDailyTasks.length > 0 ? (
                adminDailyTasks.map((task) => (
                  <div key={task.id} className={`admin-task-row ${task.done ? "is-done" : ""}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => handleToggleAdminDailyTask(task.id)}
                      />
                      <span>{task.text}</span>
                    </label>
                  </div>
                ))
              ) : (
                <p className="admin-task-empty">선택한 날짜에 등록된 할 일이 없습니다.</p>
              )}
            </div>
          </div>

          <div className="admin-todo-section-title">추천 확인 업무</div>
          <div className="admin-todo-list">
            {adminTodoItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => handleAdminTodoMove(item.target, item.payrollTab)}
                className="admin-todo-item"
              >
                <span className="admin-todo-item-icon">{item.icon}</span>
                <span className="admin-todo-item-copy">
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <span className={`admin-todo-badge is-${item.tone}`}>{item.badge}</span>
                <ArrowRight className="admin-todo-arrow h-4 w-4" />
              </button>
            ))}
          </div>

          <div className="admin-todo-footer">
            <label className="admin-todo-check">
              <input
                type="checkbox"
                checked={hideAdminTodoToday}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setHideAdminTodoToday(checked);
                  if (checked) {
                    localStorage.setItem(adminTodoHideStorageKey, "true");
                  } else {
                    localStorage.removeItem(adminTodoHideStorageKey);
                  }
                }}
              />
              <span>오늘 보지 않기</span>
            </label>
            <button
              type="button"
              onClick={() => handleAdminTodoMove("오늘할일관리")}
              className="admin-todo-close"
            >
              관리 메뉴
            </button>
            <button
              type="button"
              onClick={() => handleAdminTodoDialogChange(false)}
              className="admin-todo-close"
            >
              닫기
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <header
        ref={topbarRef}
        className="ops-topbar shrink-0 z-30"
        style={{
          "--ops-subnav-left": `${subnavOffsets.primary}px`,
          "--ops-admin-subnav-left": `${subnavOffsets.admin}px`,
          "--ops-nested-subnav-left": `${subnavOffsets.nested}px`,
        } as React.CSSProperties}
      >
        <div className="ops-topbar-main">
          <button
            type="button"
            onClick={() => handleNavClick("홈", false)}
            className="ops-brand"
          >
            <span className="ops-brand-title">한성크린텍</span>
            <span className="ops-brand-subtitle">P4 현장관리</span>
          </button>

          <nav className="ops-topnav" aria-label="주요 메뉴">
            {primaryNavItems.map(({ key, label, icon }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  data-nav-key={key}
                  onClick={() => handleNavClick(key, false)}
                  className={`ops-topnav-item ${isActive ? "is-active" : ""}`}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              data-nav-key={ADMIN_TOP_NAV_KEY}
              onClick={() => isAdmin ? handleNavClick("주간일정", true) : setLoginDialogOpen(true)}
              className={`ops-topnav-item ${isAdminSection ? "is-active" : ""} ${!isAdmin ? "is-locked" : ""}`}
            >
              <Lock className="h-4 w-4" />
              <span>관리자</span>
            </button>
          </nav>

          <div className="ops-topmeta">
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setAdminTodoDate(adminTodoTodayKey);
                  setAdminTodoDialogOpen(true);
                }}
                className="ops-todo-button"
              >
                <ListChecks className="h-3.5 w-3.5" />
                오늘할일
              </button>
            )}
            <span className="ops-date">{selectedDate}</span>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => { logout(); toast.info("로그아웃 되었습니다."); }}
                className="ops-login-button"
              >
                <LogOut className="h-3.5 w-3.5" />
                로그아웃
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLoginDialogOpen(true)}
                className="ops-login-button"
              >
                <KeyRound className="h-3.5 w-3.5" />
                관리자 로그인
              </button>
            )}
          </div>
        </div>

        {activeTab === "근태관리" && (
          <div className="ops-subbar">
            {ATTENDANCE_SUB_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setAttendanceSubTab(tab)}
                className={attendanceSubTab === tab ? "is-active" : ""}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {(isAdmin || isAdminSection) && (
          <div className="ops-admin-strip">
            <span>관리자 메뉴</span>
            {NAV_ADMIN.map(({ key, label, icon, adminOnly }) => (
              <button
                key={key}
                type="button"
                data-admin-key={key}
                onClick={() => handleNavClick(key, adminOnly)}
                className={activeTab === key ? "is-active" : ""}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {activeTab === "본사메일송부" && isAdmin && (
          <div className="ops-subbar ops-subbar-nested">
            {MAIL_REQUEST_MENU_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMailSubTab(option.value)}
                className={mailSubTab === option.value ? "is-active" : ""}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === "급여대장" && isAdmin && (
          <div className="ops-subbar ops-subbar-nested">
            {PAYROLL_SUB_TABS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPayrollSubTab(option.value)}
                className={payrollSubTab === option.value ? "is-active" : ""}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ── 데스크탑 레이아웃 ────────────────────── */}
      <div className="ops-layout flex flex-1 overflow-hidden bg-slate-100">

        {/* ── SIDEBAR (md 이상) ─────────────────── */}
        <aside className="hidden">

          {/* 로고 */}
          <div
            className="px-5 py-5 border-b border-slate-200 cursor-pointer shrink-0"
            onClick={() => window.location.reload()}
          >
            <div className="text-2xl font-extrabold leading-tight tracking-tight text-slate-950">
              한성크린텍
            </div>
            <div className="text-[13px] text-slate-500 font-medium mt-1">현장 관리 시스템</div>
          </div>

          {/* 네비게이션 */}
          <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-1">
            {[...NAV_PUBLIC, ...NAV_SEMI_PUBLIC].map(({ key, label, icon }) => {
              const isActive = activeTab === key;
              return (
                <div key={key}>
                  <button
                    onClick={() => handleNavClick(key, false)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${
                      isActive ? "bg-slate-900 text-white font-bold shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-semibold"
                    }`}
                  >
                    <span className="shrink-0">{icon}</span>
                    <span>{label}</span>
                  </button>
                  {key === "근태관리" && isActive && (
                    <div className="ml-9 mt-1 space-y-1 border-l border-slate-200 pl-3">
                      {ATTENDANCE_SUB_TABS.map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setAttendanceSubTab(tab)}
                          className={`block w-full rounded-md px-2 py-1.5 text-left text-xs font-extrabold transition-colors ${
                            attendanceSubTab === tab
                              ? "bg-slate-100 text-slate-950"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 관리자 전용 구분선 */}
            <div className="flex items-center gap-2 px-2 pt-4 pb-1">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider whitespace-nowrap">관리자 전용</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {NAV_ADMIN.map(({ key, label, icon, adminOnly }) => {
              const isActive = activeTab === key;
              const locked = !isAdmin;
              return (
                <div key={key}>
                  <button
                    onClick={() => handleNavClick(key, adminOnly)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${
                      isActive
                        ? "bg-slate-900 text-white font-bold shadow-sm"
                        : locked
                          ? "text-slate-300 hover:bg-slate-50 font-semibold"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-semibold"
                    }`}
                  >
                    <span className="shrink-0">{icon}</span>
                    <span className="flex-1">{label}</span>
                    {locked && <Lock className="h-3 w-3 opacity-30 shrink-0" />}
                  </button>
                  {key === "본사메일송부" && isActive && !locked && (
                    <div className="ml-9 mt-1 space-y-1 border-l border-slate-200 pl-3">
                      {MAIL_REQUEST_MENU_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setMailSubTab(option.value)}
                          className={`block w-full rounded-md px-2 py-1.5 text-left text-xs font-extrabold transition-colors ${
                            mailSubTab === option.value
                              ? "bg-slate-100 text-slate-950"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {key === "급여대장" && isActive && !locked && (
                    <div className="ml-9 mt-1 space-y-1 border-l border-slate-200 pl-3">
                      {PAYROLL_SUB_TABS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setPayrollSubTab(option.value)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-extrabold transition-colors ${
                            payrollSubTab === option.value
                              ? "bg-slate-100 text-slate-950"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {option.icon}
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* 하단 로그인/로그아웃 */}
          <div className="px-4 py-4 border-t border-slate-200 shrink-0">
            {isAdmin ? (
              <button
                onClick={() => { logout(); toast.info("로그아웃 되었습니다."); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                로그아웃
              </button>
            ) : (
              <button
                onClick={() => setLoginDialogOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <KeyRound className="h-4 w-4" />
                관리자 로그인
              </button>
            )}
          </div>
        </aside>

        {/* ── MAIN ──────────────────────────────── */}
        <main className="ops-main flex-1 overflow-auto pb-0">

          {/* 홈 */}
          {activeTab === "홈" && (
            <HomePage lastUploadedAt={lastUploadedAt ? formatUploadTime(lastUploadedAt) : null} selectedDate={selectedDate} isAdmin={isAdmin} leaveDetails={data?.leaveDetails ?? []} />
          )}

        {/* 신규자 명단 (관리자 전용) */}
        {activeTab === "신규자명단" && isAdmin && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <NewEmployeeList />
          </div>
        )}

        {/* 근태관리 */}
        {activeTab === "근태관리" && (
          <div className="mx-auto max-w-[1440px] space-y-4 p-5 md:p-7">
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:hidden">
              <div className="grid grid-cols-2 gap-1 sm:w-[320px]">
                {ATTENDANCE_SUB_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAttendanceSubTab(tab)}
                    className={`h-10 rounded-lg text-sm font-extrabold transition-colors ${
                      attendanceSubTab === tab
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {attendanceSubTab === "근태현황" ? (
            <>
              {/* File upload + save (admin only) */}
                {isAdmin && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
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
                        className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-extrabold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                        {isSaving ? "저장 중..." : "업로드 & 저장"}
                      </button>
                    )}
                  </div>
                )}

                {data && (
                  <>
                    {/* 통합 컨트롤 바 */}
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      {/* 상단: 날짜 + 주간범위 + 팀필터 */}
                      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
                        <div className="mr-auto">
                          <h2 className="text-lg font-extrabold text-slate-950">근태현황</h2>
                          <p className="mt-0.5 text-xs font-semibold text-slate-400">{formatWeekRange(monday)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-extrabold tracking-wide text-slate-400 whitespace-nowrap">기준일</span>
                          <input
                            type="date"
                            value={pendingDate}
                            onChange={(e) => setPendingDate(e.target.value)}
                            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-slate-300 focus:bg-white"
                          />
                          <button
                            onClick={() => { setSelectedDate(pendingDate); localStorage.setItem("attendance_selected_date", pendingDate); }}
                            disabled={pendingDate === selectedDate}
                            className="h-10 rounded-lg bg-slate-900 px-3 text-xs font-extrabold text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
                          >
                            적용
                          </button>
                        </div>
                        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                          {(["전체", "한성", "태화"] as TeamFilter[]).map((v) => (
                            <button
                              key={v}
                              onClick={() => setTeamFilter(v)}
                              className={`rounded-md px-3 py-1.5 text-xs font-extrabold transition-all ${
                                teamFilter === v
                                  ? "bg-white text-slate-950 shadow-sm"
                                  : "text-slate-500 hover:text-slate-900"
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 하단: 검색 + 다운로드 */}
                      <div className="flex flex-col gap-2 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center">
                        <div className="relative flex-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="이름으로 검색..."
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300"
                          />
                          {searchQuery && (
                            <button
                              onClick={() => setSearchQuery("")}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-900"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => exportMonthlyExcel(data.employees, data.annualLeaveMap, anomalyMap, data.dataYear, data.dataMonth)}
                          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4 text-slate-400" />
                          엑셀 다운로드
                        </button>
                      </div>
                    </div>

                    {filteredEmployees.length === 0 && searchQuery ? (
                      <div className="py-12 text-center bg-white border border-border rounded-2xl shadow-sm">
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
            ) : (
              <div className="space-y-3">
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
                      근태현황에서 Excel 파일을 먼저 업로드하세요
                    </h2>
                  </div>
                )}
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

        {/* 오늘 할 일 관리 */}
        {activeTab === "오늘할일관리" && isAdmin && (
          <div className="mx-auto max-w-[980px] space-y-4 p-4 md:p-6">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-slate-950">오늘 할 일 관리</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">날짜별 업무를 작성하고 완료 상태를 관리합니다.</p>
                </div>
                <input
                  type="date"
                  value={adminTodoDate}
                  onChange={(event) => setAdminTodoDate(event.target.value || adminTodoTodayKey)}
                  className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:bg-white"
                />
              </div>

              <div className="space-y-4 p-4">
                <form onSubmit={handleAddAdminDailyTask} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_112px]">
                  <input
                    value={adminTodoDraft}
                    onChange={(event) => setAdminTodoDraft(event.target.value)}
                    placeholder="처리할 업무를 입력하세요"
                    className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
                  >
                    <Plus className="h-4 w-4" />
                    추가
                  </button>
                </form>

                <div className="overflow-hidden rounded-lg border border-slate-200">
                  {adminDailyTasks.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {adminDailyTasks.map((task) => (
                        <div key={task.id} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_44px] ${task.done ? "bg-slate-50" : "bg-white"}`}>
                          <label className="flex min-w-0 items-center gap-3">
                            <input
                              type="checkbox"
                              checked={task.done}
                              onChange={() => handleToggleAdminDailyTask(task.id)}
                              className="h-4 w-4 accent-slate-900"
                            />
                            <span className={`min-w-0 text-sm font-bold ${task.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                              {task.text}
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => handleDeleteAdminDailyTask(task.id)}
                            aria-label="할 일 삭제"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">선택한 날짜에 등록된 할 일이 없습니다.</div>
                  )}
                </div>
              </div>
            </section>
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

          {/* 본사 메일송부 */}
          {activeTab === "본사메일송부" && isAdmin && (
            <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
              <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:hidden">
                <div className="grid grid-cols-3 gap-1">
                  {MAIL_REQUEST_MENU_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setMailSubTab(option.value)}
                      className={`h-10 rounded-lg text-sm font-extrabold transition-colors ${
                        mailSubTab === option.value
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <HeadOfficeMailRequest activeMenu={mailSubTab} onMenuChange={setMailSubTab} />
            </div>
          )}

          {/* PDF 분리 도구 */}
          {activeTab === "PDF분리" && isAdmin && (
            <PdfSplitter />
          )}

          {/* 지출결의서 */}
          {activeTab === "지출결의서" && isAdmin && (
            <ExpenseReportTab isAdmin={isAdmin} />
          )}

          {/* 급여대장 */}
          {activeTab === "급여대장" && isAdmin && (
            <div>
              <div className="p-4 pb-0 md:hidden">
                <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div className="grid grid-cols-2 gap-1">
                    {PAYROLL_SUB_TABS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setPayrollSubTab(option.value)}
                        className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-extrabold transition-colors ${
                          payrollSubTab === option.value
                            ? "bg-slate-900 text-white shadow-sm"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        {option.icon}
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {payrollSubTab === "급여대장보정" ? <PayrollPage /> : <AdditionalWorkScanPage />}
            </div>
          )}

        </main>
      </div>

    </div>
  );
};

export default Index;
