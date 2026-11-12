# 10 — Testing Strategy

Version 2.4 · 2026-11-12 · Revised for verdict v2 only per
[ADR-0023](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md) and
[docs issue 33](https://github.com/agent-guardrails/docs/issues/33): draft-2020-12 schema
fixtures, golden checker coverage, profile-driven scenario/property tests, and the hook contract
against a scripted mock binary.

## 10.1 Suites

| Suite | What | Where | Needs OpenCode |
|---|---|---|---|
| Unit (checker) | analyzer fact catalogs (`analyzers`: `sed-v1` program forms, `export-v1` assignments, `xargs-v1` nested-command extraction), letter parse/validation (`letter`), wire shapes and classification mapping (`verdict`), regex + lexical path comparison (`matcher`) | `src/checker/{analyzers,letter,verdict,matcher}.rs` | no |
| Pipeline scenario matrix | `pipeline_tests`: the full evaluate() path per `06`/`07`/`08` — profile grammar, coverage proofs, redirect resolution (inherit/extend/replace), evidence states, wrapper/substitution/`xargs-v1` nesting, and the design's evaluation-scenario rows; the sed and xargs rows are scenario TEMPLATES whose surrounding profiles and rules are part of the test config (`tests/fixtures/sketch.jsonc` patterns) | `tests/pipeline_tests.rs` | no |
| Property invariants | reorder-invariance (`reorder_rules_options_policies_keeps_verdicts`) and monotonicity (`added_allow_cannot_lower_ask`) — 08 §8.6 MUSTs | `tests/pipeline_tests.rs` | no |
| Golden (checker CLI) | letter JSON in → verdict JSON out through the `shell-warden` binary, diffed against `expect` for every case | `tests/golden.rs` + `tests/golden/cases/*.json` | no |
| Config schema | definition-scoped valid/invalid JSON fixtures; AJV 8.17.1 draft-2020-12 validation with strict types and coercion disabled | `schemas/fixtures/shell-warden.config.v2/` | no |
| Config semantic validation | cross-reference, catalog, option-arity/value-policy, duplicate canonical-ID, regex compilation, and cap checks that JSON Schema cannot express (06 §6.9) | `tests/` (via `load_str`) | no |
| Contract (hook) | hook vs a **mock checker** (scripted binary): spawn success/fail, timeout kill + grace, garbage/oversize/empty stdout, non-zero exits (incl. 2), schema-violating verdict, wrong `invocationId` echo, concurrency cap, tighten-only proof, cache TTL, deny budget | `tests/contract` (hook repo) | no |
| Integration | real OpenCode: allowlist scenario, deny with visible reason in native prompt, `onCheckerError: "deny"` drill (non-spawnable checker path), project-config-ignored warning | `tests/integration` (manual/CI with `opencode run`) | yes |

## 10.2 Golden format

```jsonc
// tests/golden/cases/vcs-no-force-push.json
{
  "letter": { "version": 1,
              "invocation": { "id": "t1", "sessionID": "s1", "projectDir": "/repo" },
              "action": "shell",
              "commands": [{ "index": 0, "raw": "git push --force origin main", "cwd": "/repo" }] },
  "expect": { "protocol": "shell-warden.verdict.v2",
              "result": { "verdict": "deny", "message": "contains:forbidden",
                          "commands": [{ "index": 0, "ruleId": "git/deny-force-push" }] } }
}
```

The runner executes the built `shell-warden` binary with
`examples/configs/shell-warden.example.jsonc` (the single shipped v2 example) and letter-in →
verdict-out per case; the runner diffs actual vs `expect` (subset match; extra fields
ignored; an expected element carrying an `index` anchors to the actual element at that
position of the parent array; `expect.message` supports a `contains:` prefix for substring
assertions). Every rule in the example config MUST have at least one positive and one
negative case. Spawn latency is recorded per case (§10.6).

## 10.3 Required adversarial cases (v2)

| Case | Expected |
|---|---|
| `echo $(whoami)` against an allow rule for `echo *` | `ask` — `opaque` evidence cannot allow (I10/I12) |
| `git status --unknown-option` with no matching ordinary rule | bare `ask` without `ruleId` — invalid evidence establishes the ask floor and blocks allow (I12) |
| `git status --unknown-option` against a matching ordinary ask rule | `ask` with the deterministic emitted-ask `ruleId` — invalid evidence may match ordinary ask rules |
| `git log --oneline --oneline` where the option entry is `repeatable: false` | `ask` (`option-not-repeatable`) |
| `git log` where the option entry is `required: true` | `ask` (`required-option-missing`) |
| `git status > /tmp/other/x` vs a redirect policy rooted at `/tmp/reports` | `ask` (`redirect-policy-uncovered`) — a weaker non-redirect `paths` change never loosens it |
| `GIT_DIR=/tmp/x git status` vs `environment: { "none": true }` | `ask` (`allow-coverage-missing`) |
| `sed -i 's/a/b/' file` against a `sed-v1` profile whose rule denies fact `executionPrimitive: inPlace` | `deny` (analyzer emits the fact; the RULE emits the deny) |
| `xargs rm -rf /` with `xargs-v1` and a nested `rm` profile denying exact `["/"]` + its recursive-force option | `deny` via the `analyzer-command` nested part joining the lattice |
| `git status; git push --force` (chain in one raw) | split into parts; the `rm`-like deny part dominates the aggregate; parts recorded in `facts` diagnostics |
| `bash -c 'git push --force'` on twinned git rules | wrapper unwrapped (07 §7.2); same verdicts as the direct command |
| reorder profiles, rules, options, hints, or policy entries | verdicts unchanged (reorder-invariance property test, 08 §8.6) |
| add a matching allow where an ask already emits | still `ask` — an added allow cannot lower the lattice result |
| rules file with a non-`ask` `defaults.action` | config invalid, exit 2, checker degrades — never fail-open |
| configured `maxRequestCommands` > 128 | hook warns and clamps to 128; no degradation solely from configuration |
| request command count > effective `maxRequestCommands` / letter > 64 KiB | hook degrades locally, no spawn — I4 |
| hook receives verdict with foreign `invocationId` | degrade — I7 |
| hook receives a verdict with an unknown `match` value or mismatched command index | degrade — I7 |
| hook receives a flat v1 response | `onCheckerError`; v1 is not an active runtime contract |
| no emitted vote for a participating part | per-part default ask; command can be ask with only emitted allow votes |
| recognized full static/argv/allow has no emitted allow vote | degrade |
| present `ruleId` is not the UTF-8-byte-order smallest emitted vote matching the command verdict, or default ask has no emitted ask vote and carries `ruleId` | degrade |
| complete and opaque parts in one command | opaque result requires `opaque-expansion`, permits `complete`, and rejects invalid-cause reasons |
| diagnostics truncation with more than eight complete reasons | retained reasons include `complete`, then the lowest other UTF-8-byte reasons; output is sorted, unique, and has at most eight entries |
| diagnostics truncation with more than eight opaque reasons | retained reasons include `opaque-expansion`, then the lowest other UTF-8-byte reasons; output is sorted, unique, and has at most eight entries |
| diagnostics truncation with more than eight invalid reasons | retained reasons include the lowest UTF-8-byte invalid-cause reason, then the lowest other UTF-8-byte reasons; output is sorted, unique, and has at most eight entries |
| repeated rejected-allow findings for one rule ID | one canonical `rejected` entry carries all sorted, unique coverage reasons; duplicate rule IDs, including property-order variants, are rejected |
| non-ASCII competing rule IDs | choose the lexicographically smallest UTF-8 byte sequence |
| hook receives two JSON values on stdout | degrade |
| deny budget: 4th deny of the same rule | hook silent; request to human (ADR-0010) |
| stale allow after rules tightening | uncached next check sees new rules; cached allow bounded by TTL — I9 |

### 10.3.1 Schema definition and fixture matrix

Each fixture file lives under `valid/<Definition>/` or `invalid/<Definition>/`; the directory
name selects the schema `$defs` entry. Array-valued fixture files contain one case per union arm
and the fixture runner validates every element independently. `Config` selects the root schema.

| Engine type / contract concern | Schema definition | Fixture family |
|---|---|---|
| argument predicates | `ArgumentsMatcher` | `ArgumentsMatcher` |
| positional remainder policy | `RemainderPolicy` | `RemainderPolicy` |
| string/path token selectors | `TokenSelector` | `TokenSelector` |
| lexical path selector arms, including `exact` | `PathSelector` | `PathSelector` |
| ordinary option predicates | `OptionsMatcher` | `OptionsMatcher` |
| zero-arity option coverage | `OptionCoverage` | `OptionCoverage` |
| positive-arity option coverage | `PositiveArityOptionCoverage` | `PositiveArityOptionCoverage` |
| replacement for old `ValuesCoverage` | `OptionValueCoverage` | `OptionValueCoverage` |
| complete allow option policy | `OptionsCoverage` | `OptionsCoverage` |
| redirect structure and target paths | `RedirectPolicy`, `RedirectPolicyOverride` | `RedirectPolicy`, `RedirectPolicyOverride` |
| ordinary redirect predicates (`any`, `all`) | `RedirectMatcher` | `RedirectMatcher` |
| lexical path coordinates and policies | `PathCoordinateSelector`, `PathPolicy` | `PathCoordinateSelector` |
| ordinary lexical-path predicates (`any`) | `PathsMatcher` | `PathsMatcher` |
| positional path coordinates | `PositionalCoordinate` | `PositionalCoordinate` |
| ordinary environment predicates (`any`) | `EnvironmentMatcher` | `EnvironmentMatcher` |
| environment occurrence coverage | `EnvironmentPolicy` | `EnvironmentPolicy` |
| ordinary typed fact predicates (`any`) | `FactsMatcher` | `FactsMatcher` |
| typed analyzer-fact coverage | `FactPolicy`, `TypedValueSelector` | `FactPolicy`, `TypedValueSelector` |
| ordinary nested-part predicates (`any`) | `NestedPartsMatcher` | `NestedPartsMatcher` |
| nested executable-part coverage | `NestedPartPolicy` | `NestedPartPolicy` |
| ask/deny rule composition | `Rule` | `Rule` |
| fail-closed allow composition | `AllowMatch` | `AllowMatch` |
| complete configuration | `Config` | `Config` |

Named invalid fixtures MUST cover nested Serde-like unions, unknown keys, missing
positive-arity value policy, out-of-range `byPosition` length, inline arity above one, duplicate
canonical option policies, unsupported regex syntax, type coercion attempts, multi-arm unions,
bad redirect override composition, incomplete coordinates/policies, and fail-open omissions.
The pinned validator MUST instantiate `ajv/dist/2020` from `ajv@8.17.1` with
`coerceTypes: false`; running a draft-07 validator or enabling coercion is not equivalent.

### 10.3.2 Release-binary embedding of definition-scoped fixtures

The fixture matrix in section 10.3.1 validates public schema definitions. A fixture that is valid for its selected `$defs` entry is definition-valid. Definition validity does not by itself establish that the value can be embedded in a complete `Config` and evaluated by the release binary.

The release conformance harness MUST process every fixture case through the real release `shell-warden` binary. Each probe MUST use a one-file temporary configuration containing the case under test and no unrelated configuration state. The harness MUST fail loudly if the processed fixture count differs from 68 cases or if the behavioral-probe count differs from 19 probes. It MUST NOT skip a fixture because its selected definition has no compatible complete-config host.

For a definition-valid case that can be embedded in a complete configuration, the binary MUST exit 0. An invalid fixture MUST be rejected before command evaluation and the binary MUST exit 2. Every known-valid adapter control MUST exit 0.

The `TypedValueSelector` integer, number, boolean, and path cases are definition-valid but embedding-semantic-invalid. The shipped analyzer fact catalog has no compatible host for those selector types. The harness MUST embed and process each of those four cases, require exit 2, and require selector/catalog mismatch diagnostics. These are expected semantic rejections. They MUST NOT be counted as skipped fixtures, valid complete configurations, or product failures.

All other expected outcomes remain fail-closed. Any unexpected exit code, missing selector/catalog diagnostic for one of the four specified cases, fixture-count drift, probe-count drift, or verdict mismatch MUST fail the release gate.

This section clarifies [ADR-0017](../../adr/0017-schema-first-shell-warden-config-contract.md). It does not introduce an architectural decision and does not change the schema or fixture semantics.

## 10.4 Contract harness requirements

- Mock checker configurable per test: scripted verdicts, delays, garbage frames, exit codes, hang.
- Deterministic: no wall-clock in assertions (inject clock), no port binding (stdio only).
- Coverage gates: hook statements ≥ 90%; every I3 row of `09-security.md` §9.4 exercised by at
  least one test.

## 10.5 Integration smoke — first live run (2026-10-31, OpenCode v2.2.2)

Historical record — findings that shaped ADR-0013 and later ADR-0016; the setup described
(mock **persistent engine**, evaluate hook) is the retired v1 architecture.

Setup: smoke project with `permissions: [shell → ask]` substrate + the shim
(local dir) + mock engine (persistent, deny `rm -rf`, allow the rest); headless
`opencode run`.

| Check | Result |
|---|---|
| Plugin loads from a local dir (package.json exports) | ✅ no LoadError; file watchers active |
| evaluate hook fires for shell commands | ✅ event shape confirmed: `{action: "shell", effect: "ask", resources: ["…"]}` |
| Wire E2E: shim → engine spawn → handshake → policy/check | ✅ first call ~215 ms (spawn+handshake), cached 3 ms — persistent pool works live |
| Deny path | ✅ `permission.rejected: denied by mock` reaches the agent with the reason; command not executed |
| **Allow path** | ❌ **hook allow does not suppress a configured ask on v2.2.2** → superseded by ADR-0013 reply automation (implemented and smoke-tested) |
| `ctx.session.get` inside the evaluate hook | ❌ **deadlock** — re-entrant HTTP into the server during permission evaluation. Removed from the hot path; M1: session-event cache (03 §3.2) |
| Auxiliary model calls (title/summary) in headless run | ⚠️ fail auth ("User not found") — unrelated to the plugin |

The §10.5.1 open question of v1.x (hook **ask** escalation on a native-allow
substrate) is resolved by construction of ADR-0013: the hook never escalates —
unanswered asks reach the human through the reply-automation silence.

## 10.6 Golden measurement (one-shot latency, before M1 merge)

ADR-0016 accepted the per-check spawn on a measured basis
("spawn ≪ the guarded command's runtime"). The golden runner records
`spawnMs` / `checkMs` per case; M1 acceptance requires the p95 total check
budget ≤ 10 ms on the reference machine, and re-measurement on the board P3
hardware before the hook ships configured with the default
`checkTimeoutMs: 2000`.

## 10.7 Pre-push gates (checker repo)

Before every push (engineering host: macOS / darwin-aarch64), the same three gates hold and
CI re-enforces them:

1. `cargo test` — unit, property, and golden suites green;
2. `cargo fmt --check`;
3. `cargo clippy` — no warnings policy.

The golden runner additionally records `spawnMs` per case; the µ-budget acceptance of §10.6
is re-measured on the board hardware before the hook ships with migrated config defaults.

## 10.8 Verdict v2 contract fixtures and rollout conformance

The verdict-v2 fixture validator and release workflow MUST validate
[`shell-warden.verdict.v2.schema.json`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v2.schema.json)
against every vector listed by the fixture manifest in
[`schemas/fixtures/shell-warden.verdict.v2`](https://github.com/agent-guardrails/docs/tree/main/schemas/fixtures/shell-warden.verdict.v2/).

The shared manifest MUST identify each vector by schema and one or more roles:
`checker-producer` for semantic output construction vectors,
`checker-serialization` for schema/wire serialization vectors, and `hook-consumer`
for v2 ingestion and fail-closed vectors. A vector MAY have multiple
roles. Checker conformance consumes only its two v2 roles,
`checker-producer` and `checker-serialization`. Hook conformance consumes
`hook-consumer` for v2 and rejected-response anomaly vectors. Historical v1 vectors
are not checker or hook conformance requirements.

The validator and workflow MUST additionally verify semantic aggregate consistency,
because the schema alone cannot establish `deny > ask > allow`. Checker conformance
tests MUST cover all valid combinations, invalid default bare ask, invalid emitted
ask with deterministic `ruleId`, invalid ordinary-rule deny, raw verdict size,
16 KiB facts, depth 8, recognized full and truncated
diagnostics evidence/reason coherence, malformed known diagnostic members,
mixed complete and opaque reasons, deterministic complete, opaque, and invalid
truncation anchors, canonical rejected construction, emitted-vote default-ask
behavior, Unicode UTF-8 rule-ID ordering, full-diagnostics emitted-vote coherence,
static/argv/allow emitted-allow proof, default-ask `ruleId` omission, and v2-only
emission. Hook tests MUST cover the 64 KiB pre-parse cap, exact v2 acceptance,
flat v1 rejection, absent or malformed protocol, malformed v2, foreign invocation
echo, unknown `match` value or positional index, positional contiguous command-index
coverage, both diagnostics shapes, and all anomaly vectors.

Release tests MUST prove coordinated checker and hook v2-only publication and
deployment. They MUST NOT require dual-read, compatibility, revision-pinned v1
preservation, or a rollback that restores v1. This repository does not claim that
external release tests ran or supplies their evidence.
