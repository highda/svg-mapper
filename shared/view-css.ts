const BLOCKED_AT_RULES = /@(?:import|namespace|charset|font-face|page|property)\b/i;

export function validateViewCss(css: string): string | null {
  if (!css.trim()) return null;
  if (/\/\*[\s\S]*$/.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) return "Unclosed comment.";
  if (BLOCKED_AT_RULES.test(css)) return "Imports and global resource rules are not supported.";
  if (/\burl\s*\(/i.test(css)) return "External and embedded CSS resources are not supported.";
  const atRules = css.match(/@[-\w]+/g) ?? [];
  const unsupportedAtRule = atRules.find((rule) => !/^@(?:media|supports|container|layer|(?:-webkit-)?keyframes)$/i.test(rule));
  if (unsupportedAtRule) return `Unsupported at-rule: ${unsupportedAtRule}.`;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth < 0) return "Unexpected closing brace.";
  }
  if (quote) return "Unclosed string.";
  if (depth) return "Unclosed rule block.";
  return null;
}

function findBlockEnd(css: string, start: number): number {
  let depth = 1;
  let quote = "";
  for (let i = start + 1; i < css.length; i += 1) {
    const char = css[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

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
    } else if (char === '"' || char === "'") quote = char;
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

/** Scope trusted, validated view CSS to one renderer root. */
export function scopeViewCss(css: string, scope: string): string {
  const error = validateViewCss(css);
  if (error) throw new Error(error);

  const keyframes = new Map<string, string>();
  const keyframePattern = /@(?:-webkit-)?keyframes\s+([\w-]+)/gi;
  let keyframeMatch: RegExpExecArray | null;
  while ((keyframeMatch = keyframePattern.exec(css)) !== null) {
    keyframes.set(keyframeMatch[1]!, `${scope.replace(/[^\w-]/g, "-")}-${keyframeMatch[1]}`);
  }
  const renameKeyframes = (value: string) => {
    let result = value;
    for (const [name, replacement] of keyframes) {
      result = result.replace(new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\w-])`, "g"), `$1${replacement}`);
    }
    return result;
  };

  const transformRules = (rules: string): string => {
    let output = "";
    let cursor = 0;
    while (cursor < rules.length) {
      const open = rules.indexOf("{", cursor);
      if (open < 0) { output += rules.slice(cursor); break; }
      const close = findBlockEnd(rules, open);
      if (close < 0) throw new Error("Unclosed rule block.");
      const prelude = rules.slice(cursor, open);
      const body = rules.slice(open + 1, close);
      const trimmed = prelude.trim();
      const leading = prelude.slice(0, prelude.indexOf(trimmed));
      if (trimmed.startsWith("@")) {
        if (/^@(?:media|supports|container|layer)\b/i.test(trimmed)) {
          output += `${leading}${trimmed}{${transformRules(body)}}`;
        } else if (/^@(?:-webkit-)?keyframes\b/i.test(trimmed)) {
          output += `${leading}${renameKeyframes(trimmed)}{${renameKeyframes(body)}}`;
        } else {
          throw new Error(`Unsupported at-rule: ${trimmed.split(/\s|\{/)[0]}.`);
        }
      } else {
        if (!trimmed || trimmed.includes("&")) throw new Error("Nested selectors are not supported.");
        const scoped = splitSelectors(trimmed).map((selector) => {
          if (!selector) throw new Error("Empty selector is not supported.");
          const normalized = selector.replace(/(^|\s)(?::root|html|body)(?=\s|$)/gi, `$1${scope}`);
          if (/^\.clickmap-root\b/.test(normalized)) {
            return normalized.replace(/^\.clickmap-root\b/, scope);
          }
          return normalized.includes(scope) ? normalized : `${scope} ${normalized}`;
        }).join(", ");
        output += `${leading}${scoped}{${renameKeyframes(body)}}`;
      }
      cursor = close + 1;
    }
    return output;
  };
  return transformRules(css);
}
