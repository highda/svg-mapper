import "@testing-library/jest-dom";
if (typeof globalThis.ResizeObserver === "undefined") {
  // jsdom has no layout; the resizable panel group only needs the API to exist.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom reports every box at (0, 0), so each simulated click would also land
// on a panel separator's hit area and move focus there. Real separators sit
// between panels; park them away from the origin.
const boundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  return this.hasAttribute("data-separator") ? new DOMRect(-10_000, -10_000, 4, 0) : boundingClientRect.call(this);
};
