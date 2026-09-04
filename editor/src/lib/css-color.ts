export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampAlpha = (value: number) => Math.max(0, Math.min(1, value));

function parseChannel(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampByte(trimmed.endsWith("%") ? parsed * 2.55 : parsed);
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) return 1;
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampAlpha(trimmed.endsWith("%") ? parsed / 100 : parsed);
}

export function parseCssColor(value: string): RgbaColor | null {
  const color = value.trim().toLowerCase();
  if (color === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = color.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((part) => part + part).join("") : hex;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = color.match(/^rgba?\(\s*([^,\s]+)[,\s]+\s*([^,\s]+)[,\s]+\s*([^,\s/]+)(?:\s*[,/]\s*([^\s)]+))?\s*\)$/);
  if (rgb) {
    const r = parseChannel(rgb[1]);
    const g = parseChannel(rgb[2]);
    const b = parseChannel(rgb[3]);
    const a = parseAlpha(rgb[4]);
    if (r !== null && g !== null && b !== null && a !== null) return { r, g, b, a };
  }

  if (typeof document !== "undefined" && document.body) {
    const probe = document.createElement("span");
    probe.style.color = color;
    if (probe.style.color) {
      probe.hidden = true;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      if (resolved && resolved.toLowerCase() !== color) return parseCssColor(resolved);
    }
  }

  return null;
}

export function isValidCssColor(value: string): boolean {
  if (parseCssColor(value)) return true;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", value.trim());
  }
  if (typeof document !== "undefined") {
    const probe = document.createElement("span");
    probe.style.color = "";
    probe.style.color = value.trim();
    return probe.style.color !== "";
  }
  return false;
}

export function colorToHex(color: RgbaColor): string {
  return `#${[color.r, color.g, color.b].map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function withHexColor(value: string, hex: string): string {
  const current = parseCssColor(value);
  const next = parseCssColor(hex);
  if (!next) return value;
  return formatRgba({ ...next, a: current?.a ?? 1 });
}

export function withOpacity(value: string, opacity: number): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value;
  return formatRgba({ ...parsed, a: clampAlpha(opacity) });
}

export function formatRgba(color: RgbaColor): string {
  const alpha = Number(clampAlpha(color.a).toFixed(3));
  return `rgba(${clampByte(color.r)},${clampByte(color.g)},${clampByte(color.b)},${alpha})`;
}
