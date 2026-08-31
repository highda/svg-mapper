#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [queueDir, repoRoot, ghPath, gitPath] = process.argv.slice(2);
if (!queueDir || !repoRoot || !ghPath || !gitPath) {
  throw new Error("Usage: host-command-relay.mjs <queue-dir> <repo-root> <gh-path> <git-path>");
}

fs.mkdirSync(queueDir, { recursive: true });
fs.writeFileSync(path.join(queueDir, "ready"), String(process.pid));

function allowed(command, args) {
  if (command === "gh") {
    if (["issue", "pr", "project", "label"].includes(args[0])) return true;
    if (args[0] === "api") {
      return args[1] === "rate_limit" || args[1]?.startsWith("repos/highda/svg-mapper/");
    }
    return false;
  }
  if (command === "git") {
    const isRemoteOperation = args.some((arg) => ["fetch", "pull", "push", "ls-remote"].includes(arg));
    const redirectsRemote = args.some((arg) => /^(?:https?:|ssh:|git@)|remote\..*\.url=/.test(arg));
    return isRemoteOperation && !redirectsRemote;
  }
  return false;
}

function respond(id, result) {
  const temp = path.join(queueDir, `${id}.response.tmp`);
  fs.writeFileSync(temp, JSON.stringify(result));
  fs.renameSync(temp, path.join(queueDir, `${id}.response.json`));
}

async function handle(file) {
  const requestPath = path.join(queueDir, file);
  let request;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    fs.unlinkSync(requestPath);
  } catch {
    return;
  }
  const { id, command, args = [], stdin = "" } = request;
  if (typeof id !== "string" || !Array.isArray(args) || !allowed(command, args)) {
    respond(id ?? "invalid", { status: 126, stdout: "", stderr: "Host relay rejected command.\n" });
    return;
  }
  const executable = command === "gh" ? ghPath : gitPath;
  const child = spawn(executable, args, {
    cwd: repoRoot,
    env: { ...process.env, GH_REPO: "highda/svg-mapper" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(stdin);
  child.on("error", (error) => respond(id, { status: 127, stdout, stderr: `${stderr}${error.message}\n` }));
  child.on("close", (status) => respond(id, { status: status ?? 1, stdout, stderr }));
}

const timer = setInterval(() => {
  for (const file of fs.readdirSync(queueDir)) {
    if (file.endsWith(".request.json")) void handle(file);
  }
}, 25);

function shutdown() {
  clearInterval(timer);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
