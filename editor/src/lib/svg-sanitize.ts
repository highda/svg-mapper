const BLOCKED_TAGS = ["script", "iframe", "foreignObject"];
const EVENT_ATTR_RE = /^on[a-z]/i;

/**
 * Strips <script>, <iframe>, <foreignObject>, and all event-handler attributes
 * from raw SVG markup. Uses DOMParser so structural integrity is preserved.
 */
export function sanitizeSvg(markup: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, "image/svg+xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid SVG: parse error.");
  }

  // Remove blocked elements
  for (const tag of BLOCKED_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  }

  // Strip event-handler attributes from every element
  doc.querySelectorAll("*").forEach((el) => {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (EVENT_ATTR_RE.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return new XMLSerializer().serializeToString(doc.documentElement);
}
