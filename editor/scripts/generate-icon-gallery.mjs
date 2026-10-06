// Regenerates editor/src/lib/icons/gallery.ts, the vendored waypoint icon
// gallery (#219). Sources and licences: editor/src/lib/icons/NOTICE.md.
// None of the inputs is a project dependency. Fetch them into a scratch dir:
//   npm pack @mapbox/maki@8.2.0 opentype.js@2.0.0   (then untar both)
// and use Liberation Sans Bold (fonts-liberation, SIL OFL 1.1).
// Usage:
//   node editor/scripts/generate-icon-gallery.mjs <maki>/package/icons \
//     <opentype>/package/dist/opentype.mjs LiberationSans-Bold.ttf editor/src/lib/icons/gallery.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [makiDir, opentypePath, fontPath, outFile] = process.argv.slice(2);
const opentype = await import(opentypePath);

const CATALOG = {
  "Pins & shapes": [
    ["marker", "Pin", "location place waypoint"],
    ["marker-stroked", "Pin outline", "location place waypoint"],
    ["circle", "Dot", "point round"],
    ["circle-stroked", "Ring", "point round outline"],
    ["square", "Square", "box"],
    ["square-stroked", "Square outline", "box"],
    ["triangle", "Triangle", ""],
    ["triangle-stroked", "Triangle outline", ""],
    ["diamond", "Diamond", ""],
    ["star", "Star", "favourite favorite highlight"],
    ["star-stroked", "Star outline", "favourite favorite"],
    ["heart", "Heart", "love favourite"],
    ["arrow", "Arrow", "direction pointer"],
    ["caution", "Caution", "warning attention"],
    ["danger", "Danger", "warning hazard"],
    ["roadblock", "Closed", "blocked barrier"],
  ],
  Wayfinding: [
    ["information", "Information", "info help desk reception"],
    ["entrance-alt1", "Entrance", "enter way in door"],
    ["exit", "Exit", "leave way out door"],
    ["entrance", "Entrance (stairs)", "enter subway"],
    ["toilet", "Toilets", "wc restroom bathroom lavatory"],
    ["wheelchair", "Accessible", "wheelchair disabled access"],
    ["elevator", "Elevator", "lift"],
    ["stairs", "Stairs", "steps staircase"],
    ["parking", "Parking", "car park"],
    ["parking-garage", "Parking garage", "car park"],
    ["bicycle", "Bicycle", "bike cycle"],
    ["bus", "Bus", "transit stop"],
    ["rail", "Train", "rail station"],
    ["rail-metro", "Metro", "subway underground"],
    ["taxi", "Taxi", "cab"],
    ["car", "Car", "vehicle"],
    ["charging-station", "Charging", "ev electric"],
    ["airport", "Airport", "plane flight"],
    ["ferry", "Ferry", "boat"],
    ["gate", "Gate", ""],
    ["building", "Building", "office"],
    ["home", "Home", "house"],
    ["telephone", "Telephone", "phone"],
    ["suitcase", "Luggage", "baggage suitcase"],
    ["viewpoint", "Viewpoint", "lookout"],
  ],
  "Food & shopping": [
    ["cafe", "Café", "coffee cafe"],
    ["restaurant", "Restaurant", "food dining eat"],
    ["fast-food", "Fast food", "burger food"],
    ["bar", "Bar", "drinks cocktail"],
    ["beer", "Beer", "pub"],
    ["ice-cream", "Ice cream", "dessert"],
    ["bakery", "Bakery", "bread"],
    ["drinking-water", "Drinking water", "fountain water"],
    ["picnic-site", "Picnic", "table"],
    ["grocery", "Grocery", "supermarket"],
    ["shop", "Shop", "store retail"],
    ["convenience", "Convenience store", "shop"],
    ["clothing-store", "Clothing", "fashion"],
    ["gift", "Gifts", "souvenir present"],
  ],
  "Health & safety": [
    ["hospital", "First aid", "hospital medical cross"],
    ["doctor", "Doctor", "medical"],
    ["pharmacy", "Pharmacy", "chemist drugs"],
    ["defibrillator", "Defibrillator", "aed"],
    ["emergency-phone", "Emergency phone", "sos help"],
    ["fire-station", "Fire station", "fire"],
    ["police", "Police", "security"],
  ],
  "Leisure & culture": [
    ["museum", "Museum", "exhibition"],
    ["art-gallery", "Gallery", "art"],
    ["theatre", "Theatre", "theater stage"],
    ["cinema", "Cinema", "film movie"],
    ["music", "Music", "concert"],
    ["library", "Library", "books"],
    ["attraction", "Attraction", "sight"],
    ["landmark", "Landmark", ""],
    ["monument", "Monument", ""],
    ["castle", "Castle", ""],
    ["park", "Park", "tree"],
    ["garden", "Garden", "flower"],
    ["playground", "Playground", "kids children"],
    ["zoo", "Zoo", "animals"],
    ["swimming", "Swimming", "pool"],
    ["fitness-centre", "Fitness", "gym sport"],
    ["stadium", "Stadium", "arena sport"],
    ["campsite", "Campsite", "tent camping"],
    ["lodging", "Lodging", "hotel bed"],
    ["school", "School", "education"],
    ["college", "College", "university"],
    ["place-of-worship", "Place of worship", "church temple religion"],
  ],
  Services: [
    ["post", "Post", "mail letter"],
    ["bank", "Bank", "money atm"],
    ["mobile-phone", "Mobile phone", "charging"],
    ["laundry", "Laundry", ""],
    ["hairdresser", "Hairdresser", "salon"],
    ["waste-basket", "Waste", "bin trash rubbish"],
    ["recycling", "Recycling", "bin"],
    ["dog-park", "Dog park", "pets"],
  ],
};

const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, "&");
const compact = (d) => decode(d).replace(/\s+/g, " ").replace(/\s*([A-Za-z])\s*/g, "$1").replace(/\s*,\s*/g, ",").trim();

function maki(name) {
  const svg = readFileSync(join(makiDir, `${name}.svg`), "utf8");
  // Match ` d=` exactly: Maki paths also carry an `id` attribute.
  const all = [...svg.matchAll(/<path\b([^>]*)>/g)].map((x) => /\sd="([^"]*)"/.exec(x[1])?.[1]).filter(Boolean);
  if (all.length !== 1) throw new Error(`${name}: ${all.length} paths`);
  return compact(all[0]);
}

// Exit: built from Maki's entrance-alt1 (an arrow into a door frame).
function mapX(d, sx, tx) {
  // Only absolute/relative M,L,H,V,C,S,A,Z with explicit numbers are used in entrance-alt1.
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  let out = "";
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const f = (n) => String(Math.round(n * 1000) / 1000);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) { cmd = tokens[i++]; out += cmd; if (/[Zz]/.test(cmd)) continue; } else out += " ";
    const abs = cmd === cmd.toUpperCase();
    const X = (x) => f(abs ? sx * x + tx : sx * x);
    switch (cmd.toUpperCase()) {
      case "M": case "L": case "T": { const x = num(), y = num(); out += `${X(x)},${f(y)}`; break; }
      case "H": out += X(num()); break;
      case "V": out += f(num()); break;
      case "C": { const a = [num(), num(), num(), num(), num(), num()]; out += `${X(a[0])},${f(a[1])},${X(a[2])},${f(a[3])},${X(a[4])},${f(a[5])}`; break; }
      case "S": case "Q": { const a = [num(), num(), num(), num()]; out += `${X(a[0])},${f(a[1])},${X(a[2])},${f(a[3])}`; break; }
      case "A": { const a = [num(), num(), num(), num(), num(), num(), num()]; out += `${f(a[0])},${f(a[1])},${f(a[2])},${a[3]},${sx < 0 ? (a[4] ? 0 : 1) : a[4]},${X(a[5])},${f(a[6])}`; break; }
      default: throw new Error(`mirror: ${cmd}`);
    }
  }
  return out;
}

const font = opentype.parse(readFileSync(fontPath).buffer);
const r2 = (n) => String(Math.round(n * 100) / 100);

function badge(char) {
  const glyphPath = font.getPath(char, 0, 0, 100);
  const box = glyphPath.getBoundingBox();
  const gw = box.x2 - box.x1;
  const gh = box.y2 - box.y1;
  const scale = Math.min(7.6 / gh, 9.2 / gw);
  const ox = 7.5 - ((box.x1 + box.x2) / 2) * scale;
  const oy = 7.5 - ((box.y1 + box.y2) / 2) * scale;
  const P = (x, y) => `${r2(x * scale + ox)},${r2(y * scale + oy)}`;
  let d = "";
  let area = 0;
  let best = 0;
  let contour = [];
  const flush = () => {
    if (contour.length < 3) return;
    let a = 0;
    for (let k = 0; k < contour.length; k++) {
      const [x1, y1] = contour[k];
      const [x2, y2] = contour[(k + 1) % contour.length];
      a += x1 * y2 - x2 * y1;
    }
    if (Math.abs(a) > Math.abs(best)) best = a;
    contour = [];
  };
  for (const c of glyphPath.commands) {
    if (c.type === "M") { flush(); d += `M${P(c.x, c.y)}`; contour.push([c.x, c.y]); }
    else if (c.type === "L") { d += `L${P(c.x, c.y)}`; contour.push([c.x, c.y]); }
    else if (c.type === "Q") { d += `Q${P(c.x1, c.y1)} ${P(c.x, c.y)}`; contour.push([c.x, c.y]); }
    else if (c.type === "C") { d += `C${P(c.x1, c.y1)} ${P(c.x2, c.y2)} ${P(c.x, c.y)}`; contour.push([c.x, c.y]); }
    else if (c.type === "Z") { d += "Z"; flush(); }
  }
  flush();
  area = best;
  // The disc runs against the glyph's outer contour, so the glyph is knocked
  // out under the default nonzero fill rule (and its counters filled again).
  const sweep = area > 0 ? 0 : 1;
  const disc = `M7.5,0A7.5,7.5,0,1,${sweep},7.5,15A7.5,7.5,0,1,${sweep},7.5,0Z`;
  return disc + d;
}

const icons = [];
for (const [category, entries] of Object.entries(CATALOG)) {
  for (const [name, label, keywords] of entries) {
    let d;
    if (name === "exit") {
      // The door frame mirrored to the left, the arrow moved right: it leaves through the opening.
      const source = maki("entrance-alt1");
      const split = source.indexOf("ZM") + 1;
      d = mapX(source.slice(0, split), 1, 3.5) + mapX(source.slice(split), -1, 15);
    }
    else if (name === "stairs") d = "M1,14V11H4V8H7V5H10V2H14V14Z";
    else d = maki(name);
    icons.push({ id: name === "stairs" || name === "exit" ? name : `maki-${name}`, name: label, category, keywords, d });
  }
}
for (const char of "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  icons.push({ id: `badge-${char.toLowerCase()}`, name: `Badge ${char}`, category: "Badges", keywords: `number letter ${char}`, d: badge(char) });
}

const categories = [...Object.keys(CATALOG), "Badges"];
const lines = icons.map((icon) => `  { id: ${JSON.stringify(icon.id)}, name: ${JSON.stringify(icon.name)}, category: ${JSON.stringify(icon.category)}, keywords: ${JSON.stringify(icon.keywords)}, d: ${JSON.stringify(icon.d)} },`);
writeFileSync(outFile, `// GENERATED by editor/scripts/generate-icon-gallery.mjs; do not edit by hand.
// Vendored icon data: see NOTICE.md in this folder for sources and licences.
// Every icon is single-colour path data in a 15 × 15 box, so marker style
// states (fill, stroke) colour it. Only icons a map uses are copied into its
// definition (\`icons\`); the renderer never bundles this gallery.

export const GALLERY_ICON_SIZE = 15;

export const GALLERY_CATEGORIES = ${JSON.stringify(categories)} as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export interface GalleryIcon {
  /** Stable id, also the key the icon gets in \`definition.icons\`. */
  id: string;
  name: string;
  category: GalleryCategory;
  /** Extra search terms. */
  keywords: string;
  d: string;
}

export const GALLERY_ICONS: readonly GalleryIcon[] = [
${lines.join("\n")}
];
`);
console.log(icons.length, "icons");
