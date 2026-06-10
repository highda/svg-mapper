// URL protocol validation for `url` actions (ASSIGNMENT §10.2).
// Canonical implementation lives in @svg-mapper/shared so the editor,
// renderer, and validation pipeline agree. Re-exported here for existing
// editor imports.
export { validateActionUrl } from "@svg-mapper/shared";
export type { UrlValidation } from "@svg-mapper/shared";
