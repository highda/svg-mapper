// Inspector controls for a marker's icon, size and scale mode (#219): a
// searchable gallery by category, uploaded icons (reusable by every marker in
// the project), and "apply to selection" for several markers at once.
import { useId, useRef, useState } from "react";
import type { Asset, MarkerGeometry, MarkerIcon, MarkerScaleMode } from "@svg-mapper/shared";
import { MARKER_PIN, MARKER_WIDTH, assetDisplaySource, markerIcon } from "@svg-mapper/shared";
import { useStore } from "../../store";
import { MIN_MARKER_SIZE } from "../../lib/area-utils";
import {
  GALLERY_CATEGORIES,
  findGalleryIcon,
  galleryIconEntry,
  importIconFile,
  makeIconKey,
  searchGalleryIcons,
} from "../../lib/marker-icons";

const fieldClass =
  "w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-blue-500";
const UPLOADED = "Uploaded";

function IconGlyph({ icon, assets, size = 20 }: { icon: MarkerIcon; assets: readonly Asset[]; size?: number }) {
  const asset = icon.assetId !== undefined ? assets.find((candidate) => candidate.id === icon.assetId) : undefined;
  return (
    <svg viewBox={`0 0 ${icon.width} ${icon.height}`} width={size} height={size} aria-hidden="true" className="shrink-0">
      {asset ? <image href={assetDisplaySource(asset.src)} width={icon.width} height={icon.height} /> : <path d={icon.d} fill="currentColor" />}
    </svg>
  );
}

export function MarkerIconSection({
  areaId,
  geometry,
  selectedMarkerIds,
}: {
  areaId: string;
  geometry: MarkerGeometry;
  /** Every selected marker, including `areaId`. */
  selectedMarkerIds: string[];
}) {
  const { project, addIcon, setMarkerIcon, updateMarkers } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const categoryId = useId();
  const sizeId = useId();
  const scaleId = useId();
  const noteId = useId();

  const icons = project.icons ?? {};
  const current = markerIcon(geometry, icons);
  const isImage = current.assetId !== undefined;
  const uploaded = Object.entries(icons).filter(([key]) => !findGalleryIcon(key));
  const words = query.trim().toLowerCase();
  const uploadedShown = !category || category === UPLOADED
    ? uploaded.filter(([, icon]) => !words || icon.name.toLowerCase().includes(words))
    : [];
  const galleryShown = category === UPLOADED ? [] : searchGalleryIcons(query, category || undefined);
  const others = selectedMarkerIds.length > 1;

  function pick(key: string | null, entry?: MarkerIcon) {
    setError("");
    setMarkerIcon([areaId], key === null ? null : { key, entry });
  }

  async function upload(file: File) {
    setError("");
    try {
      const { icon, asset } = await importIconFile(file);
      const key = makeIconKey();
      addIcon(key, icon, asset);
      setMarkerIcon([areaId], { key });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The icon could not be read.");
    }
  }

  const tile = (key: string | null, icon: MarkerIcon, entry?: MarkerIcon) => {
    const selected = (geometry.icon ?? null) === key || (key === null && current === MARKER_PIN);
    return (
      <li key={key ?? "pin"}>
        <button
          type="button"
          title={icon.name}
          aria-label={icon.name}
          aria-pressed={selected}
          data-icon-key={key ?? "pin"}
          onClick={() => pick(key, entry)}
          className={`flex h-8 w-8 items-center justify-center rounded border text-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
            selected ? "border-blue-400 bg-blue-900/60" : "border-neutral-700 bg-neutral-800 hover:bg-neutral-700"
          }`}
        >
          <IconGlyph icon={icon} assets={project.assets} />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2" data-testid="marker-icon-section">
      <div className="flex items-center gap-2 text-xs text-neutral-200">
        <span className="flex h-8 w-8 items-center justify-center rounded border border-neutral-700 bg-neutral-900">
          <IconGlyph icon={current} assets={project.assets} />
        </span>
        <span className="min-w-0 flex-1 truncate" data-testid="marker-icon-name">{current.name}</span>
        {geometry.icon !== undefined && (
          <button type="button" onClick={() => pick(null)} className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">
            Use pin
          </button>
        )}
      </div>
      {isImage && (
        <p id={noteId} className="text-xs text-amber-300">
          Image icons keep their own colours. Style states draw only an outline (stroke) around them, and disabled markers are faded.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label htmlFor={sizeId} className="text-[11px] text-neutral-400">Size (width)</label>
          <input
            key={geometry.size ?? "default"}
            id={sizeId}
            type="number"
            min={MIN_MARKER_SIZE}
            step={1}
            defaultValue={geometry.size ?? MARKER_WIDTH}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) updateMarkers([areaId], { size: Math.max(MIN_MARKER_SIZE, value) });
              else event.target.value = String(geometry.size ?? MARKER_WIDTH);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            className={fieldClass}
          />
        </div>
        <div className="space-y-0.5">
          <label htmlFor={scaleId} className="text-[11px] text-neutral-400">When zooming</label>
          <select
            id={scaleId}
            value={geometry.scaleMode ?? "map"}
            onChange={(event) => updateMarkers([areaId], { scaleMode: event.target.value === "screen" ? "screen" : undefined })}
            className={fieldClass}
          >
            <option value="map">Scale with map</option>
            <option value="screen">Keep screen size</option>
          </select>
        </div>
      </div>

      {others && (
        <button
          type="button"
          onClick={() => {
            const patch: Partial<Pick<MarkerGeometry, "size" | "scaleMode">> = { size: geometry.size, scaleMode: geometry.scaleMode as MarkerScaleMode | undefined };
            setMarkerIcon(selectedMarkerIds, geometry.icon === undefined ? null : { key: geometry.icon });
            updateMarkers(selectedMarkerIds, patch);
          }}
          className="w-full rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600"
        >
          Apply icon and size to {selectedMarkerIds.length} markers
        </button>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-0.5">
          <label htmlFor={searchId} className="text-[11px] text-neutral-400">Search icons</label>
          <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="toilet, café, exit…" className={fieldClass} />
        </div>
        <div className="space-y-0.5">
          <label htmlFor={categoryId} className="text-[11px] text-neutral-400">Category</label>
          <select id={categoryId} value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass}>
            <option value="">All</option>
            {GALLERY_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value={UPLOADED}>{UPLOADED} ({uploaded.length})</option>
          </select>
        </div>
      </div>

      <ul aria-label="Marker icons" className="flex max-h-56 flex-wrap gap-1 overflow-y-auto pr-1" data-testid="marker-icon-gallery">
        {!words && !category && tile(null, MARKER_PIN)}
        {uploadedShown.map(([key, icon]) => tile(key, icon))}
        {galleryShown.map((icon) => tile(icon.id, galleryIconEntry(icon), galleryIconEntry(icon)))}
      </ul>
      {uploadedShown.length === 0 && galleryShown.length === 0 && <p className="text-xs text-neutral-400">No icons match.</p>}

      <input
        ref={fileRef}
        type="file"
        accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
        className="hidden"
        data-testid="marker-icon-upload"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">
        Upload icon (SVG, PNG, WebP)…
      </button>
      <p className="text-[11px] text-neutral-500">
        Single-colour SVGs become recolourable path data; other SVGs and images keep their colours. Uploaded icons can be reused by any marker. Only icons in use are exported.
      </p>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
