# Autonomous completion goal

The loop may stop only when all of these are true:

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

"Bug free" means the strongest available evidence above, never an unsupported
claim of mathematical certainty.
