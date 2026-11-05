# 0017, Schema-first Shell Warden configuration contract

* **Status:** Accepted (2026-11-06)
* **Deciders:** preved911
* **Related:** [ADR 0016](https://github.com/agent-guardrails/docs/blob/main/adr/0016-two-tier-enforcement.md), [issue 21](https://github.com/agent-guardrails/docs/issues/21), [Shell Warden configuration v2 design](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-config-v2.md)

## Context and Problem Statement

The v2 configuration design introduced typed evidence, complete allow coverage,
fixed option arity, and a fail-closed verdict lattice. Its public JSON contract
must now be unambiguous enough for a JSON Schema, a specification, fixtures, and
an implementation to agree. Rust implementation DTOs can use convenient enums
or structs, but Serde's externally tagged shapes can accidentally expose nested
objects that are not the intended user configuration.

That ambiguity is security-relevant. A policy author must be able to see exactly
which evidence is covered. A parser must never infer an option boundary, unwrap
an implementation-only representation, or silently accept an older grammar.

## Decision Drivers

- One public, machine-checkable JSON shape for every selector and coverage form.
- Allow coverage remains complete, typed, bounded, and fail-closed.
- Repeated fixed-arity options remain explicit rather than becoming a variadic
  escape hatch.
- The public contract can evolve without coupling its JSON shape to Rust DTO
  layout.

## Considered Options

1. **Expose Serde DTO shapes as the contract.** Rejected. Externally tagged
   enums can produce accidental nested forms and make language implementation
   details part of the policy contract.
2. **Keep a prose-only design and let implementation types settle shapes.**
   Rejected. Schema, fixtures, and implementations would have no single source
   for validation.
3. **Define a schema-first, one-level public contract and adapt DTOs at the
   implementation boundary.** Accepted.

## Decision Outcome

Option 3.

The public v2 configuration is defined by its JSON Schema and matching
specification. Every tagged selector or coverage union is a one-level object:
its discriminator maps directly to its payload. The design records the exact
forms and semantic checks that the future schema and specification must carry.

Implementation DTOs are adapters. They deserialize or convert the validated
public shape into internal representations, but do not define the public JSON
shape. In particular, nested externally tagged Serde forms are invalid input:
`{ "none": { "none": true } }` and
`{ "each": { "each": { "any": true } } }` are not aliases for valid v2
forms.

Option arity is an integer from zero through four. An arity-one option may opt
into `--long=value`; arities two through four consume exactly that many separate
following tokens. There is no variadic option form. Homogeneous lists use
repeated fixed-arity options and each occurrence remains subject to coverage and
repeatability checks.

V2 accepts v2 only. It has no backward compatibility layer, legacy parser,
deprecation path, automatic migration, or fallback grammar.

## Consequences

- (+) Policy authors, schemas, fixtures, and implementations validate the same
  JSON contract.
- (+) Complete coverage is visible in configuration and cannot be hidden behind
  a DTO layout.
- (+) Fixed arity makes option parsing and repeated-option coverage
  deterministic.
- (−) Implementations must maintain explicit conversion code between public
  schema values and internal DTOs.
- (−) Existing v1 policy files require deliberate replacement outside the v2
  parser.

## Spec impact and implementation plan

The accepted configuration design at
[design/shell-warden-config-v2.md](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-config-v2.md)
is the design-level source for the public shapes, semantic validation, bounds,
and positive and rejected examples. When implementation work starts, the v2
schema, the matching normative specification, fixtures, and parser tests change
together. No accepted v1 schema or parser gains a compatibility fallback.
