# 0020, Versioned Shell Warden verdict envelope

* **Status:** Accepted (2026-11-11)
* **Deciders:** preved911
* **Related:** [docs issue 31](https://github.com/agent-guardrails/docs/issues/31), [primary hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13), [ADR 0016](0016-two-tier-enforcement.md), [Shell Warden verdict v2 design](../design/shell-warden-verdict-v2.md), [v1 letter and verdict specification](../spec/shell-warden/02-letter-verdict.md), [v1 verdict schema](../schemas/shell-warden.verdict.v1.schema.json)

## Context and Problem Statement

The released one-shot verdict v1 has a flat, closed response shape and only the
`static` and `opaque` wire classifications. The checker already distinguishes
invalid evidence from opaque evidence, but v1 maps invalid to opaque. The hook
needs that distinction without weakening released v1 validation or changing the
letter.

Adding a version property to the v1 root would not reliably distinguish a new
message because the released hook ignores unknown root properties. Widening the
v1 classification enum would break released consumers, violate its closed schema
identity, and make archived validators depend on time.

## Decision Drivers

- Make invalid evidence explicit to future hooks while preserving v1 exactly.
- Keep old-hook handling of new checker output fail closed.
- Give the future hook an unambiguous, closed dual-read boundary.
- Preserve ADR-0016's one-shot checker and thin-hook split.

## Considered Options

1. **Widen v1 classification in place.** Rejected. V1 is a released closed enum
   with a fixed schema identity. Released consumers reject the new value and
   archived validators would no longer have stable meaning.
2. **Add a flat v1 version field.** Rejected. The released hook ignores unknown
   root fields, so it could accept the rest of a message under old semantics.
3. **Use a distinct closed v2 envelope.** Accepted. Required v1 flat fields are
   absent at the root, causing the released hook to reject every v2 message.

## Decision Outcome

Option 3.

`shell-warden.verdict.v1` remains immutable: its flat shape and `static | opaque`
classification are unchanged. The new protocol is a closed envelope with exactly
this root shape:

```json
{
  "protocol": "shell-warden.verdict.v2",
  "result": { "...": "v2 verdict payload" }
}
```

`result` is closed and holds the v2 payload. It retains the v1 verdict semantics
and adds the explicit `invalid` command classification. Static evidence matches
`argv`; opaque and invalid evidence match `raw`; only static may allow. Invalid
evidence contributes bare ask unless an ordinary deny rule matches retained
evidence or raw text. It never creates an automatic deny or allow. Existing
precedence and aggregate lattice remain unchanged.

The letter remains v1 and does not negotiate a response version. A future hook
accepts exact flat v1 only when `protocol` is absent, and exact v2 only when the
protocol equals `shell-warden.verdict.v2`. Unknown or malformed protocol and any
failed v2 validation are checker anomalies that take `onCheckerError`, ask or
deny, without v2-to-v1 fallback. The hook never synthesizes allow.

The old checker writes v1 only. The new checker writes v2 only, regardless of
classification. The hook release/deployment precedes the checker v2
release/deployment. Rollback is checker-first, returning to v1 output while the
new hook continues dual-read validation.

## Consequences

- (+) Invalid evidence becomes explicit without altering the released v1 contract.
- (+) The envelope makes old-checker/new-hook compatibility safe and
  new-checker/old-hook rejection deterministic.
- (+) The protocol discriminator prevents validation fallback from turning an
  invalid v2 response into a v1 response.
- (-) The future hook validates and tests two exact response shapes during the
  migration.
- (-) A new checker cannot run with the released hook, even though that failure
  degrades safely.

## Specification and implementation impact

The design under [docs issue 31](https://github.com/agent-guardrails/docs/issues/31)
defines the follow-up schema, specification, fixtures, checker work, hook work,
compatibility matrix, release order, and completion criteria. The Rust checker
gains one v2 writer; the TypeScript hook gains exact v1 and v2 dual-read
validation. Existing v1 specification and schema artifacts remain unchanged.
This ADR records no implementation release and this documentation change makes no
implementation change.
