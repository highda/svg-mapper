import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Custom view CSS is parsed by the browser and scoped per instance (#168).

const ORIGIN = "http://view-css.test";
const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

const ESCAPE = ".clickmap-area {color:red} @layer escape; body {--scope-escaped:yes} :root { --root-escaped: yes } .clickmap-root { outline: 7px solid rgb(255, 0, 0) }";
const REJECTED: Record<string, RegExp> = {
  escapedUrl: /resources/,
  imageSet: /resources/,
  importRule: /global resource/,
  propertyRule: /global resource/,
};
const REJECTED_CSS: Record<string, string> = {
  escapedUrl: ".clickmap-bg { background: u\\72l(https://x.test/a.png) }",
  imageSet: '.clickmap-bg { background: image-set("https://x.test/a.png" 1x) }',
  importRule: '@import "https://x.test/a.css"; .clickmap-bg { color: red }',
  propertyRule: "@property --x { syntax: '*'; inherits: false; initial-value: 1; }",
};

test("the @layer payload stays inside its map and invalid CSS is rejected with a reason", async ({ page }) => {
  const [js, css, fixture] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
  const definition = JSON.parse(fixture);
  const base = definition.views.find((v: { id: string }) => v.id === definition.settings.initialViewId) ?? definition.views[0];
  base.customCss = ESCAPE;
  for (const [id, customCss] of Object.entries(REJECTED_CSS)) {
    definition.views.push({ ...structuredClone(base), id, slug: id, name: id, customCss });
  }
  const plain = structuredClone(definition);
  for (const view of plain.views) view.customCss = "";

  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${css}</style></head><body>
      <div id="one" style="width:600px;height:400px"></div><div id="two" style="width:600px;height:400px"></div><div id="three" style="width:600px;height:400px"></div>
      <script>${js}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  const state = await page.evaluate(([def, other]) => {
    const w = window as unknown as { ClickMapRenderer: { create(o: object): { on(t: string, cb: (e: { message: string }) => void): void } } };
    w.ClickMapRenderer.create({ container: "#one", definition: def });
    w.ClickMapRenderer.create({ container: "#two", definition: other });
    const css = getComputedStyle(document.body);
    return {
      bodyVar: css.getPropertyValue("--scope-escaped").trim(),
      rootVar: getComputedStyle(document.documentElement).getPropertyValue("--root-escaped").trim(),
      ownVar: getComputedStyle(document.querySelector("#one .clickmap-root")!).getPropertyValue("--scope-escaped").trim(),
      ownOutline: getComputedStyle(document.querySelector("#one .clickmap-root")!).outlineColor,
      otherOutline: getComputedStyle(document.querySelector("#two .clickmap-root")!).outlineStyle,
    };
  }, [definition, plain]);
  expect(state).toEqual({ bodyVar: "", rootVar: "", ownVar: "yes", ownOutline: "rgb(255, 0, 0)", otherOutline: "none" });

  const errors = await page.evaluate(async ([def, ids]) => {
    const w = window as unknown as { ClickMapRenderer: { create(o: object): { on(t: string, cb: (e: { message: string }) => void): void; goToView(id: string): void } } };
    const map = w.ClickMapRenderer.create({ container: "#three", definition: def });
    const seen: string[] = [];
    map.on("error", (event) => seen.push(event.message));
    for (const id of ids as string[]) {
      map.goToView(id);
      await new Promise((done) => setTimeout(done, 200));
    }
    return seen;
  }, [definition, Object.keys(REJECTED_CSS)] as const);
  for (const [id, pattern] of Object.entries(REJECTED)) {
    expect(errors.find((message) => message.startsWith(`${id}:`))).toMatch(pattern);
  }
  expect(requests.filter((url) => url.includes("x.test"))).toEqual([]);
});
