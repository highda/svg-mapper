export function validateViewCss(css: string): string | null {
  if (!css.trim()) return null;
  if (/\/\*[\s\S]*$/.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) return "Unclosed comment.";
  if (/@(?:import|namespace|charset|font-face|page|property)\b/i.test(css)) {
    return "Imports and global resource rules are not supported.";
  }
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
