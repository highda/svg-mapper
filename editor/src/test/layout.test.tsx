import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../App";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";
import { createRectArea } from "../lib/area-utils";

describe("primary editor navigation", () => {
  beforeEach(() => {
    const project = createNewProject();
    useStore.setState({
      project,
      activeViewId: project.views[0].id,
      selectedAreaId: null,
      selectedLayerId: null,
      screen: "design",
      past: [],
      future: [],
    });
  });

  it("opens the hierarchy workspace from the Tree tab", () => {
    render(<App />);

    const treeTab = screen.getByRole("button", { name: "Tree" });
    fireEvent.click(treeTab);

    expect(treeTab).toHaveAttribute("aria-current", "page");
    const workspace = screen.getByRole("main", { name: "Views and layers workspace" });
    expect(within(workspace).getByRole("complementary", { name: "Views and layers" })).toBeVisible();
    expect(within(workspace).getByText("Views & Layers")).toBeVisible();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("offers a keyboard-accessible layer destination and announces moves", () => {
    const viewId = useStore.getState().project.views[0].id;
    const area = createRectArea(0, 0, 20, 20);
    area.name = "Reception";
    useStore.getState().addArea(area);
    useStore.getState().addLayer(viewId);
    const target = useStore.getState().project.views[0].layers[1];
    useStore.getState().renameLayer(target.id, "Labels");
    useStore.getState().setScreen("tree");
    render(<App />);

    const destination = screen.getByRole("combobox", { name: "Move Reception to layer" });
    fireEvent.change(destination, { target: { value: target.id } });

    expect(useStore.getState().project.views[0].layers[1].areas[0].id).toBe(area.id);
    expect(screen.getByRole("status")).toHaveTextContent("Reception moved to Labels.");
  });

  it("communicates locked layer destinations", () => {
    const viewId = useStore.getState().project.views[0].id;
    const area = createRectArea(0, 0, 20, 20);
    useStore.getState().addArea(area);
    useStore.getState().addLayer(viewId);
    const target = useStore.getState().project.views[0].layers[1];
    useStore.getState().toggleLayerLock(target.id);
    useStore.getState().setScreen("tree");
    render(<App />);

    const option = screen.getByRole("option", { name: /locked/i });
    expect(option).toBeDisabled();
    expect(screen.getByLabelText(`${target.name}, locked`)).toBeInTheDocument();
  });
});
