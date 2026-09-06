import type { Area, ProjectFile, View } from "@svg-mapper/shared";
import { createNewProject } from "./project";

export type StarterProjectId = "property" | "park" | "campus";

export const STARTER_PROJECTS: { id: StarterProjectId; name: string; description: string }[] = [
  { id: "property", name: "Property floors", description: "Three linked floors with available spaces and accessible details." },
  { id: "park", name: "Park attractions", description: "A touch-friendly illustrated park map with attraction popups." },
  { id: "campus", name: "Campus places", description: "Two linked buildings with searchable services and rooms." },
];

const style = {
  default: { fill: "rgba(37,99,235,.12)", stroke: "#2563eb", strokeWidth: 3 },
  hover: { fill: "rgba(37,99,235,.3)", stroke: "#1d4ed8", strokeWidth: 4 },
  active: { fill: "rgba(16,185,129,.35)", stroke: "#047857", strokeWidth: 4 },
};

function svgBackground(title: string, accent: string, variant: "rooms" | "park" | "campus") {
  const decoration = variant === "park"
    ? '<path d="M0 360Q180 260 360 350T720 300V480H0Z" fill="#bbf7d0"/><circle cx="135" cy="145" r="55" fill="#86efac"/><circle cx="560" cy="155" r="72" fill="#a7f3d0"/><path d="M80 420Q330 190 650 390" fill="none" stroke="#fde68a" stroke-width="34"/>'
    : '<path d="M70 105H650V400H70Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="5"/><path d="M260 105V400M465 105V400M70 250H650" stroke="#cbd5e1" stroke-width="4"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480"><rect width="720" height="480" fill="#eef2ff"/><rect width="720" height="72" fill="${accent}"/><text x="32" y="47" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="white">${title}</text>${decoration}</svg>`;
}

function area(id: string, name: string, x: number, y: number, action: Area["action"], metadata: Record<string, unknown>): Area {
  return {
    id, name, geometry: { type: "rect", x, y, width: 150, height: 105, rx: 10 }, style, action,
    tooltip: { enabled: true, title: name, body: String(metadata.description ?? "Select for details") },
    accessibility: { ariaLabel: `${name}. ${String(metadata.description ?? "Open details")}`, tabIndex: 0 },
    metadata,
  };
}

function view(id: string, name: string, assetId: string, areas: Area[]): View {
  return {
    id, name, slug: id.replace("view-", ""), canvas: { width: 720, height: 480 },
    background: { assetId, fit: "contain", position: { x: .5, y: .5 } },
    viewport: { minZoom: 1, maxZoom: 3, initialZoom: 1, panEnabled: true, zoomEnabled: true },
    ui: { showBackButton: true, showBreadcrumbs: true, showTitle: true },
    layers: [{ id: `layer-${id}`, name: "Places", visible: true, locked: false, opacity: 1, areas }],
  };
}

export function createStarterProject(id: StarterProjectId): ProjectFile {
  const project = createNewProject(STARTER_PROJECTS.find((item) => item.id === id)!.name);
  const stamp = new Date().toISOString();
  const names = id === "property" ? ["Ground floor", "First floor", "Second floor"] : id === "campus" ? ["Main building", "Library"] : ["Park map"];
  const accent = id === "park" ? "#15803d" : id === "campus" ? "#7c3aed" : "#1d4ed8";
  project.project = { ...project.project, id: `sample-${id}`, createdAt: stamp, updatedAt: stamp };
  project.assets = names.map((name, index) => ({
    id: `asset-${id}-${index}`, type: "image/svg+xml" as const, name: `${name} plan`,
    src: svgBackground(name, accent, id === "park" ? "park" : id === "campus" ? "campus" : "rooms"), width: 720, height: 480, inline: true,
  }));
  project.views = names.map((name, index) => {
    const next = names[(index + 1) % names.length];
    const nextId = `view-${id}-${(index + 1) % names.length}`;
    const firstAction: Area["action"] = names.length > 1
      ? { type: "goToView", targetViewId: nextId, transition: "fade" }
      : { type: "popup", content: { title: "Lakeside café", body: "<p>Open daily, with step-free access.</p>" }, position: "auto" };
    return view(`view-${id}-${index}`, name, `asset-${id}-${index}`, [
      area(`area-${id}-${index}-a`, id === "property" ? "Available suite" : id === "park" ? "Lakeside café" : "Visitor reception", 90, 125, firstAction, { category: "featured", description: names.length > 1 ? `Go to ${next}` : "Food, drinks and accessible seating" }),
      area(`area-${id}-${index}-b`, id === "property" ? "Meeting room" : id === "park" ? "Adventure playground" : "Accessible services", 475, 270, { type: "popup", content: { title: "Visitor details", body: "<p>Wheelchair accessible. Select Close to return to the map.</p>" } }, { category: "services", description: "Wheelchair accessible visitor information" }),
    ]);
  });
  project.settings = {
    ...project.settings, initialViewId: project.views[0].id,
    sceneSwitcher: { enabled: names.length > 1, position: "bottom-center", style: "buttons" },
    zoomControls: { enabled: true, position: "bottom-right", step: .25, resetBehavior: "initial", wheelMode: "ctrl" },
    directory: { enabled: true, metadataKeys: ["description"], categoryKey: "category", categories: [{ value: "featured", label: "Featured" }, { value: "services", label: "Services" }] },
    areaLabels: { enabled: true, fontSize: 15, color: "#0f172a", hideWhenSmaller: true },
  };
  return project;
}
