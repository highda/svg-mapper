import type { Asset, AssetMimeType } from "@svg-mapper/shared";
import { sanitizeSvg } from "./svg-sanitize";

const ALLOWED_TYPES: AssetMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export function isAllowedAssetType(type: string): type is AssetMimeType {
  return (ALLOWED_TYPES as string[]).includes(type);
}

function makeAssetId(): string {
  return `asset_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads a File into an inline Asset. SVG files are sanitized and stored as raw markup
 * (encoded as a data URI). Raster files are stored as base64 data URIs.
 */
export async function importFileAsAsset(file: File): Promise<Asset> {
  if (!isAllowedAssetType(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type}". Accepted: PNG, JPG, WebP, SVG.`,
    );
  }

  if (file.type === "image/svg+xml") {
    const text = await file.text();
    const clean = sanitizeSvg(text);
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
    const dims = await getSvgDimensions(clean);
    return {
      id: makeAssetId(),
      type: "image/svg+xml",
      name: file.name,
      src,
      width: dims.width,
      height: dims.height,
      inline: true,
    };
  }

  const src = await fileToDataUri(file);
  const dims = await getRasterDimensions(src);
  return {
    id: makeAssetId(),
    type: file.type as AssetMimeType,
    name: file.name,
    src,
    width: dims.width,
    height: dims.height,
    inline: true,
  };
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function getRasterDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = src;
  });
}

function getSvgDimensions(markup: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, "image/svg+xml");
    const svg = doc.documentElement;
    const w = parseFloat(svg.getAttribute("width") ?? "0");
    const h = parseFloat(svg.getAttribute("height") ?? "0");
    if (w > 0 && h > 0) {
      resolve({ width: w, height: h });
      return;
    }
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/);
      const vw = parseFloat(parts[2] ?? "0");
      const vh = parseFloat(parts[3] ?? "0");
      if (vw > 0 && vh > 0) {
        resolve({ width: vw, height: vh });
        return;
      }
    }
    resolve({ width: 800, height: 600 });
  });
}
