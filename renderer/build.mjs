import * as esbuild from "esbuild";
import { argv } from "process";
import { copyFileSync, mkdirSync, readFileSync } from "fs";

const watch = argv.includes("--watch");
const rendererCss = readFileSync("clickmap-renderer.css", "utf8");

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
  alias: {
    "@svg-mapper/shared": "../shared/index.ts",
  },
  define: {
    __CLICKMAP_CSS__: JSON.stringify(rendererCss),
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
