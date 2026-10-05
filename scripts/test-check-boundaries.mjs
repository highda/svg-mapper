// Behavior tests for scripts/check-boundaries.mjs. Run: node --test scripts/test-check-boundaries.mjs
// Needs `npm ci --prefix shared` (the import scanner uses its TypeScript).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REPO_ROOT,
  checkBundleInputs,
  checkSources,
  collectSources,
  isAllowed,
  loadAllowlist,
  packageName,
} from './check-boundaries.mjs';

const allowlist = { shared: ['dompurify', 'valibot'], renderer: ['@floating-ui/*'] };
const check = (file, source) => checkSources([{ path: file, source }], allowlist);

test('package names and scoped wildcards', () => {
  assert.equal(packageName('@floating-ui/dom/dist/x.mjs'), '@floating-ui/dom');
  assert.equal(packageName('valibot/sub'), 'valibot');
  assert.ok(isAllowed('@floating-ui/core', ['@floating-ui/*']));
  assert.ok(!isAllowed('@floating-ui-evil/core', ['@floating-ui/*']));
  assert.ok(!isAllowed('dompurify-lite', ['dompurify']));
});

test('shared/ may import itself and allowlisted packages only', () => {
  assert.deepEqual(check('shared/schema.ts', 'import * as v from "valibot";\nimport type { X } from "./types.js";'), []);
  const [editor] = check('shared/schema.ts', '\nimport { useStore } from "../editor/src/store/projectStore";');
  assert.match(editor, /^shared\/schema\.ts:2: import "\.\.\/editor\/src\/store\/projectStore" — shared\/ may import only shared\//);
  assert.match(check('shared/x.ts', 'export { create } from "../renderer/src/renderer.js";')[0], /resolves to renderer\/src\/renderer\.js/);
  assert.match(check('shared/x.ts', 'import React from "react";')[0], /^shared\/x\.ts:1: import "react" — package "react" is not on the shared allowlist/);
  assert.match(check('shared/x.ts', 'import { computePosition } from "@floating-ui/dom";')[0], /"@floating-ui\/dom" is not on the shared allowlist/);
  assert.equal(check('shared/x.ts', 'const m = await import("zustand");').length, 1);
});

test('renderer/src may import renderer/src, shared/ and its own allowlist only', () => {
  assert.deepEqual(
    check(
      'renderer/src/renderer.ts',
      'import { computePosition } from "@floating-ui/dom";\nimport type { A } from "../../shared/types.js";\nimport { Emitter } from "./emitter.js";\nimport { x } from "@svg-mapper/shared";\ntype P = import("../../shared/types.js").PopupAction;',
    ),
    [],
  );
  assert.match(check('renderer/src/r.ts', 'import { App } from "../../editor/src/App";')[0], /^renderer\/src\/r\.ts:1: .*renderer\/src\/ may import only renderer\/src\/ and shared\/ \(resolves to editor\/src\/App\)/);
  assert.match(check('renderer/src/r.ts', 'import { create } from "zustand";')[0], /"zustand" is not on the renderer allowlist/);
  assert.match(check('renderer/src/r.ts', 'import { zip } from "fflate";')[0], /"fflate" is not on the renderer allowlist/);
  assert.equal(check('renderer/src/r.ts', 'import x from "../../shared/node_modules/valibot/dist/index.js";').length, 1);
});

test('comments and strings are not imports', () => {
  assert.deepEqual(check('shared/x.ts', '// import React from "react";\nconst s = "import x from \'react\'";\n/* require("react") */'), []);
});

test('editor production code reaches the renderer only via renderer/dist/*?raw', () => {
  assert.deepEqual(check('editor/src/screens/PreviewScreen.tsx', 'import js from "../../../renderer/dist/clickmap-renderer.js?raw";\nimport React from "react";'), []);
  assert.match(check('editor/src/screens/PreviewScreen.tsx', 'import { create } from "../../../renderer/src/renderer";')[0], /^editor\/src\/screens\/PreviewScreen\.tsx:1: .*resolves to renderer\/src\/renderer\)/);
  assert.equal(check('editor/src/x.ts', 'import js from "../../renderer/dist/clickmap-renderer.js";').length, 1);
  assert.equal(check('editor/src/x.ts', 'import r from "@svg-mapper/renderer";').length, 1);
  assert.deepEqual(check('editor/src/test/renderer-load.test.ts', 'import { create } from "../../../renderer/src/renderer";'), []);
});

test('renderer bundle inputs must be local or allowlisted packages', () => {
  const clean = [
    'src/index.ts',
    '../shared/schema.ts',
    '../shared/node_modules/valibot/dist/index.mjs',
    'node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs',
  ];
  assert.deepEqual(checkBundleInputs(clean, allowlist), []);
  const [pkg, editor] = checkBundleInputs(['node_modules/fflate/esm/browser.js', '../editor/src/lib/exportZip.ts'], allowlist);
  assert.match(pkg, /bundle input renderer\/node_modules\/fflate\/esm\/browser\.js — package "fflate" is not on/);
  assert.match(editor, /bundle input editor\/src\/lib\/exportZip\.ts — the renderer bundle may contain only/);
});

test('the repository satisfies its boundaries', () => {
  assert.deepEqual(checkSources(collectSources(), loadAllowlist()), []);
});

test('ASSIGNMENT §2.6 lists every allowlisted package', () => {
  const assignment = readFileSync(path.join(REPO_ROOT, 'ASSIGNMENT.md'), 'utf8');
  const policy = assignment.slice(assignment.indexOf('### 2.6'), assignment.indexOf('\n---', assignment.indexOf('### 2.6')));
  const { shared, renderer } = loadAllowlist();
  for (const entry of [...shared, ...renderer]) assert.ok(policy.includes(`\`${entry}\``), `ASSIGNMENT §2.6 should name ${entry}`);
});
