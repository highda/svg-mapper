import { describe, it, expect } from "vitest";
import rendererBuild from "../../../renderer/build.mjs?raw";
import repositoryReadme from "../../../README.md?raw";
import exportFormat from "../../../docs/export-format.md?raw";
import { SUPPORTED_BROWSERS } from "../lib/export-package";

// One browser floor for the exported map (#178): the renderer's build target,
// the generated package README and the repository docs must agree.

function buildTargets(): Record<string, string> {
  const list = /target:\s*\[([^\]]+)\]/.exec(rendererBuild)?.[1] ?? "";
  return Object.fromEntries([...list.matchAll(/"([a-z]+)([\d.]+)"/g)].map(([, engine, version]) => [engine!, version!]));
}

describe("exported-map browser support", () => {
  it("states the renderer build target in the package README and the docs", () => {
    const t = buildTargets();
    expect(Object.keys(t).sort()).toEqual(["chrome", "edge", "firefox", "ios", "safari"]);
    expect(t.edge).toBe(t.chrome);
    expect(t.ios).toBe(t.safari);
    const claim = `Chrome and Edge ${t.chrome}+, Firefox ${t.firefox}+, Safari ${t.safari}+ (macOS and iOS)`;
    expect(SUPPORTED_BROWSERS).toContain(claim);
    expect(repositoryReadme).toContain(claim);
    expect(exportFormat).toContain(claim);
  });
});
