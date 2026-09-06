import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("duplicates locked layers from the responsive hierarchy action", () => {
    const viewId = useStore.getState().project.views[0].id;
    useStore.getState().addLayer(viewId);
    const source = useStore.getState().project.views[0].layers[0];
    useStore.getState().renameLayer(source.id, "Floor details");
    useStore.getState().toggleLayerLock(source.id);
    useStore.getState().setScreen("tree");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate layer Floor details" }));

    const state = useStore.getState();
    expect(state.project.views[0].layers.map((layer) => layer.name)).toEqual(["Floor details", "Floor details copy"]);
    expect(state.project.views[0].layers[1].locked).toBe(true);
    expect(state.selectedLayerId).toBe(state.project.views[0].layers[1].id);
    expect(screen.getByRole("status")).toHaveTextContent("Floor details duplicated.");
  });

  it("shows inbound view links and lets authors retarget before deletion", async () => {
    const user = userEvent.setup();
    const area = createRectArea(0, 0, 20, 20);
    area.name = "Lobby link";
    useStore.getState().addArea(area);
    useStore.getState().addView();
    const deleted = useStore.getState().project.views[1];
    useStore.getState().renameView(deleted.id, "Details");
    useStore.getState().addView();
    const replacement = useStore.getState().project.views[2];
    useStore.getState().renameView(replacement.id, "Overview");
    useStore.getState().updateAreaAction(area.id, { type: "goToView", targetViewId: deleted.id });
    useStore.getState().setScreen("tree");
    render(<App />);

    expect(screen.getByText("1 inbound link")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete view Details" }));
    const controls = screen.getByRole("group", { name: "Delete Details" });
    expect(within(controls).getByText(/Lobby link \(Main View\)/)).toBeVisible();
    await user.selectOptions(within(controls).getByRole("combobox"), replacement.id);
    await user.click(within(controls).getByRole("button", { name: "Retarget & delete" }));

    expect(useStore.getState().project.views.some((view) => view.id === deleted.id)).toBe(false);
    expect(useStore.getState().project.views[0].layers[0].areas[0].action).toEqual({
      type: "goToView",
      targetViewId: replacement.id,
    });
  });

  it("gives Export the full narrow viewport while retaining the desktop inspector", () => {
    useStore.getState().setScreen("export");
    render(<App />);

    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveClass("hidden", "lg:flex");
    expect(screen.getByTestId("export-screen").firstElementChild).toHaveClass("min-w-0", "p-4", "sm:p-6");
    expect(screen.getByRole("button", { name: "Download ZIP" }).parentElement?.parentElement).toHaveClass("flex-wrap");
  });

  it("exposes guarded project operations in the compact menu", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Project" }));
    const menu = screen.getByRole("region", { name: "Project operations" });
    expect(within(menu).getByRole("button", { name: "New" })).toBeVisible();
    expect(within(menu).getByRole("button", { name: "Open" })).toBeVisible();
    expect(within(menu).getByRole("button", { name: "Save" })).toBeVisible();

    await user.clear(screen.getByRole("textbox", { name: "Project name" }));
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Pocket map");
    await user.click(within(menu).getByRole("button", { name: "Rename" }));
    expect(useStore.getState().project.project.name).toBe("Pocket map");

    await user.click(screen.getAllByRole("button", { name: "New" })[1]);
    expect(screen.getByRole("dialog", { name: "Save changes first?" })).toBeVisible();
  });

  it("lets narrow-screen authors switch to the tree and dismiss the inspector", () => {
    const area = createRectArea(0, 0, 20, 20);
    useStore.getState().addArea(area);
    useStore.getState().setSelectedAreaId(area.id);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Inspector" }));
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveClass("fixed");
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveClass("hidden");
    expect(useStore.getState().selectedAreaId).toBe(area.id);

    fireEvent.click(screen.getByRole("button", { name: "Views & layers" }));
    expect(screen.getByRole("main", { name: "Views and layers workspace" })).toBeVisible();
    expect(useStore.getState().selectedAreaId).toBe(area.id);
  });
});
