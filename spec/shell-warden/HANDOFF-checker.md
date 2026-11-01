# HANDOFF — Checker implementation (next session kickoff)

Reference: [ADR-0016](../../adr/0016-two-tier-enforcement.md) (two-tier enforcement) is the
source of truth; spec v2.0 in this directory mirrors it (02 letter/verdict, 06 rules grammar,
07 parsing, 08 pipeline). Schemas: `schemas/shell-warden.{letter,verdict,config}.v1.schema.json`.
The retired M0 engine (persistent, ADR-0002/0005/0008) stays in `agent-guardrails/shell-warden`
as reference only — do not extend it; new work is the one-shot decision binary.

## Board

- `P1 · shell-warden v2: sync спеки — ADR-0016` — **this PR closes the spec-sync slice**;
  implementation continues under:
- `P2 · shell-warden: реализация checker'а (Rust) — wire → split → шаблон-матч → вердикт + E2E с шимом`
  (n.b. per ADR-0016: one-shot letter/verdict, not the NDJSON wire protocol).
- `P3 · shell-warden E2E: шим → shell-warden → тул на живом OpenCode v2.2.5`.

## Toolchain

Rust toolchain installed on the dev machine (M0 session used it); start `cargo check` green.

## M1 build order (11 §11.2, updated reference)

| Step | Unit | Spec + acceptance |
|---|---|---|
| 1 | Grammar types + config loader | 06 + config schema: strict validation, unknown field ⇒ invalid, caps; golden fixtures for invalid configs |
| 2 | Normalizer + classifier | 07 §7.3–7.4; unit-heavy: each unresolvable step ⇒ opaque; table-driven cases |
| 3 | Recursive chain splitter | 07 §7.2; golden case per construct (operators, wrappers, substitutions, redirects); never trust the letter's split |
| 4 | Matcher: flags table, conditions | 06 §6.4–6.5 + schema; argv/argvAt/pattern/flag/flagValue/paths per 07 §7.5 |
| 5 | Pipeline: refinement → first-deny → reduction → message | 08 §8.2–8.5; refinement unit tests (bash-guard code as reference) |
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
