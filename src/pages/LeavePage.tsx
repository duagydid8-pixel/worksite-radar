import AnnualLeavePanel from "@/components/AnnualLeavePanel";
import { useAttendance } from "@/hooks/useAttendance";

export default function LeavePage() {
  const { data, rowOrders, handleOrderChange } = useAttendance();
  return (
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
  );
}
