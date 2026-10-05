import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef, type PanelImperativeHandle, type PanelSize } from "react-resizable-panels";
import { CANVAS_MIN_WIDTH, PANEL_LIMITS, SEPARATOR_IDS, useLayoutPrefs, type DockedPanel } from "../../store/layout-prefs";
import { LeftPanel } from "./LeftPanel";
import { RightSidebar } from "./RightSidebar";
import { Workspace } from "./Workspace";

const SEPARATOR_CLASS =
  "relative w-1 shrink-0 bg-neutral-800 outline-none transition-colors hover:bg-blue-500/70 focus-visible:bg-blue-500 data-[separator=active]:bg-blue-500";

/**
 * Desktop authoring layout (#156): the tree and the inspector are constrained,
 * collapsible panels around a flexible canvas. Separators resize with the
 * pointer or keyboard (arrows, Home/End; Enter collapses or restores the
 * panel). Panel widths are kept in pixels while the window resizes, so the
 * canvas absorbs window changes. Nothing here is mounted per drag, so
 * selection, focus and panel scroll positions survive resizing.
 */
export function DockedWorkspace({ showTree }: { showTree: boolean }) {
  const treeRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const tree = useLayoutPrefs((s) => s.tree);
  const inspector = useLayoutPrefs((s) => s.inspector);
  const layoutRequest = useLayoutPrefs((s) => s.layoutRequest);
  const recordPanel = useLayoutPrefs((s) => s.recordPanel);
  const toggleCollapsed = useLayoutPrefs((s) => s.toggleCollapsed);
  const appliedRequest = useRef(layoutRequest);

  // Toggle and reset requests come from controls outside the group.
  useEffect(() => {
    if (appliedRequest.current === layoutRequest) return;
    appliedRequest.current = layoutRequest;
    const prefs = useLayoutPrefs.getState();
    for (const [panel, ref] of [["tree", treeRef], ["inspector", inspectorRef]] as const) {
      applyPanel(panel, ref.current, prefs[panel].collapsed, prefs[panel].size);
    }
  }, [layoutRequest, treeRef, inspectorRef]);

  function onResize(panel: DockedPanel) {
    return (size: PanelSize) => recordPanel(panel, { collapsed: size.inPixels < 1 });
  }

  function onInspectorSeparatorKey(event: KeyboardEvent<HTMLDivElement>) {
    // The library's Enter collapses the panel before a separator; the
    // inspector sits after its separator, so Enter is handled here.
    if (event.key === "Enter") toggleCollapsed("inspector");
  }

  return (
    <Group
      orientation="horizontal"
      id="editor-workspace"
      className="min-h-0 flex-1"
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return;
        // Panel handles report the new sizes once the layout has been applied.
        requestAnimationFrame(() => {
          for (const [panel, ref] of [["tree", treeRef], ["inspector", inspectorRef]] as const) {
            const handle = ref.current;
            if (handle && !handle.isCollapsed()) recordPanel(panel, { size: handle.getSize().inPixels });
          }
        });
      }}
    >
      {showTree && (
        <>
          <Panel
            id="workspace-tree"
            panelRef={treeRef}
            collapsible
            collapsedSize={0}
            minSize={PANEL_LIMITS.tree.min}
            maxSize={PANEL_LIMITS.tree.max}
            defaultSize={tree.collapsed ? 0 : tree.size}
            groupResizeBehavior="preserve-pixel-size"
            onResize={onResize("tree")}
            className="flex"
            style={{ overflow: "hidden" }}
          >
            <PanelContent panel="tree" collapsed={tree.collapsed}>
              <LeftPanel />
            </PanelContent>
          </Panel>
          <Separator id={SEPARATOR_IDS.tree} aria-label="Resize views and layers panel" title="Drag or use arrow keys to resize; Enter hides or shows the panel" className={SEPARATOR_CLASS} />
        </>
      )}
      <Panel id="workspace-main" minSize={CANVAS_MIN_WIDTH} className="flex" style={{ overflow: "hidden" }}>
        <Workspace />
      </Panel>
      <Separator
        id={SEPARATOR_IDS.inspector}
        aria-label="Resize inspector panel"
        title="Drag or use arrow keys to resize; Enter hides or shows the panel"
        className={SEPARATOR_CLASS}
        onKeyDown={onInspectorSeparatorKey}
      />
      <Panel
        id="workspace-inspector"
        panelRef={inspectorRef}
        collapsible
        collapsedSize={0}
        minSize={PANEL_LIMITS.inspector.min}
        maxSize={PANEL_LIMITS.inspector.max}
        defaultSize={inspector.collapsed ? 0 : inspector.size}
        groupResizeBehavior="preserve-pixel-size"
        onResize={onResize("inspector")}
        className="flex"
        style={{ overflow: "hidden" }}
      >
        <PanelContent panel="inspector" collapsed={inspector.collapsed}>
          <RightSidebar docked />
        </PanelContent>
      </Panel>
    </Group>
  );
}

function applyPanel(panel: DockedPanel, handle: PanelImperativeHandle | null, collapsed: boolean, size: number) {
  if (!handle) return;
  if (collapsed) {
    // Focus inside a panel that is about to become inert moves to its separator.
    const content = document.querySelector(`[data-panel-content="${panel}"]`);
    if (content?.contains(document.activeElement)) document.getElementById(SEPARATOR_IDS[panel])?.focus();
    if (!handle.isCollapsed()) handle.collapse();
  } else {
    handle.resize(size);
  }
}

/** A collapsed panel keeps its content mounted (drafts, scroll) but out of reach. */
function PanelContent({ panel, collapsed, children }: { panel: DockedPanel; collapsed: boolean; children: ReactNode }) {
  return (
    <div data-panel-content={panel} inert={collapsed} className="flex min-w-0 flex-1">
      {children}
    </div>
  );
}
