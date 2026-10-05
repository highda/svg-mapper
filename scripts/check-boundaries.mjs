#!/usr/bin/env node
// Static check of the renderer / shared / editor dependency boundary
// (ASSIGNMENT §2.6, docs/renderer-api.md "Architecture boundary"):
//
//   shared/          imports only shared/ and the "shared" allowlist; build-time
//                    tooling in shared/scripts/ (run by Node, never bundled,
//                    like renderer/build.mjs) is outside the layer and may use
//                    Node built-ins and devDependencies, but no runtime file
//                    may import it or bundle it
//   renderer/src/    imports only renderer/src/, shared/ and the "renderer" allowlist
//   editor/src/      (production, excluding src/test/) reaches renderer/ only
//                    through renderer/dist/<file>?raw
//   renderer bundle  esbuild metafile inputs are renderer/src/, shared/, or
//                    packages on the "shared" + "renderer" allowlists
//
// The allowlist lives in scripts/dependency-allowlist.json. Run after
// `npm ci --prefix shared` (for the TypeScript import scanner) and
// `npm run build --prefix renderer` (which writes the metafile).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = 'scripts/dependency-allowlist.json';
export const METAFILE_PATH = 'renderer/dist/clickmap-renderer.meta.json';

const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SHARED_ALIAS = '@svg-mapper/shared';

export function loadAllowlist(root = REPO_ROOT) {
  const raw = JSON.parse(readFileSync(path.join(root, ALLOWLIST_PATH), 'utf8'));
  return { shared: raw.shared ?? [], renderer: raw.renderer ?? [] };
}

// Package name of a bare specifier: "@scope/name/sub" -> "@scope/name", "x/y" -> "x".
export function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Allowlist entries are exact package names or "@scope/*".
export function isAllowed(pkg, allowlist) {
  return allowlist.some((entry) =>
    entry.endsWith('/*') ? pkg.startsWith(entry.slice(0, -1)) : pkg === entry,
  );
}

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
const within = (file, dir) => file === dir || file.startsWith(`${dir}/`);
const inNodeModules = (file) => file.split('/').includes('node_modules');
// Build-time Node tooling of the shared package (e.g. the JSON Schema generator).
export const SHARED_TOOLING_DIR = 'shared/scripts';

function layerOf(file) {
  if (within(file, SHARED_TOOLING_DIR)) return null;
  if (within(file, 'shared') && !inNodeModules(file)) return 'shared';
  if (within(file, 'renderer/src')) return 'renderer';
  if (within(file, 'editor/src') && !within(file, 'editor/src/test')) return 'editor';
  return null;
}

let scanner;
function loadScanner() {
  if (scanner) return scanner;
  for (const pkg of ['shared', 'renderer', 'editor']) {
    try {
      const ts = createRequire(path.join(REPO_ROOT, pkg, 'package.json'))('typescript');
      scanner = (source) => {
        const info = ts.preProcessFile(source, true, true);
        return [...info.importedFiles, ...info.referencedFiles].map(({ fileName, pos }) => ({
          specifier: fileName,
          line: source.slice(0, pos).split('\n').length,
        }));
      };
      return scanner;
    } catch {
      // try the next package's node_modules
    }
  }
  throw new Error('check-boundaries: TypeScript not found; run `npm ci --prefix shared` first.');
}

// Every import/export/dynamic import/require/reference of one file, ignoring
// comments and string contents.
export function scanImports(source) {
  return loadScanner()(source);
}

// Returns a violation message for one import, or null when it is allowed.
// `file` is a repo-relative POSIX path.
export function checkImport(file, specifier, allowlist) {
  const layer = layerOf(file);
  if (!layer) return null;
  const [bare] = specifier.split(/[?#]/);
  const query = specifier.slice(bare.length);
  const target = isRelative(bare) ? path.posix.normalize(path.posix.join(path.posix.dirname(file), bare)) : null;

  if (layer === 'editor') {
    if (target && within(target, 'renderer')) {
      const ok = /^renderer\/dist\/[^/]+$/.test(target) && query === '?raw';
      return ok ? null : `editor production code may reach the renderer only through renderer/dist/<file>?raw (resolves to ${target}${query})`;
    }
    if (!target && packageName(bare) === '@svg-mapper/renderer') {
      return 'editor production code may reach the renderer only through renderer/dist/<file>?raw';
    }
    return null;
  }

  if (target) {
    const allowedDirs = layer === 'shared' ? ['shared'] : ['renderer/src', 'shared'];
    if (within(target, SHARED_TOOLING_DIR)) {
      return `${SHARED_TOOLING_DIR}/ is build-time tooling and must not be imported by runtime code (resolves to ${target})`;
    }
    if (allowedDirs.some((dir) => within(target, dir)) && !inNodeModules(target)) return null;
    return `${layer === 'shared' ? 'shared/' : 'renderer/src/'} may import only ${allowedDirs.map((d) => `${d}/`).join(' and ')} (resolves to ${target})`;
  }
  if (layer === 'renderer' && (bare === SHARED_ALIAS || bare.startsWith(`${SHARED_ALIAS}/`))) return null;
  const pkg = packageName(bare);
  if (isAllowed(pkg, allowlist[layer])) return null;
  return `package "${pkg}" is not on the ${layer} allowlist (${ALLOWLIST_PATH})`;
}

// files: [{ path: repo-relative, source }]
export function checkSources(files, allowlist) {
  const violations = [];
  for (const { path: file, source } of files) {
    for (const { specifier, line } of scanImports(source)) {
      const reason = checkImport(file, specifier, allowlist);
      if (reason) violations.push(`${file}:${line}: import "${specifier}" — ${reason}`);
    }
  }
  return violations;
}

// inputs: esbuild metafile input keys, relative to the renderer directory.
export function checkBundleInputs(inputs, allowlist) {
  const allowed = [...allowlist.shared, ...allowlist.renderer];
  const violations = [];
  for (const input of inputs) {
    if (input.startsWith('<')) continue; // esbuild virtual modules (define, runtime)
    const file = path.posix.normalize(path.posix.join('renderer', input.replace(/^[a-z-]+:/, '')));
    const segments = file.split('/');
    const nm = segments.lastIndexOf('node_modules');
    if (nm >= 0) {
      const pkg = packageName(segments.slice(nm + 1).join('/'));
      if (!isAllowed(pkg, allowed)) {
        violations.push(`${METAFILE_PATH}: bundle input ${file} — package "${pkg}" is not on the shared or renderer allowlist (${ALLOWLIST_PATH})`);
      }
    } else if (!within(file, 'renderer/src') && (!within(file, 'shared') || within(file, SHARED_TOOLING_DIR))) {
      violations.push(`${METAFILE_PATH}: bundle input ${file} — the renderer bundle may contain only renderer/src/, shared/ and allowlisted packages`);
    }
  }
  return violations;
}

function walk(root, dir, out = []) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(root, rel, out);
    else if (SOURCE_EXT.test(entry.name) && layerOf(rel)) out.push(rel);
  }
  return out;
}

export function collectSources(root = REPO_ROOT) {
  return ['shared', 'renderer/src', 'editor/src']
    .flatMap((dir) => walk(root, dir))
    .map((file) => ({ path: file, source: readFileSync(path.join(root, file), 'utf8') }));
}

function main() {
  const allowlist = loadAllowlist();
  const violations = checkSources(collectSources(), allowlist);
  const metafile = path.join(REPO_ROOT, METAFILE_PATH);
  if (existsSync(metafile)) {
    violations.push(...checkBundleInputs(Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs), allowlist));
  } else {
    violations.push(`${METAFILE_PATH}: missing; run \`npm run build --prefix renderer\` before this check`);
  }
  if (violations.length) {
    console.error(`Dependency boundary violations (see docs/renderer-api.md, "Architecture boundary"):\n${violations.map((v) => `  ${v}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Dependency boundaries hold: shared/, renderer/src/, editor/src/ and the renderer bundle.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
