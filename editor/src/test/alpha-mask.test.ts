import { describe, expect, it } from "vitest";
import { alphaBytesToHitMask, alphaMaskToSvgPath, MAX_ALPHA_MASK_DIMENSION } from "../lib/alpha-mask";

function rgba(alphas: number[]) {
  return new Uint8ClampedArray(alphas.flatMap((alpha) => [0, 0, 0, alpha]));
}

describe("alpha hit masks", () => {
  it("preserves sparse pixels and holes in deterministic row-major bits", () => {
    const mask = alphaBytesToHitMask("asset", rgba([255, 0, 255, 255]), 2, 2, 0.5);
    expect(mask.data).toBe("DQ==");
    expect(alphaMaskToSvgPath(mask, 0, 0, 20, 20)).toContain("M0 0h10v10h-10z");
    expect(alphaMaskToSvgPath(mask, 0, 0, 20, 20)).not.toContain("M10 0");
  });

  it("applies a configurable threshold to soft edges", () => {
    expect(alphaBytesToHitMask("asset", rgba([0, 127, 128, 255]), 4, 1, 0.5).data).toBe("DA==");
  });

  it("handles fully opaque and fully transparent fixtures", () => {
    expect(alphaBytesToHitMask("asset", rgba([255, 255, 255, 255]), 4, 1, 0.2).data).toBe("Dw==");
    expect(alphaBytesToHitMask("asset", rgba([0, 0, 0, 0]), 4, 1, 0).data).toBe("AA==");
  });

  it("keeps the documented performance bound", () => {
    expect(MAX_ALPHA_MASK_DIMENSION).toBe(128);
    const pixels = MAX_ALPHA_MASK_DIMENSION ** 2;
    const mask = alphaBytesToHitMask("asset", rgba(Array(pixels).fill(255)), 128, 128, 0.2);
    expect(atob(mask.data).length).toBe(2048);
  });
});
