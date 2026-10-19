// @vitest-environment jsdom
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { parseKakaoZip } from "./kakaoZip";

describe("parseKakaoZip", () => {
  beforeAll(() => {
    URL.createObjectURL = () => `blob:test-${Math.random()}`;
  });
  it("links photos to 사진 messages by minute", async () => {
    const zip = new JSZip();
    zip.file("KakaoTalkChats.txt", "2026. 10. 18. 오후 2:30, 김철수 : 사진\n2026. 10. 18. 오후 2:40, 김철수 : 사진\n");
    zip.file("KakaoTalk_20261018_1430_12_345.jpg", new Uint8Array([1, 2, 3]));
    zip.file("other.jpg", new Uint8Array([4]));
    const blob = await zip.generateAsync({ type: "blob" });
    const r = await parseKakaoZip(blob);
    expect(r.messages[0].images).toHaveLength(1);
    expect(r.messages[1].images).toBeUndefined();
    expect(r.unmatchedImages).toHaveLength(1);
  });
});
