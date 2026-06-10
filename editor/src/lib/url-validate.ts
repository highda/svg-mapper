// URL protocol validation for `url` actions (ASSIGNMENT §10.2).
// Allowed: http, https, mailto, tel. Everything else (javascript:, data:,
// vbscript:, file:, …) is rejected.

const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

export interface UrlValidation {
  valid: boolean;
  error?: string;
}

export function validateActionUrl(raw: string): UrlValidation {
  const value = raw.trim();
  if (value === "") {
    return { valid: false, error: "URL is required." };
  }

  // Explicit scheme present?
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) {
    // Relative URLs ("/cafeteria", "page.html") are allowed — they resolve
    // against the embedding page over http/https.
    if (value.startsWith("//")) {
      return { valid: true };
    }
    return { valid: true };
  }

  const protocol = schemeMatch[1].toLowerCase() + ":";
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    return {
      valid: false,
      error: `Protocol "${protocol}" is not allowed. Use http, https, mailto, or tel.`,
    };
  }

  if (protocol === "http:" || protocol === "https:") {
    try {
      new URL(value);
    } catch {
      return { valid: false, error: "Malformed URL." };
    }
  }

  return { valid: true };
}
