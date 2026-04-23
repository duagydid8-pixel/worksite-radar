import HomePageComponent from "@/components/HomePage";
import { useAttendance } from "@/hooks/useAttendance";
import { useUI } from "@/hooks/useUI";

function formatUploadTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function HomePage() {
  const { lastUploadedAt, selectedDate, data } = useAttendance();
  const { isAdmin } = useUI();
  return (
    <HomePageComponent
      lastUploadedAt={lastUploadedAt ? formatUploadTime(lastUploadedAt) : null}
      selectedDate={selectedDate}
      isAdmin={isAdmin}
      leaveDetails={data?.leaveDetails ?? []}
    />
  );
}
