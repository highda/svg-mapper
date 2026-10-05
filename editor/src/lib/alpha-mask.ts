import type { AlphaHitMask, Asset } from "@svg-mapper/shared";

// One limit for the editor generator and the shared decoder.
export { MAX_ALPHA_MASK_DIMENSION } from "@svg-mapper/shared";
import { MAX_ALPHA_MASK_DIMENSION } from "@svg-mapper/shared";

export async function createAlphaHitMask(
  asset: Asset,
  threshold = 0.2,
): Promise<AlphaHitMask> {
  if (asset.type !== "image/png" && asset.type !== "image/webp") {
    throw new Error("Alpha hit testing supports static PNG and WebP images only.");
  }
  const scale = Math.min(1, MAX_ALPHA_MASK_DIMENSION / Math.max(asset.width, asset.height));
  const width = Math.max(1, Math.round(asset.width * scale));
  const height = Math.max(1, Math.round(asset.height * scale));
  const image = await loadImage(asset.src);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas pixel access is unavailable; using rectangular fallback.");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  let rgba: Uint8ClampedArray;
  try {
    rgba = context.getImageData(0, 0, width, height).data;
  } catch {
    throw new Error("Image pixels are unavailable (possibly CORS); using rectangular fallback.");
  }
  return alphaBytesToHitMask(asset.id, rgba, width, height, threshold);
}

export function alphaBytesToHitMask(assetId: string, rgba: Uint8ClampedArray, width: number, height: number, threshold: number): AlphaHitMask {
  const bytes = new Uint8Array(Math.ceil((width * height) / 8));
  const cutoff = Math.max(1, Math.round(Math.max(0, Math.min(1, threshold)) * 255));
  for (let i = 0; i < width * height; i++) {
    if ((rgba[i * 4 + 3] ?? 0) >= cutoff) bytes[i >> 3] |= 1 << (i & 7);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { mode: "alpha", assetId, threshold, width, height, data: btoa(binary) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be decoded; using rectangular fallback."));
    image.src = src;
  });
}
