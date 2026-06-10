import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "../store";
import {
  collectGoToViewEdges,
  findOrphanViewIds,
  layoutViews,
} from "../lib/flow-graph";
import type { View } from "@svg-mapper/shared";

// Read-only node-edge graph of the project: nodes are Views, edges are
// goToView Area actions. Clicking a node switches the active View.

type ViewNodeData = {
  label: string;
  isActive: boolean;
  isInitial: boolean;
  isOrphan: boolean;
  areaCount: number;
};

type ViewNode = Node<ViewNodeData, "view">;

function ViewNodeComponent({ data }: NodeProps<ViewNode>) {
  return (
    <div
      className={`relative min-w-40 rounded-md border px-3 py-2 text-left shadow ${
        data.isActive
          ? "border-blue-500 bg-blue-950"
          : "border-neutral-600 bg-neutral-800"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-neutral-500" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-neutral-100">{data.label}</span>
        {data.isInitial && (
          <span
            title="Initial view"
            className="rounded bg-emerald-700 px-1 text-[9px] font-semibold text-emerald-100"
          >
            START
          </span>
        )}
        {data.isOrphan && (
          <span
            title="Orphan view — not reachable from the initial view via goToView actions"
            className="rounded bg-amber-600 px-1 text-[9px] font-semibold text-amber-50"
          >
            ⚠ ORPHAN
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] text-neutral-400">
        {data.areaCount} area{data.areaCount === 1 ? "" : "s"}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-neutral-500" />
    </div>
  );
}

const nodeTypes = { view: ViewNodeComponent };

function countAreas(view: View): number {
  return view.layers.reduce((n, l) => n + l.areas.length, 0);
}

export function FlowScreen() {
  const project = useStore((s) => s.project);
  const activeViewId = useStore((s) => s.activeViewId);
  const setActiveViewId = useStore((s) => s.setActiveViewId);

  const views = project.views as unknown as View[];
  const initialViewId = project.settings.initialViewId;

  const { nodes, edges } = useMemo(() => {
    const orphans = findOrphanViewIds(views, initialViewId);
    const positions = layoutViews(views, initialViewId);
    const goEdges = collectGoToViewEdges(views);

    const nodes: ViewNode[] = views.map((v) => ({
      id: v.id,
      type: "view",
      position: positions.get(v.id) ?? { x: 0, y: 0 },
      data: {
        label: v.name,
        isActive: v.id === activeViewId,
        isInitial: v.id === initialViewId,
        isOrphan: orphans.has(v.id),
        areaCount: countAreas(v),
      },
    }));

    const edges: Edge[] = goEdges
      .filter((e) => views.some((v) => v.id === e.targetViewId))
      .map((e) => ({
        id: e.id,
        source: e.sourceViewId,
        target: e.targetViewId,
        label: e.areaName,
        animated: false,
        style: { stroke: "#737373" },
        labelStyle: { fill: "#a3a3a3", fontSize: 10 },
        labelBgStyle: { fill: "#262626" },
      }));

    return { nodes, edges };
  }, [views, initialViewId, activeViewId]);

  return (
    <main className="relative flex-1 bg-neutral-900" data-testid="flow-screen">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) => setActiveViewId(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={20} color="#333" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </main>
  );
}
