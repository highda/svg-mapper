import * as esbuild from "esbuild";
import { argv } from "process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";

const watch = argv.includes("--watch");

/**
 * Shorten `private` member names of the renderer's own classes in the
 * minified bundle (esbuild mangleProps); property names are otherwise kept
 * verbatim and are a large share of the gzip size budget. A name is kept
 * whenever it appears anywhere in declarations of something the renderer does
 * not own: the DOM and JavaScript built-ins, the bundled packages, and all of
 * shared/ (map.json fields, create() options, events). So mangling can never
 * rename a property read from, or handed to, outside code.
 */
function privateMembersPattern() {
  const words = (text) => text.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const names = new Set();
  for (const file of readdirSync("src")) {
    if (!file.endsWith(".ts")) continue;
    for (const match of readFileSync(join("src", file), "utf8").matchAll(/\bprivate\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  }
  const tsLib = dirname(createRequire(import.meta.url).resolve("typescript/lib/lib.d.ts"));
  const declarations = (dir) => readdirSync(dir).filter((file) => /\.d\.[cm]?ts$/.test(file)).map((file) => join(dir, file));
  const sources = [
    ...declarations(tsLib),
    ...["core", "dom", "utils"].flatMap((pkg) => declarations(`node_modules/@floating-ui/${pkg}/dist`)),
    ...["dompurify", "valibot"].flatMap((pkg) => declarations(`../shared/node_modules/${pkg}/dist`)),
    ...readdirSync("../shared").filter((file) => file.endsWith(".ts")).map((file) => join("../shared", file)),
  ];
  const reserved = new Set(sources.flatMap((file) => words(readFileSync(file, "utf8"))));
  const mangled = [...names].filter((name) => name.length > 2 && !reserved.has(name));
  return mangled.length ? new RegExp(`^(?:${mangled.join("|")})$`) : undefined;
}

// The Shadow DOM stylesheet is inlined minified; dist keeps the readable file.
const rendererCss = esbuild.transformSync(readFileSync("clickmap-renderer.css", "utf8"), { loader: "css", minify: true }).code;

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "ClickMapRenderer",
  outfile: "dist/clickmap-renderer.js",
  // The supported floor, set by platform features used without polyfills:
  // CSS aspect-ratio (fluid-width sizing), cascade layers (scoped view CSS),
  // :focus-visible, and overscroll-behavior (Safari 16). esbuild only lowers
  // syntax. Keep in step with SUPPORTED_BROWSERS in editor/src/lib/export-package.ts.
  target: ["chrome99", "edge99", "firefox97", "safari16", "ios16"],
  minify: !watch,
  mangleProps: watch ? undefined : privateMembersPattern(),
  sourcemap: watch ? "inline" : false,
  alias: {
    "@svg-mapper/shared": "../shared/index.ts",
  },
  define: {
    __CLICKMAP_CSS__: JSON.stringify(rendererCss),
  },
  // Minification drops dependency license comments; keep the required notice.
  banner: {
    js: "/*! clickmap-renderer bundles Floating UI (https://floating-ui.com), MIT License, Copyright (c) 2021-present Floating UI contributors. */",
  },
};

mkdirSync("dist", { recursive: true });
copyFileSync("clickmap-renderer.css", "dist/clickmap-renderer.css");

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("Watching for changes…");
} else {
  const result = await esbuild.build({ ...opts, metafile: true });
  // scripts/check-boundaries.mjs verifies the bundle inputs against the
  // dependency allowlist. Not part of the published renderer files.
  writeFileSync("dist/clickmap-renderer.meta.json", JSON.stringify(result.metafile));

  const analysis = await esbuild.analyzeMetafile(result.metafile);
  console.log(analysis);
}
