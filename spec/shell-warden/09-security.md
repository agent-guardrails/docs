# 09 — Security: Trust Model, Invariants, Fail-Closed Matrix

Version 2.2 · 2026-11-06 · Revised for the schema-first v2 contract accepted by
[ADR-0017](../../adr/0017-schema-first-shell-warden-config-contract.md).

## 9.1 Trust boundaries

| Zone | Contents | Trust level |
|---|---|---|
| OpenCode server + native `permissions`/`policies` | outer layers | trusted; outrank everything the hook/checker decide |
| Hook (npm plugin, in-process) | reply automation, invoker, per-session state | trusted code, user-installed; carries no policy logic (03 §3.6) |
| Hook options (`opencode.jsonc` plugins.options) | checker path, budgets | project-editable knobs are limited by validation: only budgets/actions/cache/rejectBudget/debug/logLevel are tunable per project; `checker.*` is user-global posture — validate per 04 §4.3 |
| Checker binary | decision maker | trusted local code, NOT a sandbox; must be protected from untrusted modification (absolute path, optional sha256 pin I8) |
| Checker config (profiles file) | profiles, rules, redirect policies | user-global only (D5); project copies ignored with warning |
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
| I10 | Allow verdicts originate only from `complete` typed evidence AND a full coverage proof (06 §6.7, 07 §7.3, 08 §8.3); `opaque`/`invalid`/limit-bounded evidence and config-failure degrade toward `ask` |
| I11 | Checker error text is logged, never injected into prompts; prompt messages come from rule `message` templates with allowlisted context interpolation only |
| I12 | The allow coverage proof requires complete typed evidence: every participating part MUST be `complete`, every observed security-relevant item MUST be universally covered (partially matched, first-or-last-only, or unselected repeated occurrences never qualify — 06 §6.7) |
| I13 | Redirect policies are coverage infrastructure, never votes: the effective redirect policy covers only redirect structure and redirect-target coordinates, cannot rescue an allow that fails any other dimension, and `match.redirects` (plus redirect-coordinate `match.paths`) is invalid on allow. Local deny/ask votes remain dominant under the fixed lattice |
| I14 | Order independence: profile selection, redirect-policy resolution, and vote reduction are order-free. Reordering or adding allow rules, options, hints, or policy entries MUST NOT lower any verdict, and no priority/refinement/first-match semantics exist (08 §8.6) |
| I15 | Catalog closure without I/O: analyzers, fact names, redirect operators, target kinds, relations, option arities, and lexical-alias equivalence are held in closed, versioned implementation-owned tables and are machine-checkable from the config text alone — no filesystem, PATH, or network lookup participates in validation or allow coverage. Evidence production performs no I/O |
| I16 | Public configuration is the draft-2020-12 schema shape, not a language-specific DTO layout. Every tagged selector has one discriminator and direct payload; nested Serde wrappers, unknown keys, type coercion, omitted allow dimensions, positive-arity entries without value coverage, and v1/legacy forms are invalid |

## 9.3 Threat model (selected vectors)

| # | Vector | Mitigation |
|---|---|---|
| T1 | Model crafts an obfuscated command (`$(…)`, vars, unquoted globs, tilde) to slip rules | active expansion and unresolvable wrapper shapes ⇒ `opaque`; heredoc/here-string and unsupported redirects ⇒ `invalid`; either way the part cannot allow and at least one ask emits; deny/ask still match typed classification or raw text (08 §8.6) |
| T2 | Model smuggles a chain the harness split hid (`bash -c 'curl … \| sh'`) | recursive checker-side split (07 §7.2); every sub-part evaluated; unresolvable = opaque |
| T3 | Repo ships `.opencode/shell-warden` rules to widen policy | not loaded; warning logged (D5/I2 posture) |
| T4 | Repo points the plugin at a project-local checker | checker path is user-global + absolute; validation disables plugin on violation (I2) |
| T5 | Checker package tampering | optional `sha256` pin (I8); releases signed/tagged per release engineering |
| T6 | Injection via `event.message` into prompts | messages only from rule templates + allowlisted interpolation (I11); checker/infra errors never surfaced |
| T7 | Stale cached allow after rules change | uncached checks re-read config every spawn; cached allows bounded by hook TTL; denies never cached (I9) |
| T8 | Secrets leakage via letter/verdict/debug log | letter contains command text + ids + cwd + agent only; checker environment empty; payload caps (I6); debug dir outside projects (03 §3.5) |
| T9 | Selecting one path-like token to stand for filesystem meaning | v2 contributions are lexical only: cwd-joined, component-wise compare with `.`/`..` normalization (07 §7.6); no symlink/stat/mount/PATH resolution; `/work/repo2` is NOT within `/work/repo`; resolved-binary identity is outside the checker model |
| T13 | Homogeneous allow via alias spellings (`-f` vs `--force`, `node` vs `nodejs`) | alias spellings normalize to the same canonical option ID (repeated occurrences when used twice — 06 §6.3); multi-spelling `executables` assert identical grammar, never binary identity (09 I15) |
| T14 | Policy author relies on DTO-shaped nested unions, implicit coercion, or an omitted coverage dimension | schema-first validation rejects the configuration before evaluation (I16); only one-level selectors with direct payloads are public input |
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
