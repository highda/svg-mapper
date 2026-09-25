# Autonomous completion goal

The loop may stop only when all of these are true. The standard is finite: a
fixed set of acceptance scenarios plus resolved or explicitly parked defects.
It does not ask the loop to keep inventing features.

- **Scope.** Two surfaces, as defined in `ASSIGNMENT.md` §2.4–§2.6:
  - a desktop authoring editor, supported down to a 1024×600 CSS px window;
  - a static, framework-free exported renderer that responds to its embedding
    element for desktop and mobile visitors.

  Phone/tablet authoring, server-side storage, accounts, and backend work are
  out of scope.
- **Release acceptance.** Every release acceptance flow in the active roadmap
  (#180) has behavior-level evidence: author on desktop, embed, publish,
  guardrails, and access/lifecycle.
- **Defects.** Every required roadmap leaf is closed or parked with
  `agent:blocked` and a stated external condition. There are no known
  reproducible major defects in either surface. Renderer touch/physical-device
  QA (#113) counts only when actually performed; emulation is never a
  physical-device pass.
- **Checks.** Automated checks are green, and the editor and exported-map golden
  paths have been exercised in a browser.

Scope discipline:

- A defect found during the work may get a bounded ticket.
- A speculative feature idea is not a reason to keep the loop running. Record
  it as a Phase 2+ candidate and move on.
- Do not remove implemented capabilities to simplify the product.

"Bug free" means the strongest available evidence above, never an unsupported
claim of mathematical certainty.
