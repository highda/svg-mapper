import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportScreen } from "../screens/ExportScreen";
import { createNewProject } from "../lib/project";
import { DEFAULT_EXPORT_SESSION_OPTIONS, useStore } from "../store";
import * as exportPackage from "../lib/export-package";

vi.mock("../lib/export-package", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export-package")>();
  return { ...actual, zipExportManifest: vi.fn(actual.zipExportManifest) };
});

describe("ExportScreen failure handling", () => {
  beforeEach(() => {
    const project = createNewProject("Export UI");
    useStore.setState({ project, activeViewId: project.views[0].id, exportOptions: { ...DEFAULT_EXPORT_SESSION_OPTIONS } });
    vi.mocked(exportPackage.zipExportManifest).mockClear();
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
    fireEvent.change(screen.getByLabelText(/Map sizing/), { target: { value: "fill-container" } });
    fireEvent.change(screen.getByLabelText("Host width"), { target: { value: "100vw" } });
    fireEvent.change(screen.getByLabelText("Host height"), { target: { value: "100vh" } });

    const preview = screen.getByText((_, element) => element?.tagName === "PRE");
    expect(preview).toHaveTextContent("/nested/maps/one/map.json");
    expect(preview).toHaveTextContent("#map-one");
    expect(preview).toHaveTextContent("width: 100vw; height: 100vh");
    // The choice is project data, so Preview and map.json use the same mode.
    expect(useStore.getState().project.settings.sizingMode).toBe("fill-container");
  });

  it("rejects a host size that is not a single CSS length", () => {
    render(<ExportScreen />);
    fireEvent.change(screen.getByLabelText(/Map sizing/), { target: { value: "fill-container" } });
    fireEvent.change(screen.getByLabelText("Host height"), { target: { value: "auto" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Host width and height must each be one CSS length");
  });

  it("discloses preserved external asset dependencies", () => {
    const project = createNewProject("External assets");
    project.assets = [{ id: "plan", type: "image/png", name: "Plan", src: "https://cdn.example.test/plan.png", width: 100, height: 100, inline: false }];
    useStore.setState({ project, activeViewId: project.views[0].id });

    render(<ExportScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("1 external asset dependency is preserved");
    expect(screen.getByRole("status")).toHaveTextContent("README.txt lists every dependency");
  });

  it("keeps deployment and asset options when the screen remounts (Reveal → fix → Export)", () => {
    const first = render(<ExportScreen />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Upload base path"), { target: { value: "/kept/path" } });
    fireEvent.change(screen.getByLabelText("Container ID"), { target: { value: "kept-map" } });
    first.unmount();

    render(<ExportScreen />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByLabelText("Upload base path")).toHaveValue("/kept/path");
    expect(screen.getByLabelText("Container ID")).toHaveValue("kept-map");
    expect(screen.getByText((_, element) => element?.tagName === "PRE")).toHaveTextContent("/kept/path/map.json");
  });

  it("starts one compression per submit and can cancel it, leaving export available", async () => {
    let rejectZip: (error: Error) => void = () => {};
    vi.mocked(exportPackage.zipExportManifest).mockImplementationOnce((_manifest, { signal } = {}) => new Promise((_resolve, reject) => {
      rejectZip = reject;
      signal?.addEventListener("abort", () => reject(new exportPackage.ExportCancelledError()));
    }));
    render(<ExportScreen />);
    const download = screen.getByRole("button", { name: "Download ZIP" });
    fireEvent.click(download);
    fireEvent.click(download);
    expect(exportPackage.zipExportManifest).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Packaging…" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Export cancelled");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeEnabled();
    rejectZip(new Error("late failure is ignored"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a compression worker failure and allows a retry", async () => {
    vi.mocked(exportPackage.zipExportManifest).mockRejectedValueOnce(new Error("Compression failed: worker crashed"));
    render(<ExportScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed: Compression failed: worker crashed");
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeEnabled();
  });
});
