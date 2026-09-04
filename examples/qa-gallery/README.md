# QA gallery

Build the renderer, then serve the repository root over HTTP:

```sh
npm --prefix renderer run build
python3 -m http.server 4173
```

Open `http://localhost:4173/examples/qa-gallery/`. The controls switch between
canonical JSON fixtures, wide/narrow/tall hosts, and light DOM/Shadow DOM. The
dark event log is part of the test surface. A deliberately absent PNG and an
unknown asset reference are expected failures in the external-assets fixture.

The fixtures describe current schema capabilities. Add image-element coverage
here when first-class scene images land; background assets are not substitutes.
Store screenshots in `.codex/runtime/`, never beside this README.
