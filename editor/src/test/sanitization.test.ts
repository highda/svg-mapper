import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { sanitizeRichHtml, sanitizeSvgMarkup } from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createRectArea } from "../lib/area-utils";
import { generateExportPackage } from "../lib/export-package";
import { createNewProject, toDefinition } from "../lib/project";

// DOMPurify-based HTML and SVG profiles at every boundary that publishes markup (#167).

function html(raw: string): string {
  const host = document.createElement("div");
  host.append(sanitizeRichHtml(raw));
  return host.innerHTML;
}

describe("rich HTML profile", () => {
  it("keeps safe formatting, links and images", () => {
    const out = html('<p><b>Bold</b> <em>em</em> <a href="https://example.test/x">link</a> <img src="/a.png" alt="A"></p><ul><li>one</li></ul>');
    expect(out).toContain("<b>Bold</b>");
    expect(out).toContain('<a href="https://example.test/x">link</a>');
    expect(out).toContain('<img src="/a.png" alt="A">');
    expect(out).toContain("<li>one</li>");
  });

  it("removes everything that can style or control the host page", () => {
    const out = html(
      '<style>body{--review-injected:yes}</style><link rel="stylesheet" href="/x.css"><base href="https://evil.test/">'
      + '<form action="/steal"><input name="q"><button>Go</button></form><iframe src="/x"></iframe>'
      + '<b style="color:red" id="main" name="clobber" onclick="alert(1)">Safe text</b><svg><script>alert(1)</script></svg>',
    );
    // Text of removed controls stays as inert text; no element survives.
    expect(out).toBe("Go<b>Safe text</b>");
  });

  it("applies the app URL policy after entity decoding", () => {
    const out = html('<a href="java&#x09;script:alert(1)">x</a><a href=" javascript:alert(1)">y</a><img src="data:image/svg+xml,<svg onload=alert(1)>"><a href="mailto:a@b.test">m</a>');
    expect(out).toBe('<a>x</a><a>y</a><img><a href="mailto:a@b.test">m</a>');
  });

  it("makes new-window links safe and drops other targets", () => {
    expect(html('<a href="/a" target="_blank">a</a>')).toBe('<a href="/a" target="_blank" rel="noopener noreferrer">a</a>');
    expect(html('<a href="/a" target="_top">a</a>')).toBe('<a href="/a">a</a>');
  });
});

describe("SVG artwork profile", () => {
  const SVG = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

  it("keeps artwork features", () => {
    const out = sanitizeSvgMarkup(
      `<svg ${SVG} viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>`
      + '<filter id="f"><feGaussianBlur stdDeviation="1"/></filter><path id="p" d="M0 0h5v5z"/></defs>'
      + '<style>.a{fill:url(#g)}</style><use href="#p" class="a"/><rect width="5" height="5" fill="url(#g)" filter="url(#f)"/></svg>',
    );
    for (const kept of ["linearGradient", "feGaussianBlur", '<use href="#p"', "fill:url(#g)", 'filter="url(#f)"']) expect(out).toContain(kept);
  });

  it("removes scripts, foreign content, event handlers and external resources", () => {
    const out = sanitizeSvgMarkup(
      `<svg ${SVG} onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject>`
      + '<image href="https://evil.test/track.png" width="1" height="1"/><use xlink:href="https://evil.test/a.svg#x"/>'
      + '<a href="javascript:alert(1)"><rect width="1" height="1"/></a><set attributeName="href" to="javascript:alert(1)"/>'
      + '<style>@import url(https://evil.test/a.css); .b{background:url(https://evil.test/b.png)}</style>'
      + '<rect style="fill:url(https://evil.test/c.svg#p)" width="1" height="1"/></svg>',
    );
    for (const removed of ["script", "foreignObject", "onload", "evil.test", "javascript", "<set", "@import"]) {
      expect(out).not.toContain(removed);
    }
  });

  it("rejects malformed and foreign-namespace roots and strips namespaced script", () => {
    expect(() => sanitizeSvgMarkup("<svg><rect></svg>")).toThrow(/parse error/);
    expect(() => sanitizeSvgMarkup('<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>')).toThrow(/SVG namespace/);
    expect(() => sanitizeSvgMarkup('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toThrow(/SVG namespace/);
    const out = sanitizeSvgMarkup(
      `<svg ${SVG}><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>`
      + '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(2)</s:script><rect width="1" height="1"/></svg>',
    );
    // The elements are gone; their text remains inert character data.
    expect(out).not.toMatch(/<[^>]*script/i);
    expect(out).toContain("<rect");
  });
});

describe("renderer insertion boundary", () => {
  beforeEach(() => {
    __setInlinedCSS(".clickmap-root { position: relative; }");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    document.body.innerHTML = '<div id="map"></div>';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("inserts popup and tooltip bodies without host-styling content", () => {
    const area = createRectArea(0, 0, 10, 10);
    const payload = '<style>body{--review-injected:yes}</style><b>Safe text</b>';
    area.tooltip = { enabled: true, body: payload };
    area.action = { type: "popup", content: { title: "T", body: payload } };
    const project = createNewProject();
    project.views[0]!.layers = [{ id: "layer_1", name: "L", visible: true, locked: false, opacity: 1, areas: [area] }];
    create({ container: "#map", definition: toDefinition(project) });

    const shape = document.querySelector(`[data-area-id="${area.id}"]`)!;
    shape.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    shape.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelectorAll(".clickmap-tooltip b, .clickmap-popover b")).toHaveLength(2);
    expect(document.querySelector(".clickmap-tooltip style, .clickmap-popover style")).toBeNull();
    expect(document.body.innerHTML).not.toContain("--review-injected");
  });
});

describe("export boundary", () => {
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>';

  it.each([
    ["raw markup", hostile],
    ["percent data URI", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hostile)}`],
    ["base64 data URI", `data:image/svg+xml;base64,${btoa(hostile)}`],
  ])("sanitizes JSON-imported %s SVG in packaged files and inline map.json", (_kind, src) => {
    const project = createNewProject("Hostile");
    project.assets = [{ id: "art", type: "image/svg+xml", name: "art", src, width: 1, height: 1, inline: true }];

    const files = unzipSync(generateExportPackage(toDefinition(project), "", "", { inlineAssets: false }).zip);
    const svgFile = strFromU8(files["assets/art.svg"]!);
    expect(svgFile).toContain("<rect");
    expect(svgFile).not.toMatch(/script|onload|alert/);

    const inline = generateExportPackage(toDefinition(project), "", "", { inlineAssets: true }).mapJson;
    expect(decodeURIComponent(inline)).not.toMatch(/<script|onload/);
  });

  it("refuses to publish an SVG asset that cannot be sanitized", () => {
    const project = createNewProject("Broken");
    project.assets = [{ id: "art", type: "image/svg+xml", name: "broken.svg", src: "<svg><g></svg>", width: 1, height: 1, inline: true }];
    expect(() => generateExportPackage(toDefinition(project), "", "", { inlineAssets: false })).toThrow(/Asset "broken.svg": Invalid SVG/);
  });
});
