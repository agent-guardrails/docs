# 11 — Roadmap & Open Questions

Version 2.3 · 2026-11-11 · Configuration contract re-baselined per
[ADR-0017](https://github.com/agent-guardrails/docs/blob/main/adr/0017-schema-first-shell-warden-config-contract.md) and verdict v2 per
[ADR-0021](https://github.com/agent-guardrails/docs/blob/main/adr/0021-post-schema-shell-warden-verdict-validation.md) and
[docs issue 31](https://github.com/agent-guardrails/docs/issues/31)

The retired v1.x milestones (persistent engine M0–M4, TS reference engine) are
history: the M0 engine implementation exists in the `shell-warden` repository
as a retired reference. v2 rebuilds the system on two tiers.

## 11.1 Milestones

| M | Scope | Done when |
|---|---|---|
| **M1 decision core** | Rust binary `shell-warden`: schema-first v2 config loader (strict, 06), parser (normalize → recursive split → classify, 07), action-sensitive matching, complete allow coverage, lattice reduction (08), letter/verdict IO (02), golden suite, and spawn-latency measurement (10 §10.6) | schema/semantic fixtures and golden suite green; every board PR carries its doc slice |
| **M2 hook integration** | letter build, one-shot invoker (03 §3.3), hook-owned state (deny budgets, allow cache, debug log, 03 §3.4–3.5), schema-conforming verdict application; live E2E `OpenCode → hook → shell-warden` (board P3) | integration checklist passes on live OpenCode v2.2.5 with the real checker; deny/allow/ask paths proven |
| **M3 hardening** | adversarial contract cases (10 §3), `onCheckerError: "deny"` drill, concurrency-cap drill, config-valid/invalid fixtures, sha256 pin | adversarial cases green; every I3 row of 09 §9.4 tested |
| **M4 portability** | contract extracted as standalone spec (letter/verdict schemas are already it); second adapter (CI wrapper or another harness's hook) proving G2 | second adapter merged |
| **M5 distribution** | releases of the checker binary; Homebrew tap; public repo (board P3 backlog) | first tagged binary installable from the tap |

## 11.2 Suggested build order inside M1

1. Grammar types + config loader + validation fixtures (06 ⇄ schema)
2. Normalizer + classifier (07 §7.3–7.4) — unit-heavy, highest risk
3. Recursive chain splitter (07 §7.2) — golden cases per construct
4. Matcher: one-level typed selectors, fixed-arity option parsing, and coverage policies (06 §6.4–6.9)
5. Pipeline: predicate satisfaction → allow coverage validation → `deny > ask > allow` reduction → message (08)
6. Letter/verdict IO + CLI + exit codes (02)
7. Golden runner + measurement (10)

## 11.3 Open questions

| # | Question | Current lean |
|---|---|---|
| Q1 | Reference checker language | **Answered — Rust** (ADR-0015, carried by 0016) |
| Q2 | Default `actions`: `["shell"]` only, or include `edit`? | `["shell"]`; path-canonicalization rules needed before `edit`/`read` (N5) |
| Q3 | Context lookups (git branch/env/time) for placement rules? | outside v2; the letter carries no such context and evidence production performs no I/O (I6/I15) |
| Q4 | MCP face for advisory/debug tools | post-M4; letter/verdict shapes are harness-neutral, MCP adds ceremony without a channel win |
| Q5 | Project-supplied policy behind explicit global opt-in | outside v2; user-global policy remains the trust boundary |
| Q6 | Symlink-resolving canonicalization for path conditions | outside v2; requires filesystem I/O and TOCTOU analysis (T9) |
| Q7 | Cache TTL default > 0 (allow caching on by default)? | default 0 until M2 latency data; revisit with §10.6 measurements |
| Q8 | Wrapper/interpreter unwrap depth budget (07 §7.2) | answered for v2: closed maximum 32; overflow ⇒ invalid evidence |

## 11.4 Risks

| Risk | Mitigation |
|---|---|
| Contract drift between hook (TS) and checker (Rust) | schemas are the contract; contract suite runs the hook against a scripted mock (10 §10.1); schema-conformance gates on both sides |
| Per-check spawn latency growth | golden measurement gate (§10.6) before M1 merge; spawn ≪ guarded command runtime accepted by ADR-0016 on measured basis |
| Hook size creep (the "thin layer" rots) | hard rule: no policy logic in hook; CI check — no imports beyond `@opencode/plugin` + node built-ins; ~400 LOC budget |
| Overloaded `message` becoming an injection channel | I11 — templates + allowlisted interpolation only; integration test asserts prompt content |
| Config complexity snowball | one-level closed unions, fixed arity, strict draft-2020-12 schema, exhaustive fixture families, and semantic validation (06 §6.9, 10 §10.3.1) |
| Parser under-splitting a construct (false `static`) | recursive splitter per construct with golden cases; default `ask` for anything unrecognized (I10); adversarial suite §10.3 |

## 11.5 Verdict v2 rollout and release completion

Publish compatible hook and checker releases together as one coordinated pair for
[hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13).
Deploy the dual-read hook first, then the v2-only checker. Roll back the checker
first, returning it to v1 output while the deployed hook continues dual-read
validation.

| Checker | Hook | Required behavior |
|---|---|---|
| Old v0.4.0 | Old | Exact schema-valid v1 normal; internal invalid remains opaque on wire. |
| Old v0.4.0 | New | Exact schema-valid v1 normal; opaque is not reinterpreted as invalid. |
| New | Old | V2 fails closed through `onCheckerError` because legacy flat root fields are missing; operationally incompatible. |
| New | New | V2 normal. |

Migration MUST NOT be reported complete until docs/schema are merged, the hook is
released and deployed, the checker is released and deployed, compatibility and
rollback tests pass, and deployed checker v2 emission is verified. This contract
change does not complete implementation or rollout.

The hook repository implementation handoff MUST require revision-pinned shell-warden
v0.4.0 `04cfe594b433d05343044bb848891d7942a4b87c` and hook v0.2.1
`7090301963bed3fbe9d2a3f0babf413d521f75f4` harness tests with revision
provenance for exact-valid-v1 preservation and v2-envelope rejection through
`onCheckerError`. This repository makes no claim that those external tests ran.
