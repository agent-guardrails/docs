# HANDOFF — Checker implementation (next session kickoff)

References: [ADR-0016](../../adr/0016-two-tier-enforcement.md) defines two-tier enforcement;
[ADR-0017](../../adr/0017-schema-first-shell-warden-config-contract.md) defines the public
configuration contract. Specs 06–10 and `schemas/shell-warden.config.v2.schema.json` mirror the
accepted design. Letter and verdict remain on their separately versioned v1 schemas until their
coordinated diagnostics update.
The retired M0 engine (persistent, ADR-0002/0005/0008) stays in `agent-guardrails/shell-warden`
as reference only — do not extend it; new work is the one-shot decision binary.

## Board

- [docs issue 21](https://github.com/agent-guardrails/docs/issues/21) owns the schema-first
  configuration contract alignment.
- Checker implementation follows in the `shell-warden` repository: one-shot letter/verdict,
  not the retired NDJSON protocol.
- Hook integration and live OpenCode E2E remain separate repository tickets.

## Toolchain

Rust toolchain installed on the dev machine (M0 session used it); start `cargo check` green.

## M1 build order (11 §11.2, updated reference)

| Step | Unit | Spec + acceptance |
|---|---|---|
| 1 | Public DTO adapter + config loader | 06 + draft-2020-12 config schema: validate the public one-level shape before conversion; valid/invalid fixture families; engine-only cross-reference/catalog checks |
| 2 | Normalizer + classifier | 07 §7.3–7.4; unit-heavy: each unresolvable step ⇒ opaque; table-driven cases |
| 3 | Recursive chain splitter | 07 §7.2; golden case per construct (operators, wrappers, substitutions, redirects); never trust the letter's split |
| 4 | Matcher and coverage engine | 06 §6.4–6.9 + schema; string/token/path/typed selectors, fixed-arity options, occurrence-aware universal coverage |
| 5 | Pipeline | 08 §8.2–8.5; predicate satisfaction → allow coverage validation → fixed lattice reduction → message |
| 6 | Letter/verdict IO + CLI | 02 + schemas; exit codes 0/1/2; schema-conformance both directions |
| 7 | Golden runner + measurement | 10 §10.2/§10.6; every rule ≥ 1 positive + negative case; p95 ≤ 10 ms gate |

## Hook-side follow-ups (separate repo, its own tickets)

Letter build, one-shot invoker with deadline/grace, deny budgets (0010), allow cache (TTL from
hook options), debug log — the hook currently speaks the retired persistent protocol; those
parts are retired with it. Hook owner: `opencode-shell-warden-hook` P2/P3 tickets.

## Reusable facts from the prior sessions

- Reply automation proven live: reply wins over client auto-reject (28 ms vs ~40 ms); reason
  reaches the agent; hook-allow on evaluate never worked (superseded path).
- Open head risks to keep in golden set: 10 §10.3 adversarial table (each row = a test).
- Latency gate: p95 ≤ 10 ms before M1 merge (10 §10.6).
