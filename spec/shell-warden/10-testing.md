# 10 — Testing Strategy

Version 2.0 · 2026-11-01 · Re-targeted per [ADR-0016](../../adr/0016-two-tier-enforcement.md):
golden coverage of the checker (letter → verdict) without a harness; hook
contract against a scripted mock binary.

## 10.1 Suites

| Suite | What | Where | Needs OpenCode |
|---|---|---|---|
| Golden (checker) | `shell-warden` CLI: letter JSON in → verdict JSON out; table-driven over `examples/configs` | `tests/golden` | no |
| Parsing unit | classification + normalization + chain split + glob/flag/path semantics per 07 examples and edge cases | `tests/golden/parsing` | no |
| Config validation | valid/invalid rules-file fixtures; strict rejection of unknown fields/caps | `tests/config` | no |
| Contract (hook) | hook vs a **mock checker** (scripted binary): spawn success/fail, timeout kill + grace, garbage/oversize/empty stdout, non-zero exits (incl. 2), schema-violating verdict, wrong `invocationId` echo, concurrency cap, tighten-only proof, cache TTL, deny budget | `tests/contract` | no |
| Integration | real OpenCode: allowlist scenario, deny with visible reason in native prompt, `onCheckerError: "deny"` drill (non-spawnable checker path), project-config-ignored warning | `tests/integration` (manual/CI with `opencode run`) | yes |

## 10.2 Golden format

```jsonc
// tests/golden/cases/vcs-no-force-push.json
{
  "config": "examples/configs/shell-warden.example.jsonc",
  "letter": { "version": 1,
              "invocation": { "id": "t1", "sessionID": "s1", "projectDir": "/repo" },
              "action": "shell",
              "commands": [{ "index": 0, "raw": "git -C sub push --force origin main", "cwd": "/repo" }] },
  "expect": { "verdict": "deny", "messageContains": "forbidden",
              "commands": [{ "index": 0, "verdict": "deny", "ruleId": "vcs/no-force-push",
                             "match": "argv" }] }
}
```

Runner diffs actual vs `expect` (subset match; extra fields ignored; an
expected element carrying an `index` anchors to the actual element at that
position of the parent array; `expect.message` supports a `contains:` prefix
for substring assertions). Every rule in every example config MUST have at
least one positive and one negative case. Spawn latency is measured here too
(§10.6).

## 10.3 Required adversarial cases

| Case | Expected |
|---|---|
| `echo $(whoami)` against an allow rule for `echo *` | `ask` (opaque ⇒ allow inert) — I10 |
| broad `push → allow` refined by narrow `push --all → ask` on `git push --all` | refinement discards the broad rule; `ask` survives and wins (08 §8.3); plain `git push` still `allow` |
| `git status; rm -rf /` (chain in one raw) | split into parts; the `rm` part determines the aggregate; parts recorded in `commands[]` |
| `bash -c 'git push --force'` on twinned `git` rules | wrapper unwrapped (07 §7.2); same verdicts as the direct command |
| letter > 64 KiB / > 32 commands | hook degrades locally, no spawn — I4 |
| unknown flag vs allow rule (`git status --stealth-x`) | unknown flag ⇒ not fully parsed ⇒ `ask` (I10) |
| hook receives verdict with foreign `invocationId` | degrade — I7 |
| hook receives two JSON values on stdout | degrade |
| rules file with `defaults.action: "allow"` | config invalid, exit 2, checker degrades — never fail-open |
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
