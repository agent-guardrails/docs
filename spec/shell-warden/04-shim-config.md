# 04 — Hook Configuration (plugin options)

Version 2.0 · 2026-11-01 · Revised per [ADR-0016](../../adr/0016-two-tier-enforcement.md):
no persistent engine options (handshake, restart ladder, frames) — one-shot
invoker budgets and hook-owned state instead.

Loaded from the object form of `plugins` in `opencode.jsonc`; validated in `setup` before any registration.

## 4.1 Example

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-shell-warden-hook",
      "options": {
        "enabled": true,
        "checker": {
          "command": ["/usr/local/bin/shell-warden"],
          "sha256": null
        },
        "budgets": {
          "checkTimeoutMs": 2000, "killGraceMs": 250,
          "maxRequestCommands": 32, "maxConcurrentSpawns": 8
        },
        "onCheckerError": "ask",
        "actions": ["shell"],
        "cache": { "enabled": true, "maxEntries": 1024, "ttlMs": 0 },
        "rejectBudget": { "maxRejections": 3, "windowMs": 1800000 },
        "asConfig": { "observeShell": false },
        "debug": { "enabled": false, "dir": null },
        "logLevel": "warn"
      }
    }
  ]
}
```

## 4.2 Field specification

### `enabled` · boolean · default `true`
`false` ⇒ plugin performs no registrations (pure no-op).

### `checker` · object · REQUIRED

| Field | Type | Default | Clamp/Rule | Violation |
|---|---|---|---|---|
| `command` | string[] | — required | `command[0]` absolute path; no shell metacharacters; members strings; usually `[..., "--config", "/abs/config.jsonc"]` when not relying on the default path (06 §6.1) | **plugin disables itself** + warn (I2) |
| `sha256` | string\|null | null | 64 hex chars; pins the checker binary (I8) | refuse to spawn ⇒ degrade posture |

`command` members support `"{env:NAME}"` substitution resolved at setup; unresolved ⇒ disable (I2).
The child process environment is empty regardless (I1) — options are argv only.

### `budgets` · object

| Field | Type | Default | Clamp |
|---|---|---|---|
| `checkTimeoutMs` | int | 2000 | 100–30 000 (verdict deadline; ADR-0016: spawn ≪ the guarded command's runtime) |
| `killGraceMs` | int | 250 | 50–2 000 (SIGTERM → SIGKILL) |
| `maxRequestCommands` | int | 32 | 1–128 (local degrade without spawn on breach) |
| `maxConcurrentSpawns` | int | 8 | 1–64 (excess ⇒ local degrade, never queued) |

All violations: warn + clamp. A mistyped budget must never silently unguard the system.
(The v1.x handshake/frame/in-flight/violation-ladder budgets are retired with the persistent engine.)

### `onCheckerError` · `"ask" | "deny"` · default `"ask"`
The degrade verdict for every anomaly (09 §9.4 matrix; renamed from v1.x
`onEngineError`). **`"allow"` is not a valid value** — rejected at validation (I3).

### `actions` · string[] · default `["shell"]`
Permission actions the hook processes; `"*"` = all. Values other than known
V2 action strings or `"*"` ⇒ warn + drop the entry. v1 scope is `shell`
(ADR-0016: shell only; N5).

### `cache` · object

| Field | Type | Default | Clamp |
|---|---|---|---|
| `enabled` | boolean | true | — |
| `maxEntries` | int | 1024 | 16–100 000 |
| `ttlMs` | int | 0 | 0–3 600 000; allow-only TTL (03 §3.4; default 0 = never cache) |

### `rejectBudget` · object · ADR-0010, hook-owned

| Field | Type | Default | Clamp |
|---|---|---|---|
| `maxRejections` | int | 3 | 1–10 (per rule, per session) |
| `windowMs` | int | 1800000 | 60 000–86 400 000 |

On exhaustion the hook stops answering that rule for the session — requests
reach the human via the native ask, never auto-allowed (03 §3.5).

### `asConfig.observeShell` · boolean · default `false`
Enables `shell.hook("create.before")` observation. Audit only; never a decision input in v1.

### `debug` · object

| Field | Type | Default | Rule |
|---|---|---|---|
| `enabled` | boolean | false | NDJSON per check (03 §3.5) |
| `dir` | string\|null | null | absolute dir override; default `~/.local/state/shell-warden/hook/`; MUST NOT be inside a project or `~/.config` |

### `logLevel` · `"debug" | "info" | "warn" | "error"` · default `"warn"`

## 4.3 Validation semantics

1. Unknown keys ⇒ warn + ignore (forward compatibility within v2).
2. Wrong types / out-of-clamp values ⇒ warn + default/clamp; the hook stays up.
3. Fatal-only defects (bad `checker.command`, bad `sha256`, `onCheckerError: "allow"`) ⇒ plugin disables
   itself and logs `[opencode-shell-warden-hook] Disabled: <reason>`. Disabling is the only honest fail-closed posture for
   load-time misconfiguration — there is nothing to degrade in-process.
4. The checker/rules files are user-global tools; a repository can only tune
   `budgets/actions/cache/rejectBudget/debug/logLevel` knobs — never supply
   policy (ADR-0003/I2). Config is read once at `setup`; option changes require
   plugin reload (OpenCode watches config and reloads plugins). Rules-file
   changes need no hook reload — the checker re-reads per spawn (06 §6.1).
