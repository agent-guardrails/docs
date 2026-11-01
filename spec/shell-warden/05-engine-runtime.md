# 05 — Engine Runtime Contract

Version 0.1 · 2026-10-30

> Superseded in scope by [ADR-0016](../../adr/0016-two-tier-enforcement.md): the engine process contract is retired; the one-shot spawn contract moves to the shim spec. Rewrite pending.
What the shim and this spec fix about the engine process. Everything else (internals, language) is free.

## 5.1 Process contract

| Aspect | Requirement |
|---|---|
| Spawn | direct argv (no shell), **empty environment** — no inherited `PATH` or variables (I1) |
| stdin | accepts NDJSON requests (02); MUST tolerate partial lines at process end |
| stdout | NDJSON responses/notifications ONLY — any other byte is a protocol violation; logs NEVER go here |
| stderr | free-form diagnostics log; should be line-oriented; no format guarantee |
| Exit codes | `0` clean (SIGTERM handled); `1` startup failure; `2` config fatal (see 5.3) |
| Termination | on SIGTERM: finish or abandon in-flight checks, exit within shim `killGraceMs` (default 250 ms) |
| Crash semantics | unexpected exit ⇒ shim violation counter + restart (02 §2.7) |

## 5.2 Concurrency model

- Single process serves all sessions; the shim bounds it with `maxInFlight` pipelined requests.
- Engine MAY process concurrently internally, but per-check deadline accounting MUST be independent:
  one slow check must not delay others beyond their own deadlines.
- Recommended: single-threaded event loop + async context lookups (git, fs stat).

## 5.3 Configuration lifecycle

| Phase | Behavior |
|---|---|
| Startup | load `~/.config/opencode/shell-warden.jsonc` (path fixed v1; `06-engine-config.md` §1). Valid ⇒ ready. Invalid ⇒ start anyway, answer every `policy/check` with `-32001 data.fatal: true` — **never fail open** (I3). Exit code 2 is optional diagnostics; the shim keeps restarting per its backoff |
| Reload | watch the file. Valid new config ⇒ atomic swap + clear derived caches + emit nothing (shim learns via next `initialize` only). Invalid ⇒ keep last-good, log, count a violation |
| Echo | `initialize.result.config` reflects the currently active file: `{source, stages[], loadedAt}` |

Config is the engine's own domain; the shim never reads it (only the handshake echo).

## 5.4 State, files, side effects

- State directory: `$XDG_STATE_HOME/shell-warden/` (audit rollups, internal caches). MUST NOT write inside the project,
  the repo, or `~/.config`.
- `policy/check` MUST be side-effect-free with respect to the user's system: read-only context lookups only
  (git plumbing, `stat`), bounded by the engine's own `limits.checkBudgetMs` (kept < shim `checkTimeoutMs`).
- Allowed reads: project dir contents needed by context providers (git metadata), env vars on the config
  allowlist (`context.env`), wall clock. Nothing else.
- No network access in v1 (N3).

## 5.5 Per-session state

- Keyed by `invocation.sessionID`; bounded (LRU, engine-chosen cap).
- Holds context caches (e.g., last-known git branch, upstream) with staleness limits from `limits`.
- Dropped on `session/ended`, `cache/invalidate`, config reload, restart.
- MUST NOT contain command text longer than needed for audit rollups; audit records capped (16 KiB, depth 8).

## 5.6 Health & telemetry

- `initialize` result is the health report (version, config echo).
- `result.engine.checkMs` per check; optional `ping` method (shim debug builds only):
  request `{}` → result `{ uptimeMs, checksProcessed, inFlight, lastErrorAt }`.
- Unhealthy is a *shim-side* verdict (restart window exhausted); the engine has no matching state — it just keeps
  answering or failing per its config validity.

## 5.7 Engine contract summary (normative one-liner list)

1. Speak `02-protocol.md` exactly; stdout is wire-only.
2. Respect deadlines; one slow check must not poison others.
3. Invalid config ⇒ fatal errors, never fail-open.
4. Read-only with respect to the user's system; write only to the state dir.
5. Exit cleanly on SIGTERM within grace.
