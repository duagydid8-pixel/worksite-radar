import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { isMediaMessage, type KakaoMessage } from "./kakaoChat";
import { makeEvent, normalizeName, type KakaoEvent } from "./kakaoEvents";

export const KAKAO_AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (가장 정확)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (균형)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (가장 저렴)" },
] as const;
export type KakaoAiModel = (typeof KAKAO_AI_MODELS)[number]["id"];

const CATEGORIES = ["punch", "resign", "early", "leave", "absent", "late", "trip", "newbie"] as const;
const CAUSES = ["안전교육", "교육", "xerp 오류", "xerp 승인대기", ""] as const;

const ResultSchema = z.object({
  events: z.array(
    z.object({
      msg_index: z.number().int(),
      name: z.string(),
      date: z.string(),
      category: z.enum(CATEGORIES),
      cause: z.enum(CAUSES),
    }),
  ),
});

const SYSTEM = `당신은 건설 현장 공무 담당자를 돕는 근태 정리 도우미입니다.
현장 단체 공지 카톡방 메시지 목록을 읽고, 특정 작업자의 근태에 영향을 주는 내용만 골라 events로 돌려주세요.

category:
- punch: XERP/PMIS/전자카드 출퇴근 타각을 못 했거나 오류·누락·지연된 경우
- resign: 퇴사·계약종료
- early: 조퇴·일찍 퇴근
- leave: 연차·반차·휴가·병가·경조사
- absent: 결근·불참·출근 못 함
- late: 지각·외출·병원
- trip: 출장·교육 참석·이관·파견 (타각 문제가 아니라 일정 자체)
- newbie: 입사·신규 투입

cause (category가 punch일 때만, 아니면 빈 문자열):
- "안전교육" / "교육": 교육 때문에 타각을 못 함
- "xerp 오류": 시스템·단말기 오류
- "xerp 승인대기": 신규자라 XERP 승인 전
- "": 원인 불명

규칙:
- 돌려 말한 표현도 판단하세요. 예) "내일 못 나올 것 같아요" → absent, 다음날.
- 한 메시지에 여러 사람이 있으면 사람마다 event를 따로 만드세요.
- name은 가능하면 [명단]에 있는 이름 그대로 쓰고, 명단에 없으면 메시지에 나온 이름, 이름이 없으면 빈 문자열.
- date는 근태가 적용되는 날(YYYY-MM-DD). "내일", "10월 25일" 같은 표현을 메시지 날짜 기준으로 계산하세요.
- 잡담, 업무 일반 공지, 작업 지시는 제외하세요.
- msg_index는 아래 목록의 [번호]입니다.`;

const CHUNK_SIZE = 400;

export interface KakaoAiOptions {
  apiKey: string;
  model: KakaoAiModel;
  roster: string[];
  onProgress?: (done: number, total: number) => void;
}

/** 카톡 메시지를 Claude에 보내 근태 이벤트를 추출한다. 메시지 원문이 Anthropic으로 전송된다. */
export async function extractKakaoEventsWithAi(messages: KakaoMessage[], opts: KakaoAiOptions): Promise<KakaoEvent[]> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const textMessages = messages.filter((m) => !isMediaMessage(m.text));
  const chunks: KakaoMessage[][] = [];
  for (let i = 0; i < textMessages.length; i += CHUNK_SIZE) chunks.push(textMessages.slice(i, i + CHUNK_SIZE));

  const rosterLine = opts.roster.length ? [...new Set(opts.roster.map(normalizeName))].join(", ") : "(명단 없음)";
  const events: KakaoEvent[] = [];
  const supportsFallback = opts.model !== "claude-haiku-5-5";

  for (let c = 0; c < chunks.length; c++) {
    opts.onProgress?.(c, chunks.length);
    const chunk = chunks[c];
    const listing = chunk
      .map((m, i) => `[${i}] ${m.date} ${m.time} ${m.sender}: ${m.text.replace(/\n/g, " / ")}`)
      .join("\n");

    const response = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `[명단]\n${rosterLine}\n\n[메시지]\n${listing}` }],
      output_config: { effort: "low", format: betaZodOutputFormat(ResultSchema) },
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") throw new Error("AI가 이 내용의 분석을 거절했습니다.");
    if (response.stop_reason === "max_tokens") throw new Error("AI 응답이 너무 길어 잘렸습니다. 기간을 줄여 다시 시도하세요.");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("AI 응답을 해석하지 못했습니다.");

    for (const e of parsed.events) {
      const m = chunk[e.msg_index];
      if (!m) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : m.date;
      events.push(
        makeEvent({
          date,
          msgDate: m.date,
          time: m.time,
          sender: m.sender,
          name: normalizeName(e.name),
          category: e.category,
          cause: e.category === "punch" ? e.cause : "",
          text: m.text.slice(0, 300),
          source: "ai",
        }),
      );
    }
  }
  opts.onProgress?.(chunks.length, chunks.length);
  return events;
}

export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다.";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 선택한 모델을 쓸 수 없습니다.";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (e instanceof Anthropic.BadRequestError) return `요청 오류: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Anthropic 서버에 연결하지 못했습니다.";
  if (e instanceof Anthropic.APIError) return `API 오류 ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : "알 수 없는 오류";
}
