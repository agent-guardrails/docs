# Design: Shell Warden verdict v2

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/docs/issues/31
Primary hook work: https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13
Decision: [ADR-0021](https://github.com/agent-guardrails/docs/blob/main/adr/0021-post-schema-shell-warden-verdict-validation.md), current decision; [ADR-0020](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md) is superseded historical provenance.
Normative contract: [spec/shell-warden/02-letter-verdict.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md)
Schema: [schemas/shell-warden.verdict.v2.schema.json](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v2.schema.json)

## Purpose

The released verdict v1 wire contract has only `static` and `opaque` command
classifications. Shell Warden already distinguishes `complete`, `opaque`, and
`invalid` evidence internally. Version 1 maps both `opaque` and `invalid` to
wire `opaque`, which hides a useful fail-closed distinction from the hook.

This design introduces a separate verdict v2 contract that carries `invalid`
explicitly. It records the response migration without changing policy behavior,
the request letter, or the released v1 contract.

This is a design artifact. This contract PR adds the schema, fixtures, and
specification that define the normative wire contract; it adds no Rust checker or
TypeScript hook implementation.

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
    "commands": [
      { "index": 0, "verdict": "ask", "classification": "invalid", "match": "raw" }
    ]
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
| `opaque` | Structure is coherent and supported, but runtime-dependent content is unknown. Unterminated quoting remains opaque because its token is unresolvable. | `raw` | `ask`, `deny` |
| `invalid` | Required typed evidence cannot be constructed because it is malformed, internally inconsistent, unsupported where required, or exceeds a resource or evidence limit. | `raw` | `ask`, `deny` |

Invalid evidence establishes an ask floor and never allows. When no ordinary rule
emits a vote, an invalid part contributes a bare `ask` without `ruleId`. Ordinary
ask or deny rules may match retained evidence or raw text; an emitted ask carries
the deterministic `ruleId`, and deny remains dominant. Invalid evidence never
creates an automatic deny.

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
| `protocol` absent | Validate only the exact flat v1 schema, then apply post-schema semantic invariants. |
| `protocol` exactly `shell-warden.verdict.v2` | Validate only the exact v2 envelope and nested result schema. |
| Unknown, malformed, or non-string `protocol` | Treat as a checker anomaly and fail through `onCheckerError`. |
| Failed v2 validation | Treat as a checker anomaly. Do not retry as v1. |

The old checker writes v1 only. The new checker writes v2 for every
classification. Response version is never selected from command data. The new
checker does not emit v1 as a fallback.

The future dual-read hook applies semantic invariants after either exact schema
validation using the expected letter invocation ID and positional indexes:
positional contiguous command indexes matching the letter at every array position, legal
classification/match/verdict tuples, required deny messages, full-diagnostics
coherence, and aggregate consistency. Thus an exact-valid v1 impossible tuple such as opaque/argv/allow
fails through `onCheckerError`, without changing the v1 schema or released v1
producer behavior. The hook enforces the 64 KiB verdict cap before parsing; facts
remain limited to 16 KiB and depth 8.

| Checker | Hook | Outcome |
|---|---|---|
| Old | Old | Exact schema-valid v1 operation. |
| Old | New | Exact schema-valid v1 operation. The new hook then applies semantic invariants. |
| New | Old | Fail closed, but operationally incompatible for every verdict because the v2 envelope lacks required legacy flat root fields. |
| New | New | Compatible v2 operation with explicit invalid classification. |

## Rollout and rollback

Compatible checker and hook releases are published together as one coordinated
pair for [hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13).
Deployment remains hook dual-read first, then checker v2.

1. Add the v2 verdict schema and the matching specification update. Preserve the
    v1 schema byte-for-byte and the released v1 wire semantics; this specification
    expansion only clarifies those preserved semantics.
2. Add hook dual-read validation and contract tests for exact v1, exact v2,
    malformed protocol, malformed v2, and no v2-to-v1 fallback.
3. Add checker v2 serialization, diagnostics fixtures, and golden coverage. The
   new checker writes v2 for all verdicts and classifications.
4. Publish the compatible checker and hook releases together as one coordinated
    pair.
5. Deploy the dual-read hook first, then deploy the v2-only checker. Confirm
    production compatibility and complete the migration only after the
    hook accepts both exact forms and the checker emits v2 consistently.

Rollback is checker-first: restore an old checker that emits v1 while retaining
the new hook's dual-read support. Rolling back the hook before the checker would
make every v2 response operationally incompatible.

## Deliverables and handoffs

The contract layer of this change delivers a closed
`shell-warden.verdict.v2` schema, the corresponding specification sections,
versioned fixtures, and compatibility examples. It preserves the v1 schema
byte-for-byte and preserves the v1 wire semantics in the expanded specification.

Rust checker work delivers a single v2 writer for all outcomes, v2 schema
validation before output, bounded stable diagnostics, golden cases for static,
opaque, invalid bare ask, and invalid ordinary deny, plus output-size checks.

TypeScript hook work delivers exact response discrimination, v1 and v2 schema
validation, fail-closed anomaly handling, and contract tests for the compatibility
matrix. It continues to apply verdicts tighten-only and never invents allow.

Release completion requires the schema/spec, checker, and hook deliverables above,
the consumer-first deployment order, passing compatibility tests, and a verified
checker-first rollback path. This documentation PR adds the schema, fixtures, and
specification artifacts only; it makes no Rust checker or TypeScript hook
implementation changes.

## Non-goals

This design does not change rule semantics, evidence precedence, aggregation,
messages, request-letter versioning, hook policy behavior, or diagnostics limits.
It adds no compatibility shim beyond exact future-hook dual-read of v1 and v2.
