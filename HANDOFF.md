# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #22 — renderer+shared: interaction model — per-area trigger, always-on highlight, disabled state
Branch:       feat/22-area-interaction-model
Started:      2026-08-31
Last commit:  e212717  fix: give loop sessions a host task brief (#59)

### What's done
- Claimed the interaction-model task; existing partial implementation and tests need acceptance review.

### What's next
- Verify renderer, editor inspector, validation, serialisation, tests, and browser behaviour; fill any gaps.

### Notes / gotchas
- The prior sandboxed loop session could not start its GitHub bridge or write Vite's temporary config bundle; this host session can proceed.

---

## Ledger (most recent first)
- 2026-08-31 — closed #56 — prevented source-text false positives from triggering GitHub retry; PR #57.
- 2026-08-31 — closed #54 — removed development screenshots and made browser-test evidence runtime-only; PR #55.
- 2026-08-31 — closed #52 — made the autonomous loop self-starting, credential-testable, and explicit about bridge startup failures; PR #53.
- 2026-08-18 — closed #48 — scoped the loopback bridge to agent Git and package commands, preserving Codex control-plane access; PR #49.
- 2026-08-18 — closed #46 — added a restricted loopback GitHub/package-registry bridge for Codex sandbox sessions; PR #47.
- 2026-08-18 — closed #44 — hardened unattended Git lock access and temporary GitHub API recovery; PR #45.
- 2026-08-18 — closed #42 — explicitly allowed GitHub’s REST API host for the autonomous loop; PR #43.
- 2026-08-18 — closed #40 — added automatic, interruptible fresh-session retry after explicit Codex quota/rate-limit failures; PR #41.
- 2026-08-18 — closed #38 — pinned unattended Codex loop to Terra medium; PR #39.
- 2026-08-18 — closed #36 — Codex commit identity plus proactive product-completeness goal beyond MVP acceptance; PR #37.
- 2026-08-18 — closed #34 — two-pass autonomous-loop completion guard with independent final review and stop marker; PR #35.
- 2026-08-18 — closed #32 — scoped unattended Codex profile with Git/memento access, proxy network policy, and local Playwright MCP; PR #33.
- 2026-08-18 — closed #30 — repository-local fresh-session Codex loop with PreCompact failsafe and Git/memento recovery; PR #31.
- 2026-06-10 — closed #10 — polish: all Appendix A shortcuts, ? help overlay, Cmd+C/V copy-paste, ResizeObserver debounce, prefers-reduced-motion CSS, renderer a11y audit; 5 new tests (93 total); PR #21.
- 2026-06-10 — closed #9 — export pipeline: generateExportPackage() with fflate ZIP, inline/external assets toggle, index.html (works file://), embed.html, README.txt, Download ZIP + Copy embed snippet + Copy map.json; 7 new tests (88 total); PR #20.
- 2026-06-10 — closed #8 — validation pipeline: validateProject() in /shared, ExportScreen with gated export + reveal links, BottomBar live badge, 10 new tests (88 total); PR #19.
- 2026-05-12 — closed #5 — inspector sidebar + layers/views tree: View/Layer CRUD, area property updates, 22 new tests, 56 total; PR #15.
- 2026-05-12 — closed #4 — design screen: SVG sanitizer, asset import, Canvas (pan/zoom), Select/Rect/Polygon tools, move/resize/delete/duplicate, undo/redo; 16 new tests; PR #14.
- 2026-05-12 — closed #3 — editor shell: Vite + React 19 + TS strict + Tailwind v4 + Zustand v5; app shell (TopBar/panels/Workspace/BottomBar); New/Open/Save; 14 tests; PR #13.
- 2026-05-12 — closed #2 — renderer: 3.4 KB gzipped IIFE, rect/polygon/hover/goToView/URL/back-btn/responsive/events; campus fixture 2 views 6 areas; PR #12.
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
