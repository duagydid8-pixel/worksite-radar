import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dev-with-services XERP helper wiring", () => {
  it("exposes package scripts for the XERP worker helper", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["xerp:worker"]).toBe("node scripts/xerp-worker-registration-sync.mjs");
    expect(packageJson.scripts["playwright:install"]).toBe("playwright install chromium");
  });

  it("starts the XERP worker helper with local dev services", () => {
    const source = readFileSync("scripts/dev-with-services.mjs", "utf8");

    expect(source).toContain('start("xerp:worker", ["run", "xerp:worker"])');
  });
});
