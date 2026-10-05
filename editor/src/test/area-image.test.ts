import { describe, expect, it } from "vitest";
import {
  alphaMaskCacheSize,
  alphaMaskHit,
  alphaMaskWorldPath,
  applyAffine,
  areaImagePlacement,
  decodeAlphaMask,
  imagePreserveAspectRatio,
  imageRotationTransform,
  invertAffine,
  isAreaHidden,
  worldToImageUnit,
  type AlphaHitMask,
} from "@svg-mapper/shared";
import { alphaBytesToHitMask } from "../lib/alpha-mask";

// 2×2 mask, row-major: top-left opaque, top-right transparent, bottom row opaque.
const MASK: AlphaHitMask = { mode: "alpha", assetId: "a", threshold: 0.5, width: 2, height: 2, data: "DQ==" };
const frame = { x: 100, y: 50, width: 200, height: 100 };

function close(p: { x: number; y: number } | null, x: number, y: number) {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 6);
  expect(p!.y).toBeCloseTo(y, 6);
}

describe("area image placement", () => {
  it("fill stretches the whole image over the rectangle", () => {
    const placement = areaImagePlacement(frame, { fit: "fill" }, { width: 50, height: 50 });
    expect(placement.content).toEqual(frame);
    close(applyAffine(placement.toWorld, { x: 0, y: 0 }), 100, 50);
    close(applyAffine(placement.toWorld, { x: 1, y: 1 }), 300, 150);
    expect(imagePreserveAspectRatio("fill")).toBe("none");
    expect(imagePreserveAspectRatio(undefined)).toBe("none");
  });

  it("contain letterboxes a square image in the center, leaving empty bands unhittable", () => {
    const placement = areaImagePlacement(frame, { fit: "contain" }, { width: 50, height: 50 });
    expect(placement.content).toEqual({ x: 150, y: 50, width: 100, height: 100 });
    expect(imagePreserveAspectRatio("contain")).toBe("xMidYMid meet");
    // Left letterbox band: inside the rectangle, outside the image.
    expect(worldToImageUnit(placement, { x: 120, y: 100 })).toBeNull();
    close(worldToImageUnit(placement, { x: 175, y: 75 }), 0.25, 0.25);
    expect(alphaMaskHit(placement, MASK, { x: 175, y: 75 })).toBe(true);
    expect(alphaMaskHit(placement, MASK, { x: 225, y: 75 })).toBe(false);
    expect(alphaMaskHit(placement, MASK, { x: 120, y: 75 })).toBe(false);
  });

  it("cover scales past the rectangle and crops what falls outside it", () => {
    const placement = areaImagePlacement(frame, { fit: "cover" }, { width: 50, height: 50 });
    expect(placement.content).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(imagePreserveAspectRatio("cover")).toBe("xMidYMid slice");
    expect(placement.clip).toEqual({ u0: 0, v0: 0.25, u1: 1, v1: 0.75 });
    // Above the rectangle the image is cropped away even though the mask is opaque there.
    expect(worldToImageUnit(placement, { x: 150, y: 20 })).toBeNull();
    expect(alphaMaskHit(placement, MASK, { x: 150, y: 20 })).toBe(false);
    expect(alphaMaskHit(placement, MASK, { x: 150, y: 60 })).toBe(true);
    expect(alphaMaskHit(placement, MASK, { x: 250, y: 60 })).toBe(false);
    expect(alphaMaskHit(placement, MASK, { x: 250, y: 140 })).toBe(true);
  });

  it("rotates image-local coordinates about the rectangle center", () => {
    const square = { x: 0, y: 0, width: 100, height: 100 };
    const placement = areaImagePlacement(square, { fit: "fill", rotation: 90 });
    expect(imageRotationTransform(placement)).toBe("rotate(90 50 50)");
    // Clockwise on screen: the image's top-left corner lands at the top-right.
    close(applyAffine(placement.toWorld, { x: 0, y: 0 }), 100, 0);
    close(applyAffine(placement.toWorld, { x: 1, y: 0 }), 100, 100);
    // The transparent top-right quadrant of the image is now bottom-right.
    expect(alphaMaskHit(placement, MASK, { x: 75, y: 75 })).toBe(false);
    expect(alphaMaskHit(placement, MASK, { x: 75, y: 25 })).toBe(true);
    expect(alphaMaskHit(placement, MASK, { x: 25, y: 75 })).toBe(true);
  });

  it("hits rotated pixels that extend beyond the unrotated rectangle", () => {
    const placement = areaImagePlacement({ x: 0, y: 0, width: 100, height: 100 }, { rotation: 45 });
    // Image top-left corner after a 45° turn sits above the rectangle.
    const corner = applyAffine(placement.toWorld, { x: 0.02, y: 0.02 });
    expect(corner.y).toBeLessThan(0);
    expect(alphaMaskHit(placement, MASK, corner)).toBe(true);
    // The rectangle's own corner is outside the rotated image.
    expect(alphaMaskHit(placement, MASK, { x: 2, y: 2 })).toBe(false);
  });

  it("round-trips through the inverse transform for every fit and angle", () => {
    for (const fit of ["fill", "contain", "cover"] as const) {
      for (const rotation of [0, 17, 90, 180, -135]) {
        const placement = areaImagePlacement(frame, { fit, rotation }, { width: 30, height: 70 });
        const inverse = invertAffine(placement.toWorld)!;
        const u = { x: 0.5, y: 0.5 };
        close(applyAffine(inverse, applyAffine(placement.toWorld, u)), 0.5, 0.5);
        // The image center always stays at the rectangle center.
        close(applyAffine(placement.toWorld, u), 200, 100);
      }
    }
  });

  it("falls back to fill geometry without intrinsic dimensions", () => {
    expect(areaImagePlacement(frame, { fit: "contain" }).content).toEqual(frame);
    expect(areaImagePlacement(frame, { fit: "cover" }, { width: 0, height: 0 }).content).toEqual(frame);
  });

  it("returns a rectangular fallback (null) for undecodable masks", () => {
    const placement = areaImagePlacement(frame, {});
    expect(alphaMaskHit(placement, { ...MASK, data: "!!!" }, { x: 150, y: 75 })).toBeNull();
    expect(alphaMaskHit(placement, { ...MASK, width: 8, height: 8 }, { x: 150, y: 75 })).toBeNull();
    expect(alphaMaskWorldPath(placement, { ...MASK, data: "!!!" })).toBe("");
  });

  it("keeps decoded masks in a bounded cache", () => {
    for (let i = 0; i < 200; i++) {
      decodeAlphaMask(alphaBytesToHitMask("a", new Uint8ClampedArray([0, 0, 0, i]), 1, 1, 0.5));
      decodeAlphaMask({ ...MASK, data: btoa(String.fromCharCode(i)) });
    }
    expect(alphaMaskCacheSize()).toBeLessThanOrEqual(64);
  });

  it("draws the debug overlay through the same fitted, cropped and rotated transform", () => {
    const contain = areaImagePlacement(frame, { fit: "contain" }, { width: 50, height: 50 });
    // Top row: one opaque cell at the image's top-left (150..200 × 50..100).
    expect(alphaMaskWorldPath(contain, MASK)).toContain("M150 50L200 50L200 100L150 100Z");
    // Bottom row merges into one run.
    expect(alphaMaskWorldPath(contain, MASK)).toContain("M150 100L250 100L250 150L150 150Z");

    const cover = areaImagePlacement(frame, { fit: "cover" }, { width: 50, height: 50 });
    // Cells are cropped to the rectangle's top and bottom edges.
    expect(alphaMaskWorldPath(cover, MASK)).toContain("M100 50L200 50L200 100L100 100Z");
    expect(alphaMaskWorldPath(cover, MASK)).toContain("M100 100L300 100L300 150L100 150Z");

    const rotated = areaImagePlacement({ x: 0, y: 0, width: 100, height: 100 }, { rotation: 90 });
    expect(alphaMaskWorldPath(rotated, MASK)).toContain("M100 0L100 50L50 50L50 0Z");
  });

  it("treats visible: false as hiding the scene element", () => {
    expect(isAreaHidden({ image: { assetId: "a", visible: false } })).toBe(true);
    expect(isAreaHidden({ image: { assetId: "a" } })).toBe(false);
    expect(isAreaHidden({})).toBe(false);
  });
});
