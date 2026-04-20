import { useState } from "react";
import { saveScheduleFS } from "@/lib/firestoreService";
import { toast } from "sonner";
import { FileJson, Save, Loader2 } from "lucide-react";

interface ScheduleData {
  weekStart: string;
  zones: string[];
  schedule: Record<string, Record<string, string>>;
  uploadedAt?: string;
}

// schedule_maker_v2.py 배열 형식 → Record 형식 변환
function normalizeSchedule(json: any): ScheduleData | null {
  if (!json.weekStart) return null;

  // 이미 Record 형식이면 그대로
  if (json.zones && json.schedule && !Array.isArray(json.schedule)) {
    return {
      weekStart: json.weekStart,
      zones: json.zones,
      schedule: json.schedule,
      uploadedAt: new Date().toISOString(),
    };
  }

  // 배열 형식 변환 (schedule_maker_v2.py 출력)
  if (Array.isArray(json.schedule)) {
    const recordSchedule: Record<string, Record<string, string>> = {};
    const zonesSet = new Set<string>();

    for (const item of json.schedule) {
      const zone = item.zone || item.floor;
      const date = item.date;
      const task = item.task;
      if (!zone || !date || !task) continue;

      zonesSet.add(zone);
      if (!recordSchedule[date]) recordSchedule[date] = {};
      recordSchedule[date][zone] = task;
    }

    return {
      weekStart: json.weekStart,
      zones: json.zones ?? Array.from(zonesSet),
      schedule: recordSchedule,
      uploadedAt: new Date().toISOString(),
    };
  }

  return null;
}

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const TYPE_STYLE: Record<string, string> = {
  "야간":    "bg-orange-100 text-orange-700",
  "연장":    "bg-blue-100 text-blue-700",
  "주간":    "bg-green-100 text-green-700",
  "현장 휴무": "bg-red-100 text-red-500",
  "현장휴무": "bg-red-100 text-red-500",
};

export function WeeklySchedule() {
  const [preview, setPreview] = useState<ScheduleData | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const normalized = normalizeSchedule(json);
      if (!normalized) {
        toast.error("JSON 형식이 올바르지 않습니다. weekStart, zones, schedule 필드가 필요합니다.");
        return;
      }
      setPreview(normalized);
      toast.success("파일을 불러왔습니다. 확인 후 저장하세요.");
    } catch {
      toast.error("JSON 파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await saveScheduleFS(preview);
      toast.success("주간 일정이 저장되었습니다!");
      // 홈 화면 자동 업데이트 이벤트
      window.dispatchEvent(new CustomEvent("schedule-updated", { detail: preview }));
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setSaving(false);
    }
  };

  // 날짜 목록 생성 (로컬 기준 — toISOString은 UTC로 변환되어 KST에서 하루 밀림)
  const weekDates = preview
    ? Array.from({ length: 7 }, (_, i) => {
        const d = new Date(preview.weekStart + "T00:00:00");
        d.setDate(d.getDate() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })
    : [];

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">주간 작업 일정</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors cursor-pointer">
            <FileJson className="h-4 w-4" /> JSON 업로드
            <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
          </label>
          {preview && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
      </div>

      {/* JSON 형식 안내 */}
      {!preview && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">📋 지원 JSON 형식:</p>
          <pre className="text-[10px] text-gray-400 overflow-x-auto whitespace-pre">{`{
  "weekStart": "2026-04-13",
  "zones": ["1층", "3층"],
  "schedule": {
    "2026-04-13": { "1층": "야간", "3층": "연장" }
  }
}`}</pre>
        </div>
      )}

      {/* 미리보기 테이블 */}
      {preview && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">
              {preview.weekStart} 주간
            </span>
            <span className="text-xs text-gray-400">— 저장 전 미리보기</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 text-gray-500 font-semibold w-24">구역</th>
                  {weekDates.map((date, i) => {
                    const d = new Date(date + "T00:00:00");
                    const isToday = date === new Date().toISOString().slice(0, 10);
                    return (
                      <th key={date} className="text-center py-2.5 px-2" style={{ minWidth: 64 }}>
                        <div className={`text-[11px] font-bold ${isToday ? "text-purple-600" : i >= 5 ? "text-blue-400" : "text-gray-600"}`}>
                          {d.getMonth() + 1}/{d.getDate()}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${isToday ? "text-purple-400" : i >= 5 ? "text-blue-300" : "text-gray-400"}`}>
                          ({DAY_KO[d.getDay()]})
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.zones.map((zone, zi) => (
                  <tr key={zone} className={`border-b border-gray-50 last:border-0 ${zi % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}>
                    <td className="py-3 px-4 font-semibold text-gray-700 whitespace-nowrap">{zone}</td>
                    {weekDates.map((date) => {
                      const task = preview.schedule[date]?.[zone] ?? "";
                      const style = TYPE_STYLE[task];
                      return (
                        <td key={date} className="py-3 px-2 text-center">
                          {task ? (
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-bold ${style ?? "bg-gray-100 text-gray-600"}`}>
                              {task}
                            </span>
                          ) : (
                            <span className="text-gray-200">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
