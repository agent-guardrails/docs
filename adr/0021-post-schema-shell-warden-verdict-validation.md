# 0021, Post-schema Shell Warden verdict validation

* **Status:** Accepted (2026-11-11)
* **Deciders:** preved911
* **Supersedes:** [0020, Versioned Shell Warden verdict envelope](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md)
* **Partially supersedes:** [0016, Two-tier enforcement](https://github.com/agent-guardrails/docs/blob/main/adr/0016-two-tier-enforcement.md), only its retired persistent-protocol wording that said there was no ID echo
* **Related:** [docs issue 31](https://github.com/agent-guardrails/docs/issues/31), [primary hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13), [Shell Warden verdict v2 design](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-verdict-v2.md), [letter and verdict specification](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md)

## Context and Problem Statement

The superseded ADR-0020 correctly chose a closed v2 envelope instead of changing
the released v1 schema. Its statement that existing v1 specification artifacts
remain unchanged is too strict: a future dual-read hook needs fail-closed semantic
checks that JSON Schema cannot express, while the released v1 schema and wire shape
must remain immutable.

Historical release provenance also establishes that letter and verdict command
indexes are positional and contiguous: each command index is its array position in
the range `0..N-1`. Diagnostics can be recognized as full or truncated shapes;
their evidence and reasons need coherence checks, and full diagnostics additionally
need emitted-vote coherence checks.

## Decision Drivers

- Retain the superseded decision's closed v2 envelope and no-fallback discriminator.
- Preserve released v1 schema and wire shape byte-for-byte.
- Reject schema-valid but semantically impossible responses fail closed.
- Preserve released positional command-index behavior.
- Permit normative clarification of released behavior without changing the wire.

## Considered Options

1. **Schema validation only.** Rejected. It cannot prove positional coverage,
   aggregate reduction, diagnostic coherence, or impossible tuple rejection.
2. **Change the v1 schema or wire shape.** Rejected. Released consumers and
   archived validators require its immutable contract.
3. **Apply post-schema validation to exact v1 and v2.** Accepted. It preserves
   the wire contracts and fails closed when cross-field invariants do not hold.

## Decision Outcome

Option 3.

This ADR retains the closed v2 envelope as the current protocol decision. A
dual-read consumer selects exact v1 only when `protocol` is absent and exact v2 only when it is
`shell-warden.verdict.v2`; unknown or malformed protocol and failed v2 validation
remain checker anomalies with no fallback.

After exact schema validation, consumers apply fail-closed semantic validation to
both forms using the expected letter context: its `invocation.id`, command count,
and positional indexes. For an array of length `N`, each entry at position `i`
has index `i`, for `0 <= i < N`; verdict commands have the same positions and
indexes as the letter. The invocation echo, legal classification/match/verdict
tuples, required deny messages, and aggregate `deny > ask > allow` reduction
agree with that context.

It partially supersedes ADR-0016 only for the retired persistent-protocol
statement that there was no ID echo. In the one-shot verdict contract,
`invocationId` correlates a verdict to the letter's `invocation.id`; it is not
a handshake. All other ADR-0016 architecture remains unchanged.

Recognized full and truncated diagnostics agree with classification and stable
reasons. Opaque evidence includes `opaque-expansion`, may also include `complete`
for mixed complete and opaque parts, and excludes invalid-cause reasons. Invalid
evidence includes an invalid-cause reason. Full diagnostics record emitted votes,
not default asks: a part with no emitted vote defaults to ask. A command can
therefore be ask while its recorded votes are only allow. No command is less
restrictive than an emitted vote. A present command `ruleId` is the
UTF-8-byte-order smallest emitted vote whose action matches the command verdict.
A recognized full static/argv/allow result has at least one emitted allow vote.
Any v1 facts object containing a reserved diagnostic key must be an exact valid
full or truncated diagnostic shape; otherwise it fails closed. V1 facts disjoint
from those keys remain legacy-opaque.

The v1 schema and wire shape remain immutable. The normative specifications clarify
these released semantics and consumer enforcement without changing schema or
protocol negotiation.

## Consequences

- (+) Exact v1 and v2 responses receive the same fail-closed cross-field checks.
- (+) The released positional contract is explicit and testable.
- (+) Diagnostics cannot contradict evidence or the decisive verdict unnoticed.
- (-) Hook implementations must maintain semantic validators beyond JSON Schema.
- (-) Hook implementations maintain release-pinned compatibility harnesses.

## Specification and implementation impact

The specifications update their v1 semantic clarification and v2 requirements
under [docs issue 31](https://github.com/agent-guardrails/docs/issues/31). The
checker writes v2 only; the hook implements exact dual-read plus post-schema
validation. This ADR records no implementation release or test execution.
