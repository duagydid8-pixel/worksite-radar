import { describe, expect, it } from "vitest";
import { decodeBase64ToArrayBuffer, shouldApplyLocalWatchVersion } from "./localAttendanceWatchClient";

describe("localAttendanceWatchClient", () => {
  it("decodes a base64 file payload into an ArrayBuffer", () => {
    const buffer = decodeBase64ToArrayBuffer(Buffer.from("hello").toString("base64"));
    expect(new TextDecoder().decode(buffer)).toBe("hello");
  });

  it("applies only ready new versions", () => {
    expect(shouldApplyLocalWatchVersion({ ready: false, version: "a" }, null)).toBe(false);
    expect(shouldApplyLocalWatchVersion({ ready: true, version: "a" }, "a")).toBe(false);
    expect(shouldApplyLocalWatchVersion({ ready: true, version: "b" }, "a")).toBe(true);
  });
});
