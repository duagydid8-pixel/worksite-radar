import { createContext, useState, useMemo, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { parseExcelFile } from "../services/excelParser";
import {
  saveAttendanceFS,
  fetchAttendanceFS,
  saveRowOrderFS,
  fetchRowOrderFS,
} from "../services/attendanceService";
import { toast } from "sonner";
import type { ParsedData, Employee, AnomalyRecord } from "../types/attendance";
import type { TeamFilter } from "../types/common";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

const ROW_ORDER_CONTEXTS = ["attendance_한성_F", "attendance_태화_F", "leave"];

// ── Context value type ────────────────────────────────────────────────────────

export interface AttendanceContextValue {
  data: ParsedData | null;
  fileName: string | null;
  selectedDate: string;
  pendingDate: string;
  teamFilter: TeamFilter;
  lastUploadedAt: string | null;
  isSaving: boolean;
  isLoading: boolean;
  rowOrders: Record<string, string[]>;
  searchQuery: string;
  filteredEmployees: Employee[];
  anomalyMap: Map<string, AnomalyRecord>;
  weekDates: Date[];
  weekStats: { total: number; late: number; uncheck: number; leave: number };
  monthStats: { total: number; late: number; uncheck: number; leave: number };
  setSelectedDate: (date: string) => void;
  setPendingDate: (date: string) => void;
  setTeamFilter: (filter: TeamFilter) => void;
  setSearchQuery: (query: string) => void;
  handleFileLoaded: (buffer: ArrayBuffer) => void;
  handleSaveToCloud: () => Promise<void>;
  handleOrderChange: (context: string, names: string[]) => Promise<void>;
  setFileName: (name: string | null) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

export const AttendanceContext = createContext<AttendanceContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AttendanceProvider({ children }: { children: ReactNode }) {
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
  const [rowOrders, setRowOrders] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState("");

  // ── Initial data load ──────────────────────────────────────────────────────

  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 8000);
    (async () => {
      try {
        const [result, ...orders] = await Promise.all([
          fetchAttendanceFS(),
          ...ROW_ORDER_CONTEXTS.map((ctx) =>
            fetchRowOrderFS(ctx).then((names) => ({ ctx, names }))
          ),
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

  // ── Derived date values ────────────────────────────────────────────────────

  const monday = useMemo(() => getMonday(new Date(selectedDate)), [selectedDate]);

  const weekDates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
      }),
    [monday]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleFileLoaded = useCallback((buffer: ArrayBuffer) => {
    try {
      const parsed = parseExcelFile(buffer);
      setData(parsed);
      setPendingBuffer(buffer);
      toast.success(
        `${parsed.employees.length}명의 데이터를 불러왔습니다. "업로드 & 저장" 버튼을 눌러 저장하세요.`
      );
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

  // ── Memos ──────────────────────────────────────────────────────────────────

  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const [weekYear, weekMonth] = selectedDate.split("-").map(Number);
    let emps = data.employees.filter(
      (e) => e.dataYear === weekYear && e.dataMonth === weekMonth
    );
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
    const sorted = [
      ...emps.filter((e) => e.team === "한성_F"),
      ...emps.filter((e) => e.team === "태화_F"),
    ];
    if (!searchQuery.trim()) return sorted;
    return sorted.filter((e) => e.name.includes(searchQuery.trim()));
  }, [data, teamFilter, monday, searchQuery, selectedDate]);

  const anomalyMap = useMemo(() => {
    if (!data) return new Map<string, AnomalyRecord>();
    const map = new Map<string, AnomalyRecord>();
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
        if (data?.annualLeaveMap[emp.name]?.[leaveKey]) {
          empLeave = true;
          continue;
        }
        const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
        const rec = emp.dailyRecords[key];
        if (rec?.punchIn && isLate(rec.punchIn)) empLate = true;
        const isToday = cellDate.getTime() === today.getTime();
        if (!isToday && emp.team === "태화_F" && rec?.punchIn && !rec.punchOut)
          empUncheck = true;
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
        if (data?.annualLeaveMap[emp.name]?.[leaveKey]) {
          leaveTotal++;
          continue;
        }
        const key = `${weekYear}-${weekMonth}-${d}`;
        const rec = emp.dailyRecords[key];
        if (rec?.punchIn && isLate(rec.punchIn)) lateTotal++;
        const isToday = dateObj.getTime() === today.getTime();
        if (!isToday && emp.team === "태화_F" && rec?.punchIn && !rec.punchOut)
          uncheckTotal++;
      }
    }
    return { total: filteredEmployees.length, late: lateTotal, uncheck: uncheckTotal, leave: leaveTotal };
  }, [filteredEmployees, data, monday, selectedDate]);

  // ── Context value ──────────────────────────────────────────────────────────

  const value: AttendanceContextValue = {
    data,
    fileName,
    selectedDate,
    pendingDate,
    teamFilter,
    lastUploadedAt,
    isSaving,
    isLoading,
    rowOrders,
    searchQuery,
    filteredEmployees,
    anomalyMap,
    weekDates,
    weekStats,
    monthStats,
    setSelectedDate,
    setPendingDate,
    setTeamFilter,
    setSearchQuery,
    handleFileLoaded,
    handleSaveToCloud,
    handleOrderChange,
    setFileName,
  };

  return (
    <AttendanceContext.Provider value={value}>
      {children}
    </AttendanceContext.Provider>
  );
}

export { DAY_NAMES, getMonday, formatWeekRange, isLate, ROW_ORDER_CONTEXTS };
