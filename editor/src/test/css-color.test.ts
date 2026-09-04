import { describe, expect, it } from "vitest";
import { colorToHex, formatRgba, isValidCssColor, parseCssColor, withHexColor, withOpacity } from "../lib/css-color";

describe("CSS color utilities", () => {
  it.each([
    ["#0f08", { r: 0, g: 255, b: 0, a: 0.5333333333333333 }],
    ["#336699cc", { r: 51, g: 102, b: 153, a: 0.8 }],
    ["rgb(100% 0% 50% / 25%)", { r: 255, g: 0, b: 127, a: 0.25 }],
    ["rgba(12, 34, 56, 0.75)", { r: 12, g: 34, b: 56, a: 0.75 }],
    ["transparent", { r: 0, g: 0, b: 0, a: 0 }],
  ])("parses %s", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it("formats picker and opacity edits without losing the other component", () => {
    expect(colorToHex(parseCssColor("rgba(51,102,153,.4)")!)).toBe("#336699");
    expect(withHexColor("rgba(1,2,3,.4)", "#abcdef")).toBe("rgba(171,205,239,0.4)");
    expect(withOpacity("#336699", 0.37)).toBe("rgba(51,102,153,0.37)");
    expect(formatRgba({ r: 300, g: -2, b: 1.4, a: 2 })).toBe("rgba(255,0,1,1)");
  });

  it("rejects invalid input while accepting browser-supported named colors", () => {
    expect(isValidCssColor("definitely-not-a-color")).toBe(false);
    expect(isValidCssColor("rebeccapurple")).toBe(true);
  });
});
