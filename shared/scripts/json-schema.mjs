// Generates the published JSON Schema for map.json from the Valibot schema in
// shared/schema.ts, the single structural source (#196). Never edit the JSON
// file by hand.
//
//   node scripts/json-schema.mjs          write schema/clickmap-definition.schema.json
//   node scripts/json-schema.mjs --check  fail when the committed file is stale
//
// Imports the TypeScript source directly through Node's built-in type
// stripping (Node >= 22.18).
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { toJsonSchema } from "@valibot/to-json-schema";

// shared/ sources import each other as "./x.js" (bundler resolution); map a
// relative .js import that does not exist to its .ts source.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    try {
      return await next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
      return next(specifier.slice(0, -3) + ".ts", context);
    }
  }
`)}`);
const { CURRENT_SCHEMA_VERSION, definitionParts, definitionSchema } = await import("../schema.ts");

const outFile = fileURLToPath(new URL("../schema/clickmap-definition.schema.json", import.meta.url));

// Validation actions JSON Schema cannot express. They stay enforced by the
// runtime decoder and are described in the schema's $comment:
// - finite: JSON has no NaN or Infinity, so every JSON number is finite.
// - check / forward: the hit-mask byte length and data-URI well-formedness.
const RUNTIME_ONLY_ACTIONS = new Set(["finite", "check", "forward"]);

function generateJsonSchema() {
  const { $schema, ...body } = toJsonSchema(definitionSchema, {
    target: "draft-07",
    errorMode: "throw",
    definitions: definitionParts,
    // Returning the schema built so far keeps it and suppresses the error.
    overrideAction: ({ valibotAction, jsonSchema }) =>
      RUNTIME_ONLY_ACTIONS.has(valibotAction.type) ? jsonSchema : undefined,
  });
  return {
    $schema,
    title: "svg-mapper map definition (map.json)",
    description:
      "ClickMapDefinition, the contract between the svg-mapper builder and renderer. " +
      `This release writes schemaVersion ${CURRENT_SCHEMA_VERSION} and reads any 1.x.y. ` +
      "A major version change is breaking; minor and patch changes are additive. " +
      "See docs/data-model.md.",
    $comment:
      "Generated from shared/schema.ts by shared/scripts/json-schema.mjs; do not edit by hand. " +
      "Structural only: rules across objects (settings.initialViewId, goToView and " +
      "toggleLayer targets and asset ids must exist; ids and view slugs must be unique; " +
      "minZoom <= initialZoom <= maxZoom) are semantic checks made by validateProject, " +
      "not by this schema. The runtime decoder additionally requires " +
      "image.hitMask.data to hold exactly ceil(width * height / 8) base64-encoded bytes and " +
      "data: URIs in assets[].src to be well formed. Objects accept extra properties.",
    ...body,
  };
}

const text = `${JSON.stringify(generateJsonSchema(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(outFile, "utf8");
  } catch {
    // A missing file is reported as stale below.
  }
  if (committed !== text) {
    console.error(
      "shared/schema/clickmap-definition.schema.json is out of date with shared/schema.ts.\n" +
        "Run `npm run schema:generate --prefix shared` and commit the result.",
    );
    process.exit(1);
  }
  console.log("JSON Schema is up to date.");
} else {
  writeFileSync(outFile, text);
  console.log(`Wrote ${outFile}`);
}
