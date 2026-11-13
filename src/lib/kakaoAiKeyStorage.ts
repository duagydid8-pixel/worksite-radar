/**
 * 카톡 AI 분석용 Anthropic API 키 보관.
 *
 * 전에는 입력할 때마다 localStorage에 평문으로 박아 넣어서, 한 번 넣으면 그 PC에
 * 영구히 남았다. 현장 PC는 여러 사람이 쓰고 브라우저 저장소는 같은 출처의
 * 스크립트면 다 읽을 수 있어서, 기본값을 "탭을 닫으면 사라지는" sessionStorage로
 * 내리고 디스크 저장(localStorage)은 사용자가 직접 체크해야만 하도록 바꿨다.
 *
 * ※ 브라우저에 두는 이상 암호화해도 의미가 없다(복호화 키도 같이 있어야 하므로).
 *   제대로 숨기려면 서버(함수)에 키를 두고 프록시해야 한다.
 */
const KEY = "kakao_ai_api_key";

export interface StoredApiKey {
  key: string;
  /** true면 이 브라우저(디스크)에 남긴다 */
  remember: boolean;
}

function safeGet(store: Storage | undefined, key: string): string {
  try {
    return store?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSet(store: Storage | undefined, key: string, value: string) {
  try {
    store?.setItem(key, value);
  } catch {
    /* 시크릿 모드·저장소 차단 */
  }
}

function safeRemove(store: Storage | undefined, key: string) {
  try {
    store?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * 저장된 키를 읽는다. 예전 버전이 localStorage에 남긴 키가 있으면
 * 그대로 쓰되 remember=true로 올려 줘서, 사용자가 체크를 풀면 지울 수 있게 한다.
 */
export function readStoredApiKey(
  local: Storage | undefined = globalThis.localStorage,
  session: Storage | undefined = globalThis.sessionStorage,
): StoredApiKey {
  const persisted = safeGet(local, KEY);
  if (persisted) return { key: persisted, remember: true };
  return { key: safeGet(session, KEY), remember: false };
}

/** 키를 저장한다. remember에 따라 한쪽에만 남기고 반대쪽은 반드시 지운다. */
export function writeStoredApiKey(
  value: string,
  remember: boolean,
  local: Storage | undefined = globalThis.localStorage,
  session: Storage | undefined = globalThis.sessionStorage,
) {
  if (!value) {
    clearStoredApiKey(local, session);
    return;
  }
  if (remember) {
    safeSet(local, KEY, value);
    safeRemove(session, KEY);
  } else {
    safeSet(session, KEY, value);
    safeRemove(local, KEY);
  }
}

/** 양쪽 저장소에서 키를 모두 지운다. */
export function clearStoredApiKey(
  local: Storage | undefined = globalThis.localStorage,
  session: Storage | undefined = globalThis.sessionStorage,
) {
  safeRemove(local, KEY);
  safeRemove(session, KEY);
}

/** 화면에 보여 줄 때 쓰는 가린 표기 (sk-ant-...abcd) */
export function maskApiKey(value: string): string {
  const key = value.trim();
  if (!key) return "";
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
