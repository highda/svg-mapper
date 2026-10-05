import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../App";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";
import { useStylePreview } from "../store/style-preview";

describe("area color inspector", () => {
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
    const area = createRectArea(10, 10, 100, 80);
    area.style = { ...area.style, disabled: { fill: "transparent", stroke: "#123456", strokeWidth: 1 } };
    useStore.getState().addArea(area);
    useStore.getState().setSelectedAreaId(area.id);
  });

  function selectedArea() {
    return useStore.getState().project.views[0].layers[0].areas[0];
  }

  it("offers labelled picker, exact text, and opacity controls for every style state", () => {
    render(<App />);

    expect(screen.getByLabelText("Default fill color picker")).toHaveValue("#3b82f6");
    expect(screen.getByLabelText("Hover stroke CSS color")).toHaveValue("rgba(59,130,246,0.9)");
    expect(screen.getByLabelText("Active fill opacity")).toHaveValue("45");
    expect(screen.getByLabelText("Disabled fill CSS color")).toHaveValue("transparent");
  });

  it("updates picker and opacity values immediately", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Default fill color picker"), { target: { value: "#ff0080" } });
    expect(selectedArea().style.default.fill).toBe("rgba(255,0,128,0.08)");

    fireEvent.change(screen.getByLabelText("Default fill opacity"), { target: { value: "42" } });
    expect(selectedArea().style.default.fill).toBe("rgba(255,0,128,0.42)");
  });

  it("identifies invalid exact input without overwriting the saved color, then recovers", () => {
    render(<App />);
    const field = screen.getByLabelText("Default stroke CSS color");
    const original = selectedArea().style.default.stroke;

    fireEvent.change(field, { target: { value: "not-a-color" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("saved value is unchanged");
    fireEvent.blur(field);
    expect(selectedArea().style.default.stroke).toBe(original);

    fireEvent.change(field, { target: { value: "#abcdef80" } });
    fireEvent.blur(field);
    expect(selectedArea().style.default.stroke).toBe("#abcdef80");
  });
  it("previews the Active (selected) and Hover states of the selected area on the canvas", () => {
    const { unmount } = render(<App />);
    const area = selectedArea();
    const shape = () => document.querySelector(`path[stroke-width="${area.style.active.strokeWidth}"][fill="${area.style.active.fill}"]`);
    const picker = screen.getByRole("group", { name: "Canvas style preview" });
    expect(within(picker).getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "true");
    expect(shape()).toBeNull();

    fireEvent.click(within(picker).getByRole("button", { name: "Active" }));
    expect(within(picker).getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    expect(shape()).not.toBeNull();
    expect(screen.getByText(/Selected: shown after a visitor chooses the area/)).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole("button", { name: "Hover" }));
    expect(shape()).toBeNull();
    expect(document.querySelector(`path[fill="${area.style.hover.fill}"]`)).not.toBeNull();

    // The preview is ephemeral: leaving the inspected selection resets it.
    unmount();
    expect(useStylePreview.getState().state).toBe("default");
  });
});
