# 11 — Roadmap & Open Questions

Version 0.1 · 2026-10-30

## 11.1 Milestones

| M | Scope | Done when |
|---|---|---|
| **M0 skeleton** | schemas (`../../schemas/*.json`), protocol codec, supervisor (spawn/handshake/restart/backoff), mock engine, contract harness | contract suite green against mock |
| **M1 vertical slice** | `evaluate` hook end-to-end; reference TS engine implementing stage walk (08) + config v1 (06) + parsing v1 (07); deny reason visible in native prompt | integration checklist 1–3 pass; golden suite green |
| **M2 hardening** | budgets/violations/unhealthy ladder; shim cache; `onEngineError` drill; sha256 pinning; config reload (last-good) | adversarial cases §10.3 green |
| **M3 audit & observe** | `audit/event` pipeline, `policy/observe`, state-dir audit rollups, log levels | audit visible in server log; observe flag documented |
| **M4 portability** | engine contract extracted as standalone spec; second adapter (CI wrapper or another agent's hook) proving G2 | second adapter merged |

## 11.2 Suggested build order inside M0/M1

1. `packages/schema` — both JSON Schemas + fixtures
2. `protocol.ts` codec (frame parse/serialize, id pool) + unit tests
3. Mock engine + contract harness (fastest feedback loop)
4. Supervisor states (03 §3.3) with deadline/backoff injection
5. `applyVerdict` + tighten-only proof test
6. Reference engine: config loader → normalizer/classifier (07) → stage walk (08) → CLI mode for golden tests
7. Wire into `Plugin.define` and run the OpenCode integration checklist

## 11.3 Open questions

| # | Question | Current lean |
|---|---|---|
| Q1 | Reference engine language: TS-first or Rust-first? | TS for M1 velocity; Rust later behind the same contract |
| Q2 | Default `actions`: `["shell"]` only, or include `edit`? | `["shell"]`; path-canonicalization rules needed before `edit`/`read` |
| Q3 | Singleton engine vs per-session instances | singleton + session tags; revisit if engines grow heavy per-session state |
| Q4 | Naming: `opencode-shell-warden-hook` / `shell-warden` | placeholder — decide before publish |
| Q5 | MCP face for advisory/debug tools | post-M3; see [R§4] hybrid model |
| Q6 | Project-supplied policy behind explicit global opt-in | v2; design the allowlist (`allowProjectPolicy`) when there is demand |
| Q7 | Symlink-resolving canonicalization for `within` path checks | v2; requires fs-walk budget and TOCTOU care |

## 11.4 Risks

| Risk | Mitigation |
|---|---|
| Protocol drift between shim and third-party engines | schemas are the contract; conformance suite in `tests/contract` published for engine authors |
| Shim size creep (the "thin layer" rots) | hard rule: no policy logic in shim; CI check — `packages/plugin/src` LOC budget 400, no imports beyond `@opencode/plugin` + node built-ins |
| Overloaded `message` becoming an injection channel | I11 — templates + allowlisted interpolation only; integration test asserts prompt content |
| Config complexity snowball (stages × conditions) | strict schema validation; golden tests required per example config; keep v1 condition set closed |
