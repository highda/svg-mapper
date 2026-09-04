# SVG Mapper

SVG Mapper is a browser-only editor for turning a floor plan, diagram, or map image into an accessible interactive map. Import PNG, JPEG, WebP, or SVG artwork; draw clickable areas; connect views; preview the real renderer; then download a static package that needs no application server or JavaScript framework.

The editor keeps projects in memory and saves them as JSON files. It has no accounts, database, or server-side storage.

Try the hosted editor at **https://highda.github.io/svg-mapper/**. Every push to
`main` deploys the project site; version tags publish downloadable editor and
renderer archives as GitHub Releases.

## Documentation

- [User guide](docs/user-guide.md) — the editor workflow from import to deployment
- [Data model](docs/data-model.md) — saved project and exported `map.json` schema
- [Renderer API](docs/renderer-api.md) — initialization, options, methods, events, and embedding
- [Export format](docs/export-format.md) — ZIP contents, asset modes, and hosting
- [Product specification](ASSIGNMENT.md) and [agent workflow](AGENTS.md)
- [Product reassessment](docs/product-reassessment.md) — actual capabilities, gaps, and image-first roadmap
- [Human test plan](docs/human-test-plan.md) — repeatable browser and usability checks
- [Canonical QA gallery](examples/qa-gallery/README.md) — durable fixtures for browser passes

## Local development

Requirements: a current Node.js release supported by Vite 8 and npm.

```sh
git clone https://github.com/highda/svg-mapper.git
cd svg-mapper
npm ci --prefix shared
npm ci --prefix renderer
npm ci --prefix editor
npm run dev --prefix editor
```

The editor is then available at the local URL printed by Vite. Its `predev` step builds the renderer so Preview and Export exercise the same runtime shipped to users.

Run the repository checks from its package directories:

```sh
npm run typecheck --prefix shared
npm run typecheck --prefix renderer
npm run typecheck --prefix editor
npm run test --prefix editor
npm run lint --prefix editor
npm run build --prefix renderer
npm run build --prefix editor
```

## Package layout

| Path | Purpose |
| --- | --- |
| `editor/` | React, TypeScript, Vite, Zustand, and Tailwind authoring app |
| `renderer/` | Dependency-free browser IIFE and stylesheet used by Preview and exports |
| `shared/` | TypeScript schema and pre-export validation shared by editor and renderer |
| `docs/` | Product, integration, and autonomous-loop documentation |
| `scripts/` | Repository automation and loop tests |

The renderer build writes `renderer/dist/clickmap-renderer.js` and `renderer/dist/clickmap-renderer.css`. The editor build writes `editor/dist/`.
