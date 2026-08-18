# Autonomous completion goal

The loop may stop only when all of these are true. This is a product-completion
standard, not an MVP checklist or a reason to avoid worthwhile invention.

- The browser-only SVG Mapper is feature-complete for its useful in-browser
  authoring and static export scope. Do not add server-side storage, accounts,
  or backend work.
- The editor and dependency-free exported renderer work together through the
  documented product flows, including import, editing, linking, preview,
  validation, and export.
- The application looks intentional and polished at normal desktop and mobile
  sizes; no obvious broken, placeholder, or inaccessible UI remains.
- Automated checks are green, relevant browser golden paths have been exercised,
  and there are no known reproducible major defects.
- A repository inspection has found no remaining high-value feature or quality
  gap that materially advances this product's stated scope.

Proactively invent and implement valuable in-scope improvements before declaring
completion. Prefer changes that make authoring faster, safer, clearer, or more
pleasant without complicating the exported runtime. Examples include a usable
color picker for RGBA style fields, drag-and-drop where it improves view/layer
management, and duplicating views or layers with correctly remapped unique IDs.
These examples are prompts for judgment, not an exhaustive backlog. Do not stop
merely because the original MVP acceptance criteria pass.

"Bug free" means the strongest available evidence above, never an unsupported
claim of mathematical certainty.
