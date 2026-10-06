// Marker icons in the editor (#219): the vendored gallery, and turning an
// uploaded file into a reusable icon. SVG uploads pass the shared artwork
// sanitizer first. A single-colour SVG made of basic shapes is reduced to path
// data, so style states recolour it; anything else (several colours, strokes,
// gradients, text, embedded images) is kept as a sanitized SVG asset and,
// like PNG and WebP icons, drawn as an image that cannot be recoloured.
import type { Asset, MarkerIcon } from "@svg-mapper/shared";
import {
  parsePathData,
  rectPathData,
  serializePathData,
  transformPathSegments,
  type AffineMatrix,
  type PathSegment,
} from "@svg-mapper/shared";
import { importFileAsAsset } from "./asset";
import { sanitizeSvg } from "./svg-sanitize";
import { GALLERY_ICON_SIZE, GALLERY_ICONS, type GalleryIcon } from "./icons/gallery";

export { GALLERY_CATEGORIES, GALLERY_ICONS, type GalleryCategory, type GalleryIcon } from "./icons/gallery";

/** Accepted icon uploads. */
export const ICON_UPLOAD_TYPES = ["image/svg+xml", "image/png", "image/webp"] as const;

export function findGalleryIcon(id: string): GalleryIcon | undefined {
  return GALLERY_ICONS.find((icon) => icon.id === id);
}

/** The `definition.icons` entry for a gallery icon; its key is the gallery id. */
export function galleryIconEntry(icon: GalleryIcon): MarkerIcon {
  return { name: icon.name, width: GALLERY_ICON_SIZE, height: GALLERY_ICON_SIZE, d: icon.d };
}

/** Case-insensitive search over name, id, category and keywords. */
export function searchGalleryIcons(query: string, category?: string): GalleryIcon[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return GALLERY_ICONS.filter((icon) => {
    if (category && icon.category !== category) return false;
    const haystack = `${icon.name} ${icon.id} ${icon.category} ${icon.keywords}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function makeIconKey(): string {
  return `icon_${Math.random().toString(36).slice(2, 10)}`;
}

// ── SVG → path data ─────────────────────────────────────────────────────────

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

function multiply(m: AffineMatrix, n: AffineMatrix): AffineMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** An SVG `transform` attribute as one matrix, or null when it cannot be read. */
export function parseTransformList(value: string | null): AffineMatrix | null {
  if (!value?.trim()) return IDENTITY;
  let matrix = IDENTITY;
  const pattern = /\s*,?\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gy;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(value))) {
    consumed = pattern.lastIndex;
    const n = match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.some((x) => !Number.isFinite(x))) return null;
    let next: AffineMatrix;
    switch (match[1]) {
      case "matrix":
        if (n.length !== 6) return null;
        next = n as unknown as AffineMatrix;
        break;
      case "translate":
        next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
        break;
      case "scale":
        next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((n[0] ?? 0) * Math.PI) / 180;
        const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
        next = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        next = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        next = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    matrix = multiply(matrix, next);
  }
  return value.slice(consumed).trim() ? null : matrix;
}

const CONTAINERS = new Set(["svg", "g", "title", "desc", "metadata"]);
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline"]);
/** Attributes that make a shape anything other than one flat colour. */
const UNREDUCIBLE_ATTRIBUTES = ["style", "class", "opacity", "fill-opacity", "mask", "clip-path", "filter"];

function num(el: Element, name: string): number {
  const value = Number(el.getAttribute(name) ?? 0);
  return Number.isFinite(value) ? value : NaN;
}

function shapePathData(el: Element): string | null {
  switch (el.localName) {
    case "path":
      return el.getAttribute("d") ?? "";
    case "rect": {
      const [x, y, w, h] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height")];
      const rx = el.hasAttribute("rx") ? num(el, "rx") : el.hasAttribute("ry") ? num(el, "ry") : 0;
      const ry = el.hasAttribute("ry") ? num(el, "ry") : rx;
      if (![x, y, w, h, rx, ry].every(Number.isFinite) || w <= 0 || h <= 0) return "";
      // Elliptical corners are not representable by rectPathData; keep them exact with arcs.
      if (rx !== ry) {
        const [cx, cy] = [Math.min(rx, w / 2), Math.min(ry, h / 2)];
        return `M${x + cx},${y}H${x + w - cx}A${cx},${cy} 0 0 1 ${x + w},${y + cy}V${y + h - cy}A${cx},${cy} 0 0 1 ${x + w - cx},${y + h}H${x + cx}A${cx},${cy} 0 0 1 ${x},${y + h - cy}V${y + cy}A${cx},${cy} 0 0 1 ${x + cx},${y}Z`;
      }
      return rectPathData(x, y, w, h, rx);
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [num(el, "cx"), num(el, "cy")];
      const rx = el.localName === "circle" ? num(el, "r") : num(el, "rx");
      const ry = el.localName === "circle" ? rx : num(el, "ry");
      if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return "";
      return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
    }
    case "polygon":
    case "polyline": {
      const n = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (n.length < 4 || n.some((v) => !Number.isFinite(v))) return "";
      const pairs: string[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pairs.push(`${n[i]},${n[i + 1]}`);
      // A filled polyline paints as if closed.
      return `M${pairs.join("L")}Z`;
    }
    default:
      return null;
  }
}

/** The icon box of an SVG root: its viewBox, else its width and height. */
function svgBox(root: Element): { x: number; y: number; width: number; height: number } | null {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { x: viewBox[0]!, y: viewBox[1]!, width: viewBox[2]!, height: viewBox[3]! };
  }
  const width = parseFloat(root.getAttribute("width") ?? "");
  const height = parseFloat(root.getAttribute("height") ?? "");
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

const isNone = (value: string | null) => value !== null && value.trim().toLowerCase() === "none";

/**
 * Reduce sanitized SVG markup to one path in a box with its origin at 0,0, or
 * null when that would change how it looks: several fill colours, strokes,
 * gradients or patterns, the even-odd fill rule, CSS, text, images or `<use>`.
 */
export function svgToIconPath(markup: string): { d: string; width: number; height: number } | null {
  const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  if (root.localName !== "svg") return null;
  const box = svgBox(root);
  if (!box) return null;
  const segments: PathSegment[] = [];
  const fills = new Set<string>();

  function visit(el: Element, parent: AffineMatrix): boolean {
    const name = el.localName;
    if (name === "title" || name === "desc" || name === "metadata") return true;
    if (!CONTAINERS.has(name) && !SHAPES.has(name)) return false;
    if (UNREDUCIBLE_ATTRIBUTES.some((attribute) => el.hasAttribute(attribute))) return false;
    const stroke = el.getAttribute("stroke");
    if (stroke !== null && !isNone(stroke)) return false;
    if (el.getAttribute("fill-rule") === "evenodd") return false;
    const fill = el.getAttribute("fill");
    if (fill !== null) {
      if (/url\(/i.test(fill)) return false;
      if (!isNone(fill)) fills.add(fill.trim().toLowerCase());
    }
    const own = name === "svg" ? IDENTITY : parseTransformList(el.getAttribute("transform"));
    if (!own) return false;
    const matrix = multiply(parent, own);
    if (SHAPES.has(name)) {
      if (isNone(fill) || (fill === null && isNone(el.closest("[fill]")?.getAttribute("fill") ?? null))) return true;
      const d = shapePathData(el);
      if (d === null) return false;
      try {
        segments.push(...transformPathSegments(parsePathData(d), matrix));
      } catch {
        return false;
      }
      return true;
    }
    return Array.from(el.children).every((child) => visit(child, matrix));
  }

  if (!visit(root, [1, 0, 0, 1, -box.x, -box.y]) || fills.size > 1 || segments.length === 0) return null;
  return { d: serializePathData(segments), width: box.width, height: box.height };
}

/**
 * Turn an uploaded file into an icon. SVG is sanitized and, where possible,
 * reduced to path data; otherwise the file becomes an asset (the returned
 * `asset`) that the icon references.
 */
export async function importIconFile(file: File): Promise<{ icon: MarkerIcon; asset?: Asset }> {
  if (!(ICON_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(`Unsupported icon type "${file.type || "unknown"}". Use SVG, PNG or WebP.`);
  }
  const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "Icon";
  if (file.type === "image/svg+xml") {
    const clean = sanitizeSvg(await file.text());
    const path = svgToIconPath(clean);
    if (path) return { icon: { name, ...path } };
  }
  const asset = await importFileAsAsset(file);
  return { icon: { name, width: asset.width, height: asset.height, assetId: asset.id }, asset };
}
