import { lazy, Suspense, useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { MAIL_REQUEST_MENU_OPTIONS, type MailRequestMenu } from "@/lib/headOfficeMail";
import { formatUploadTime, getLocalDateKey, getMonday } from "@/lib/attendanceDateUtils";
import type { AttendanceRosterEmployee } from "@/lib/attendanceSources";
import {
  applyManualAttendanceOverrides,
  type ManualAttendanceOverride,
  type ManualAttendanceStatus,
} from "@/lib/manualAttendanceOverrides";
import {
  decodeBase64ToArrayBuffer,
  fetchLocalAttendanceSourceFiles,
  fetchLocalAttendanceWatchStatus,
  shouldApplyLocalWatchVersion,
} from "@/lib/localAttendanceWatchClient";
import type { ParsedData } from "@/lib/parseExcel";
import type { ParsedPmisData } from "@/components/PmisInOutLogTab";
import { fetchAttendanceFS, fetchRowOrderFS } from "@/lib/firestoreAttendance";
import { loadXerpFS, loadXerpPH2FS, loadXerpP5PH1FS } from "@/lib/firestoreService";
import { openLocalServicesLauncher } from "@/lib/localServicesLauncher";
import { fetchXerpLoginStatus, requestXerpLoginWindowOpen } from "@/lib/localXerpWorkerRegistrationClient";
import { getAdminMenuButtonLabel, shouldShowAdminMenuPanel } from "@/lib/navigationDisplay";
import { toast } from "sonner";
import { Loader2, Users, ClipboardList, GitBranch, Database, Home, LogOut, KeyRound, CalendarRange, Calculator, Scissors, Mail, BookText, ScanText, ListChecks, ArrowRight, Plus, Trash2, ChevronDown, FileSpreadsheet, CreditCard, BarChart2, LogIn, Power, FilePenLine, BellRing, MessageSquare } from "lucide-react";
import { useAdminAuth } from "@/components/AdminLoginDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock } from "lucide-react";
const OrgChart = lazy(() => import("@/components/OrgChart"));

const LazyHomePage = lazy(() => import("@/components/HomePage"));
const LazyNewEmployeeList = lazy(() => import("@/components/NewEmployeeList"));
const LazyTenureAlert = lazy(() => import("@/components/TenureAlert"));
const LazyKakaoChatOrganizer = lazy(() => import("@/components/KakaoChatOrganizer"));
const LazyXerpPmisTable = lazy(() => import("@/components/XerpPmisTable"));
const LazyXerpWorkReflection = lazy(() => import("@/components/XerpWorkReflection"));
const LazyPmisInOutLogTab = lazy(() => import("@/components/PmisInOutLogTab"));
const LazyFinalWorkUnitsCheck = lazy(() => import("@/components/FinalWorkUnitsCheck"));
const LazyWeeklySchedule = lazy(() => import("@/components/WeeklySchedule").then((module) => ({ default: module.WeeklySchedule })));
const LazyPdfSplitter = lazy(() => import("@/components/tabs/PdfSplitter"));
const LazyElcdComparePage = lazy(() => import("@/components/ElcdComparePage"));
const LazyHeadOfficeMailRequest = lazy(() => import("@/components/HeadOfficeMailRequest"));
const LazyPayrollPage = lazy(() => import("@/components/PayrollPage"));
const LazyAdditionalWorkScanPage = lazy(() => import("@/components/AdditionalWorkScanPage"));
const LazyPayrollJobTitleChangePage = lazy(() => import("@/components/PayrollJobTitleChangePage"));
const LazyRcmDraftImageExport = lazy(() => import("@/components/RcmDraftImageExport"));

function LazyPanel({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm font-bold text-slate-400">불러오는 중...</div>}>
      {children}
    </Suspense>
  );
}

type XerpSiteKey = "PH4" | "PH2" | "P5PH1";
type XerpSubPage = "xerp" | "inout" | "final";
type XerpLoginUiStatus = "idle" | "checking" | "login-required" | "logged-in" | "unavailable";

const XERP_SITES = [
  { value: "PH4" as XerpSiteKey, label: "P4-PH4" },
  { value: "PH2" as XerpSiteKey, label: "P4-PH2" },
  { value: "P5PH1" as XerpSiteKey, label: "P5-PH1" },
] as const;

function XerpPmisPageWrapper({ isAdmin }: { isAdmin: boolean }) {
  const [selectedSite, setSelectedSite] = useState<XerpSiteKey>("PH4");
  const [selectedPage, setSelectedPage] = useState<XerpSubPage>("xerp");
  const [pmisDataBySite, setPmisDataBySite] = useState<Partial<Record<XerpSiteKey, ParsedPmisData>>>({});
  const [xerpNamesBySite, setXerpNamesBySite] = useState<Partial<Record<XerpSiteKey, Set<string>>>>({});

  useEffect(() => {
    if (xerpNamesBySite[selectedSite]) return;
    const loadFn = selectedSite === "PH4" ? loadXerpFS : selectedSite === "PH2" ? loadXerpPH2FS : loadXerpP5PH1FS;
    loadFn().then((dateMap) => {
      if (!dateMap) return;
      const names = new Set<string>();
      Object.values(dateMap).forEach((rows) => {
        (rows as { 성명?: string }[]).forEach((r) => {
          if (r.성명?.trim()) names.add(r.성명.trim());
        });
      });
      if (names.size > 0) setXerpNamesBySite((prev) => ({ ...prev, [selectedSite]: names }));
    }).catch(() => {});
  }, [selectedSite]);

  const handlePmisDataLoaded = (d: ParsedPmisData) => {
    setPmisDataBySite((prev) => ({ ...prev, [selectedSite]: d }));
  };
  const handlePmisClear = () => {
    setPmisDataBySite((prev) => { const n = { ...prev }; delete n[selectedSite]; return n; });
  };

  return (
    <div className="flex items-start">
      {/* 사이드바 — sticky so it follows scroll */}
      <div className="w-44 shrink-0 border-r border-slate-200 bg-slate-50 py-3 sticky top-0 max-h-screen overflow-y-auto self-start">
        {XERP_SITES.map((site) => {
          const isActive = selectedSite === site.value;
          return (
            <div key={site.value}>
              <button
                type="button"
                onClick={() => { setSelectedSite(site.value); }}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors text-left ${
                  isActive ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                {site.label}
              </button>
              {isActive && (
                <div className="mb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedPage("xerp")}
                    className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-xs font-semibold transition-colors text-left ${
                      selectedPage === "xerp" ? "bg-white text-slate-900 font-bold" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <BarChart2 className="h-3 w-3 shrink-0" />
                    XERP/PMIS 현황
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPage("inout")}
                    className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-xs font-semibold transition-colors text-left ${
                      selectedPage === "inout" ? "bg-white text-slate-900 font-bold" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <LogIn className="h-3 w-3 shrink-0" />
                    IN/OUT 로그
                    {pmisDataBySite[site.value] && (
                      <span className="ml-auto rounded-full bg-emerald-500 w-1.5 h-1.5 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPage("final")}
                    className={`w-full flex items-center gap-2 pl-9 pr-4 py-2 text-xs font-semibold transition-colors text-left ${
                      selectedPage === "final" ? "bg-white text-slate-900 font-bold" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <ListChecks className="h-3 w-3 shrink-0" />
                    최종공수확인
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 min-w-0">
        {selectedPage === "xerp" && (
          <LazyPanel>
            <LazyXerpPmisTable isAdmin={isAdmin} site={selectedSite} key={selectedSite} />
          </LazyPanel>
        )}
        {selectedPage === "inout" && (
          <LazyPanel>
            <LazyPmisInOutLogTab
              key={selectedSite}
              site={selectedSite}
              data={pmisDataBySite[selectedSite] ?? null}
              onDataLoaded={handlePmisDataLoaded}
              onClear={handlePmisClear}
              xerpNames={xerpNamesBySite[selectedSite] ?? null}
            />
          </LazyPanel>
        )}
        {selectedPage === "final" && (
          <LazyPanel>
            <LazyFinalWorkUnitsCheck
              key={selectedSite}
              site={selectedSite}
              pmisData={pmisDataBySite[selectedSite] ?? null}
            />
          </LazyPanel>
        )}
      </div>
    </div>
  );
}
type ActiveTab = "홈" | "신규자명단" | "근속알림" | "카톡정리" | "조직도" | "본사송부용" | "조직도송부" | "XERP&PMIS" | "전자카드 조회" | "오늘할일관리" | "주간일정" | "XERP공수반영" | "PDF분리" | "본사메일송부" | "급여대장" | "RCM기안서송부";
type PayrollSubTab = "급여대장보정" | "추가공수스캔" | "직종변경";
const PAYROLL_SUB_TABS: { value: PayrollSubTab; label: string; icon: React.ReactNode }[] = [
  { value: "급여대장보정", label: "공수자동보정", icon: <BookText className="h-3.5 w-3.5" /> },
  { value: "추가공수스캔", label: "추가공수 스캔추출", icon: <ScanText className="h-3.5 w-3.5" /> },
  { value: "직종변경", label: "직종변경", icon: <FilePenLine className="h-3.5 w-3.5" /> },
];

const ROW_ORDER_CONTEXTS = ["attendance_한성_F", "attendance_태화_F", "attendance_현채", "leave"];

interface NavItem {
  key: ActiveTab;
  label: string;
  icon: React.ReactNode;
  adminOnly: boolean;
}

const NAV_PUBLIC: NavItem[] = [
  { key: "홈", label: "홈", icon: <Home className="h-4 w-4" />, adminOnly: false },
  { key: "카톡정리", label: "카톡 대화 정리", icon: <MessageSquare className="h-4 w-4" />, adminOnly: false },
  { key: "조직도", label: "조직도", icon: <GitBranch className="h-4 w-4" />, adminOnly: false },
  { key: "본사송부용", label: "본사 송부용", icon: <Mail className="h-4 w-4" />, adminOnly: false },
];

const NAV_ADMIN: NavItem[] = [
  { key: "오늘할일관리", label: "오늘 할 일 관리", icon: <ListChecks className="h-4 w-4" />, adminOnly: true },
  { key: "주간일정", label: "작업일정", icon: <CalendarRange className="h-4 w-4" />, adminOnly: true },
  { key: "신규자명단", label: "기술인 및 관리자 명단", icon: <Users className="h-4 w-4" />, adminOnly: true },
  { key: "근속알림", label: "근속 1년 도래 알림", icon: <BellRing className="h-4 w-4" />, adminOnly: true },
  { key: "XERP공수반영", label: "XERP 공수 반영", icon: <Calculator className="h-4 w-4" />, adminOnly: true },
];

const NAV_SEMI_PUBLIC: NavItem[] = [
  { key: "XERP&PMIS", label: "XERP & PMIS", icon: <Database className="h-4 w-4" />, adminOnly: false },
  { key: "전자카드 조회", label: "전자카드 조회", icon: <CreditCard className="h-4 w-4" />, adminOnly: false },
];

const HEAD_OFFICE_NAV: NavItem[] = [
  { key: "조직도송부", label: "조직도 송부 PPT", icon: <GitBranch className="h-4 w-4" />, adminOnly: false },
  { key: "본사메일송부", label: "본사 메일송부", icon: <Mail className="h-4 w-4" />, adminOnly: false },
  { key: "급여대장", label: "급여대장", icon: <BookText className="h-4 w-4" />, adminOnly: false },
  { key: "PDF분리", label: "PDF 분리 도구", icon: <Scissors className="h-4 w-4" />, adminOnly: false },
  { key: "RCM기안서송부", label: "RCM 기안서 송부", icon: <FileSpreadsheet className="h-4 w-4" />, adminOnly: false },
];
const ADMIN_TOP_NAV_KEY = "__admin";
const ADMIN_TODO_HIDE_PREFIX = "admin_todo_hidden_";
const ADMIN_DAILY_TASKS_PREFIX = "admin_daily_tasks_";
const MANUAL_ATTENDANCE_OVERRIDES_KEY = "attendance_manual_overrides";
const ATTENDANCE_ROSTER_KEY = "attendance_roster";
const ATTENDANCE_ROSTER_FILE_NAME_KEY = "attendance_roster_file_name";
const LOCAL_ATTENDANCE_WATCH_ENABLED_KEY = "attendance_local_watch_enabled";
const MANUAL_ATTENDANCE_STATUSES: ManualAttendanceStatus[] = ["연차", "오전반차", "오후반차", "결근", "입사일", "현장휴무"];

interface AdminDailyTask {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
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

function readManualAttendanceOverrides(): ManualAttendanceOverride[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANUAL_ATTENDANCE_OVERRIDES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ManualAttendanceOverride => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<ManualAttendanceOverride>;
      return (
        typeof record.id === "string" &&
        typeof record.date === "string" &&
        typeof record.name === "string" &&
        typeof record.createdAt === "string" &&
        !!record.status &&
        MANUAL_ATTENDANCE_STATUSES.includes(record.status)
      );
    });
  } catch {
    return [];
  }
}

function readAttendanceRoster(): AttendanceRosterEmployee[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ATTENDANCE_ROSTER_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AttendanceRosterEmployee => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<AttendanceRosterEmployee>;
      return (
        (record.team === "한성_F" || record.team === "태화_F" || record.team === "현채") &&
        typeof record.name === "string" &&
        typeof record.jobTitle === "string" &&
        typeof record.rank === "string"
      );
    });
  } catch {
    return [];
  }
}

function normalizeEmployeeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function getHanseongLeaveExcludedNames(data: ParsedData, roster: AttendanceRosterEmployee[]): Set<string> {
  const names = new Set<string>();
  for (const employee of roster) {
    if (employee.team === "한성_F") names.add(employee.name);
  }
  for (const employee of data.employees) {
    if (employee.team === "한성_F") names.add(employee.name);
  }
  return names;
}

function removeAnnualLeaveForNames(data: ParsedData, excludedNames: Set<string>): ParsedData {
  if (excludedNames.size === 0) return data;
  const normalizedExcludedNames = new Set([...excludedNames].map(normalizeEmployeeName));
  const keepName = (name: string) => !normalizedExcludedNames.has(normalizeEmployeeName(name));
  const keepLeaveDetail = (detail: ParsedData["leaveDetails"][number]) =>
    keepName(detail.name) || detail.reason.startsWith("수동 연차");
  const leaveDetails = data.leaveDetails.filter(keepLeaveDetail);
  const annualLeaveMap = Object.fromEntries(
    Object.entries(data.annualLeaveMap).filter(([name]) => keepName(name))
  );

  for (const detail of leaveDetails) {
    if (!detail.reason.startsWith("수동 연차")) continue;
    annualLeaveMap[detail.name] = {
      ...(annualLeaveMap[detail.name] ?? {}),
      [`${detail.year}|${detail.month}|${detail.day}`]: true,
    };
  }

  return {
    ...data,
    annualLeaveMap,
    leaveEmployees: data.leaveEmployees.filter((employee) => keepName(employee.name)),
    leaveDetails,
  };
}

function applyAttendancePresentationRules(data: ParsedData, roster: AttendanceRosterEmployee[]): ParsedData {
  return removeAnnualLeaveForNames(data, getHanseongLeaveExcludedNames(data, roster));
}

const Index = () => {
  const topbarRef = useRef<HTMLElement | null>(null);
  const adminTodoShownRef = useRef(false);
  const publicGuideShownRef = useRef(false);
  const localWatchVersionRef = useRef<string | null>(null);
  const [data, setData] = useState<ParsedData | null>(null);
  const [, setFileName] = useState<string | null>(null);
  const [, setRosterFileName] = useState<string | null>(() => localStorage.getItem(ATTENDANCE_ROSTER_FILE_NAME_KEY));
  const [attendanceRoster, setAttendanceRoster] = useState<AttendanceRosterEmployee[]>(() => readAttendanceRoster());
  const [, setFingerprintFileName] = useState<string | null>(null);
  const [, setXerpSourceFileName] = useState<string | null>(null);
  const [selectedDate] = useState(() => {
    const saved = localStorage.getItem("attendance_selected_date");
    if (saved) return saved;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setPendingBuffer] = useState<ArrayBuffer | null>(null);
  const [, setFingerprintBuffer] = useState<ArrayBuffer | null>(null);
  const [, setXerpSourceBuffer] = useState<ArrayBuffer | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("홈");
  const [payrollSubTab, setPayrollSubTab] = useState<PayrollSubTab>("급여대장보정");
  const [mailSubTab, setMailSubTab] = useState<MailRequestMenu>("certificate");
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [, setRowOrders] = useState<Record<string, string[]>>({});
  const [, setSearchQuery] = useState("");
  const { isAdmin, login, logout, authReady } = useAdminAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [publicGuideDialogOpen, setPublicGuideDialogOpen] = useState(false);
  const [adminTodoDialogOpen, setAdminTodoDialogOpen] = useState(false);
  const [manualAttendanceDialogOpen, setManualAttendanceDialogOpen] = useState(false);
  const [manualAttendanceOverrides, setManualAttendanceOverrides] = useState<ManualAttendanceOverride[]>(() => readManualAttendanceOverrides());
  const [manualAttendanceDate, setManualAttendanceDate] = useState(() => getLocalDateKey());
  const [manualAttendanceName, setManualAttendanceName] = useState("");
  const [manualAttendanceStatus, setManualAttendanceStatus] = useState<ManualAttendanceStatus>("연차");
  const [manualAttendanceNote, setManualAttendanceNote] = useState("");
  const [localWatchEnabled] = useState(() => localStorage.getItem(LOCAL_ATTENDANCE_WATCH_ENABLED_KEY) === "true");
  const [, setLocalWatchStatus] = useState("자동감시가 꺼져 있습니다.");
  const [xerpLoginOpening, setXerpLoginOpening] = useState(false);
  const [xerpLoginStatus, setXerpLoginStatus] = useState<XerpLoginUiStatus>("idle");
  const [hideAdminTodoToday, setHideAdminTodoToday] = useState(false);
  const [adminTodoDate, setAdminTodoDate] = useState(() => getLocalDateKey());
  const [adminTodoDraft, setAdminTodoDraft] = useState("");
  const [adminDailyTasks, setAdminDailyTasks] = useState<AdminDailyTask[]>([]);
  const [subnavOffsets, setSubnavOffsets] = useState({ primary: 18, admin: 18, nested: 18 });

  const adminTodoTodayKey = useMemo(() => getLocalDateKey(), []);
  const adminTodoHideStorageKey = `${ADMIN_TODO_HIDE_PREFIX}${adminTodoTodayKey}`;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (await login(loginId, loginPw, rememberLogin)) {
        toast.success("관리자로 로그인되었습니다.");
        setLoginDialogOpen(false);
        setLoginId("");
        setLoginPw("");
      } else {
        toast.error("관리자 권한이 없는 계정입니다.");
      }
    } catch {
      toast.error("이메일 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  const handleAdminTodoDialogChange = (open: boolean) => {
    if (!open && hideAdminTodoToday) {
      localStorage.setItem(adminTodoHideStorageKey, "true");
    }
    setAdminTodoDialogOpen(open);
  };

  const checkXerpLoginStatus = useCallback(async () => {
    try {
      const status = await fetchXerpLoginStatus();
      if (status.loggedIn) {
        setXerpLoginStatus("logged-in");
      } else if (status.status === "login-required") {
        setXerpLoginStatus("login-required");
      } else if (status.status === "no-window") {
        setXerpLoginStatus("idle");
      } else {
        setXerpLoginStatus("checking");
      }
      return status;
    } catch {
      setXerpLoginStatus("unavailable");
      return null;
    }
  }, []);

  const handleXerpLoginOpen = async () => {
    setXerpLoginOpening(true);
    setXerpLoginStatus("checking");
    try {
      const result = await requestXerpLoginWindowOpen();
      toast.success(result.message || "XERP 전용 창(Chrome for Testing)을 열었습니다. 일반 Chrome이 아니라 이 창에서 로그인한 뒤 XERP 가져오기를 눌러주세요.");
      void checkXerpLoginStatus();
    } catch (error) {
      setXerpLoginStatus("unavailable");
      toast.error(error instanceof Error ? error.message : "XERP 로그인 창을 열지 못했습니다.");
    } finally {
      setXerpLoginOpening(false);
    }
  };

  useEffect(() => {
    if (xerpLoginStatus !== "checking" && xerpLoginStatus !== "login-required") return;
    const timer = window.setInterval(() => {
      void checkXerpLoginStatus();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [checkXerpLoginStatus, xerpLoginStatus]);

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
          const roster = readAttendanceRoster();
          setData(applyAttendancePresentationRules(
            applyManualAttendanceOverrides(result.data, readManualAttendanceOverrides(), roster),
            roster
          ));
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

  const saveManualAttendanceOverrides = useCallback((nextOverrides: ManualAttendanceOverride[]) => {
    setManualAttendanceOverrides(nextOverrides);
    localStorage.setItem(MANUAL_ATTENDANCE_OVERRIDES_KEY, JSON.stringify(nextOverrides));
    setData((current) => current ? applyAttendancePresentationRules(
      applyManualAttendanceOverrides(current, nextOverrides, attendanceRoster),
      attendanceRoster
    ) : current);
  }, [attendanceRoster]);

  const handleAddManualAttendanceOverride = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const isSiteWide = manualAttendanceStatus === "현장휴무";
    if (!isSiteWide && !manualAttendanceName) {
      toast.error("직원을 선택하세요.");
      return;
    }

    const nextOverride: ManualAttendanceOverride = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: manualAttendanceDate,
      name: isSiteWide ? "" : manualAttendanceName,
      status: manualAttendanceStatus,
      note: manualAttendanceNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const nextOverrides = [
      nextOverride,
      ...manualAttendanceOverrides.filter(
        (override) => !(override.date === manualAttendanceDate && override.name === manualAttendanceName)
      ),
    ];
    saveManualAttendanceOverrides(nextOverrides);
    setManualAttendanceNote("");
    toast.success("수동 근태 입력을 반영했습니다.");
  }, [
    manualAttendanceDate,
    manualAttendanceName,
    manualAttendanceNote,
    manualAttendanceOverrides,
    manualAttendanceStatus,
    saveManualAttendanceOverrides,
  ]);

  const handleDeleteManualAttendanceOverride = useCallback((id: string) => {
    saveManualAttendanceOverrides(manualAttendanceOverrides.filter((override) => override.id !== id));
  }, [manualAttendanceOverrides, saveManualAttendanceOverrides]);

  useEffect(() => {
    if (!localWatchEnabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await fetchLocalAttendanceWatchStatus();
        if (cancelled) return;

        if (!status.ready) {
          setLocalWatchStatus(`대기 중: ${status.missing.join(", ")} 파일이 필요합니다.`);
          return;
        }

        const rosterStatus = status.roster?.name ? ` / ${status.roster.name}` : "";
        setLocalWatchStatus(`감시 중: ${status.fingerprint?.name ?? "지문기록"} / ${status.xerp?.name ?? "XERP기록"}${rosterStatus}`);
        if (!shouldApplyLocalWatchVersion(status, localWatchVersionRef.current)) return;

        const payload = await fetchLocalAttendanceSourceFiles();
        if (cancelled) return;

        const nextFingerprintBuffer = decodeBase64ToArrayBuffer(payload.fingerprint.base64);
        const nextXerpBuffer = decodeBase64ToArrayBuffer(payload.xerp.base64);
        const { parseAttendanceRosterFile, parseAttendanceSourceFiles, preserveAnnualLeaveData } = await import("@/lib/attendanceSources");
        let nextRoster = attendanceRoster;
        if (payload.roster?.base64) {
          const nextRosterBuffer = decodeBase64ToArrayBuffer(payload.roster.base64);
          const parsedRoster = parseAttendanceRosterFile(nextRosterBuffer);
          if (parsedRoster.length > 0) {
            nextRoster = parsedRoster;
            setAttendanceRoster(parsedRoster);
            setRosterFileName(payload.roster.name);
            localStorage.setItem(ATTENDANCE_ROSTER_KEY, JSON.stringify(parsedRoster));
            localStorage.setItem(ATTENDANCE_ROSTER_FILE_NAME_KEY, payload.roster.name);
          }
        }
        const sourceData = parseAttendanceSourceFiles(nextFingerprintBuffer, nextXerpBuffer, nextRoster);

        localWatchVersionRef.current = payload.version;
        setFingerprintBuffer(nextFingerprintBuffer);
        setXerpSourceBuffer(nextXerpBuffer);
        setFingerprintFileName(payload.fingerprint.name);
        setXerpSourceFileName(payload.xerp.name);
        setData((current) => applyAttendancePresentationRules(
          applyManualAttendanceOverrides(
            preserveAnnualLeaveData(sourceData, current),
            manualAttendanceOverrides,
            nextRoster
          ),
          nextRoster
        ));
        setFileName(`${payload.fingerprint.name} + ${payload.xerp.name}`);
        setPendingBuffer(null);
        const rosterAppliedStatus = payload.roster?.name ? ` / ${payload.roster.name}` : "";
        setLocalWatchStatus(`자동 반영됨: ${payload.fingerprint.name} / ${payload.xerp.name}${rosterAppliedStatus}`);
        toast.success("로컬 폴더 변경을 자동 반영했습니다.");
      } catch {
        if (!cancelled) {
          setLocalWatchStatus("로컬 감시 프로그램에 연결되지 않았습니다. npm run attendance:watch를 실행하세요.");
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, 5000);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attendanceRoster, localWatchEnabled, manualAttendanceOverrides]);

  const handleNavClick = (key: ActiveTab, adminOnly: boolean) => {
    if (adminOnly && !isAdmin) {
      toast.error("관리자 로그인이 필요합니다.");
      return;
    }
    const nextTab = key === "본사송부용" ? "조직도송부" : key;
    setAdminMenuOpen(false);
    setActiveTab(nextTab);
    setSearchQuery("");
  };

  const handleAdminTodoMove = (key: ActiveTab, payrollTab?: PayrollSubTab) => {
    if (key === "급여대장" && payrollTab) {
      setPayrollSubTab(payrollTab);
    }
    handleNavClick(key, true);
    setAdminTodoDialogOpen(false);
  };

  const handlePublicGuideMove = (key: "카톡정리" | "조직도" | "XERP&PMIS") => {
    handleNavClick(key, false);
    setPublicGuideDialogOpen(false);
  };

  const manualAttendanceEmployeeNames = useMemo(() => {
    const names = new Set<string>();
    if (attendanceRoster.length > 0) {
      for (const employee of attendanceRoster) names.add(employee.name);
    } else {
      for (const employee of data?.employees ?? []) names.add(employee.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [attendanceRoster, data]);

  useEffect(() => {
    if (
      manualAttendanceEmployeeNames.length > 0 &&
      (!manualAttendanceName || !manualAttendanceEmployeeNames.includes(manualAttendanceName))
    ) {
      setManualAttendanceName(manualAttendanceEmployeeNames[0]);
    }
  }, [manualAttendanceEmployeeNames, manualAttendanceName]);

  const adminTodoItems = useMemo(() => [
    {
      title: "월간 작업일정 점검",
      description: "월 기준 구역별 조출·연장·야간 일정을 확인하세요.",
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
  }, [adminTodoHideStorageKey, adminTodoTodayKey, isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      setPublicGuideDialogOpen(false);
      return;
    }
    if (!publicGuideShownRef.current) {
      publicGuideShownRef.current = true;
      setPublicGuideDialogOpen(true);
    }
  }, [isAdmin]);

  const primaryNavItems = [...NAV_PUBLIC, ...NAV_SEMI_PUBLIC];
  const isHeadOfficeSection = activeTab === "본사송부용" || HEAD_OFFICE_NAV.some((item) => item.key === activeTab);
  const activeAdminItem = NAV_ADMIN.find((item) => item.key === activeTab);
  const isAdminSection = Boolean(activeAdminItem);
  const activePrimarySubnavKey = null;
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
    const nestedLeft = isHeadOfficeSection
      ? measureLeft(findByData("[data-nav-key]", "navKey", "본사송부용"))
      : activeNestedSubnavKey
        ? measureLeft(findByData("[data-admin-key]", "adminKey", activeNestedSubnavKey))
        : null;

    setSubnavOffsets((current) => {
      const next = {
        primary: primaryLeft ?? current.primary,
        admin: current.admin,
        nested: nestedLeft ?? 18,
      };
      return next.primary === current.primary && next.admin === current.admin && next.nested === current.nested
        ? current
        : next;
    });
  }, [activeNestedSubnavKey, activePrimarySubnavKey, isHeadOfficeSection]);

  useLayoutEffect(() => {
    updateSubnavOffsets();

    const topbar = topbarRef.current;
    if (!topbar) return;

    const handleLayoutChange = () => updateSubnavOffsets();
    window.addEventListener("resize", handleLayoutChange);

    const scrollers = topbar.querySelectorAll(".ops-topnav, .ops-admin-menu-panel");
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
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">이메일</label>
              <input
                type="email"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="admin@example.com"
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
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => setRememberLogin(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              자동 로그인 유지
            </label>
            <button
              type="submit"
              disabled={!authReady}
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              {authReady ? "로그인" : "인증 확인 중..."}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={manualAttendanceDialogOpen} onOpenChange={setManualAttendanceDialogOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-primary" />
              수동 근태 입력
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddManualAttendanceOverride} className="grid gap-3 pt-2 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">날짜</label>
              <input
                type="date"
                value={manualAttendanceDate}
                onChange={(event) => setManualAttendanceDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-slate-400"
              />
            </div>
            {manualAttendanceStatus !== "현장휴무" && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">직원</label>
                <select
                  value={manualAttendanceName}
                  onChange={(event) => setManualAttendanceName(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-slate-400"
                >
                  <option value="">직원 선택</option>
                  {manualAttendanceEmployeeNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">상태</label>
              <select
                value={manualAttendanceStatus}
                onChange={(event) => setManualAttendanceStatus(event.target.value as ManualAttendanceStatus)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-slate-400"
              >
                {MANUAL_ATTENDANCE_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">메모</label>
              <input
                value={manualAttendanceNote}
                onChange={(event) => setManualAttendanceNote(event.target.value)}
                placeholder="선택 입력"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="h-10 w-full rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
              >
                입력 반영
              </button>
            </div>
          </form>

          <div className="max-h-56 space-y-2 overflow-auto border-t border-slate-100 pt-3">
            {manualAttendanceOverrides.length === 0 ? (
              <p className="py-6 text-center text-sm font-semibold text-slate-400">등록된 수동 근태가 없습니다.</p>
            ) : (
              manualAttendanceOverrides.map((override) => (
                <div key={override.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-bold text-slate-900">{override.date}</span>
                  <span className="font-bold text-slate-700">{override.name || "전체"}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">{override.status}</span>
                  {override.note && <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-400">{override.note}</span>}
                  <button
                    type="button"
                    onClick={() => handleDeleteManualAttendanceOverride(override.id)}
                    className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={publicGuideDialogOpen} onOpenChange={setPublicGuideDialogOpen}>
        <DialogContent className="admin-todo-dialog sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="admin-todo-title">
              <span className="admin-todo-title-icon">
                <ClipboardList className="h-5 w-5" />
              </span>
              <span>
                현장 정보 바로가기
                <small>로그인 없이 확인 가능</small>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="admin-todo-greeting">
            <strong>필요한 현장 정보를 바로 확인하세요</strong>
            <p>카톡 대화 정리, 조직도, XERP & PMIS는 관리자 로그인 없이 열람할 수 있습니다.</p>
          </div>

          <div className="admin-todo-list">
            <button
              type="button"
              onClick={() => handlePublicGuideMove("카톡정리")}
              className="admin-todo-item"
            >
              <span className="admin-todo-item-icon"><ClipboardList className="h-4 w-4" /></span>
              <span className="admin-todo-item-copy">
                <strong>카톡 대화 정리하기</strong>
                <small>카톡 대화 파일을 올려 날짜·사람별로 정리합니다.</small>
              </span>
              <span className="admin-todo-badge is-base">카톡</span>
              <ArrowRight className="admin-todo-arrow h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePublicGuideMove("조직도")}
              className="admin-todo-item"
            >
              <span className="admin-todo-item-icon"><GitBranch className="h-4 w-4" /></span>
              <span className="admin-todo-item-copy">
                <strong>조직도 확인하기</strong>
                <small>현장 조직과 담당자 배치를 확인합니다.</small>
              </span>
              <span className="admin-todo-badge is-base">조직</span>
              <ArrowRight className="admin-todo-arrow h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePublicGuideMove("XERP&PMIS")}
              className="admin-todo-item"
            >
              <span className="admin-todo-item-icon"><Database className="h-4 w-4" /></span>
              <span className="admin-todo-item-copy">
                <strong>XERP & PMIS 확인하기</strong>
                <small>공수 및 PMIS 반영 현황을 확인합니다.</small>
              </span>
              <span className="admin-todo-badge is-base">공수</span>
              <ArrowRight className="admin-todo-arrow h-4 w-4" />
            </button>
          </div>

          <div className="admin-todo-footer" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setPublicGuideDialogOpen(false)}
              className="admin-todo-close"
            >
              닫기
            </button>
          </div>
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
            <span className="ops-brand-subtitle">현장관리자동시스템</span>
          </button>

          <nav className="ops-topnav" aria-label="주요 메뉴">
            {primaryNavItems.map(({ key, label, icon }) => {
              const isActive = activeTab === key || (key === "본사송부용" && isHeadOfficeSection);
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
              onClick={() => isAdmin ? setAdminMenuOpen((open) => !open) : setLoginDialogOpen(true)}
              aria-expanded={shouldShowAdminMenuPanel({ isAdmin, isOpen: adminMenuOpen })}
              className={`ops-topnav-item ${isAdminSection ? "is-active" : ""} ${!isAdmin ? "is-locked" : ""}`}
            >
              <Lock className="h-4 w-4" />
              <span>{getAdminMenuButtonLabel(isAdminSection, activeAdminItem?.label)}</span>
              {isAdmin && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${adminMenuOpen ? "rotate-180" : ""}`} />}
            </button>
          </nav>

          <div className="ops-topmeta">
            <button
              type="button"
              onClick={() => {
                openLocalServicesLauncher();
                toast.info("로컬 서비스 실행 요청을 보냈습니다. 처음 사용 시 등록 파일을 먼저 실행해야 합니다.");
              }}
              className="ops-todo-button"
              title="로컬 서비스 켜기"
            >
              <Power className="h-3.5 w-3.5" />
              로컬서비스
            </button>
            <button
              type="button"
              onClick={handleXerpLoginOpen}
              disabled={xerpLoginOpening}
              className={`ops-todo-button ${xerpLoginStatus === "logged-in" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : ""}`}
              title={xerpLoginStatus === "logged-in" ? "XERP 로그인됨" : "XERP 로그인 창 열기"}
            >
              {xerpLoginOpening || xerpLoginStatus === "checking" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogIn className="h-3.5 w-3.5" />
              )}
              {xerpLoginOpening
                ? "여는 중"
                : xerpLoginStatus === "logged-in"
                  ? "XERP 로그인됨"
                  : xerpLoginStatus === "checking"
                    ? "확인 중"
                    : "XERP 로그인"}
            </button>
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

        {shouldShowAdminMenuPanel({ isAdmin, isOpen: adminMenuOpen }) && (
          <div className="ops-admin-menu-panel" aria-label="관리자 메뉴">
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

        {isHeadOfficeSection && (
          <div className="ops-subbar ops-subbar-nested">
            {HEAD_OFFICE_NAV.map(({ key, label, icon, adminOnly }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleNavClick(key, adminOnly)}
                className={activeTab === key ? "is-active" : ""}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {activeTab === "본사메일송부" && (
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

        {activeTab === "급여대장" && (
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
            <LazyPanel>
              <LazyHomePage lastUploadedAt={lastUploadedAt ? formatUploadTime(lastUploadedAt) : null} selectedDate={selectedDate} isAdmin={isAdmin} leaveDetails={data?.leaveDetails ?? []} />
            </LazyPanel>
          )}

        {/* 신규자 명단 (관리자 전용) */}
        {activeTab === "신규자명단" && isAdmin && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <LazyPanel>
              <LazyNewEmployeeList />
            </LazyPanel>
          </div>
        )}

        {/* 근속 1년 도래 알림 (관리자 전용) */}
        {activeTab === "근속알림" && isAdmin && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <LazyPanel>
              <LazyTenureAlert />
            </LazyPanel>
          </div>
        )}

        {/* 카톡 대화 정리 */}
        {activeTab === "카톡정리" && (
          <LazyPanel>
            <LazyKakaoChatOrganizer />
          </LazyPanel>
        )}

        {/* 조직도 */}
        {activeTab === "조직도" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <LazyPanel>
              <OrgChart initialSiteKey="p4-ph4" />
            </LazyPanel>
          </div>
        )}

        {activeTab === "조직도송부" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <LazyPanel>
              <OrgChart initialSiteKey="head-office-p4-ph4" showSiteTabs={false} />
            </LazyPanel>
          </div>
        )}

        {/* 작업일정 */}
        {activeTab === "주간일정" && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <LazyPanel>
              <LazyWeeklySchedule />
            </LazyPanel>
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

        {activeTab === "전자카드 조회" && (
          <LazyPanel>
            <LazyElcdComparePage isAdmin={isAdmin} />
          </LazyPanel>
        )}

          {/* XERP 공수 반영 */}
          {activeTab === "XERP공수반영" && (
            <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
              <LazyPanel>
                <LazyXerpWorkReflection isAdmin={isAdmin} />
              </LazyPanel>
            </div>
          )}

          {/* 본사 메일송부 */}
          {activeTab === "본사메일송부" && (
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
              <LazyPanel>
                <LazyHeadOfficeMailRequest activeMenu={mailSubTab} onMenuChange={setMailSubTab} />
              </LazyPanel>
            </div>
          )}

          {/* PDF 분리 도구 */}
          {activeTab === "PDF분리" && (
            <LazyPanel>
              <LazyPdfSplitter />
            </LazyPanel>
          )}

          {/* RCM 기안서 송부 */}
          {activeTab === "RCM기안서송부" && (
            <LazyPanel>
              <LazyRcmDraftImageExport />
            </LazyPanel>
          )}

          {/* 급여대장 */}
          {activeTab === "급여대장" && (
            <div>
              <div className="p-4 pb-0 md:hidden">
                <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
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
              <LazyPanel>
                {payrollSubTab === "급여대장보정" && <LazyPayrollPage />}
                {payrollSubTab === "추가공수스캔" && <LazyAdditionalWorkScanPage />}
                {payrollSubTab === "직종변경" && <LazyPayrollJobTitleChangePage />}
              </LazyPanel>
            </div>
          )}

        </main>
      </div>

    </div>
  );
};

export default Index;
