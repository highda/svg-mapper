import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../App";
import { createRectArea } from "../lib/area-utils";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";

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
    expect(screen.getByLabelText("Active fill opacity")).toHaveValue("35");
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
});
