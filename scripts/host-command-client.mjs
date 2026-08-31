#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [queueDir, command, ...args] = process.argv.slice(2);
if (!queueDir || !command) process.exit(126);
const id = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
const stdin = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
const request = path.join(queueDir, `${id}.request.json`);
const response = path.join(queueDir, `${id}.response.json`);
fs.writeFileSync(request, JSON.stringify({ id, command, args, stdin }));

const deadline = Date.now() + 120_000;
while (!fs.existsSync(response) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
if (!fs.existsSync(response)) {
  process.stderr.write("Host command relay timed out.\n");
  process.exit(124);
}
const result = JSON.parse(fs.readFileSync(response, "utf8"));
fs.unlinkSync(response);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(Number.isInteger(result.status) ? result.status : 1);
