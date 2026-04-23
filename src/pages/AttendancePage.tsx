import { CloudUpload, Loader2, Search, X, Download } from "lucide-react";
import FileUploadZone from "@/components/FileUploadZone";
import AttendanceTable from "@/components/AttendanceTable";
import { exportMonthlyExcel } from "@/services/excelExporter";
import { useAttendance } from "@/hooks/useAttendance";
import { useUI } from "@/hooks/useUI";
import { formatWeekRange } from "@/contexts/AttendanceContext";
import type { TeamFilter } from "@/types/common";

export default function AttendancePage() {
  const {
    data,
    fileName,
    selectedDate,
    pendingDate,
    teamFilter,
    isSaving,
    filteredEmployees,
    anomalyMap,
    weekDates,
    rowOrders,
    setTeamFilter,
    setPendingDate,
    setSelectedDate,
    setFileName,
    handleFileLoaded,
    handleSaveToCloud,
    handleOrderChange,
    setSearchQuery,
    searchQuery,
  } = useAttendance();
  const { isAdmin } = useUI();

  const monday = weekDates[0];

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">
      {/* File upload + save (admin only) */}
      {isAdmin && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <FileUploadZone
              onFileLoaded={handleFileLoaded}
              fileName={fileName}
              onClear={() => { setFileName(null); }}
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
          {/* 통합 컨트롤 바 */}
          <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
            {/* 상단: 날짜 + 주간범위 + 팀필터 */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-muted-foreground tracking-wide uppercase whitespace-nowrap">기준일</span>
                <input
                  type="date"
                  value={pendingDate}
                  onChange={(e) => setPendingDate(e.target.value)}
                  className="bg-muted/40 border border-border text-foreground text-sm font-bold px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-colors"
                />
                <button
                  onClick={() => { setSelectedDate(pendingDate); localStorage.setItem("attendance_selected_date", pendingDate); }}
                  disabled={pendingDate === selectedDate}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  적용
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary bg-secondary/10 border border-secondary/20 px-3 py-1.5 rounded-lg whitespace-nowrap">
                <span>📅</span>
                <span>{monday ? formatWeekRange(monday) : ""}</span>
              </div>
              <div className="flex gap-1 ml-auto bg-muted rounded-lg p-0.5">
                {(["전체", "한성", "태화"] as TeamFilter[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTeamFilter(v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      teamFilter === v
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* 하단: 검색 + 다운로드 */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름으로 검색..."
                  className="w-full bg-white border border-border rounded-lg pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-border text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors shrink-0 shadow-sm"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
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
    </div>
  );
}
