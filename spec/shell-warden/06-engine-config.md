# 06 — Engine Configuration (v1.1: tool-first stages)

Version 1.1 · 2026-10-31 · Supersedes the rules-grammar draft (never shipped)

> Superseded in scope by [ADR-0016](../../adr/0016-two-tier-enforcement.md): this document is rewritten as the rules grammar of the single decision binary (flat rules, stages as family scopes; no stage tools). Rewrite pending.
Schema: `schemas/shell-warden.config.v1.schema.json`

## 6.0 Core principle (ADR-0008)

The engine core is a **pure orchestrator**: it walks stages, invokes their tools,
aggregates verdicts. It contains **zero decision logic** — no rule grammar, no
matchers, no command parsing.

Every stage is an **external tool**: a program that receives the invocation
context on stdin and returns a verdict on stdout. Declarative pattern matching,
readability gating, MCP routing — all live in tools. Reference tools
(`warden-match`, `warden-legible`) ship for the common cases, so simple setups
need no custom binaries.

## 6.1 Config file & trust

| | |
|---|---|
| Path | `$XDG_CONFIG_HOME/shell-warden/config.jsonc` — single file, user-global only |
| Trust | Tools and stages are executable policy; a repository can never supply them (ADR-0003) |

Reload: on file change the engine re-validates; valid → atomic swap (stage pools
restart as needed); invalid → last-good stays active, violation counted.

## 6.2 Top-level schema

```jsonc
{
  "version": 1,                       // REQUIRED, must be 1
  "defaults": {
    "action": "ask"                   // aggregate verdict when no stage decided
  },
  "limits": {
    "stages": 64,                     // hard cap (fail-closed against broken configs)
    "configBytes": 262144,
    "factsBytes": 16384,
    "factsDepth": 8,
    "maxConcurrentTools": 16          // cap on persistent tool processes
  },
  "stages": [ /* §6.3 — REQUIRED, ordered; array position = execution order */ ]
}
```

Strict validation: unknown keys, wrong types, cap violations ⇒ config invalid
(last-good / fatal start — never fail-open).

## 6.3 Stage schema

```jsonc
{
  "id": "route-api",                   // REQUIRED, ^[a-z][a-z0-9-]{0,31}$, unique

  "tool": { /* §6.4 — REQUIRED: tool invocation contract */ },

  "messageMode": "append",             // "append" | "replace" (default "append")
                                       //   policy stages:   "append"  (reason adds context)
                                       //   format stages:   "append"  (usually standalone)
                                       //   redirect stages: "replace" (instruction replaces)
                                       //   The first deny stops the walk (ADR-0012)

  "exclusive": false,                  // a non-noop stage verdict → later stages are
                                       //   NOT invoked (redirect absorption: the tool
                                       //   decides its own relevance; a noop response
                                       //   does not claim)

  "budget": {                          // optional (§6.6): typically for deny-with-
    "maxRejections": 3,                //   recommendation stages
    "windowMs": 1800000
  },
  "enabled": true                      // profiles: disable a stage without removing it
}
```

**Execution order = array position.** No numeric priorities; `family`/`kind`/
`scope` do not exist as schema fields — see ADR-0008.

## 6.4 Tool invocation contract

### 6.4.1 The `tool` object

```jsonc
"tool": {
  // ── what to run ──
  "command": ["/usr/local/bin/warden-route", "--family=routing"],
      // REQUIRED. Absolute argv[0], no shell. Individual argv members support
      // {env:NAME} (resolved from the engine's environment at config load);
      // after expansion argv[0] must remain absolute. Tool settings go through
      // argv or the tool's own config file.
  "cwd": "/var/lib/warden",            // default: engine state dir

  // ── process environment (inheritance + override + substitution) ──
  "env": {
    "WARDEN_MODE": "strict",               // literal: set / override
    "WARDEN_TOKEN": "{env:GITHUB_TOKEN}",  // {env:NAME}: resolved from the engine's env
    "GITHUB_TOKEN": null                   // null = remove from the inherited set
  },
  // Result = the environment inherited along the chain (server → engine → stage)
  // + this patch. {env:NAME} is resolved at config load from the engine process
  // environment (= the inherited host env); unset → config invalid (fail-closed).
  // Given full inheritance this is aliasing/explicit pinning, not an access
  // channel: the variable already reaches the tool through the chain.

  // ── lifecycle ──
  "lifecycle": "persistent",           // "persistent" (default) | "spawn"
  "idleTimeoutMs": 300000,             // persistent: kill the process when idle

  // ── invocation bounds ──
  "timeoutMs": 1000,                   // 1..30000 — deadline for a single call
  "killGraceMs": 250,                  // SIGTERM → SIGKILL
  "maxOutputBytes": 65536,             // exceeding = protocol violation

  // ── what goes to stdin ──
  "input": {
    "session": { "id": true, "agent": true },
    "mcp": true                        // list of connected MCP servers (for routing)
  },                                   // command/cwd are always included (§6.4.2)

  // ── verdict ──
  "onError": "ask",                    // "skip" | "ask" | "deny" — NEVER "allow" (I3):
                                       //   crash, timeout, garbage, unreadable output
  "sha256": "…"                        // optional binary pin; mismatch = fatal (I8)
}
```

### 6.4.2 Request (stdin, single JSON line)

```json
{ "protocolVersion": 1,
  "command": { "raw": "curl -s api.example.com", "cwd": "/work/repo" },
  "session": { "id": "ses_…", "agent": "build" },
  "mcp": [ { "name": "http", "status": "connected" } ] }
```

The composition is fixed by the protocol and not configurable per-stage:
`command` and `cwd` are needed by any decider; `session` — for per-session
state (budget); `mcp` — for routing tools. The request contains no secrets by
construction (I6).

### 6.4.3 Response (stdout, single JSON line)

```json
{ "verdict": "deny",
  "message": "use mcp__http.post instead of curl to api.example.com",
  "cacheTtlMs": 0 }
```

- `verdict` ∈ `allow | ask | deny` — REQUIRED. The only format: there are no
  pass/fail modes (the tool owns its mapping via its own config).
- `message` ≤ 512 chars; goes into the final denial/prompt message according to
  the stage's `messageMode`.
- `cacheTtlMs` — pass-verdicts only (I9: denies are not cached).
- An empty string = "the stage does not vote".

### 6.4.4 Outcome classification

| Invocation outcome | Classification |
|---|---|
| Valid JSON with `verdict` | the stage's verdict |
| Exit ≠ 0 — even with valid JSON | **onError** (the tool reported its own failure) |
| Timeout / kill / crash (persistent) | **onError** + violation counter (restarts) |
| Oversize / unreadable output / foreign `protocolVersion` / no answer | **onError** + violation |
| Spawn failure (ENOENT) | **onError** + violation |

`onError ∈ { skip, ask, deny }` — never `allow` (I3). Rising violations lead to
a tool pool restart; the ladder is as in 02-protocol §2.7.

## 6.5 Stage walk & aggregation

```
verdict = defaults.action; message = ∅; owned = true
for stage of stages (array order):
    if !stage.enabled:                                          continue
    if !owned:                                                  continue   # exclusive claim
    outcome = invoke(stage.tool, command, deadline)             # §6.4
    if outcome == onError:      outcome = stage.onError policy
    if outcome.message:
        if stage.messageMode == "replace":  message = outcome.message
        else:                               message = compose(message, outcome.message)
    verdict = mostRestrictive(verdict, outcome.action)
    if verdict == "deny":                       break   # the first deny stops the walk (ADR-0012)
    if stage.exclusive and outcome != noop:     owned = false   # later stages are not invoked
```

- **Verdict** — most-restrictive (`deny > ask > allow`); order-independent.
- **Message** — `replace` wins regardless of position; `append` adds
  (`existing — reason`); `skip` stays silent on a foreign deny.
  Order-independent.
- **Invocation control**: `exclusive` removes the command from later stages
  after a non-noop response. A separate `terminal` flag is not needed: in the
  tool model the tool always answers with a verdict, there is no
  "matched/did not match" distinction — `exclusive` covers both cases.
- **Recommended order**: redirect stages (exclusive) → format stages
  (messageMode: append) → policy stages (append).

## 6.6 Rejection budget (ADR-0010)

A stage with a `budget` (typically deny-with-recommendation: format, redirect)
cannot deny the agent forever:

- The engine counts the stage's deny verdicts per `(stage, sessionID)` within
  `windowMs`.
- Exhausting `maxRejections` ⇒ the stage is temporarily removed from the walk
  for that session (skip); the first bypass adds a notice:
  `[<id>] suspended for this session after N rejections — commands will be reviewed manually`.
- Reset: the stage produced a non-deny verdict for that session, or the window
  expired.
- Suspension hands commands to **the human** (ask path), never auto-allow.

## 6.7 Reference tools

| Tool | Family | Specification |
|---|---|---|
| `warden-match` | declarative matching (rule-file → verdict) | `07-command-parsing.md` (guidance; normative for the reference) |
| `warden-legible` | readability gate (L1/L2/L3 + rejection budget) | `design/shell-legible-gate.md` |

Both are ordinary stage tools; the core contains none of their logic.

## 6.8 Engine CLI

- `shell-warden serve [--config FILE]` — NDJSON loop on stdio (the hook path; default mode).
- `shell-warden check --config FILE --file REQ.json` — single-shot: prints the result JSON (golden mode, 10 §10.2).
- Config default path: `~/.config/shell-warden/config.jsonc` (§6.1).
- Implementation language: Rust (ADR-0015).

## 6.9 Profiles

Enabling/disabling families — via the `enabled` flags of stages:

```jsonc
// readability-only profile: policy stages disabled
{ "id": "s1", "enabled": false }, { "id": "legible", "enabled": true }
```

A profile = a state of the config; switching = editing the file (reload on
save).
