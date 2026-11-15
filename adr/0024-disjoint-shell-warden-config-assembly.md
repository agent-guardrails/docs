# 0024 — Assemble explicit shell-warden configs from disjoint profiles

Status: Accepted

Date: 2026-11-16

Design: https://github.com/agent-guardrails/docs/issues/39.
Implementation: https://github.com/agent-guardrails/shell-warden/issues/51.
Contract synchronization: https://github.com/agent-guardrails/docs/issues/40.

## Context

Users need multiple explicit policy files without generating a merged file.
Last-file-wins merging can silently replace deny rules or loosen grammar.
Individual v2 documents already describe complete profiles and redirect bundles.

## Decision

Assemble independently valid v2 files into one policy with disjoint profile IDs
and executable spellings. Require equal decoded defaults. Share redirect-policy
names only when their decoded definitions are equal. Keep rule and hint IDs
profile-local. Do not add cross-file references.

Take each effective limit's minimum and apply byte and profile/rule budgets to
the assembled input. Reject canonical duplicate paths. Fail atomically before
evaluating any command. Explicit paths suppress default-path loading.

The complete contract is in
[configuration §6.1.1](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/06-engine-config.md#611-explicit-file-assembly).

## Alternatives considered

- Last-file-wins replacement: rejected because ordering can silently weaken
  existing policy.
- Restrictive overlays: deferred because deciding safe updates to grammars,
  coverage proofs, and named redirect bundles requires a new public contract.
- Independent-policy intersection: deferred because every policy would vote on
  every command, changing evaluation and evidence composition.

## Consequences

Files modularize policy by executable; they are not narrower project overlays.
Adding a disjoint profile intentionally configures another executable, but cannot
replace or extend an existing profile. Shared defaults must be coordinated.
Individual v2 JSON shapes and verdict envelopes remain unchanged. Trust remains
user-global with no implicit discovery or reload.
