# 09 — Security: Trust Model, Invariants, Fail-Closed Matrix

Version 0.1 · 2026-10-30

## 9.1 Trust boundaries

| Zone | Contents | Trust level |
|---|---|---|
| OpenCode server + native `permissions`/`policies` | outer layers | trusted; outrank everything the shim/engine decide |
| Shim (npm plugin, in-process) | transport, supervision, verdict application | trusted code, user-installed; repo cannot supply it (engine path is user-global, I2) |
| Shim options (`opencode.jsonc` plugins.options) | engine path, budgets | project-editable knobs are limited by validation: only budgets/actions/cache are tunable per project; `engine.*` is typically set globally — validate per 04 §4.3 |
| Engine binary | decision maker | trusted local code, NOT a sandbox; must be protected from untrusted modification (absolute path, optional sha256 pin I8) |
| Engine config (`shell-warden.jsonc`) | stages, rules | user-global only (D9); project copies ignored with warning |
| Model output | command text, tool args | **untrusted input** — the only thing the engine evaluates |
| Repository content | files the model may read/edit | untrusted; MUST NOT influence policy (no project rules, no project engine) |

## 9.2 Invariants (normative)

| # | Invariant |
|---|---|
| I1 | Engine `command[0]` absolute; no shell; child spawned with empty environment |
| I2 | Engine location from user-global config only; bad/relative path ⇒ plugin disables itself |
| I3 | Every anomaly (parse error, bad version, unknown method, malformed/oversize frame, timeout, crash, stdin/stdout violation) resolves the invocation to `onEngineError ∈ {ask, deny}` — never `allow` |
| I4 | Budgets enforced by the shim regardless of engine behavior |
| I5 | The shim never loosens an existing deny; otherwise the engine verdict replaces the accumulated effect — automating a configured `ask` into `allow` is the product. Explicit config `deny` and `policies` never reach hooks and remain unoverridable |
| I6 | Payload caps everywhere: frames 64 KiB default, facts 16 KiB / depth 8, reasons ≤ 256 chars, messages ≤ 512 |
| I7 | Protocol version exact-match at handshake; mismatch ⇒ degrade |
| I8 | Optional sha256 pinning of the engine binary; mismatch ⇒ refuse to spawn |
| I9 | Shim caches `allow` verdicts only, TTL engine-issued; denies never cached; config reload invalidates caches |
| I10 | Allow verdicts originate only from `static` classification (07 §7.2); opaque commands degrade toward `ask` |
| I11 | Engine error text is logged, never injected into prompts; prompt messages come from rule `message` templates with allowlisted context interpolation only |

## 9.3 Threat model (selected vectors)

| # | Vector | Mitigation |
|---|---|---|
| T1 | Model crafts an obfuscated command (`$(…)`, vars, residual operators) to slip rules | classification `opaque` ⇒ allow-rules inert; default ask; deny-patterns still match on raw |
| T2 | Repo ships `.opencode/shell-warden.jsonc` to widen policy | not loaded; warning logged (D9) |
| T3 | Repo points the shim at a project-local engine | engine path is user-global + absolute; validation disables plugin on violation (I2) |
| T4 | Malicious/typosquatted shim package | out of band: `policies` `plugin.use` deny; managed config outranks plugins config |
| T5 | Engine crash-loop / hang | violation counters ⇒ unhealthy ⇒ all checks degrade per I3; supervision per 03 §3.3 |
| T6 | Injection via `event.message` into prompts | messages only from rule templates + context interpolation of allowlisted fields (I11); engine error text never surfaced |
| T7 | Stale cached allow after config change | cache invalidation on reload/restart; denies never cached (I9) |
| T8 | Secrets leakage via requests/facts/audit | shim sends command text + ids + cwd + agent only; env values allowlisted and never echoed; payload caps (I6) |
| T9 | Symlink trickery against `within` path checks | lexical canonicalization only in v1 — documented limitation; treat path conditions as advisory for hostile layouts |
| T10 | Slow-engine DoS of the agent loop | per-check deadline + `maxInFlight` + unhealthy ladder (02 §2.7) |

## 9.4 Fail-closed matrix (normative)

| Condition | Invocation result | Engine |
|---|---|---|
| Configured rule `deny` | native deny; hooks skipped | n/a |
| Engine cold (spawning within deadline) | wait until `handshakeTimeoutMs` | spawn |
| Handshake version mismatch | `onEngineError` | refuse; restart-limited |
| `policy/check` timeout | `onEngineError` + violation | grace-kill, restart |
| Malformed / oversize frame | `onEngineError` + violation | restart |
| `-32001` config fatal | `onEngineError` until config fixed | unhealthy |
| Restarts exceed window | `onEngineError` for all invocations | unhealthy |
| Shim option invalid (`engine.*`) | plugin disabled at load + warning | n/a |
| Project engine/policy config | ignored with warning | n/a |
| Plugin unload (`dispose`) | in-flight → `onEngineError`; engine killed | exit |
| Engine internal error (per command) | that command → `defaults.onError` | check still answers |

No row of this table can produce `allow`.
