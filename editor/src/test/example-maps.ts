import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Discovery of the hand-authored map definitions under examples/ (#197), shared
// by the schema/semantic conformance test (vitest) and the browser conformance
// spec (Playwright). Every JSON file with a `schemaVersion` is a map; adding one
// to examples/ enrols it in both suites without editing either.

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EXAMPLES_DIR = join(REPO_ROOT, "examples");

/**
 * Maps that are deliberately broken QA fixtures, with the exact semantic error
 * codes they exist to exercise. Everything else must have no errors.
 */
export const EXPECTED_SEMANTIC_ERRORS: Record<string, string[]> = {
  "examples/qa-gallery/fixtures/external-and-broken.json": ["DUPLICATE_ID", "MISSING_ASSET"],
};

export interface ExampleMap {
  /** Repository-relative path with forward slashes, e.g. `examples/minimal/map.json`. */
  path: string;
  /** Raw file text. */
  text: string;
  /**
   * Repository-relative directory (trailing slash) that relative asset sources
   * resolve against: the directory of the nearest `index.html` that hosts the
   * map, at or above the file. The QA gallery, for example, loads
   * `fixtures/*.json` from `examples/qa-gallery/index.html`.
   */
  assetBase: string;
}

const toPosix = (path: string) => path.split(sep).join("/");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return jsonFiles(full);
    return entry.name.endsWith(".json") ? [full] : [];
  });
}

function hostDirectory(file: string): string {
  for (let dir = dirname(file); dir.startsWith(EXAMPLES_DIR); dir = dirname(dir)) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return dirname(file);
}

export function exampleMaps(): ExampleMap[] {
  return jsonFiles(EXAMPLES_DIR)
    .sort()
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => {
      const value: unknown = JSON.parse(text);
      return typeof value === "object" && value !== null && "schemaVersion" in value;
    })
    .map(({ file, text }) => ({
      path: toPosix(relative(REPO_ROOT, file)),
      text,
      assetBase: `${toPosix(relative(REPO_ROOT, hostDirectory(file)))}/`,
    }));
}

/** Relative asset sources (files expected beside the map), excluding URLs, data URIs and raw SVG. */
export function relativeAssetSources(definition: { assets: Array<{ src: string }> }): string[] {
  return definition.assets
    .map((asset) => asset.src)
    .filter((src) => !/^\s*<svg\b/i.test(src) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(src));
}
