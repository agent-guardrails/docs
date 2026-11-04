# 10 — Testing Strategy

Version 2.1 · 2026-11-04 · Revised for checker configuration v2 (command profiles) per
[docs#15](https://github.com/agent-guardrails/docs/issues/15): golden coverage of the checker
(letter → verdict), profile-driven scenario and property tests, and the hook contract against
a scripted mock binary.

## 10.1 Suites

| Suite | What | Where | Needs OpenCode |
|---|---|---|---|
| Unit (checker) | analyzer fact catalogs (`analyzers`: sed-v1 in-place/program-form, export-v1 assignment, generic-xargs emptiness), letter parse/validation (`letter`), wire shapes and classification mapping (`verdict`), glob + lexical path comparison (`matcher`) | `src/checker/{analyzers,letter,verdict,matcher}.rs` | no |
| Pipeline scenario matrix | `pipeline_tests`: the full evaluate() path per `06`/`07`/`08` — profile grammar, coverage proofs, redirect resolution (inherit/extend/replace), evidence states, wrapper/substitution/`xargs-v1` nesting, and the design's evaluation-scenario rows; the sed and xargs rows are scenario TEMPLATES whose surrounding profiles and rules are part of the test config (`tests/fixtures/sketch.jsonc` patterns) | `tests/pipeline_tests.rs` | no |
| Property invariants | reorder-invariance (`reorder_rules_options_policies_keeps_verdicts`) and monotonicity (`added_allow_cannot_lower_ask`) — 08 §8.6 MUSTs | `tests/pipeline_tests.rs` | no |
| Golden (checker CLI) | letter JSON in → verdict JSON out through the `shell-warden` binary, diffed against `expect` for every case | `tests/golden.rs` + `tests/golden/cases/*.json` | no |
| Config validation | valid/invalid config fixtures; strict rejection of unknown fields/caps/unresolved references (06 §6.9) | `tests/` (via `load_str`) | no |
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
  "expect": { "verdict": "deny", "message": "contains:forbidden",
              "commands": [{ "index": 0, "ruleId": "git/deny-force-push" }] }
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
| `git status --unknown-option` against a complete allow | `ask` — `invalid` evidence (unknown option) blocks allow but deny/ask still match (I12) |
| `git log --oneline --oneline` where the option entry is `repeatable: false` | `ask` (`option-not-repeatable`) |
| `git log` where the option entry is `required: true` | `ask` (`required-option-missing`) |
| `git status > /tmp/other/x` vs a redirect policy rooted at `/tmp/reports` | `ask` (`redirect-policy-uncovered`) — a weaker non-redirect `paths` change never loosens it |
| `GIT_DIR=/tmp/x git status` vs `environment: { "none": true }` | `ask` (`allow-coverage-missing`) |
| `sed -i 's/a/b/' file` against a `sed-v1` profile whose rule denies fact `executionPrimitive: inPlace` | `deny` (analyzer emits the fact; the RULE emits the deny) |
| `xargs rm -rf /` with `xargs-v1` and a nested `rm` profile denying exact `["/"]` + its recursive-force option | `deny` via the `analyzerCommand` nested part joining the lattice |
| `git status; git push --force` (chain in one raw) | split into parts; the `rm`-like deny part dominates the aggregate; parts recorded in `facts` diagnostics |
| `bash -c 'git push --force'` on twinned git rules | wrapper unwrapped (07 §7.2); same verdicts as the direct command |
| reorder profiles, rules, options, hints, or policy entries | verdicts unchanged (reorder-invariance property test, 08 §8.6) |
| add a matching allow where an ask already emits | still `ask` — an added allow cannot lower the lattice result |
| rules file with a non-`ask` `defaults.action` | config invalid, exit 2, checker degrades — never fail-open |
| letter > 64 KiB / > 32 commands | hook degrades locally, no spawn — I4 |
| hook receives verdict with foreign `invocationId` | degrade — I7 |
| hook receives two JSON values on stdout | degrade |
| deny budget: 4th deny of the same rule | hook silent; request to human (ADR-0010) |
| stale allow after rules tightening | uncached next check sees new rules; cached allow bounded by TTL — I9 |

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
