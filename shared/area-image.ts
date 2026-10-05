// One placement model for a rectangular area's foreground image, shared by the
// editor canvas (image + mask debug overlay) and the runtime renderer (image +
// alpha hit testing), so what is drawn and what is hit cannot drift apart.
//
// Image-local coordinates are the unit square over the asset's full intrinsic
// image: (0, 0) is its top-left pixel corner, (1, 1) its bottom-right. An alpha
// hit mask covers exactly that square. `toWorld` maps it into canvas units by
// fitting it inside the area rectangle (`fill`, `contain` or `cover`, centered,
// like SVG `preserveAspectRatio` xMidYMid meet/slice), then rotating it about
// the rectangle center. The rectangle is the image viewport: `cover` crops
// whatever falls outside it, before rotation (SVG <image> clips the same way).
import type { AlphaHitMask, Area, AreaImage } from "./types.js";
import { fitImageRect, type Rect } from "./scene-geometry.js";

export interface Point {
  x: number;
  y: number;
}

/** 2D affine matrix in SVG `matrix(a b c d e f)` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface AreaImagePlacement {
  /** The area rectangle: the image viewport and crop, before rotation. */
  frame: Rect;
  /** Where the whole intrinsic image is drawn inside the frame, before rotation. */
  content: Rect;
  /** Degrees, clockwise on screen, about the frame center. */
  rotation: number;
  /** Image-local unit square → canvas units. */
  toWorld: Affine;
  /** The visible (frame-clipped) part of the image, in image-local units. */
  clip: { u0: number; v0: number; u1: number; v1: number };
}

/**
 * `image.visible === false` hides the whole scene element: its image, its
 * hotspot shape, its label and its keyboard stop. Only the editor still shows
 * it, so authors can select it and turn it back on.
 */
export function isAreaHidden(area: Pick<Area, "image">): boolean {
  return area.image?.visible === false;
}

/** SVG `preserveAspectRatio` that draws an image the way `areaImagePlacement` places it. */
export function imagePreserveAspectRatio(fit: AreaImage["fit"]): string {
  return fit === "contain" ? "xMidYMid meet" : fit === "cover" ? "xMidYMid slice" : "none";
}

export function areaImagePlacement(
  frame: Rect,
  image: Pick<AreaImage, "fit" | "rotation">,
  intrinsic?: { width: number; height: number },
): AreaImagePlacement {
  const fit = image.fit ?? "fill";
  const sized = fit !== "fill" && intrinsic && intrinsic.width > 0 && intrinsic.height > 0;
  const placed = sized ? fitImageRect(frame, intrinsic, fit) : { x: 0, y: 0, width: frame.width, height: frame.height };
  const content = { x: frame.x + placed.x, y: frame.y + placed.y, width: placed.width, height: placed.height };
  const rotation = Number.isFinite(image.rotation) ? (image.rotation as number) : 0;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const toWorld: Affine = {
    a: cos * content.width,
    b: sin * content.width,
    c: -sin * content.height,
    d: cos * content.height,
    e: cx + cos * (content.x - cx) - sin * (content.y - cy),
    f: cy + sin * (content.x - cx) + cos * (content.y - cy),
  };
  const toUnit = (value: number, origin: number, size: number) => (size > 0 ? (value - origin) / size : 0);
  const clip = {
    u0: Math.max(0, toUnit(frame.x, content.x, content.width)),
    v0: Math.max(0, toUnit(frame.y, content.y, content.height)),
    u1: Math.min(1, toUnit(frame.x + frame.width, content.x, content.width)),
    v1: Math.min(1, toUnit(frame.y + frame.height, content.y, content.height)),
  };
  return { frame, content, rotation, toWorld, clip };
}

/** SVG `transform` for the image element (and the mask overlay), or undefined when unrotated. */
export function imageRotationTransform(placement: AreaImagePlacement): string | undefined {
  const { frame, rotation } = placement;
  return rotation ? `rotate(${rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})` : undefined;
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (!det || !Number.isFinite(det)) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Image-local unit coordinates of a canvas point, or null where no image pixel is displayed. */
export function worldToImageUnit(placement: AreaImagePlacement, world: Point): Point | null {
  const inverse = invertAffine(placement.toWorld);
  if (!inverse) return null;
  const p = applyAffine(inverse, world);
  const { u0, v0, u1, v1 } = placement.clip;
  return p.x >= u0 && p.x < u1 && p.y >= v0 && p.y < v1 ? p : null;
}

// Decoded masks are cached by their data so pointer moves never re-decode or
// read pixels. The cache is bounded; the oldest entry is evicted first.
const MASK_CACHE_LIMIT = 64;
const maskCache = new Map<string, Uint8Array | null>();

/**
 * The mask's bits (one per pixel, row-major, least significant bit first), or
 * null when the data cannot be decoded or has the wrong length. Callers fall
 * back to the rectangular hit area on null.
 */
export function decodeAlphaMask(mask: AlphaHitMask): Uint8Array | null {
  const key = `${mask.width}x${mask.height}:${mask.data}`;
  if (maskCache.has(key)) {
    const cached = maskCache.get(key) ?? null;
    maskCache.delete(key);
    maskCache.set(key, cached);
    return cached;
  }
  let bits: Uint8Array | null = null;
  try {
    const binary = atob(mask.data);
    const valid = mask.width >= 1 && mask.height >= 1 && Number.isInteger(mask.width) && Number.isInteger(mask.height);
    if (valid && binary.length === Math.ceil((mask.width * mask.height) / 8)) {
      bits = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bits[i] = binary.charCodeAt(i);
    }
  } catch {
    bits = null;
  }
  if (maskCache.size >= MASK_CACHE_LIMIT) maskCache.delete(maskCache.keys().next().value as string);
  maskCache.set(key, bits);
  return bits;
}

/** Number of decoded masks currently cached (bounded by an internal limit). */
export function alphaMaskCacheSize(): number {
  return maskCache.size;
}

function maskBit(bits: Uint8Array, mask: AlphaHitMask, col: number, row: number): boolean {
  const index = row * mask.width + col;
  return ((bits[index >> 3]! >> (index & 7)) & 1) !== 0;
}

/**
 * Pixel hit test for an area image's alpha mask at a canvas point: true on a
 * displayed opaque pixel, false elsewhere (transparent, cropped away or outside
 * the rotated image). Null means there is no usable mask, so the caller uses
 * the area's rectangular shape instead.
 */
export function alphaMaskHit(placement: AreaImagePlacement, mask: AlphaHitMask, world: Point): boolean | null {
  const bits = decodeAlphaMask(mask);
  if (!bits) return null;
  const unit = worldToImageUnit(placement, world);
  if (!unit) return false;
  const col = Math.min(mask.width - 1, Math.floor(unit.x * mask.width));
  const row = Math.min(mask.height - 1, Math.floor(unit.y * mask.height));
  return maskBit(bits, mask, col, row);
}

/**
 * Canvas-unit SVG path covering the displayed opaque mask cells, already
 * fitted, cropped to the frame and rotated, for the editor's debug overlay.
 * Horizontal runs of opaque cells become one quadrilateral each.
 */
export function alphaMaskWorldPath(placement: AreaImagePlacement, mask: AlphaHitMask): string {
  const bits = decodeAlphaMask(mask);
  if (!bits) return "";
  const { u0, v0, u1, v1 } = placement.clip;
  const parts: string[] = [];
  const point = (u: number, v: number) => {
    const p = applyAffine(placement.toWorld, { x: u, y: v });
    return `${round(p.x)} ${round(p.y)}`;
  };
  for (let row = 0; row < mask.height; row++) {
    const top = Math.max(v0, row / mask.height);
    const bottom = Math.min(v1, (row + 1) / mask.height);
    if (bottom <= top) continue;
    for (let col = 0; col < mask.width; col++) {
      if (!maskBit(bits, mask, col, row)) continue;
      let end = col + 1;
      while (end < mask.width && maskBit(bits, mask, end, row)) end++;
      const left = Math.max(u0, col / mask.width);
      const right = Math.min(u1, end / mask.width);
      if (right > left) parts.push(`M${point(left, top)}L${point(right, top)}L${point(right, bottom)}L${point(left, bottom)}Z`);
      col = end - 1;
    }
  }
  return parts.join("");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
