/** Serialize JSON for insertion into an HTML script element.
 *
 * Escaping every less-than character prevents any HTML parser spelling of an
 * end tag (including whitespace and case variants) from ending the script.
 */
export function serializeJsonForScript(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(/</g, "\\u003c");
}
