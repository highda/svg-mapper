import { sanitizeSvgMarkup } from "@svg-mapper/shared";

/**
 * Sanitizes imported SVG artwork with the shared DOMPurify SVG profile (#167):
 * validates an SVG-namespace root, removes scripts, foreignObject, event
 * handlers and external resource references. Throws "Invalid SVG: …" errors.
 */
export function sanitizeSvg(markup: string): string {
  return sanitizeSvgMarkup(markup);
}
