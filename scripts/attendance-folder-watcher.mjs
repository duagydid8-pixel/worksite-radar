import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WATCH_DIR = "C:\\Users\\bongryong\\Desktop\\염효양\\8. 상용,현채,서드 근태관리";
export const DEFAULT_PORT = 8787;

const EXCEL_EXTENSIONS = new Set([".xlsx", ".xls"]);

export function classifyAttendanceFile(fileName) {
  const lowerName = fileName.toLowerCase();
  if (fileName.startsWith("~$")) return null;
  if (!EXCEL_EXTENSIONS.has(path.extname(lowerName))) return null;
  if (fileName.includes("지문")) return "fingerprint";
  if (lowerName.includes("xerp")) return "xerp";
  return null;
}

export function selectSourceFiles(candidates) {
  const selected = { fingerprint: null, xerp: null };
  for (const candidate of candidates) {
    const kind = classifyAttendanceFile(candidate.name);
    if (!kind) continue;
    if (!selected[kind] || candidate.mtimeMs > selected[kind].mtimeMs) {
      selected[kind] = candidate;
    }
  }
  return {
    ...selected,
    ready: !!(selected.fingerprint && selected.xerp),
    missing: [
      ...(selected.fingerprint ? [] : ["지문기록"]),
      ...(selected.xerp ? [] : ["XERP기록"]),
    ],
  };
}

function toPublicFile(file) {
  if (!file) return null;
  return {
    name: file.name,
    fullPath: file.fullPath,
    mtimeMs: file.mtimeMs,
    size: file.size,
  };
}

function versionFor(selection) {
  if (!selection.ready) return null;
  return [
    selection.fingerprint.name,
    selection.fingerprint.mtimeMs,
    selection.fingerprint.size,
    selection.xerp.name,
    selection.xerp.mtimeMs,
    selection.xerp.size,
  ].join("|");
}

async function scanWatchDir(watchDir) {
  const entries = await readdir(watchDir);
  const candidates = [];
  for (const name of entries) {
    const fullPath = path.join(watchDir, name);
    const info = await stat(fullPath);
    if (!info.isFile()) continue;
    candidates.push({ name, fullPath, mtimeMs: info.mtimeMs, size: info.size });
  }
  const selection = selectSourceFiles(candidates);
  return {
    ready: selection.ready,
    missing: selection.missing,
    watchDir,
    fingerprint: toPublicFile(selection.fingerprint),
    xerp: toPublicFile(selection.xerp),
    version: versionFor(selection),
  };
}

async function readSourcePayload(watchDir) {
  const status = await scanWatchDir(watchDir);
  if (!status.ready) return status;
  const [fingerprintBuffer, xerpBuffer] = await Promise.all([
    readFile(status.fingerprint.fullPath),
    readFile(status.xerp.fullPath),
  ]);
  return {
    ...status,
    fingerprint: {
      ...status.fingerprint,
      base64: fingerprintBuffer.toString("base64"),
    },
    xerp: {
      ...status.xerp,
      base64: xerpBuffer.toString("base64"),
    },
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function startAttendanceFolderWatcher({
  watchDir = process.env.ATTENDANCE_WATCH_DIR || DEFAULT_WATCH_DIR,
  port = Number(process.env.ATTENDANCE_WATCH_PORT || DEFAULT_PORT),
} = {}) {
  if (!existsSync(watchDir)) {
    throw new Error(`감시 폴더가 없습니다: ${watchDir}`);
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    try {
      if (req.url === "/status") {
        sendJson(res, 200, await scanWatchDir(watchDir));
        return;
      }
      if (req.url === "/source-files") {
        const payload = await readSourcePayload(watchDir);
        sendJson(res, payload.ready ? 200 : 404, payload);
        return;
      }
      sendJson(res, 404, { error: "지원하지 않는 경로입니다.", paths: ["/status", "/source-files"] });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "알 수 없는 오류" });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[attendance-watch] ${watchDir}`);
    console.log(`[attendance-watch] http://127.0.0.1:${port}/status`);
  });

  watch(watchDir, { persistent: true }, (_eventType, fileName) => {
    if (fileName && classifyAttendanceFile(fileName)) {
      console.log(`[attendance-watch] 변경 감지: ${fileName}`);
    }
  });

  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    startAttendanceFolderWatcher();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
