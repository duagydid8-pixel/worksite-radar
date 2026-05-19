import { describe, expect, it } from "vitest";
import { isAllowedLocalServiceOrigin } from "./local-service-cors.mjs";

describe("local service CORS allowlist", () => {
  it("allows production and localhost app origins", () => {
    expect(isAllowedLocalServiceOrigin("https://worksite-radar.vercel.app")).toBe(true);
    expect(isAllowedLocalServiceOrigin("http://localhost:8081")).toBe(true);
    expect(isAllowedLocalServiceOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("allows non-browser requests without an Origin header", () => {
    expect(isAllowedLocalServiceOrigin(undefined)).toBe(true);
  });

  it("blocks unrelated websites", () => {
    expect(isAllowedLocalServiceOrigin("https://example.com")).toBe(false);
    expect(isAllowedLocalServiceOrigin("http://evil.test:8081")).toBe(false);
  });
});
