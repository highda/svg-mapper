import * as esbuild from "esbuild";
import { argv } from "process";
import { copyFileSync, mkdirSync } from "fs";

const watch = argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "ClickMapRenderer",
  outfile: "dist/clickmap-renderer.js",
  target: ["chrome90", "firefox90", "safari14", "edge90"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  // Alias shared types (they compile to nothing at runtime, but esbuild needs
  // to resolve the import for type-only re-exports in case tsc emits them)
  alias: {
    "@svg-mapper/shared": "../shared/index.ts",
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
  const analysis = await esbuild.analyzeMetafile(result.metafile);
  console.log(analysis);
}
