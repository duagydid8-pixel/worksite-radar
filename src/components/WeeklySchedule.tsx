import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';

interface ScheduleItem {
  zone: string;
  date: string;
  day_of_week: string;
  task: string;
  time: string;
  note: string;
}

interface WeeklyScheduleData {
  weekStart: string;
  zones: string[];
  schedule: ScheduleItem[];
}

export function WeeklySchedule() {
  const [data, setData] = useState<WeeklyScheduleData | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const text = await file.text();
      const parsed: WeeklyScheduleData = JSON.parse(text);

      // 데이터 저장
      setData(parsed);

      // Firebase에 저장
      await addDoc(collection(db, 'weekly_schedules'), {
        weekStart: parsed.weekStart,
        zones: parsed.zones,
        schedule: parsed.schedule,
        createdAt: new Date(),
      });

      alert('✅ 주간 일정이 저장되었습니다!');
    } catch (error) {
      console.error('Error:', error);
      alert('❌ 파일 형식이 올바르지 않습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">주간 작업 일정</h2>

      <div className="border-2 border-dashed rounded-lg p-6">
        <input
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          disabled={loading}
          className="w-full"
        />
      </div>

      {data && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {data.weekStart} ~ {data.zones.join(', ')}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2">구역</th>
                  <th className="border p-2">날짜</th>
                  <th className="border p-2">요일</th>
                  <th className="border p-2">작업</th>
                  <th className="border p-2">시간</th>
                  <th className="border p-2">비고</th>
                </tr>
              </thead>
              <tbody>
                {data.schedule.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="border p-2">{item.zone}</td>
                    <td className="border p-2">{item.date}</td>
                    <td className="border p-2">{item.day_of_week}</td>
                    <td className="border p-2">{item.task}</td>
                    <td className="border p-2">{item.time}</td>
                    <td className="border p-2">{item.note}</td>
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
