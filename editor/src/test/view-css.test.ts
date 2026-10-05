import { describe, expect, it } from "vitest";
import { scopeViewCss, validateProject, validateViewCss } from "@svg-mapper/shared";
import { createNewProject, toDefinition } from "../lib/project";

// View CSS is parsed by CSSOM and regenerated from rules, never scanned as text (#168).

const SCOPE = '[data-clickmap-instance="m1"]';
const scope = (css: string) => scopeViewCss(css, SCOPE);
/** Top-level rule preludes of the scoped output. */
const preludes = (css: string) => css.split("\n").filter((line) => /\{\s*$|;$|\{ .* \}$/.test(line)).map((line) => line.split("{")[0]!.trim());

describe("view CSS scoping", () => {
  it("keeps the @layer statement payload inside the map", () => {
    const out = scope(".clickmap-area {color:red} @layer escape; body {--scope-escaped:yes}");
    expect(out).toContain(`${SCOPE} .clickmap-area { color: red; }`);
    expect(out).toContain(`${SCOPE} { --scope-escaped: yes; }`);
    expect(out).toMatch(/@layer data-clickmap-instance-m1-escape;/);
    for (const prelude of preludes(out)) expect(prelude.startsWith(SCOPE) || prelude.startsWith("@")).toBe(true);
  });

  it("maps leading page roots to the map and prefixes everything else", () => {
    const out = scope("html body > .a, :root .b, body.dark .c, .clickmap-root .d, .e body { color: red }");
    expect(out.split(" {")[0]).toBe(`${SCOPE} > .a, ${SCOPE} .b, ${SCOPE}.dark .c, ${SCOPE} .d, ${SCOPE} .e body`);
  });

  it("handles comments, quoted braces and commas, and grouping rules", () => {
    expect(validateViewCss("/* } */ .a { color: red }")).toBeNull();
    const out = scope('/* before */ @media (min-width: 1px) { .a[title="x, }"], .b::after { content: "{ , }"; } } @supports (display: grid) { .c { display: grid } }');
    expect(out).toContain("@media (min-width: 1px) {");
    expect(out).toContain(`${SCOPE} .a[title="x, }"], ${SCOPE} .b::after { content: "{ , }"; }`);
    expect(out).toContain(`@supports (display: grid) {\n${SCOPE} .c { display: grid; }`);
  });

  it("renames keyframes and only animation-name references to them", () => {
    const out = scope('@keyframes pulse { to { opacity: .5; } } .pulse { animation-name: pulse; content: "pulse"; --label: pulse; }');
    expect(out).toContain("@keyframes data-clickmap-instance-m1-pulse {");
    expect(out).toContain(`${SCOPE} .pulse {`);
    expect(out).toContain("animation-name: data-clickmap-instance-m1-pulse");
    expect(out).toContain('content: "pulse"');
    expect(out).toContain("--label: pulse");
  });

  it.each([
    [".a { background: url(https://x.test/a.png) }", /resources/],
    [".a { --img: \\75 rl(https://x.test/a.png) }", /resources/],
    ["@font-face { font-family: x; }", /global resource/],
    ["@page { margin: 0 }", /global resource/],
    ["}}}", /No valid CSS rules/],
  ])("rejects %s", (css, message) => {
    expect(validateViewCss(css)).toMatch(message);
    expect(() => scope(css)).toThrow(message);
  });

  // jsdom's CSS engine drops some of these before scoping sees them; a real
  // browser parses them and they are rejected (e2e/view-css.spec.ts). Either
  // way the emitted CSS never loads a resource.
  it.each([
    ".a { background: u\\72l(https://x.test/a.png) }",
    '.a { background: image-set("a.png" 1x) }',
    "@property --x { syntax: '*'; inherits: false; }",
    '@import "https://x.test/a.css"; .a { color: red }',
  ])("never emits a resource for %s", (css) => {
    if (validateViewCss(css)) return;
    expect(scope(css)).not.toMatch(/url\(|image-set|@import|@property/i);
  });

  it("treats comment-only CSS as empty", () => {
    expect(validateViewCss("/* nothing yet */")).toBeNull();
    expect(scope("/* nothing yet */")).toBe("");
  });
});

describe("pre-export validation", () => {
  it("reports invalid custom CSS with a reference to its view", () => {
    const project = createNewProject();
    project.views[0]!.customCss = ".a { background: url(x.png) }";
    const result = validateProject(toDefinition(project)).find((entry) => entry.code === "INVALID_VIEW_CSS");
    expect(result).toMatchObject({ severity: "error", ref: { viewId: project.views[0]!.id } });
    expect(result?.message).toMatch(/resources are not supported/);
  });
});
