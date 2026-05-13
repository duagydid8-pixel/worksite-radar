import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const DEFAULT_PORT = 8791;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_SCRIPT = path.join(SCRIPT_DIR, "rcm-export-print-areas.ps1");
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_UPLOAD_BYTES * 1.4) {
        reject(new Error("업로드 파일이 너무 큽니다."));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("요청 데이터를 읽을 수 없습니다."));
      }
    });
    req.on("error", reject);
  });
}

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      ...args,
    ], { windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error((stderr || stdout || `PowerShell exited with ${code}`).trim()));
    });
  });
}

async function convertWorkbook(payload) {
  const base64 = typeof payload.base64 === "string" ? payload.base64 : "";
  const fileName = typeof payload.fileName === "string" ? payload.fileName : "rcm.xlsx";
  if (!base64) throw new Error("엑셀 파일이 전달되지 않았습니다.");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("업로드 파일이 너무 큽니다. 40MB 이하 파일만 변환합니다.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "worksite-rcm-"));
  const outputDir = path.join(tempRoot, "output");
  await mkdir(outputDir, { recursive: true });
  const inputPath = path.join(tempRoot, fileName.replace(/[\\/:*?"<>|]/g, "_") || "rcm.xlsx");

  try {
    await writeFile(inputPath, buffer);
    const raw = await runPowerShell([
      "-File",
      EXPORT_SCRIPT,
      "-InputPath",
      inputPath,
      "-OutputDir",
      outputDir,
    ]);
    const parsed = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const items = await Promise.all(rows.map(async (item) => {
      const image = await readFile(item.path);
      return {
        sheetName: item.sheetName,
        range: item.range,
        fileName: item.fileName,
        size: item.size,
        widthPoints: item.widthPoints,
        heightPoints: item.heightPoints,
        imageBase64: image.toString("base64"),
      };
    }));

    return {
      engine: "Microsoft Excel",
      sourceFileName: fileName,
      count: items.length,
      items,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function startRcmDraftImageServer({
  port = Number(process.env.RCM_IMAGE_PORT || DEFAULT_PORT),
} = {}) {
  if (!existsSync(EXPORT_SCRIPT)) {
    throw new Error(`변환 스크립트를 찾을 수 없습니다: ${EXPORT_SCRIPT}`);
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    try {
      if (req.method === "GET" && req.url === "/status") {
        sendJson(res, 200, {
          ready: true,
          engine: "Microsoft Excel",
          port,
          paths: ["/status", "/convert"],
        });
        return;
      }

      if (req.method === "POST" && req.url === "/convert") {
        const payload = await readRequestJson(req);
        sendJson(res, 200, await convertWorkbook(payload));
        return;
      }

      sendJson(res, 404, { error: "지원하지 않는 경로입니다.", paths: ["/status", "/convert"] });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "알 수 없는 오류" });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[rcm-image] http://127.0.0.1:${port}/status`);
    console.log("[rcm-image] Excel 인쇄영역을 PNG로 변환합니다.");
  });

  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    startRcmDraftImageServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
