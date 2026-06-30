import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isWorkerRegistrationWorkbookName,
  scanWorkerRegistrationDownloads,
  selectLatestWorkerRegistrationFile,
} from "./xerp-worker-registration-sync.mjs";

describe("xerp-worker-registration-sync file scanner", () => {
  it("recognizes XERP worker-registration workbook names", () => {
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xlsx")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("근로자 등록_10037_20260630132922.xls")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("근로자등록_10037_20260630132922.xlsx")).toBe(true);
    expect(isWorkerRegistrationWorkbookName("~$근로자 등록_10037_20260630132922.xlsx")).toBe(false);
    expect(isWorkerRegistrationWorkbookName("출역관리_20260630.xlsx")).toBe(false);
  });

  it("selects the latest workbook newer than the session start", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const oldPath = path.join(dir, "근로자 등록_old.xlsx");
      const newPath = path.join(dir, "근로자 등록_new.xlsx");
      await writeFile(oldPath, "old");
      await writeFile(newPath, "new");
      const oldTime = new Date("2026-06-30T01:00:00.000Z");
      const newTime = new Date("2026-06-30T02:00:00.000Z");
      await utimes(oldPath, oldTime, oldTime);
      await utimes(newPath, newTime, newTime);

      const result = await scanWorkerRegistrationDownloads({
        downloadsDir: dir,
        startedAtMs: new Date("2026-06-30T01:30:00.000Z").getTime(),
      });

      expect(result.fileName).toBe("근로자 등록_new.xlsx");
      expect(result.size).toBe(3);
      expect(Buffer.from(result.base64, "base64").toString("utf8")).toBe("new");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no matching workbook exists", () => {
    expect(selectLatestWorkerRegistrationFile([])).toBeNull();
  });
});
