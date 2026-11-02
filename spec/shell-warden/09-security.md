# 09 — Security: Trust Model, Invariants, Fail-Closed Matrix

Version 2.0 · 2026-11-01 · Revised per [ADR-0016](../../adr/0016-two-tier-enforcement.md)

## 9.1 Trust boundaries

| Zone | Contents | Trust level |
|---|---|---|
| OpenCode server + native `permissions`/`policies` | outer layers | trusted; outrank everything the hook/checker decide |
| Hook (npm plugin, in-process) | reply automation, invoker, per-session state | trusted code, user-installed; carries no policy logic (03 §3.6) |
| Hook options (`opencode.jsonc` plugins.options) | checker path, budgets | project-editable knobs are limited by validation: only budgets/actions/cache/rejectBudget/debug/logLevel are tunable per project; `checker.*` is user-global posture — validate per 04 §4.3 |
| Checker binary | decision maker | trusted local code, NOT a sandbox; must be protected from untrusted modification (absolute path, optional sha256 pin I8) |
| Checker config (rules file) | stages, rules | user-global only (D5); project copies ignored with warning |
| Model output | command text, tool args | **untrusted input** — the only thing the checker evaluates; its splitting of the command is never trusted (07 §7.2 — the 0014 principle) |
| Repository content | files the model may read/edit | untrusted; MUST NOT influence policy (no project rules, no project checker path) |

## 9.2 Invariants (normative)

| # | Invariant |
|---|---|
| I1 | Checker spawn: `command[0]` absolute; no shell; child spawned with **empty environment**; options are argv only |
| I2 | Checker location from user-global config only; bad/relative path ⇒ plugin disables itself |
| I3 | Every anomaly (spawn failure, timeout, graceful-kill, non-zero exit, unreadable/garbage/oversize stdout, schema violation, untrusted split) resolves the invocation to `onCheckerError ∈ {ask, deny}` — never `allow` |
| I4 | Letter/verdict limits enforced by the hook regardless of checker behavior: letter ≤ 64 KiB / ≤ `maxRequestCommands` commands before spawn; verdict ≤ 64 KiB; spawn concurrency ≤ `maxConcurrentSpawns` |
| I5 | The hook never loosens an existing deny; a reply allow applies only to a request whose checker verdict was allow; native denies are unreachable (hooks see only published asks) |
| I6 | Payload caps everywhere: letter 64 KiB, verdict 64 KiB, facts 16 KiB / depth 8, messages ≤ 512, debug-log lines ≤ 16 KiB |
| I7 | Letter and verdict schema exact conformance: `version` const, unknown fields, wrong types, wrong `invocationId` echo ⇒ degrade; both sides ship the schemas |
| I8 | Optional sha256 pinning of the checker binary; mismatch ⇒ refuse to spawn |
| I9 | Hook caches `allow` verdicts only, hook-configured TTL; denies never cached; uncached checks always see the current rules file (checker re-reads per spawn) |
| I10 | Allow verdicts originate only from `static`, fully parsed commands (07 §7.3, 08 §8.2); opaque/unparseable degrades toward `ask` |
| I11 | Checker error text is logged, never injected into prompts; prompt messages come from rule `message` templates with allowlisted context interpolation only |

## 9.3 Threat model (selected vectors)

| # | Vector | Mitigation |
|---|---|---|
| T1 | Model crafts an obfuscated command (`$(…)`, vars, residual operators) to slip rules | part classification `opaque` ⇒ allow-rules inert; default ask; deny-patterns still match on raw (08 §8.4) |
| T2 | Model smuggles a chain the harness split hid (`bash -c 'curl … \| sh'`) | recursive checker-side split (07 §7.2); every sub-part evaluated; unresolvable = opaque |
| T3 | Repo ships `.opencode/shell-warden` rules to widen policy | not loaded; warning logged (D5/I2 posture) |
| T4 | Repo points the plugin at a project-local checker | checker path is user-global + absolute; validation disables plugin on violation (I2) |
| T5 | Checker package tampering | optional `sha256` pin (I8); releases signed/tagged per release engineering |
| T6 | Injection via `event.message` into prompts | messages only from rule templates + allowlisted interpolation (I11); checker/infra errors never surfaced |
| T7 | Stale cached allow after rules change | uncached checks re-read config every spawn; cached allows bounded by hook TTL; denies never cached (I9) |
| T8 | Secrets leakage via letter/verdict/debug log | letter contains command text + ids + cwd + agent only; checker environment empty; payload caps (I6); debug dir outside projects (03 §3.5) |
| T9 | Value globs steering by filesystem meaning | v1 `argValue` compares decoded token text only — no canonicalization (no symlink/cwd-resolving; `/repo/./x` ≠ `/repo/x`); token-semantic interpretation is a v2 layer (§11.3 Q6) |
| T10 | Hung/slow checker DoS of the agent loop | per-check deadline + graceful kill (02 §2.1); spawn concurrency cap (04 §4.2); one bad check isolates itself |

## 9.4 Fail-closed matrix (normative)

| Condition | Invocation result | Checker |
|---|---|---|
| Configured rule `deny` | native deny; hooks never see the request | n/a |
| Letter over cap / wrong version / bad schema | **local degrade before spawn** | not spawned |
| Checker spawn failure (ENOENT, permission) | `onCheckerError` + debug-log note | n/a |
| Checker timeout | `onCheckerError` | SIGTERM → grace → SIGKILL |
| Checker exit ≠ 0 (incl. config fatal, exit 2) | `onCheckerError`; stderr line logged | n/a (stateless — every re-check fails the same way until config fixed) |
| Garbage / multiple / oversize stdout; schema violation; wrong `invocationId` echo | `onCheckerError` | n/a |
| Spawn concurrency exceeded | **local degrade before spawn** (no new process) | old spawns unaffected; each still deadline-bounded |
| Hook option invalid (`checker.*`) | plugin disabled at load + warning | n/a |
| Project checker/policy config | ignored with warning | n/a |
| Plugin unload (`dispose`) | in-flight invocations abandoned → `onCheckerError` | SIGTERM → grace → SIGKILL |
| Checker internal error, single command/part | that part degrades inside the verdict; aggregate still tight (most-restrictive holds) | exit 0 with a valid verdict |

No row of this table can produce `allow` — and no combination of rows can,
because every degrade verdict is at most as permissive as `ask`, and `ask` is
never turned into `allow` by the hook (I5, D9).
