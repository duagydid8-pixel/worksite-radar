import { toast } from "sonner";
import { auth } from "./firebase";

/** Firestore 오류를 사용자가 이해할 수 있는 한 줄로 바꾼다. 알 수 없는 오류면 null. */
export function describeFirestoreError(e: unknown): string | null {
  const code = (e as { code?: string } | null)?.code ?? "";
  const message = e instanceof Error ? e.message : String(e ?? "");
  if (code === "permission-denied" || /insufficient permissions/i.test(message)) {
    return "권한이 없어 클라우드 저장/조회가 거부되었습니다. 관리자 로그인 상태를 확인하세요.";
  }
  if (code === "unauthenticated") return "로그인이 만료되었습니다. 다시 로그인하세요.";
  if (/exceeds the maximum allowed size|maximum.*1,?048,?576|too large/i.test(message) || code === "resource-exhausted") {
    return "저장할 데이터가 너무 큽니다(Firestore 문서 1MB 한도). 저장되지 않았습니다.";
  }
  if (code === "unavailable" || /offline|network/i.test(message)) {
    return "네트워크 연결이 불안정해 클라우드와 통신하지 못했습니다.";
  }
  if (code === "deadline-exceeded" || /시간 초과|timeout/i.test(message)) {
    return "클라우드 응답이 너무 늦어 작업이 중단되었습니다.";
  }
  return null;
}

/**
 * 원인을 알 수 있는 Firestore 오류만 화면에 알린다(같은 원인은 하나로 합쳐 표시).
 * 비로그인 방문자의 읽기 권한 거부는 규칙상 정상이므로 알리지 않는다.
 */
export function notifyFirestoreError(e: unknown, action: string, kind: "read" | "write" = "write"): void {
  const reason = describeFirestoreError(e);
  if (!reason) return;
  const code = (e as { code?: string } | null)?.code ?? "unknown";
  if (kind === "read" && code === "permission-denied" && !auth?.currentUser) return;
  toast.error(`${action} 실패`, { id: `firestore-${code}`, description: reason });
}
