import * as esbuild from "esbuild";
import { argv } from "process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const watch = argv.includes("--watch");
const rendererCss = readFileSync("clickmap-renderer.css", "utf8");

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
