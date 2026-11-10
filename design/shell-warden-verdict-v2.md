# Design: Shell Warden verdict v2

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/docs/issues/31
Primary hook work: https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md

## Purpose

The released verdict v1 wire contract has only `static` and `opaque` command
classifications. Shell Warden already distinguishes `complete`, `opaque`, and
`invalid` evidence internally. Version 1 maps both `opaque` and `invalid` to
wire `opaque`, which hides a useful fail-closed distinction from the hook.

This design introduces a separate verdict v2 contract that carries `invalid`
explicitly. It records the response migration without changing policy behavior,
the request letter, or the released v1 contract.

This is a design artifact. The later schema and specification change defines the
normative wire contract.

## Existing contract and compatibility boundary

`shell-warden.verdict.v1` remains immutable. It has its released flat root shape,
its closed schema identity, and command classification `static | opaque`. The
letter remains v1 and has no response-version negotiation field.

V2 is an unmistakably different envelope:

```json
{
  "protocol": "shell-warden.verdict.v2",
  "result": {
    "invocationId": "msg:call",
    "verdict": "ask",
    "commands": []
  }
}
```

The root object is closed and contains exactly `protocol` and `result`. The
nested `result` object is also closed. It holds the v2 verdict payload, retaining
the v1 payload's field meanings, bounds, aggregation rules, and message rules,
while extending command `classification` to `static | opaque | invalid`.

The nesting is deliberate. A released v1 hook requires flat root fields such as
`invocationId`, `verdict`, and `commands`, so it rejects every v2 response. That
is fail closed and operationally incompatible, not an accidental compatibility
mode. Adding a flat version field to v1 is unsafe because the released hook
ignores unknown root properties. In-place widening of the v1 classification enum
is also rejected: v1's enum and schema identity are closed, released consumers
reject an unknown value, and archived validators would become time-dependent.

## V2 result semantics

The result continues the established evidence and policy model:

| Classification | Evidence state | Match | Permitted verdicts |
|---|---|---|---|
| `static` | All participating evidence is complete. | `argv` | `allow`, `ask`, `deny` |
| `opaque` | Structure is supported, but runtime-dependent content is unknown. | `raw` | `ask`, `deny` |
| `invalid` | Evidence is malformed, internally inconsistent, unsupported where required, or exceeds a resource or evidence limit. | `raw` | `ask`, `deny` |

An invalid part contributes a bare `ask` unless an ordinary deny rule matches its
retained evidence or raw text. An invalid `deny` is valid only through that
ordinary deny match. Invalid evidence never creates an automatic deny and never
allows. Ask rules may likewise match retained evidence or raw text.

Command classification retains the precedence already established by spec 08
section 8.6: a command is `invalid` if any participating part is invalid;
otherwise it is `opaque` if any participating part is opaque; otherwise it is
`static`. Aggregate verdicts and messages do not change. The same lattice applies
within parts, across parts, and across commands:

```text
deny > ask > allow
```

Thus an invalid bare ask plus allows aggregates to ask. An invalid deny that is
produced by an ordinary deny rule aggregates to deny. Unknown, malformed, or
unsupported response values are checker anomalies. The hook handles them with
its configured `onCheckerError` action, `ask` or `deny`, and never synthesizes
allow.

Diagnostics remain bounded and machine readable. V2 carries only the stable
reason codes listed in spec 07 section 7.3. It does not put parser or library
diagnostic text on the wire. Facts remain capped at 16 KiB and depth 8; the full
verdict remains capped at 64 KiB.

## Reader and writer behavior

The future hook is dual-read at the response boundary:

| Response shape | Hook behavior |
|---|---|
| `protocol` absent | Validate only the exact flat v1 schema. |
| `protocol` exactly `shell-warden.verdict.v2` | Validate only the exact v2 envelope and nested result schema. |
| Unknown, malformed, or non-string `protocol` | Treat as a checker anomaly and fail through `onCheckerError`. |
| Failed v2 validation | Treat as a checker anomaly. Do not retry as v1. |

The old checker writes v1 only. The new checker writes v2 for every
classification. Response version is never selected from command data. The new
checker does not emit v1 as a fallback.

| Checker | Hook | Outcome |
|---|---|---|
| Old | Old | Compatible v1 operation. |
| Old | New | Compatible. The new hook exact-validates v1. |
| New | Old | Fail closed, but operationally incompatible for every verdict because the v2 envelope lacks required legacy flat root fields. |
| New | New | Compatible v2 operation with explicit invalid classification. |

## Rollout and rollback

Implementation releases are coordinated but need not be simultaneous. The hook
release and deployment precede the checker v2 release and deployment.

1. Add the v2 verdict schema and the matching specification update. Preserve the
   v1 schema and specification unchanged.
2. Add hook dual-read validation and contract tests for exact v1, exact v2,
   malformed protocol, malformed v2, and no v2-to-v1 fallback. Release and deploy
   that hook before any checker emits v2.
3. Add checker v2 serialization, diagnostics fixtures, and golden coverage. The
   new checker writes v2 for all verdicts and classifications.
4. Release and deploy the checker only after the dual-read hook is deployed.
5. Confirm production compatibility and complete the migration only after the
   hook accepts both exact forms and the checker emits v2 consistently.

Rollback is checker-first: restore an old checker that emits v1 while retaining
the new hook's dual-read support. Rolling back the hook before the checker would
make every v2 response operationally incompatible.

## Deliverables and handoffs

The contract layer of this change delivers a closed
`shell-warden.verdict.v2` schema, the corresponding specification sections,
versioned fixtures, and compatibility examples. It also preserves the v1
schema/spec byte-for-byte.

Rust checker work delivers a single v2 writer for all outcomes, v2 schema
validation before output, bounded stable diagnostics, golden cases for static,
opaque, invalid bare ask, and invalid ordinary deny, plus output-size checks.

TypeScript hook work delivers exact response discrimination, v1 and v2 schema
validation, fail-closed anomaly handling, and contract tests for the compatibility
matrix. It continues to apply verdicts tighten-only and never invents allow.

Release completion requires the schema/spec, checker, and hook deliverables above,
the consumer-first deployment order, passing compatibility tests, and a verified
checker-first rollback path. This documentation PR changes the contract artifacts
only; it makes no Rust checker or TypeScript hook implementation changes.

## Non-goals

This design does not change rule semantics, evidence precedence, aggregation,
messages, request-letter versioning, hook policy behavior, or diagnostics limits.
It adds no compatibility shim beyond exact future-hook dual-read of v1 and v2.
