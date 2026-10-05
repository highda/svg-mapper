// Markup sanitization for untrusted map content, built on DOMPurify (#167).
// Two profiles, each with its own DOMPurify instance so hooks never leak
// between them:
//   - rich HTML for tooltip/popup bodies inserted into the host page;
//   - SVG artwork for imported and exported SVG files.
// Safe HTML is not CSS isolation: the HTML profile removes everything that
// could style or control the host page (<style>, <link>, <base>, forms,
// style/id/name attributes), not only scripts.
import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";
import { validateActionUrl } from "./validation.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Rich HTML (tooltips, popups, content templates)
// ---------------------------------------------------------------------------

const HTML_URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "cite", "background"]);

const HTML_CONFIG: Config = {
  USE_PROFILES: { html: true },
  // Page-level and interactive controls, embedded documents and foreign content.
  FORBID_TAGS: [
    "style", "link", "base", "meta", "title", "form", "input", "button", "select", "option", "optgroup",
    "textarea", "label", "fieldset", "output", "iframe", "frame", "frameset", "object", "embed", "applet",
    "dialog", "template", "slot", "svg", "math", "audio", "video", "source", "track", "picture", "noscript",
  ],
  // Styling and identity attributes: no host styling, no id/name collisions between instances.
  FORBID_ATTR: ["style", "id", "name", "srcset", "sizes", "formaction", "action", "autofocus", "tabindex", "popover", "slot", "is"],
  ADD_ATTR: ["target"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
};

let htmlPurifier: Purifier | undefined;

function richHtmlPurifier(): Purifier {
  if (htmlPurifier) return htmlPurifier;
  const purifier = DOMPurify(window);
  // The application's URL policy (browser-normalized, see validateActionUrl):
  // DOMPurify's own URI rules are not the same policy.
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (HTML_URL_ATTRS.has(data.attrName) && !validateActionUrl(data.attrValue).valid) data.keepAttr = false;
  });
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof Element && node.tagName === "A" && node.hasAttribute("target")) {
      if (node.getAttribute("target") === "_blank") node.setAttribute("rel", "noopener noreferrer");
      else node.removeAttribute("target");
    }
  });
  htmlPurifier = purifier;
  return purifier;
}

/**
 * Sanitizes untrusted rich HTML into a fragment owned by `doc`. Insert the
 * fragment directly; never serialize it and re-parse it as HTML.
 */
export function sanitizeRichHtml(raw: string, doc: Document = document): DocumentFragment {
  const fragment = richHtmlPurifier().sanitize(raw, { ...HTML_CONFIG, RETURN_DOM_FRAGMENT: true });
  return doc === fragment.ownerDocument ? fragment : (doc.importNode(fragment, true) as DocumentFragment);
}

// ---------------------------------------------------------------------------
// SVG artwork (import and export of SVG files)
// ---------------------------------------------------------------------------

const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["use"],
  FORBID_TAGS: ["foreignObject", "script", "a", "animate", "set", "animateMotion", "animateTransform", "discard", "handler", "listener"],
  ALLOW_DATA_ATTR: false,
  IN_PLACE: true,
};

// Resource references may only point inside the document or at embedded raster images.
function allowedSvgReference(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("#") || /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i.test(trimmed);
}

// CSS may not import or fetch anything outside the document.
function scrubCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote: string, target: string) => (allowedSvgReference(target) ? match : "none"));
}

let svgPurifier: Purifier | undefined;

function artworkPurifier(): Purifier {
  if (svgPurifier) return svgPurifier;
  const purifier = DOMPurify(window);
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    const name = data.attrName.toLowerCase();
    if ((name === "href" || name === "xlink:href") && !allowedSvgReference(data.attrValue)) data.keepAttr = false;
    else if (name === "style") data.attrValue = scrubCss(data.attrValue);
  });
  purifier.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "style" && node.textContent) node.textContent = scrubCss(node.textContent);
  });
  svgPurifier = purifier;
  return purifier;
}

function parseSvgDocument(markup: string): Element {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("Invalid SVG: parse error.");
  return doc.documentElement;
}

function parseSvgRoot(markup: string): Element {
  let root = parseSvgDocument(markup);
  // Hand-written markup often omits xmlns; such a root is still meant as SVG.
  // A root in any other namespace is malformed and rejected.
  if (root.localName === "svg" && root.namespaceURI === null) {
    root = parseSvgDocument(markup.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`));
  }
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
    throw new Error("Invalid SVG: the root must be an <svg> element in the SVG namespace.");
  }
  return root;
}

/**
 * Sanitizes untrusted SVG artwork and returns standalone SVG markup. Throws a
 * descriptive error when the input is not a well-formed SVG document.
 */
export function sanitizeSvgMarkup(markup: string): string {
  const root = parseSvgRoot(markup);
  artworkPurifier().sanitize(root, SVG_CONFIG);
  return new XMLSerializer().serializeToString(parseSvgRoot(new XMLSerializer().serializeToString(root)));
}
