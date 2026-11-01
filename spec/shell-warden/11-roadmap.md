# 11 — Roadmap & Open Questions

Version 2.0 · 2026-11-01 · Re-baselined per [ADR-0016](../../adr/0016-two-tier-enforcement.md)

The retired v1.x milestones (persistent engine M0–M4, TS reference engine) are
history: the M0 engine implementation exists in the `shell-warden` repository
as a retired reference. v2 rebuilds the system on two tiers.

## 11.1 Milestones

| M | Scope | Done when |
|---|---|---|
| **M1 decision core** | Rust binary `shell-warden`: config loader (strict, 06), parser (normalize → recursive split → classify, 07), matcher (scope entry, rule vote, refinement, reduction, 08), letter/verdict IO (02) + golden suite + spawn-latency measurement (10 §10.6) | golden suite green over example configs; every board-PR carries its doc slice |
| **M2 hook integration** | letter build, one-shot invoker (03 §3.3), hook-owned state (deny budgets, allow cache, debug log, 03 §3.4–3.5), schema-conforming verdict application; live E2E `OpenCode → hook → shell-warden` (board P3) | integration checklist passes on live OpenCode v2.2.5 with the real checker; deny/allow/ask paths proven |
| **M3 hardening** | adversarial contract cases (10 §3), `onCheckerError: "deny"` drill, concurrency-cap drill, config-valid/invalid fixtures, sha256 pin | adversarial cases green; every I3 row of 09 §9.4 tested |
| **M4 portability** | contract extracted as standalone spec (letter/verdict schemas are already it); second adapter (CI wrapper or another harness's hook) proving G2 | second adapter merged |
| **M5 distribution** | releases of the checker binary; Homebrew tap; public repo (board P3 backlog) | first tagged binary installable from the tap |

## 11.2 Suggested build order inside M1

1. Grammar types + config loader + validation fixtures (06 ⇄ schema)
2. Normalizer + classifier (07 §7.3–7.4) — unit-heavy, highest risk
3. Recursive chain splitter (07 §7.2) — golden cases per construct
4. Matcher: flag table + token/glob/flagValue/paths conditions (06 §6.4–6.5)
5. Pipeline: refinement → first-deny/reduction → message (08)
6. Letter/verdict IO + CLI + exit codes (02)
7. Golden runner + measurement (10)

## 11.3 Open questions

| # | Question | Current lean |
|---|---|---|
| Q1 | Reference checker language | **Answered — Rust** (ADR-0015, carried by 0016) |
| Q2 | Default `actions`: `["shell"]` only, or include `edit`? | `["shell"]`; path-canonicalization rules needed before `edit`/`read` (N5) |
| Q3 | Context lookups (git branch/env/time) for placement rules? | v2 candidate; v1 keeps rules text-only (N6); letter carries no context by design (I6) |
| Q4 | MCP face for advisory/debug tools | post-M4; letter/verdict shapes are harness-neutral, MCP adds ceremony without a channel win |
| Q5 | Project-supplied policy behind explicit global opt-in | v2; design the allowlist (`allowProjectPolicy`) when there is demand |
| Q6 | Symlink-resolving canonicalization for paths conditions | v2; requires fs-walk budget and TOCTOU care (T9) |
| Q7 | Cache TTL default > 0 (allow caching on by default)? | default 0 until M2 latency data; revisit with §10.6 measurements |
| Q8 | Wrapper/interpreter unwrap depth budget (07 §7.2) | cap list + depth in v1 grammar review; oversized nesting ⇒ opaque (fail-closed) |

## 11.4 Risks

| Risk | Mitigation |
|---|---|
| Contract drift between hook (TS) and checker (Rust) | schemas are the contract; contract suite runs the hook against a scripted mock (10 §10.1); schema-conformance gates on both sides |
| Per-check spawn latency growth | golden measurement gate (§10.6) before M1 merge; spawn ≪ guarded command runtime accepted by ADR-0016 on measured basis |
| Hook size creep (the "thin layer" rots) | hard rule: no policy logic in hook; CI check — no imports beyond `@opencode/plugin` + node built-ins; ~400 LOC budget |
| Overloaded `message` becoming an injection channel | I11 — templates + allowlisted interpolation only; integration test asserts prompt content |
| Config complexity snowball (stages × conditions) | strict schema validation; golden tests required per example config; v1 condition set is closed (06 §6.5) |
| Parser under-splitting a construct (false `static`) | recursive splitter per construct with golden cases; default `ask` for anything unrecognized (I10); adversarial suite §10.3 |
