import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isWorkerRegistrationWorkbookName,
  scanWorkerRegistrationDownloads,
  selectLatestWorkerRegistrationFile,
  startXerpWorkerRegistrationServer,
} from "./xerp-worker-registration-sync.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  servers.length = 0;
});

async function startTestServer(options = {}) {
  const server = await startXerpWorkerRegistrationServer({ ...options, port: 0 });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

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

describe("xerp-worker-registration-sync server", () => {
  it("serves local helper status", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const baseUrl = await startTestServer({ downloadsDir: dir });
      const response = await fetch(`${baseUrl}/xerp-worker-registration/status`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.downloadsDir).toBe(dir);
      expect(json.port).toBeGreaterThan(0);
      expect(json.sites.PH4.xerpSiteName).toBe("평택 P4-PH4 초순수");
      expect(json.sites.PH2.xerpSiteName).toBe("평택 P4-PH2 초순수");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported download sites", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/xerp-worker-registration/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "P5PH1" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("지원하지 않는 현장");
  });

  it("returns the latest workbook as base64", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xerp-worker-"));
    try {
      const workbookPath = path.join(dir, "근로자 등록_10037_20260630132922.xlsx");
      await writeFile(workbookPath, "xlsx-bytes");

      const baseUrl = await startTestServer({ downloadsDir: dir });
      const response = await fetch(
        `${baseUrl}/xerp-worker-registration/latest?site=PH4&startedAtMs=0`,
      );
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.site).toBe("PH4");
      expect(json.file.fileName).toBe("근로자 등록_10037_20260630132922.xlsx");
      expect(Buffer.from(json.file.base64, "base64").toString("utf8")).toBe("xlsx-bytes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles CORS preflight", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/xerp-worker-registration/status`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
