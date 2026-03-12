import { useState, useMemo, useCallback } from "react";
import FileUploadZone from "@/components/FileUploadZone";
import StatCard from "@/components/StatCard";
import AttendanceTable from "@/components/AttendanceTable";
import { parseExcelFile, type ParsedData, type Employee, type AnomalyRecord } from "@/lib/parseExcel";
import { toast } from "sonner";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateHeader(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES[date.getDay()]})`;
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

const Index = () => {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("전체");

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
      toast.success(`${parsed.employees.length}명의 데이터를 불러왔습니다.`);
    } catch (err: any) {
      toast.error(err.message || "파일 파싱 오류");
    }
  }, []);

  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const monthOfWeek = monday.getMonth() + 1;
    let emps = data.employees.filter(() => data.dataMonth === monthOfWeek);
    if (emps.length === 0) emps = data.employees;

    if (teamFilter === "한성") return emps.filter((e) => e.team === "한성_F");
    if (teamFilter === "태화") return emps.filter((e) => e.team === "태화_F");
    // 전체: 한성_F first, then 태화_F
    const hanseong = emps.filter((e) => e.team === "한성_F");
    const taehwa = emps.filter((e) => e.team === "태화_F");
    return [...hanseong, ...taehwa];
  }, [data, teamFilter, monday]);

  const anomalyMap = useMemo(() => {
    if (!data) return new Map<string, AnomalyRecord>();
    const map = new Map<string, AnomalyRecord>();
    for (const a of data.anomalies) {
      map.set(a.name, a);
    }
    return map;
  }, [data]);

  const stats = useMemo(() => {
    const total = filteredEmployees.length;
    let 미타각 = 0, 지각 = 0, 결근 = 0, 연차 = 0;
    for (const emp of filteredEmployees) {
      const a = anomalyMap.get(emp.name);
      if (a) {
        미타각 += a.미타각;
        지각 += a.지각;
        결근 += a.결근;
        연차 += a.연차;
      }
    }
    return { total, 미타각, 지각, 결근, 연차 };
  }, [filteredEmployees, anomalyMap]);

  const filterButtons: { label: string; value: TeamFilter }[] = [
    { label: "전체", value: "전체" },
    { label: "한성", value: "한성" },
    { label: "태화", value: "태화" },
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <h1 className="text-xl font-bold text-foreground">P4-PH4 주간 출퇴근 현황</h1>

      <FileUploadZone
        onFileLoaded={handleFileLoaded}
        fileName={fileName}
        onClear={() => { setData(null); setFileName(null); }}
        onFileName={setFileName}
      />

      {data && (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">기준일</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md bg-card border border-border px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <span className="text-sm text-muted-foreground">{formatWeekRange(monday)}</span>
            <div className="flex gap-1 ml-auto">
              {filterButtons.map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => setTeamFilter(btn.value)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    teamFilter === btn.value
                      ? btn.value === "한성"
                        ? "bg-hanseong text-foreground"
                        : btn.value === "태화"
                        ? "bg-taehwa text-background"
                        : "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="인원" value={stats.total} />
            <StatCard label="미타각" value={stats.미타각} variant="warning" />
            <StatCard label="지각" value={stats.지각} variant="warning" />
            <StatCard label="결근" value={stats.결근} variant="danger" />
            <StatCard label="연차" value={stats.연차} />
          </div>

          {/* Table */}
          <AttendanceTable
            employees={filteredEmployees}
            anomalyMap={anomalyMap}
            weekDates={weekDates}
            dataYear={data.dataYear}
            dataMonth={data.dataMonth}
          />
        </>
      )}
    </div>
  );
};

export default Index;
