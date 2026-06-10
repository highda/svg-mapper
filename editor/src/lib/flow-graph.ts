import type { View } from "@svg-mapper/shared";

// Graph helpers for the Flow screen: Views are nodes, goToView Area actions
// are edges.

export interface GoToViewEdge {
  id: string;
  sourceViewId: string;
  targetViewId: string;
  areaId: string;
  areaName: string;
}

export function collectGoToViewEdges(views: View[]): GoToViewEdge[] {
  const edges: GoToViewEdge[] = [];
  for (const view of views) {
    for (const layer of view.layers) {
      for (const area of layer.areas) {
        if (area.action.type === "goToView" && area.action.targetViewId) {
          edges.push({
            id: `${view.id}->${area.action.targetViewId}:${area.id}`,
            sourceViewId: view.id,
            targetViewId: area.action.targetViewId,
            areaId: area.id,
            areaName: area.name,
          });
        }
      }
    }
  }
  return edges;
}

// A View is an orphan when it is not reachable from initialViewId by
// following goToView edges. The initial View itself is never an orphan.
export function findOrphanViewIds(views: View[], initialViewId: string): Set<string> {
  const edges = collectGoToViewEdges(views);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.sourceViewId) ?? [];
    list.push(e.targetViewId);
    adjacency.set(e.sourceViewId, list);
  }

  const reachable = new Set<string>();
  const queue: string[] = [];
  if (views.some((v) => v.id === initialViewId)) {
    reachable.add(initialViewId);
    queue.push(initialViewId);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adjacency.get(id) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const orphans = new Set<string>();
  for (const v of views) {
    if (!reachable.has(v.id)) orphans.add(v.id);
  }
  return orphans;
}

// Simple layered layout: BFS depth from the initial View determines the
// column; orphans go into the column after the deepest reachable one.
export function layoutViews(
  views: View[],
  initialViewId: string,
): Map<string, { x: number; y: number }> {
  const edges = collectGoToViewEdges(views);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.sourceViewId) ?? [];
    list.push(e.targetViewId);
    adjacency.set(e.sourceViewId, list);
  }

  const depth = new Map<string, number>();
  if (views.some((v) => v.id === initialViewId)) {
    depth.set(initialViewId, 0);
    const queue = [initialViewId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const d = depth.get(id)!;
      for (const next of adjacency.get(id) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, d + 1);
          queue.push(next);
        }
      }
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  const orphanColumn = depth.size > 0 ? maxDepth + 1 : 0;

  const positions = new Map<string, { x: number; y: number }>();
  const rowsPerColumn = new Map<number, number>();
  for (const v of views) {
    const col = depth.get(v.id) ?? orphanColumn;
    const row = rowsPerColumn.get(col) ?? 0;
    rowsPerColumn.set(col, row + 1);
    positions.set(v.id, { x: col * 280, y: row * 120 });
  }
  return positions;
}
