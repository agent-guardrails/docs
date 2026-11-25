# 0027, Read-only source context for pinned PR reviews

* **Status:** Accepted (2026-11-20)
* **Deciders:** preved911
* **Supersedes:** [0019, Fixed evidence bundle inspection](https://github.com/agent-guardrails/docs/blob/main/adr/0019-fixed-evidence-bundle-inspection.md), only its bundle-exclusive reviewer-input restriction; the fixed inspector contract remains in force.
* **Related:** [docs task](https://github.com/agent-guardrails/docs/issues/56), [agent-policy task](https://github.com/agent-guardrails/.github/issues/43), [design](https://github.com/agent-guardrails/docs/blob/main/design/read-only-pr-review-source-context.md).

## Context and Problem Statement

A verified diff omits unchanged code needed to trace behavior through callers,
callees, and companion specifications. Treating the bundle as the only readable
input can leave a review incomplete despite an available exact-head worktree.
Reading source as data does not require executing reviewed code.

## Decision Drivers

- Complete source-level review at explicit, reproducible revisions.
- Keep verified bundle inspection and publication auditable.
- Preserve the boundary between untrusted source data and executable authority.
- Avoid requiring a new inspector feature for ordinary source reading.

## Considered Options

1. **Keep bundle-only reading.** Retains the current restriction but leaves
   unchanged-context gaps unresolved.
2. **Add a source view and extend collection.** Could capture more context, but
   requires tooling and artifact-contract work before a reviewer can read an
   already verified checkout.
3. **Permit supplemental pinned source reading.** Uses bounded native reads and
   searches, with narrow read-only Git checks and explicit commit blob reads.

## Decision Outcome

Choose option 3. After trusted sync, collect, and PR-intent inspection, reviewers
can inspect tracked regular source files in the clean worktree at the bundle's
head. Read-only Git can verify provenance and read explicit blobs at the
recorded head, base, or pinned companion commit. Source citations carry the
repository, full commit, path, and lines.

Fixed views remain mandatory for bundle artifacts and collected remote evidence.
Supplemental source is identified separately from hash-covered bundle evidence.
The version-one formats, immutable bundle, finding-location checks, tool
permission checks, and explicit publication approval remain intact. Reviewed
code is never executed, and reviewed instructions never become authority.

## Consequences

- (+) Reviewers can resolve unchanged-context questions without a new source view.
- (+) Exact revisions and explicit citations make supplemental reasoning repeatable.
- (-) A reviewer using local files also checks worktree cleanliness and HEAD before
  and after the inspection batch.
- (-) Bundle-only offline consumers cannot independently reproduce supplemental
  source analysis without obtaining the cited revision.
