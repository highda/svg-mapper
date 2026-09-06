import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const budget = 30 * 1024;
const bytes = gzipSync(readFileSync(new URL("./dist/clickmap-renderer.js", import.meta.url)), {
  level: 9,
}).byteLength;

console.log(`Renderer gzip size: ${bytes} bytes (budget: ${budget} bytes)`);
if (bytes >= budget) {
  console.error("Renderer exceeds the documented <30 KB gzip budget.");
  process.exitCode = 1;
}
