import * as esbuild from "esbuild";
import { argv } from "process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";

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

  // Inline CSS into the IIFE bundle so shadow DOM mode can inject styles.
  const css = readFileSync("clickmap-renderer.css", "utf8");
  const escaped = css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  let bundle = readFileSync("dist/clickmap-renderer.js", "utf8");
  // Prepend a self-calling injection before the IIFE closes
  const injection = `\n(function(){var r=ClickMapRenderer;if(r&&r.__setInlinedCSS)r.__setInlinedCSS(\`${escaped}\`);}());\n`;
  bundle += injection;
  writeFileSync("dist/clickmap-renderer.js", bundle);

  const analysis = await esbuild.analyzeMetafile(result.metafile);
  console.log(analysis);
}
