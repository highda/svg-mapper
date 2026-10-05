import { DETAILS_SIZE_PATTERN } from "@svg-mapper/shared";

/** Parse the panel size field: a fraction 0–1, or a px, %, em or rem length. */
export function parseDetailsSize(input: string): { ok: true; value: number | string | undefined } | { ok: false } {
  const text = input.trim();
  if (!text) return { ok: true, value: undefined };
  if (/^(?:0?\.\d+|1(?:\.0+)?|0)$/.test(text)) {
    const fraction = Number(text);
    return fraction > 0 ? { ok: true, value: fraction } : { ok: false };
  }
  return DETAILS_SIZE_PATTERN.test(text) ? { ok: true, value: text } : { ok: false };
}
