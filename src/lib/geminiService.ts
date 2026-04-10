export interface ScheduleData {
  weekStart: string; // "YYYY-MM-DD" (월요일)
  zones: string[];
  schedule: Record<string, Record<string, string>>; // date → zone → "주간"|"연장"|"야간"|"현장휴무"|""
  uploadedAt: string;
}

const MODEL = "gemini-2.0-flash-lite";

function getApiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!key) throw new Error("VITE_GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
  return key;
}

export async function analyzeScheduleImage(base64Data: string, mimeType: string): Promise<ScheduleData> {
  const key = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${key}`;

  const prompt = `이 이미지는 건설현장 주간 작업 일정표입니다.
이미지를 분석하여 구역/팀별, 날짜별 작업 일정을 정확히 추출하세요.

반드시 아래 JSON 형식으로만 응답하세요 (다른 설명 없이):
{
  "weekStart": "YYYY-MM-DD",
  "zones": ["구역명1", "구역명2"],
  "schedule": {
    "YYYY-MM-DD": {
      "구역명1": "주간",
      "구역명2": "야간"
    }
  }
}

규칙:
- weekStart: 표에 나타난 주의 월요일 날짜 (YYYY-MM-DD 형식). 날짜 불명확시 오늘 기준 이번 주 월요일 사용.
- zones: 이미지에 표시된 모든 구역/팀/장소 이름 목록
- schedule의 날짜 키: YYYY-MM-DD 형식 (표에서 읽은 실제 날짜)
- 작업 유형: "주간"(주간작업), "연장"(연장근무), "야간"(야간작업), "현장휴무"(휴무), ""(해당 없음)
- 각 구역은 zones 배열의 이름과 동일하게 사용`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const msg = (() => { try { return JSON.parse(errText)?.error?.message ?? errText; } catch { return errText; } })();
    throw new Error(`Gemini API 오류 (${res.status}): ${msg.slice(0, 300)}`);
  }

  const result = await res.json();
  const rawText: string = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!rawText) throw new Error("Gemini 응답이 비어있습니다. 이미지를 확인하거나 다시 시도해 주세요.");

  // JSON 추출 (마크다운 코드 블럭 포함 대응)
  let jsonStr = rawText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  let parsed: Partial<ScheduleData>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("분석 결과를 파싱할 수 없습니다. 이미지가 작업 일정표인지 확인해 주세요.");
  }

  if (!parsed.weekStart || !Array.isArray(parsed.zones) || !parsed.schedule) {
    throw new Error("추출된 데이터 형식이 올바르지 않습니다. 이미지를 다시 확인해 주세요.");
  }

  return {
    weekStart: parsed.weekStart,
    zones: parsed.zones,
    schedule: parsed.schedule,
    uploadedAt: new Date().toISOString(),
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip "data:image/...;base64,"
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function hasGeminiKey(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}
