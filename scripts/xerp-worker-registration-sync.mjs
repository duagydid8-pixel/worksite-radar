import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_XERP_WORKER_REGISTRATION_PORT = 8791;
export const DEFAULT_DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Downloads")
  : path.join(os.homedir(), "Downloads");

const WORKER_REGISTRATION_WORKBOOK_RE = /^근로자\s*등록_.*\.(xlsx|xls)$/i;

export function isWorkerRegistrationWorkbookName(fileName) {
  return !fileName.startsWith("~$") && WORKER_REGISTRATION_WORKBOOK_RE.test(fileName);
}

export async function collectWorkerRegistrationCandidates({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  startedAtMs = 0,
} = {}) {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isWorkerRegistrationWorkbookName(entry.name)) continue;
    const filePath = path.join(downloadsDir, entry.name);
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs < startedAtMs) continue;
    candidates.push({
      fileName: entry.name,
      filePath,
      modifiedAtMs: fileStat.mtimeMs,
      size: fileStat.size,
    });
  }

  return candidates;
}

export function selectLatestWorkerRegistrationFile(candidates) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)[0];
}

export async function scanWorkerRegistrationDownloads({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  startedAtMs = 0,
} = {}) {
  const candidates = await collectWorkerRegistrationCandidates({ downloadsDir, startedAtMs });
  const latest = selectLatestWorkerRegistrationFile(candidates);
  if (!latest) return null;

  const buffer = await readFile(latest.filePath);
  return {
    fileName: latest.fileName,
    modifiedAtMs: latest.modifiedAtMs,
    size: latest.size,
    base64: buffer.toString("base64"),
  };
}
