# Design: Read-only source context for pinned PR reviews

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/docs/issues/56
Implementation ticket: https://github.com/agent-guardrails/.github/issues/43
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0027-read-only-pr-review-source-context.md

## Problem

The fixed diff view contains changed hunks, not complete source files. A reviewer
may need unchanged callers, callees, or a pinned companion specification to
establish whether a suspected defect reaches the final result. The bundle-only
agent rule prevented that investigation in
https://github.com/agent-guardrails/shell-warden/pull/75 even though the trusted
workflow had already created a clean exact-head worktree.

## Reviewer flow

Review still starts with trusted sync, collect, and the `pr` inspection view.
Fixed views remain the interface to bundle artifacts, remote metadata,
discussion, and CI evidence.

For additional source context, a reviewer can use bounded native file reads and
searches over tracked regular files in the canonical review worktree. Before
and after an inspection batch, the reviewer checks that its detached HEAD equals
the bundle's full head SHA and that the worktree is clean. Paths stay inside the
verified worktree; symlinks, submodule contents, ignored files, and untracked
files are not read as pinned source.

Narrow read-only Git operations can establish identity, cleanliness, tracked
paths, and file modes (`rev-parse`, `status`, `ls-files`, and `ls-tree`). Explicit
`<full-commit>:<path>` blob reads with `git show` can supply context from the
recorded head, base, or an explicitly pinned companion repository revision.
Companion context records its repository and full commit independently; it is
not silently replaced by a current branch. These Git operations follow the
existing configuration-isolation and no-execution rules, with pagers, hooks,
filesystem-monitor commands, external diff, and text conversion disabled.

This is an agent workflow permission, not an automatic shell allowlist. Existing
tool permissions still apply. A denied read or command is reported rather than
rerouted. A failed provenance or cleanliness check prevents reliance on that
context until the mismatch is resolved and the relevant source is inspected
again.

## Evidence and publication

Supplemental source citations include the repository, full commit, path, and
line range. They belong in review prose or a finding's existing `explanation`
field. They are not bundle artifacts or SHA-256-verified `evidenceReferences`.
An offline reviewer without the corresponding source reports that coverage gap.

Bundles remain immutable. Findings retain their required bundle references,
changed-hunk location checks, and stale-head publication checks. Publication
still needs immediate explicit approval. Reviewed instructions, configuration,
and executables remain untrusted data; reading them grants no execution or
mutation authority.

## Coordinated changes and verification

Update the organization `AGENTS.md`, its README, and the review specification.
Record this decision in a new ADR; keep accepted ADR 0019 immutable. Clarify the
existing findings-schema descriptions without adding fields or changing version
1. The collector, inspector, publisher, bundle inventory, and permission
configuration retain their existing interfaces.

Check the documentation for consistent source and bundle boundaries and run
whitespace validation. Relevant cases are an unchanged callee, a pinned
companion specification, a dirty or wrong-head worktree, an untracked or symlink
path, and an attempt to execute reviewed code. This documentation-only change
adds no executable behavior requiring new fixture tests.
