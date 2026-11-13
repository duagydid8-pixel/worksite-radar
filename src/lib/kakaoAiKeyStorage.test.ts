import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredApiKey,
  maskApiKey,
  readStoredApiKey,
  writeStoredApiKey,
} from "./kakaoAiKeyStorage";

/** 테스트용 메모리 Storage */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

let local: Storage;
let session: Storage;

beforeEach(() => {
  local = memoryStorage();
  session = memoryStorage();
});

describe("kakaoAiKeyStorage", () => {
  it("기본은 탭을 닫으면 사라지는 sessionStorage에만 둔다", () => {
    writeStoredApiKey("sk-ant-abc123", false, local, session);

    expect(session.getItem("kakao_ai_api_key")).toBe("sk-ant-abc123");
    expect(local.getItem("kakao_ai_api_key")).toBeNull();
    expect(readStoredApiKey(local, session)).toEqual({ key: "sk-ant-abc123", remember: false });
  });

  it("'이 브라우저에 저장'을 켜면 localStorage로 옮기고 session은 비운다", () => {
    writeStoredApiKey("sk-ant-abc123", false, local, session);
    writeStoredApiKey("sk-ant-abc123", true, local, session);

    expect(local.getItem("kakao_ai_api_key")).toBe("sk-ant-abc123");
    expect(session.getItem("kakao_ai_api_key")).toBeNull();
    expect(readStoredApiKey(local, session)).toEqual({ key: "sk-ant-abc123", remember: true });
  });

  it("체크를 풀면 디스크에서 지워진다", () => {
    writeStoredApiKey("sk-ant-abc123", true, local, session);
    writeStoredApiKey("sk-ant-abc123", false, local, session);

    expect(local.getItem("kakao_ai_api_key")).toBeNull();
    expect(session.getItem("kakao_ai_api_key")).toBe("sk-ant-abc123");
  });

  it("예전 버전이 localStorage에 남긴 키는 remember=true로 읽어 들인다", () => {
    local.setItem("kakao_ai_api_key", "sk-ant-old");

    expect(readStoredApiKey(local, session)).toEqual({ key: "sk-ant-old", remember: true });
  });

  it("빈 값을 쓰면 양쪽 저장소에서 지운다", () => {
    writeStoredApiKey("sk-ant-abc123", true, local, session);
    writeStoredApiKey("", true, local, session);

    expect(local.getItem("kakao_ai_api_key")).toBeNull();
    expect(session.getItem("kakao_ai_api_key")).toBeNull();
    expect(readStoredApiKey(local, session)).toEqual({ key: "", remember: false });
  });

  it("키 지우기는 양쪽을 모두 비운다", () => {
    writeStoredApiKey("sk-ant-abc123", true, local, session);
    session.setItem("kakao_ai_api_key", "sk-ant-abc123");

    clearStoredApiKey(local, session);

    expect(readStoredApiKey(local, session)).toEqual({ key: "", remember: false });
  });

  it("저장소가 막혀 있어도(시크릿 모드) 터지지 않는다", () => {
    // 사파리 시크릿 모드 등: 접근 자체가 예외를 던진다
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;

    expect(() => writeStoredApiKey("sk-ant-abc123", true, blocked, blocked)).not.toThrow();
    expect(() => clearStoredApiKey(blocked, blocked)).not.toThrow();
    expect(readStoredApiKey(blocked, blocked)).toEqual({ key: "", remember: false });
  });

  it("maskApiKey는 앞뒤만 남긴다", () => {
    expect(maskApiKey("sk-ant-api03-abcdefgh1234")).toBe("sk-ant-…1234");
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("short")).toBe("•••••");
  });
});
