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
    const weekMonth = monday.getMonth() + 1;
    const weekYear = monday.getFullYear();
    // Filter by both year AND month
    let emps = data.employees.filter((e) => e.dataYear === weekYear && e.dataMonth === weekMonth);
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

  // Stats: monthly cumulative from anomaly sheets
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-6 py-4">
        <h1 className="text-base font-bold text-foreground">📋 P4-PH4 초순수 현장 — 주간 근태보고</h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">평택 한성크린텍 · XERP 기록 기반 자동집계</p>
      </div>

      <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-3">
        <FileUploadZone
          onFileLoaded={handleFileLoaded}
          fileName={fileName}
          onClear={() => { setData(null); setFileName(null); }}
          onFileName={setFileName}
        />

        {data && (
          <>
            {/* Controls */}
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

            {/* Stats */}
            <div className="flex gap-2.5 flex-wrap">
              <StatCard label="조회 인원" value={stats.total} icon="👥" />
              <StatCard label="미타각(월누계)" value={stats.미타각} variant="warning" icon="⚠️" />
              <StatCard label="지각(월누계)" value={stats.지각} variant="yellow" icon="🕐" />
              <StatCard label="결근(월누계)" value={stats.결근} variant="danger" icon="❌" />
              <StatCard label="연차(월누계)" value={stats.연차} variant="teal" icon="📅" />
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

        {!data && (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4">⬆️</div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              Excel 파일을 업로드하면 근태 현황이 자동 표시됩니다
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-muted px-1.5 py-0.5 rounded text-secondary text-[11px]">XERP 기록</code> 시트가 포함된 엑셀 파일을 올려주세요<br />
              한성 / 태화 팀별 자동 분류<br />
              날짜 선택 → 해당 주 출퇴근 현황 즉시 표시
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
