import { describe, it, expect } from "vitest";
import { createNewProject, toDefinition } from "../lib/project";
import { buildPreviewHtml, PREVIEW_MESSAGE_SOURCE } from "../lib/preview-html";

describe("toDefinition", () => {
  it("strips the editor-only block", () => {
    const project = createNewProject();
    expect(project.editor).toBeDefined();
    const def = toDefinition(project);
    expect("editor" in def).toBe(false);
    expect(def.views).toBe(project.views);
    expect(def.settings.initialViewId).toBe(project.settings.initialViewId);
  });
});

describe("buildPreviewHtml", () => {
  const base = {
    rendererJs: "/* renderer */",
    rendererCss: "/* css */",
  };

  it("embeds the definition, renderer js/css, and message source", () => {
    const project = createNewProject();
    project.views[0].customCss = ".clickmap-bg { opacity: .75; }";
    const def = toDefinition(project);
    const html = buildPreviewHtml({ ...base, definition: def, blockUrls: true });
    expect(html).toContain("/* renderer */");
    expect(html).toContain("/* css */");
    expect(html).toContain(def.settings.initialViewId);
    expect(html).toContain(PREVIEW_MESSAGE_SOURCE);
    expect(html).toContain("ClickMapRenderer.create");
    expect(html).toContain(".clickmap-bg { opacity: .75; }");
  });

  it("toggles URL blocking", () => {
    const def = toDefinition(createNewProject());
    expect(buildPreviewHtml({ ...base, definition: def, blockUrls: true })).toContain(
      "var BLOCK_URLS = true",
    );
    expect(buildPreviewHtml({ ...base, definition: def, blockUrls: false })).toContain(
      "var BLOCK_URLS = false",
    );
  });

  it("escapes </script> sequences inside the definition", () => {
    const project = createNewProject();
    project.project.name = 'x</script><script>alert(1)</script>';
    const html = buildPreviewHtml({
      ...base,
      definition: toDefinition(project),
      blockUrls: true,
    });
    expect(html).not.toContain("x</script>");
    expect(html).toContain("x\\u003c/script");
  });
});
