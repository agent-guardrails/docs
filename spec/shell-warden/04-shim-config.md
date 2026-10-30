# 04 — Shim Configuration (plugin options)

Version 1 · 2026-10-30

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
        "engine": {
          "command": ["/usr/local/bin/shell-warden", "serve"],
          "protocolVersion": 1,
          "sha256": null,
          "cwd": null,
          "restart": { "maxBackoffMs": 30000, "windowMs": 300000, "resetAfterMs": 300000 }
        },
        "budgets": {
          "handshakeTimeoutMs": 5000, "checkTimeoutMs": 5000, "killGraceMs": 250,
          "maxFrameBytes": 65536, "maxInFlight": 8, "maxRequestCommands": 32,
          "maxViolations": 3, "maxViolationsWindowMs": 60000
        },
        "onEngineError": "ask",
        "actions": ["shell"],
        "cache": { "enabled": true, "maxEntries": 1024, "defaultTtlMs": 0 },
        "observeShell": false,
        "logLevel": "warn"
      }
    }
  ]
}
```

## 4.2 Field specification

### `enabled` · boolean · default `true`
`false` ⇒ plugin performs no registrations (pure no-op).

### `engine` · object · REQUIRED

| Field | Type | Default | Clamp/Rule | Violation |
|---|---|---|---|---|
| `command` | string[] | — required | `command[0]` absolute path; no shell metacharacters; members strings | **plugin disables itself** + warn (I2) |
| `protocolVersion` | int | 1 | ≥ 1 | disable + warn |
| `sha256` | string\|null | null | 64 hex chars; pins the engine binary (I8) | refuse to spawn ⇒ degrade posture |
| `cwd` | string\|null | null | absolute dir; default: OS temp | disable + warn |
| `restart.maxBackoffMs` | int | 30000 | 1 000–300 000 | warn + clamp |
| `restart.windowMs` | int | 300000 | 10 000–3 600 000 | warn + clamp |
| `restart.resetAfterMs` | int | 300000 | 10 000–3 600 000 | warn + clamp |

`command` members support `"{env:NAME}"` substitution resolved at setup; unresolved ⇒ disable (I2).

### `budgets` · object

| Field | Type | Default | Clamp |
|---|---|---|---|
| `handshakeTimeoutMs` | int | 5000 | 100–60 000 |
| `checkTimeoutMs` | int | 5000 | 1–30 000 |
| `killGraceMs` | int | 250 | 50–2 000 |
| `maxFrameBytes` | int | 65536 | 4 096–1 048 576 |
| `maxInFlight` | int | 8 | 1–64 |
| `maxRequestCommands` | int | 32 | 1–128 |
| `maxViolations` | int | 3 | 1–10 |
| `maxViolationsWindowMs` | int | 60000 | 5 000–3 600 000 |

All violations: warn + clamp. A mistyped budget must never silently unguard the system.

### `onEngineError` · `"ask" | "deny"` · default `"ask"`
The degrade verdict for every anomaly (`09-security.md` matrix). **`"allow"` is not a valid value** — rejected at
validation (I3).

### `actions` · string[] · default `["shell"]`
Permission actions the evaluate hook processes; `"*"` = all. The shim forwards nothing else. Values other than known
V2 action strings or `"*"` ⇒ warn + drop the entry.

### `cache` · object

| Field | Type | Default | Clamp |
|---|---|---|---|
| `enabled` | boolean | true | — |
| `maxEntries` | int | 1024 | 16–100 000 |
| `defaultTtlMs` | int | 0 | 0–3 600 000; used when engine omits `cacheTtlMs` on an allow |

### `observeShell` · boolean · default `false`
Enables `policy/observe` notifications from `shell.hook("create.before")`. Audit only; never a decision input in v1.

### `logLevel` · `"debug" | "info" | "warn" | "error"` · default `"warn"`

## 4.3 Validation semantics

1. Unknown keys ⇒ warn + ignore (forward compatibility within v1).
2. Wrong types / out-of-clamp values ⇒ warn + default/clamp; the shim stays up.
3. Fatal-only defects (bad `engine.command`, bad `protocolVersion`, `onEngineError: "allow"`) ⇒ plugin disables
   itself and logs `[opencode-shell-warden-hook] Disabled: <reason>`. Disabling is the only honest fail-closed posture for
   load-time misconfiguration — there is nothing to degrade in-process.
4. Config is read once at `setup`; changes require plugin reload (OpenCode watches config and reloads plugins).
