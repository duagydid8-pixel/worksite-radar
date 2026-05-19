import { spawn } from "node:child_process";

const networkMode = process.argv.includes("--network");
const viteArgs = process.argv.slice(2).filter((a) => a !== "--network");
const children = [];

function quoteCmdArg(arg) {
  if (!/[ \t"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function npmSpawnOptions(args) {
  if (process.platform !== "win32") {
    return { command: "npm", args };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", ["npm", ...args].map(quoteCmdArg).join(" ")],
  };
}

function start(name, args) {
  const npmCommand = npmSpawnOptions(args);
  const child = spawn(npmCommand.command, npmCommand.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`[dev] ${name} exited with code ${code ?? signal}`);
    }
  });
  return child;
}

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

if (networkMode) {
  console.log("[dev] 네트워크 모드 — 다른 PC에서도 접속 가능합니다");
  start("rcm:image", ["run", "rcm:image:network"]);
  start("attendance:watch", ["run", "attendance:watch:network"]);
  start("dev:vite", ["run", "dev:vite", "--", "--host", ...viteArgs]);
} else {
  console.log("[dev] starting Vite and RCM image server");
  start("rcm:image", ["run", "rcm:image"]);
  start("dev:vite", ["run", "dev:vite", "--", ...viteArgs]);
}
