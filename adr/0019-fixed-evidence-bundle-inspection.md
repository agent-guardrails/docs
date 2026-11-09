# 0019, Fixed evidence bundle inspection

* **Status:** Accepted (2026-11-08)
* **Deciders:** preved911
* **Supersedes:** [0018, Script-based auditable PR review workflow](0018-script-based-auditable-pr-review-workflow.md)
* **Related:** [docs issue 27](https://github.com/agent-guardrails/docs/issues/27), [implementation issue 35](https://github.com/agent-guardrails/.github/issues/35), [Fixed PR review bundle inspection design](https://github.com/agent-guardrails/docs/blob/main/design/fixed-pr-review-bundle-inspection.md), [agent-guardrails/.github](https://github.com/agent-guardrails/.github)

## Context and Problem Statement

The accepted review workflow produces a verified immutable bundle, but its three
launchers leave offline reviewers to read artifacts with caller-owned commands and
parsers. That weakens the fixed permission boundary: a caller can accidentally
decode unverified bytes, read arbitrary bundle paths, dump CI logs, or execute
reviewed content while assembling context.

Reviewers need focused, bounded views of verified evidence. The answer must retain
the fixed CLI model and must not turn the bundle into a generic local file API.

## Decision Drivers

- Preserve exact-head, hash-verified, immutable evidence as the review input.
- Give humans and agents one testable, bounded inspection interface.
- Keep the trusted command and permission surface small.
- Prevent caller-owned parsing, arbitrary artifact reads, raw log dumping, and
  reviewed-code execution.
- Keep the current version-one schemas and persisted bundle format unchanged.

## Considered Options

1. **Caller-owned parsing of verified bundle files.** Rejected. Every caller would
   recreate path checks, hash verification, pagination, output bounds, and data
   normalization. The review boundary would become difficult to audit.
2. **Generic artifact access, such as `--artifact PATH`.** Rejected. It exposes
   arbitrary bundle content, creates a broad parser surface, and makes raw CI-log
   dumping easy.
3. **A fixed read-only inspector with purpose-specific views.** Accepted. It can
   verify once before decoding, expose only review-relevant projections, and make
   bounds and failures testable.

## Decision Outcome

Option 3.

https://github.com/agent-guardrails/.github will host Node.js standard-library
tooling with four stable entry points:

```text
pr-review-sync
pr-review-collect
pr-review-inspect
pr-review-publish
```

`pr-review-sync` creates or updates one caller-selected clean worktree at the
resolved exact PR head. `pr-review-collect` verifies that worktree and writes one
immutable bundle containing a locally generated pinned diff and remote-only
evidence. `pr-review-inspect` accepts only a canonical absolute bundle path,
verifies the bundle before decoding any payload, and emits one bounded JSON view
from verified artifact bytes. `pr-review-publish` verifies its bundle and findings,
then only previews or, after explicit confirmation and stale-head verification,
creates one `COMMENT` review and valid inline comments.

The inspector provides only fixed `pr`, `files`, `diff`, `ci`, `discussion`, and
`manifest` views. It is read-only and has no subprocess, network, write, query,
generic-artifact, or arbitrary-file capability. Collection and publication remain
separate operations with separate permissions. Scripts never execute repository,
bundle, CI, or other reviewed content.

The design and normative specification define all four command contracts. The
version-one bundle and findings schemas remain unchanged because inspection creates
no persisted artifact.

## Consequences

- (+) Reviewers receive normalized, verified, purpose-specific context without
  recreating a parser or opening arbitrary evidence files.
- (+) Bounded JSON and continuation metadata make the command safe for human and
  agent consumers.
- (+) The trusted boundary continues to prevent reviewed content from becoming
  executable authority.
- (-) The implementation must maintain structured projections and exact output
  accounting for each view.
- (-) Reviewers cannot use the command for arbitrary historical or raw-log
  exploration.

## Specification and implementation impact

The implementation-ready design and normative specification are maintained under
[docs issue 27](https://github.com/agent-guardrails/docs/issues/27). The thin
launcher and `pr-review/inspect.mjs`, backed by `verifyBundle()`, belong under
[implementation issue 35](https://github.com/agent-guardrails/.github/issues/35).
This decision adds no schema, package dependency, compatibility alias, generic
artifact read, or write behavior.
