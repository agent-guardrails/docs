# 0023, Shell Warden verdict v2 only

* **Status:** Accepted (2026-11-12)
* **Deciders:** preved911
* **Supersedes:** [0022, Post-schema Shell Warden verdict validation](https://github.com/agent-guardrails/docs/blob/main/adr/0022-post-schema-shell-warden-verdict-validation.md)
* **Partially supersedes:** [0016, Two-tier enforcement](https://github.com/agent-guardrails/docs/blob/main/adr/0016-two-tier-enforcement.md), only its retired persistent-protocol wording that said there was no ID echo
* **Related:** [docs issue 33](https://github.com/agent-guardrails/docs/issues/33), [primary hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13), [Shell Warden verdict v2 design](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-verdict-v2.md), [letter and verdict specification](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md)

## Context and Problem Statement

ADR-0022 retained a dual-read hook and release-pinned v1 preservation while also
requiring new checkers to emit v2. That migration model is contradictory for the
active implementation: no deployed v1 consumers require runtime compatibility,
and a fallback path expands the fail-closed boundary without a current consumer.

The released v1 schema and earlier ADRs remain historical records. They do not
define the response contract for the coordinated checker and hook release.

## Decision Drivers

- Keep the response boundary closed and fail closed.
- Make one current checker and hook contract clear and testable.
- Preserve denial, ask, allow reduction, bounds, and diagnostics semantics.
- Avoid dual-read code, compatibility shims, and rollback paths that restore v1.

## Considered Options

1. **Keep ADR-0022 dual-read compatibility.** Rejected. There are no deployed v1
   consumers that need it, and it leaves an unnecessary active legacy path.
2. **Add a compatibility shim or fallback.** Rejected. A shim makes v1 an active
   runtime contract and weakens the unambiguous v2 boundary.
3. **Release the checker and hook as a v2-only pair.** Accepted. Both components
   accept and produce only the closed v2 envelope, with every anomaly degrading
   through `onCheckerError`.

## Decision Outcome

Option 3.

The checker emits only the exact `shell-warden.verdict.v2` envelope. The hook
accepts only that envelope, validates its schema and semantic invariants against
the expected letter, and applies its nested result through the existing tighten-only
path. Flat v1 responses are rejected fail closed. An absent, unknown, non-string,
or malformed `protocol`, malformed v2, semantic invariant failure, oversize output,
or any other response anomaly uses `onCheckerError`, never a fallback parser.

The v2 result retains positional contiguous indexes, invocation echo, diagnostics
coherence, output and facts bounds, and aggregate reduction `deny > ask > allow`.
Invalid evidence establishes an ask floor and never allows. These invariants are
unchanged; only the active response-version policy changes.

Checker and hook releases are published and deployed as one coordinated v2-only
pair for [primary hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13).
There is no dual-read deployment order, compatibility matrix, v1 rollback, or
release-pinned v1 preservation requirement. A rollback that would restore v1 is not
part of this decision.

## Consequences

- (+) The active response contract has one parser, one writer, and no fallback.
- (+) Hook tests focus on v2 validation and fail-closed anomalies.
- (+) Historical v1 schemas and ADRs remain immutable provenance.
- (-) Checker and hook releases must be coordinated; mixed-version deployment is
  unsupported and fails closed.

## Specification and implementation impact

The Shell Warden design, specification, testing strategy, roadmap, and handoffs
use v2 as the only active response contract. ADR-0020 and ADR-0022 remain
historical provenance only. This ADR records the decision; it makes no checker or
hook implementation change.
