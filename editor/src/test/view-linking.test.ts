import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../store";
import { createNewProject } from "../lib/project";
import { createRectArea } from "../lib/area-utils";
import { validateActionUrl } from "../lib/url-validate";
import {
  collectGoToViewEdges,
  findOrphanViewIds,
  layoutViews,
} from "../lib/flow-graph";
import type { View } from "@svg-mapper/shared";

function resetStore() {
  const p = createNewProject();
  useStore.setState({
    project: p,
    activeViewId: p.views[0].id,
    selectedAreaId: null,
    selectedLayerId: null,
    activeTool: "select",
    past: [],
    future: [],
  });
}

// ── goToView action ─────────────────────────────────────────────────────────

describe("store: goToView action", () => {
  beforeEach(resetStore);

  it("assigns a goToView action targeting another view", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().addView();
    const targetId = useStore.getState().project.views[1].id;

    useStore.getState().updateAreaAction(area.id, {
      type: "goToView",
      targetViewId: targetId,
      transition: "fade",
    });

    const saved = useStore.getState().project.views[0].layers[0].areas[0].action;
    expect(saved.type).toBe("goToView");
    if (saved.type === "goToView") {
      expect(saved.targetViewId).toBe(targetId);
      expect(saved.transition).toBe("fade");
    }
  });

  it("is undoable", () => {
    const area = createRectArea(0, 0, 100, 100);
    useStore.getState().addArea(area);
    useStore.getState().updateAreaAction(area.id, {
      type: "goToView",
      targetViewId: "view_x",
    });
    useStore.getState().undo();
    const saved = useStore.getState().project.views[0].layers[0].areas[0].action;
    expect(saved.type).toBe("none");
  });
});

// ── duplicateView ───────────────────────────────────────────────────────────

describe("store: duplicateView", () => {
  beforeEach(resetStore);

  it("duplicates a view with fresh ids for view, layers, and areas", () => {
    const area = createRectArea(10, 10, 50, 50);
    useStore.getState().addArea(area);
    const original = useStore.getState().project.views[0];

    useStore.getState().duplicateView(original.id);

    const { project, activeViewId } = useStore.getState();
    expect(project.views).toHaveLength(2);
    const copy = project.views[1];
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe(original.name + " copy");
    expect(copy.canvas).toEqual(original.canvas);
    expect(copy.canvas).not.toBe(original.canvas);
    expect(copy.layers).toHaveLength(original.layers.length);
    expect(copy.layers[0].id).not.toBe(original.layers[0].id);
    expect(copy.layers[0].areas).toHaveLength(1);
    expect(copy.layers[0].areas[0].id).not.toBe(area.id);
    expect(copy.layers[0].areas[0].geometry).toEqual(area.geometry);
    expect(activeViewId).toBe(copy.id);
  });

  it("is undoable", () => {
    const viewId = useStore.getState().project.views[0].id;
    useStore.getState().duplicateView(viewId);
    expect(useStore.getState().project.views).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().project.views).toHaveLength(1);
  });
});

// ── URL validation ──────────────────────────────────────────────────────────

describe("validateActionUrl", () => {
  it("accepts http, https, mailto, tel", () => {
    expect(validateActionUrl("http://example.com").valid).toBe(true);
    expect(validateActionUrl("https://example.com/path?q=1").valid).toBe(true);
    expect(validateActionUrl("mailto:info@example.com").valid).toBe(true);
    expect(validateActionUrl("tel:+420123456789").valid).toBe(true);
  });

  it("accepts relative URLs", () => {
    expect(validateActionUrl("/cafeteria").valid).toBe(true);
    expect(validateActionUrl("page.html").valid).toBe(true);
  });

  it("rejects javascript: and data:", () => {
    expect(validateActionUrl("javascript:alert(1)").valid).toBe(false);
    expect(validateActionUrl("JaVaScRiPt:alert(1)").valid).toBe(false);
    expect(validateActionUrl("data:text/html,<script>x</script>").valid).toBe(false);
  });

  it("rejects other unknown protocols and empty input", () => {
    expect(validateActionUrl("vbscript:msgbox(1)").valid).toBe(false);
    expect(validateActionUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateActionUrl("").valid).toBe(false);
    expect(validateActionUrl("   ").valid).toBe(false);
  });
});

// ── Flow graph helpers ──────────────────────────────────────────────────────

function projectWithLink(): { views: View[]; initialViewId: string } {
  resetStore();
  const area = createRectArea(0, 0, 10, 10);
  useStore.getState().addArea(area);
  useStore.getState().addView(); // view 2 (reachable)
  useStore.getState().addView(); // view 3 (orphan)
  const s = useStore.getState();
  const v2 = s.project.views[1].id;
  s.updateAreaAction(area.id, { type: "goToView", targetViewId: v2 });
  const after = useStore.getState();
  return {
    views: after.project.views as unknown as View[],
    initialViewId: after.project.settings.initialViewId,
  };
}

describe("flow-graph", () => {
  it("collects goToView edges", () => {
    const { views } = projectWithLink();
    const edges = collectGoToViewEdges(views);
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceViewId).toBe(views[0].id);
    expect(edges[0].targetViewId).toBe(views[1].id);
  });

  it("flags unreachable views as orphans", () => {
    const { views, initialViewId } = projectWithLink();
    const orphans = findOrphanViewIds(views, initialViewId);
    expect(orphans.has(views[0].id)).toBe(false); // initial
    expect(orphans.has(views[1].id)).toBe(false); // linked
    expect(orphans.has(views[2].id)).toBe(true); // unlinked
  });

  it("lays out reachable views by depth and orphans in a later column", () => {
    const { views, initialViewId } = projectWithLink();
    const pos = layoutViews(views, initialViewId);
    expect(pos.get(views[0].id)!.x).toBe(0);
    expect(pos.get(views[1].id)!.x).toBeGreaterThan(0);
    expect(pos.get(views[2].id)!.x).toBeGreaterThan(pos.get(views[1].id)!.x);
  });
});
