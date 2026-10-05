// Per-view custom CSS, parsed by the browser's own CSS parser (CSSOM) and
// regenerated from the parsed rules (#168). Comments, strings, escapes and
// grouping rules are handled by the standards parser, not by text scanning.
// One function validates and scopes, so the editor, pre-export validation and
// the renderer always agree.
//
// Every selector is placed under the renderer instance; keyframes and cascade
// layer names are renamed per instance; animation references are renamed only
// in animation-name. Rules that could reach outside the map are rejected:
// resource-loading functions, global at-rules and nested rules.

const RESOURCE_FUNCTION = /\b(?:url|src|image|image-set|-webkit-image-set|cross-fade|element)\(/i;

// Rule kinds that are always global or load resources, by CSSOM interface name.
const BLOCKED_RULES: Record<string, string> = {
  CSSImportRule: "Imports and global resource rules are not supported.",
  CSSNamespaceRule: "Imports and global resource rules are not supported.",
  CSSFontFaceRule: "Imports and global resource rules are not supported.",
  CSSPageRule: "Imports and global resource rules are not supported.",
  CSSPropertyRule: "Imports and global resource rules are not supported.",
  CSSCounterStyleRule: "Imports and global resource rules are not supported.",
  CSSFontPaletteValuesRule: "Imports and global resource rules are not supported.",
  CSSFontFeatureValuesRule: "Imports and global resource rules are not supported.",
};

class ViewCssError extends Error {}

/** Decode CSS escapes so `u\72l(` and similar spellings are checked as what they mean. */
function decodeEscapes(text: string): string {
  return text
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    })
    .replace(/\\(.)/g, "$1");
}

function assertNoResources(declarations: string) {
  if (RESOURCE_FUNCTION.test(decodeEscapes(declarations))) {
    throw new ViewCssError("External and embedded CSS resources are not supported.");
  }
}

/** Split a browser-serialized selector list at top-level commas. */
function splitSelectors(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
    } else if (char === "\\") i += 1;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      selectors.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(value.slice(start).trim());
  return selectors;
}

/**
 * Place one selector inside the scope. Leading page roots (:root, html, body,
 * .clickmap-root) stand for the scope itself; everything else descends from it.
 */
function scopeSelector(selector: string, scope: string): string {
  const root = /^(?::root|html|body|\.clickmap-root)(?![\w-])/i;
  let rest = selector;
  let rooted = false;
  for (let match = root.exec(rest); match; match = root.exec(rest)) {
    rooted = true;
    rest = rest.slice(match[0].length);
    // "html body", "html > body": drop the combinator between two page roots.
    const between = /^\s*(?:>\s*)?/.exec(rest)![0];
    if (!root.test(rest.slice(between.length))) break;
    rest = rest.slice(between.length);
  }
  if (!rooted) return `${scope} ${selector}`;
  return `${scope}${rest}`;
}

function parseSheet(css: string): CSSStyleSheet {
  // An inert document parses the sheet without applying it or fetching anything.
  const doc = document.implementation.createHTMLDocument("");
  const style = doc.createElement("style");
  style.textContent = css;
  doc.head.append(style);
  if (style.sheet) return style.sheet;
  // Environments without sheets for inert documents (jsdom): a constructable
  // sheet parses the same way, but drops @import instead of exposing it.
  if (typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  }
  throw new ViewCssError("Custom CSS could not be parsed.");
}

function ruleKind(rule: CSSRule): string {
  return rule.constructor.name;
}

function atRuleName(rule: CSSRule): string {
  return rule.cssText.trim().split(/[\s{;(]/)[0] ?? "@";
}

interface Transform {
  scope: string;
  prefix: string;
  keyframes: Map<string, string>;
}

function renameLayers(names: string, prefix: string): string {
  return names.split(",").map((name) => `${prefix}-${name.trim()}`).join(", ");
}

function transformRules(rules: CSSRuleList, t: Transform): string {
  return Array.from(rules, (rule) => transformRule(rule, t)).join("\n");
}

function transformRule(rule: CSSRule, t: Transform): string {
  const kind = ruleKind(rule);
  const blocked = BLOCKED_RULES[kind];
  if (blocked) throw new ViewCssError(blocked);

  if (kind === "CSSStyleRule") {
    const styleRule = rule as CSSStyleRule;
    if (styleRule.cssRules && styleRule.cssRules.length > 0) throw new ViewCssError("Nested rules are not supported.");
    assertNoResources(styleRule.style.cssText);
    const names = styleRule.style.getPropertyValue("animation-name");
    if (names) {
      const renamed = names.split(",").map((name) => t.keyframes.get(name.trim()) ?? name.trim()).join(", ");
      if (renamed !== names) styleRule.style.setProperty("animation-name", renamed, styleRule.style.getPropertyPriority("animation-name"));
    }
    const selectors = splitSelectors(styleRule.selectorText).map((selector) => scopeSelector(selector, t.scope));
    return `${selectors.join(", ")} { ${styleRule.style.cssText} }`;
  }
  if (kind === "CSSKeyframesRule") {
    const keyframes = rule as CSSKeyframesRule;
    const frames = Array.from(keyframes.cssRules, (frame) => {
      assertNoResources((frame as CSSKeyframeRule).style.cssText);
      return frame.cssText;
    });
    return `@keyframes ${t.keyframes.get(keyframes.name)!} { ${frames.join(" ")} }`;
  }
  if (kind === "CSSMediaRule") {
    return `@media ${(rule as CSSMediaRule).media.mediaText} {\n${transformRules((rule as CSSMediaRule).cssRules, t)}\n}`;
  }
  if (kind === "CSSSupportsRule") {
    return `@supports ${(rule as CSSSupportsRule).conditionText} {\n${transformRules((rule as CSSSupportsRule).cssRules, t)}\n}`;
  }
  if (kind === "CSSContainerRule") {
    const container = rule as CSSGroupingRule & { conditionText: string };
    return `@container ${container.conditionText} {\n${transformRules(container.cssRules, t)}\n}`;
  }
  if (kind === "CSSLayerBlockRule") {
    // Layer names are document-global; prefix them so a map cannot reorder the host's layers.
    const layer = rule as CSSGroupingRule & { name: string };
    return `@layer ${layer.name ? `${renameLayers(layer.name, t.prefix)} ` : ""}{\n${transformRules(layer.cssRules, t)}\n}`;
  }
  if (kind === "CSSLayerStatementRule") {
    return `@layer ${renameLayers((rule as CSSRule & { nameList: string[] }).nameList.join(","), t.prefix)};`;
  }
  throw new ViewCssError(`Unsupported at-rule: ${atRuleName(rule)}.`);
}

function collectKeyframes(rules: CSSRuleList, prefix: string, into: Map<string, string>) {
  for (const rule of Array.from(rules)) {
    if (ruleKind(rule) === "CSSKeyframesRule") {
      const name = (rule as CSSKeyframesRule).name;
      into.set(name, `${prefix}-${name}`);
    } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
      collectKeyframes((rule as CSSGroupingRule).cssRules, prefix, into);
    }
  }
}

function hasContent(css: string): boolean {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "").trim() !== "";
}

/** Validate and scope view CSS in one pass. Requires a DOM (browser or jsdom). */
function processViewCss(css: string, scope: string): { css: string } | { error: string } {
  if (!hasContent(css)) return { css: "" };
  try {
    const sheet = parseSheet(css);
    if (sheet.cssRules.length === 0) return { error: "No valid CSS rules were found." };
    const prefix = scope.replace(/[^\w-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "clickmap";
    const keyframes = new Map<string, string>();
    collectKeyframes(sheet.cssRules, prefix, keyframes);
    return { css: transformRules(sheet.cssRules, { scope, prefix, keyframes }) };
  } catch (cause) {
    if (cause instanceof ViewCssError) return { error: cause.message };
    throw cause;
  }
}

/** The reason custom CSS would be rejected, or null when it can be applied. */
export function validateViewCss(css: string): string | null {
  const result = processViewCss(css, "[data-clickmap-instance=\"validate\"]");
  return "error" in result ? result.error : null;
}

/** Scope validated view CSS to one renderer root; throws with the validation message otherwise. */
export function scopeViewCss(css: string, scope: string): string {
  const result = processViewCss(css, scope);
  if ("error" in result) throw new Error(result.error);
  return result.css;
}
