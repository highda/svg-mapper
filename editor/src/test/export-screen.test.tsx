import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportScreen } from "../screens/ExportScreen";
import { createNewProject } from "../lib/project";
import { useStore } from "../store";

describe("ExportScreen failure handling", () => {
  beforeEach(() => {
    const project = createNewProject("Export UI");
    useStore.setState({ project, activeViewId: project.views[0].id });
  });

  it("offers manual copy and retry when clipboard permission is denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ExportScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Copy embed snippet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard access failed");
    expect((screen.getByRole("textbox", { name: "Copy embed snippet manual copy" }) as HTMLTextAreaElement).value).toContain("ClickMapRenderer.create");
    fireEvent.click(screen.getByRole("button", { name: "Retry copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  });

  it("reports packaging failures and allows a retry", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("Browser storage is full");
    });
    render(<ExportScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed: Browser storage is full");
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeEnabled();
    createObjectURL.mockRestore();
  });

  it("updates nested paths, container IDs, and sizing without packaging", () => {
    render(<ExportScreen />);
    fireEvent.change(screen.getByLabelText("Upload base path"), { target: { value: "/nested/maps/one" } });
    fireEvent.change(screen.getByLabelText("Container ID"), { target: { value: "map-one" } });
    fireEvent.change(screen.getByLabelText("Container sizing"), { target: { value: "viewport" } });

    const preview = screen.getByText((_, element) => element?.tagName === "PRE");
    expect(preview).toHaveTextContent("/nested/maps/one/map.json");
    expect(preview).toHaveTextContent("#map-one");
    expect(preview).toHaveTextContent("width: 100vw; height: 100vh");
  });
});
