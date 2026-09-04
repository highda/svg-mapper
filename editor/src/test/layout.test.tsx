import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../App";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";

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
});
