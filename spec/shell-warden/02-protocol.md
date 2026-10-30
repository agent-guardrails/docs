# 02 — Wire Protocol (hook ⇄ engine)

Version 1 · 2026-10-30 · Schema: `../../schemas/wire.v1.schema.json`

## 2.1 Transport & framing

- **stdio** of the engine process. Shim writes requests to engine stdin; reads responses/notifications from stdout.
  Engine stderr is a diagnostics log (shim keeps a ring buffer, last 8 KiB, for error reports; never parsed).
- **NDJSON**: exactly one UTF-8 JSON value per `\n`-terminated line. No comments, no blank lines, no trailing commas.
- **Frame cap**: any line longer than `budgets.maxFrameBytes` (default 65 536) is a protocol violation → restart;
  in-flight invocation degrades per §2.7. Engines MUST chunk nothing; oversized output is an engine bug.
- No batching: each line is exactly one message (simplifies budget accounting).
- The shim tolerates unknown notification methods (log at debug, ignore). Engines MUST tolerate unknown shim
  notifications the same way — forward compatibility.

## 2.2 JSON-RPC 2.0 profile

- Requests carry numeric `id` (monotonic per engine connection, start at 1); responses echo `id`.
- Notifications carry no `id` and MUST NOT be answered.
- Standard error object shape; codes in §2.8.

## 2.3 `initialize` — MUST be the first message

Request:
```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "client": { "name": "opencode-shell-warden-hook", "version": "0.1.0", "opencode": "2.4.1" }
  } }
```

Response:
```json
{ "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": 1,
    "engine": { "name": "shell-warden", "version": "0.4.0" },
    "capabilities": { "maxCommandsPerCheck": 32, "cacheTtl": true, "auditEvents": true, "stages": true },
    "config": { "source": "~/.config/opencode/shell-warden.jsonc", "stages": ["s1","s3","s2"],
                "loadedAt": "2026-10-30T10:00:00Z" }
  } }
```

Rules:
- Exact match on `protocolVersion`; mismatch ⇒ shim refuses the engine (invariant I7).
- Handshake deadline `budgets.handshakeTimeoutMs` (default 5 000). Breach ⇒ kill + degrade.
- `config` block is informational (shim logs it); stage order matters only to the engine.

## 2.4 `policy/check` — the core request

One call per permission evaluation. `commands[]` carries the scanner-split subcommands — one element per
`event.resources` entry. The engine re-parses defensively; it MUST NOT assume the split is complete
(`07-command-parsing.md` §1).

Request:
```json
{ "jsonrpc": "2.0", "id": 7, "method": "policy/check",
  "params": {
    "invocation": {
      "id": "msg_01HX..:call_01HX..",
      "sessionID": "ses_01HX..",
      "agent": "build",
      "hook": "permission.evaluate",
      "projectDir": "/work/repo",
      "startedAt": "2026-10-30T10:00:01.250Z"
    },
    "action": "shell",
    "commands": [
      { "index": 0, "raw": "git push origin main", "cwd": "/work/repo" }
    ],
    "context": {
      "source": { "type": "tool", "messageID": "msg_01HX..", "id": "call_01HX.." },
      "metadata": {}
    }
  } }
```

| Field | Req | Rules |
|---|---|---|
| `invocation.id` | yes | `${messageID}:${callID}` from `event.source`; unique per tool call; cache/cancel/audit key |
| `invocation.sessionID`, `invocation.agent` | yes / opt | session scope; `agent` selects agent-scoped rules |
| `invocation.hook` | yes | `"permission.evaluate"` v1; `"shell.create.before"` reserved |
| `invocation.projectDir` | opt | project root for `within: project` path conditions |
| `action` | yes | permission action string (`"shell"`, `"edit"`, …); shim forwards only configured `actions` |
| `commands[].index` | yes | 0-based, matches response indexing |
| `commands[].raw` | yes | command text exactly as OpenCode produced it; ≤ 8 KiB each |
| `commands[].argv` | no | argv split if the caller has one; shim v1 does not split — engines needing argv parse `raw` |
| `commands[].cwd` | yes | working directory for this command |
| `context.metadata` | opt | pass-through from the hook event; opaque to the shim |

Limits (checked by the shim **before sending**; breach ⇒ local degrade, no request): ≤ `budgets.maxRequestCommands`
(default 32) commands, total params ≤ 64 KiB.

Response:
```json
{ "jsonrpc": "2.0", "id": 7,
  "result": {
    "invocationId": "msg_01HX..:call_01HX..",
    "verdict": "deny",
    "message": "push to protected branch main denied by stage s1",
    "commands": [
      { "index": 0, "verdict": "deny", "stage": "s1", "ruleId": "s1/no-push-protected",
        "reason": "branch main is protected; use a worktree + PR",
        "cacheTtlMs": 0, "classification": "static",
        "facts": { "branch": "main", "remote": "origin" } }
    ],
    "engine": { "checkMs": 3 }
  } }
```

| Field | Req | Rules |
|---|---|---|
| `verdict` | yes | aggregate ∈ `allow / ask / deny`; **authoritative**; shim applies tighten-only |
| `message` | opt | copied to `event.message` on tighten; shown in native prompt/denial |
| `commands[]` | opt | diagnostics; `index` MUST match request; `verdict` per command advisory |
| `commands[].stage`, `.ruleId`, `.reason` | opt | audit strings ≤ 256 chars |
| `commands[].classification` | opt | `static / opaque` (07 §2) |
| `commands[].cacheTtlMs` | opt | engine-issued cache permission; shim caches `allow` only, `0`/absent = never |
| `commands[].facts` | opt | ≤ 16 KiB serialized, depth ≤ 8 |
| `engine.checkMs` | opt | telemetry |

Deadline: response MUST arrive within `budgets.checkTimeoutMs` (default 5 000, clamp 1–30 000).

## 2.5 `audit/event` — engine → shim notification

```json
{ "jsonrpc": "2.0", "method": "audit/event",
  "params": { "type": "decision", "invocationId": "…", "sessionID": "…",
              "verdict": "deny", "stage": "s1", "ruleId": "s1/no-push-protected",
              "ts": "2026-10-30T10:00:01.253Z" } }
```
Shim logs only (never blocks). `params` ≤ 16 KiB / depth ≤ 8; oversize ⇒ violation counter (3 strikes ⇒ restart).

## 2.6 Shim → engine notifications (fire-and-forget, no reply)

| Method | Params | Purpose |
|---|---|---|
| `cache/invalidate` | `{ "reason": "config-reloaded" \| "session-start" \| "manual" }` | engine drops derived caches |
| `session/ended` | `{ "sessionID": "…" }` | engine drops per-session state |
| `policy/observe` | `{ invocationId, phase: "create.before", command, cwd, env }` | audit-only, emitted when shim `observeShell: true`; TOCTOU-free view of the command about to run; never affects decisions |

## 2.7 Budgets, violations, supervision

| Budget | Default | Clamp | Breach |
|---|---|---|---|
| `handshakeTimeoutMs` | 5 000 | 100–60 000 | kill + restart; invocation degrades |
| `checkTimeoutMs` | 5 000 | 1–30 000 | invocation degrades + violation; grace-kill then restart |
| `killGraceMs` | 250 | 50–2 000 | SIGTERM wait before SIGKILL |
| `maxFrameBytes` | 65 536 | 4 096–1 048 576 | protocol violation → restart |
| `maxInFlight` | 8 | 1–64 | excess queue; queue > 64 ⇒ newest degrades (never drop in-flight) |
| `maxRequestCommands` | 32 | 1–128 | local degrade before send |
| `maxViolations` | 3 | 1–10 | consecutive ⇒ restart |

Lifecycle states: `cold → spawning → handshaking → ready ⇄ busy → restarting → (ready | unhealthy)`, `disposed` on
plugin unload. Restart backoff 250 ms × 2ⁿ capped at `restart.maxBackoffMs` (30 000); resets after
`restart.resetAfterMs` (300 000) stable. Restarts exceeding `restart.windowMs` ⇒ **unhealthy**: all invocations
degrade until manual/service restart or window elapses. Spawn is lazy: first check that needs the engine triggers it.

## 2.8 Error model

```json
{ "jsonrpc": "2.0", "id": 7,
  "error": { "code": -32001, "message": "config invalid: stages[1].rules[4].when.argv[0] must be a string",
             "data": { "fatal": false } } }
```

| Code | Meaning | Shim reaction |
|---|---|---|
| -32700 / -32600 / -32601 / -32602 | parse / invalid request / method / params | protocol violation; invocation degrades |
| -32000 | engine internal error | invocation degrades; violation if `data.fatal` |
| -32001 | engine config invalid | as -32000; `fatal: true` ⇒ unhealthy until config fixed |
| anything else / missing id / unparseable line | malformed | protocol violation |

The shim NEVER synthesizes `allow` from an error. Engine error text goes to the shim log, never into prompts.

## 2.9 Versioning policy

- `protocolVersion` integer. Additive changes (new optional fields, new notifications) do not bump it.
- Breaking changes bump it; both sides MUST refuse mismatches; both sides ship the schema from `../../schemas/`.

## 2.10 Example session (abbreviated)

```
shim →  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
eng  →  {"jsonrpc":"2.0","id":1,"result":{...protocolVersion:1...}}
shim →  {"jsonrpc":"2.0","id":2,"method":"policy/check","params":{... "raw":"git push origin main" ...}}
eng  →  {"jsonrpc":"2.0","method":"audit/event","params":{...}}
eng  →  {"jsonrpc":"2.0","id":2,"result":{ "verdict":"deny", ... }}
shim →  {"jsonrpc":"2.0","method":"session/ended","params":{"sessionID":"ses_…"}}
     (plugin unload: SIGTERM, engine exits 0)
```
