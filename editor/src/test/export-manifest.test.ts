// Package manifest, cached asset preparation and async compression (#171).
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildExportManifest,
  ExportCancelledError,
  generateExportPreview,
  prepareExportAssets,
  zipExportManifest,
  zipExportManifestSync,
} from "../lib/export-package";
import { createNewProject, toDefinition } from "../lib/project";
import type { Asset } from "@svg-mapper/shared";

const STUB_JS = "/* renderer */ var ClickMapRenderer = {};";
const STUB_CSS = ".clickmap-root { color: red; }";

function pngAsset(index: number, bytes: number): Asset {
  // Pseudo-random bytes so DEFLATE cannot shrink them to nothing.
  const raw = new Uint8Array(bytes);
  let seed = index + 1;
  for (let i = 0; i < raw.length; i++) raw[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return { id: `img_${index}`, type: "image/png", name: `image-${index}.png`, src: `data:image/png;base64,${btoa(binary)}`, width: 10, height: 10, inline: false };
}

function imageProject(count: number, bytes: number) {
  const project = createNewProject("Manifest Map");
  project.assets = [
    ...Array.from({ length: count }, (_, index) => pngAsset(index, bytes)),
    { id: "logo", type: "image/svg+xml", name: "logo.svg", src: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', width: 1, height: 1, inline: false },
    { id: "remote", type: "image/png", name: "remote", src: "https://cdn.example.test/plan.png", width: 1, height: 1, inline: false },
  ];
  return project;
}

function entryBytes(zip: Uint8Array): number {
  return Object.values(unzipSync(zip)).reduce((total, bytes) => total + bytes.byteLength, 0);
}

afterEach(() => vi.restoreAllMocks());

describe("export manifest", () => {
  it("estimates exactly the uncompressed bytes of every produced ZIP entry", () => {
    for (const inlineAssets of [true, false]) {
      const definition = toDefinition(imageProject(3, 2048));
      const options = { inlineAssets, basePath: "/maps/nested", containerId: "map-a" };
      const manifest = buildExportManifest(definition, STUB_JS, STUB_CSS, options);
      const entries = unzipSync(zipExportManifestSync(manifest));

      expect(Object.keys(entries)).toEqual(Object.keys(manifest.files));
      expect(entryBytes(zipExportManifestSync(manifest))).toBe(manifest.uncompressedBytes);
      // index.html duplicates the renderer and definition; hooks.js and the
      // full embed.html are counted too.
      for (const name of ["index.html", "hooks.js", "embed.html", "README.txt"]) expect(entries[name]).toBeDefined();
      expect(manifest.uncompressedBytes).toBeGreaterThan(entries["index.html"]!.byteLength + entries["map.json"]!.byteLength);
      expect(generateExportPreview(definition, STUB_JS, STUB_CSS, options).estimatedUncompressedBytes).toBe(manifest.uncompressedBytes);
      expect(manifest.assetFileCount).toBe(inlineAssets ? 0 : 4);
      expect(manifest.externalDependencies).toEqual(["https://cdn.example.test/plan.png"]);
    }
  });

  it("does not redo asset preprocessing when only deployment text changes", () => {
    const definition = toDefinition(imageProject(4, 4096));
    const atob = vi.spyOn(globalThis, "atob");
    const first = buildExportManifest(definition, STUB_JS, STUB_CSS, { inlineAssets: false, basePath: "/a", containerId: "one" });
    const decodes = atob.mock.calls.length;
    expect(decodes).toBe(4);

    const second = buildExportManifest(definition, STUB_JS, STUB_CSS, { inlineAssets: false, basePath: "/b/c", containerId: "two" });
    expect(atob.mock.calls.length).toBe(decodes);
    // The heavy entries are the same objects; only deployment text differs.
    expect(second.files["index.html"]).toBe(first.files["index.html"]);
    expect(second.files["map.json"]).toBe(first.files["map.json"]);
    expect(second.files["assets/image-0.png"]).toBe(first.files["assets/image-0.png"]);
    expect(strFromU8(second.files["embed.html"]!)).toContain("/b/c/map.json");
    expect(second.embedSnippet).toContain("#two");

    // A new definition object over the same asset array (an unrelated
    // project edit) and switching to inline still reuse the decoded bytes.
    buildExportManifest({ ...definition }, STUB_JS, STUB_CSS, { inlineAssets: true });
    expect(atob.mock.calls.length).toBe(decodes);
  });

  it("re-prepares assets when the list changes, even in place", () => {
    const project = imageProject(1, 64);
    const before = prepareExportAssets(project.assets);
    expect(prepareExportAssets(project.assets)).toBe(before);
    project.assets[0] = { ...project.assets[0]!, src: "data:image/png;base64,%%%" };
    const after = prepareExportAssets(project.assets);
    expect(after).not.toBe(before);
    expect(after.error?.message).toBe("Malformed base64 asset data URI.");
  });

  it("previews a broken asset without throwing but refuses to package it", async () => {
    const project = imageProject(0, 0);
    project.assets.push({ id: "bad", type: "image/svg+xml", name: "bad.svg", src: "<svg><foreignObject>", width: 1, height: 1, inline: false });
    const manifest = buildExportManifest(toDefinition(project), STUB_JS, STUB_CSS, { inlineAssets: false });
    expect(manifest.error?.message).toMatch(/Asset "bad.svg"/);
    expect(() => zipExportManifestSync(manifest)).toThrow(/Asset "bad.svg"/);
    await expect(zipExportManifest(manifest)).rejects.toThrow(/Asset "bad.svg"/);
  });
});

describe("zipExportManifest", () => {
  it("produces the same entries as the synchronous encoder, storing raster images", async () => {
    // Large enough that fflate hands the text entries to its async path.
    const manifest = buildExportManifest(toDefinition(imageProject(2, 200_000)), "x".repeat(300_000), STUB_CSS, { inlineAssets: false });
    const zip = await zipExportManifest(manifest);
    const entries = unzipSync(zip);
    const expected = unzipSync(zipExportManifestSync(manifest));
    expect(Object.keys(entries)).toEqual(Object.keys(expected));
    // Compare bytes directly: deep-equality over ~200 KB arrays alone takes seconds.
    for (const [name, bytes] of Object.entries(expected)) expect(Buffer.from(entries[name]).equals(Buffer.from(bytes)), name).toBe(true);
    // PNGs are stored, so the archive is at least their raw size.
    expect(zip.byteLength).toBeGreaterThan(400_000);
  });

  it("rejects with ExportCancelledError when cancelled before or during compression", async () => {
    const manifest = buildExportManifest(toDefinition(imageProject(1, 64)), "y".repeat(2_000_000), STUB_CSS, { inlineAssets: false });
    const before = new AbortController();
    before.abort();
    await expect(zipExportManifest(manifest, { signal: before.signal })).rejects.toBeInstanceOf(ExportCancelledError);

    const during = new AbortController();
    const pending = zipExportManifest(manifest, { signal: during.signal });
    setTimeout(() => during.abort(), 1);
    await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);

    // The manifest stays usable after a cancel.
    expect(entryBytes(await zipExportManifest(manifest))).toBe(manifest.uncompressedBytes);
  });
});
