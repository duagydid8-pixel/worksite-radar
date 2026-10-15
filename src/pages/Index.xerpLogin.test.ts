import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/Index.tsx"), "utf8");

describe("Index XERP login launcher", () => {
  it("adds a top-bar XERP login button next to local services", () => {
    expect(source).toContain("fetchXerpLoginStatus");
    expect(source).toContain("requestXerpLoginWindowOpen");
    expect(source).toContain("handleXerpLoginOpen");
    expect(source).toContain("xerpLoginOpening");
    expect(source).toContain("xerpLoginStatus");
    expect(source).toContain("XERP 로그인");
    expect(source).toContain("XERP 로그인됨");
    const localServicesIndex = source.indexOf("로컬서비스");
    expect(localServicesIndex).toBeGreaterThan(-1);
    expect(source.indexOf("XERP 로그인", localServicesIndex)).toBeGreaterThan(localServicesIndex);
  });
});
