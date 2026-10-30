# agent-guardrails/docs — agent instructions

This repository is the canonical knowledge base: ADRs (decisions), specifications (normative
contracts), schemas (machine-readable contract). Genres are separated — see README.md.

## When to update what

- **Implementation behavior changed** (protocol, budgets/clamps, config semantics, security
  invariants, cache/verdict rules) in any implementation repo → update the matching document in
  `spec/<family>/` **and** `schemas/` in the same change. Schema and spec change together, never
  separately.
- **An architectural choice was made** (options were actually weighed) → new ADR in `adr/` with the
  next sequential number, MADR structure, `Status: Accepted`. Never edit an Accepted ADR — supersede
  it with a new one ("Supersedes NNNN").
- **A new product/project starts** → add it to the README products table and create a
  `spec/<family>/` skeleton.
- **A design draft is needed** → `design/<topic>.md` only when the work enters the roadmap;
  promote to `spec/` when accepted.

## Rules

- RFC 2119 normative language in `spec/` only. An ADR is one decision per file, ~1 page.
- Schemas are the contract: implementations validate against them; do not add fields to `schemas/`
  without describing them in the corresponding spec section.
- No references to resources outside this organization.
- Documentation changes ship in the same commit/PR as the behavior change they describe.
