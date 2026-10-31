# 10 — Testing Strategy

Version 0.1 · 2026-10-30

## 10.1 Suites

| Suite | What | Where | Needs OpenCode |
|---|---|---|---|
| Contract (shim) | shim vs a **mock engine** (scripted stdio): handshake success / version mismatch / timeout; check pass, fail, malformed, oversize, late; violation ladder → unhealthy; tighten-only proof; cache TTL + invalidation; dispose kill | `tests/contract` | no |
| Golden (engine) | `shell-warden check --file request.json` CLI mode: request JSON in → response JSON out; table-driven over `examples/configs` | `tests/golden` | no |
| Parsing unit | classification + normalization + glob/flag/path semantics per `07-command-parsing.md` examples table and edge cases | `tests/golden/parsing` | no |
| Config validation | valid/invalid `shell-warden.jsonc` fixtures; last-good and fatal paths | `tests/contract` | no |
| Integration | real OpenCode: allowlist scenario, deny with visible reason in native prompt, `onEngineError: "deny"` drill (SIGSTOP engine), project-config-ignored warning, hot config reload | `tests/integration` (manual/CI with `opencode run`) | yes |

## 10.2 Golden format

```jsonc
// tests/golden/cases/push-protected.json
{
  "config": "examples/configs/shell-warden.example.jsonc",
  "request": { "invocation": { "id": "t1", "sessionID": "s1", "agent": "build",
                "hook": "permission.evaluate", "projectDir": "/repo" },
               "action": "shell",
               "commands": [{ "index": 0, "raw": "git push origin main", "cwd": "/repo" }] },
  "expect": { "verdict": "deny", "messageContains": "protected",
              "commands": [{ "index": 0, "verdict": "deny", "stage": "s1",
                             "ruleId": "s1/no-push-protected", "classification": "static" }] }
}
```

Runner diffs actual vs `expect` (subset match; extra fields ignored). Every rule in every example config MUST have
at least one positive and one negative case.

## 10.3 Required adversarial cases

| Case | Expected |
|---|---|
| `echo $(whoami)` against an allow rule for `echo *` | `ask` (opaque ⇒ allow inert) — I10 |
| `git status; rm -rf /` (residual operator) | opaque; no allow; deny-patterns still evaluated on raw |
| engine writes a 1 MiB line | violation + restart; invocation degraded |
| engine answers after deadline | degraded; late answer ignored (id poisoned) |
| duplicate `invocation.id` re-check | idempotent, same verdict |
| config reload mid-session with narrower rules | next check uses new rules; caches invalidated |
| SIGSTOP engine → deadline breach ×3 | unhealthy; all checks `onEngineError` |

## 10.4 Contract harness requirements

- Mock engine configurable per test: scripted responses, delays, oversize frames, crash timing.
- Deterministic: no wall-clock in assertions (inject clock), no port binding (stdio only).
- Coverage gates: shim statements ≥ 90%; every I3 row of `09-security.md` §9.4 exercised by at least one test.

## 10.5 Integration smoke — first live run (2026-10-31, OpenCode v2.2.2)

Setup: smoke project with `permissions: [shell → ask]` substrate + the shim
(local dir) + mock engine (persistent, deny `rm -rf`, allow the rest); headless
`opencode run`.

| Check | Result |
|---|---|
| Plugin loads from a local dir (package.json exports) | ✅ no LoadError; file watchers active |
| evaluate hook fires for shell commands | ✅ event shape confirmed: `{action: "shell", effect: "ask", resources: ["…"]}` |
| Wire E2E: shim → engine spawn → handshake → policy/check | ✅ first call ~215 ms (spawn+handshake), cached 3 ms — persistent pool works live |
| Deny path | ✅ `permission.rejected: denied by mock` reaches the agent with the reason; command not executed |
| **Allow path** | ❌ **hook allow does not suppress a configured ask on v2.2.2** — retested with a pure-V2 `permissions` config (V1 `permission` block removed): same result. Deny escalations are honored, allow-downgrades are not. Next: retest on v2.2.5 (released 2026-10-30); fallback M1: auto-answer published asks via `permission.reply` when the engine pre-approved the invocation; if v2.2.5 still ignores hook allow — upstream issue |
| `ctx.session.get` inside the evaluate hook | ❌ **deadlock** — re-entrant HTTP into the server during permission evaluation; hook hangs forever, ask auto-rejects. Removed from the hot path; M1: session-event cache |
| Auxiliary model calls (title/summary) in headless run | ⚠️ fail auth ("User not found") — unrelated to the shim |

Open protocol addition: `policy/check` request gains `context.env` — the
allowlisted host variables read by the shim (the engine process itself is
spawned empty and cannot see the host env; it only relays the fields).
