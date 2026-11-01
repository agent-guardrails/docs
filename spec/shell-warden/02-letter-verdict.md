# 02 — Letter & Verdict (one-shot contract)

Version 2.0 · 2026-11-01 · Schemas: `../../schemas/shell-warden.letter.v1.schema.json`,
`../../schemas/shell-warden.verdict.v1.schema.json`

Revised per [ADR-0016](../../adr/0016-two-tier-enforcement.md): the persistent NDJSON wire protocol
is retired (supersedes ADR-0002). This document is now the complete process contract of the one-shot
decision binary — nothing else about it is specified.

## 2.1 Invocation contract

| Aspect | Requirement |
|---|---|
| Spawn | direct argv (`checker.command[0]` absolute, no shell), empty environment — no inherited variables or `PATH` (I1) |
| stdin | exactly one UTF-8 JSON **letter**, then EOF (hook closes stdin after writing) |
| stdout | exactly one UTF-8 JSON **verdict**, then EOF; any other byte is a checker defect (hook degrades) |
| stderr | free-form diagnostics (line-oriented); never parsed by the hook, surfaced only in hook logs |
| Deadline | hook kills the checker if no verdict by `budgets.checkTimeoutMs`; SIGTERM → `killGraceMs` → SIGKILL |
| State | none — the checker is a pure function of the letter and its config: no cache, no fs writes, no network, no clock-dependent output |

Tolerances: the hook tolerates nothing beyond the schema — unknown fields, wrong types, trailing
bytes, multiple JSON values, or a wrong `letter.version` are checker/harness defects and degrade
(09 §9.4). Both sides ship the schemas from `../../schemas/`.

## 2.2 Letter — request JSON

```json
{
  "version": 1,
  "invocation": {
    "id": "msg_01HX..:call_01HX..",
    "sessionID": "ses_01HX..",
    "agent": "build",
    "projectDir": "/work/repo"
  },
  "action": "shell",
  "commands": [
    { "index": 0, "raw": "git push origin main", "cwd": "/work/repo" }
  ]
}
```

| Field | Req | Rules |
|---|---|---|
| `version` | yes | letter schema version; MUST be `1`; mismatch ⇒ hook degrades without spawning |
| `invocation.id` | yes | `${messageID}:${callID}` from the permission request source; unique per tool call; budget/cache key |
| `invocation.sessionID` | yes | session scope (hook-side budgets, cache key) |
| `invocation.agent` | no | agent that requested execution (debug log only in v1) |
| `invocation.projectDir` | no | project root for `paths` conditions (06 §6.3) |
| `action` | yes | permission action string (`"shell"` in v1); hook forwards only configured `actions` |
| `commands`.index | yes | 0-based, matches verdict indexing |
| `commands`.raw | yes | command text exactly as OpenCode produced it; ≤ 8 KiB each |
| `commands`.cwd | yes | working directory for this command |

Limits (enforced by the hook **before spawning**; breach ⇒ local degrade, no spawn): at most
`budgets.maxRequestCommands` (default 32) commands, letter ≤ 64 KiB. The letter contains no secrets
by construction (I6). OpenCode's scanner-split subcommands arrive as separate `commands[]` entries —
the checker NEVER trusts this split (`07-command-parsing.md` §7.2); it re-splits recursively.

## 2.3 Verdict — response JSON

```json
{
  "invocationId": "msg_01HX..:call_01HX..",
  "verdict": "deny",
  "message": "push --force is forbidden — history is protected",
  "commands": [
    { "index": 0, "verdict": "deny", "ruleId": "vcs/no-force-push",
      "classification": "opaque", "match": "raw" }
  ]
}
```

| Field | Req | Rules |
|---|---|---|
| `invocationId` | yes | echo of `invocation.id` |
| `verdict` | yes | aggregate ∈ `allow / ask / deny`; **authoritative**; hook applies tighten-only |
| `message` | yes on tighten | ≤ 512 chars; copied to the rejection reply / shown in native prompt (I11: rule `message` templates only) |
| `commands[]` | yes | exactly one entry per request `commands[]`; `index` MUST match |
| `commands[].verdict` | yes | per-command aggregate verdict |
| `commands[].ruleId` | deny/ask | id of the deciding rule (first deny wins; best ask otherwise) — audit string |
| `commands[].classification` | yes | `static / opaque` (07 §7.3) |
| `commands[].match` | yes | what the rule matched: `argv` (fully parsed) or `raw` (raw glob — never on an `allow`) |
| `commands[].facts` | no | parsed-evidence diagnostics; ≤ 16 KiB serialized, depth ≤ 8 (I6) |

Verdict bounds: output ≤ 64 KiB; anything larger is a checker defect. `deny` MUST always carry a
`message` (prescriptive, 07 §7.6); `allow` carries `message` only if it will not tighten anything
(the hook ignores it).

## 2.4 Exit codes

| Code | Meaning | Hook reaction |
|---|---|---|
| 0 | verdict JSON written to stdout | parse and apply |
| 1 | startup/usage failure (bad argv, unreadable config file) | degrade (`onCheckerError`) + violation count (debug log) |
| 2 | config invalid (per 06 strict validation) | degrade; stderr carries the exact path; every subsequent check degrades the same way until the user fixes the file |
| other / signal | crash or external kill | degrade |

A non-zero exit MUST NOT be accompanied by stdout use: on any non-zero exit the hook ignores stdout
entirely (garbage cannot become a verdict). Timeout: kill + degrade. Written-but-unparseable stdout:
degrade. In every row of 09 §9.4 the result is `onCheckerError ∈ {ask, deny}` — never `allow` (I3).

## 2.5 Config lifecycle (one-shot posture)

The checker re-reads its rules file **on every spawn** — there is no reload channel, no handshake,
no version pinning beyond the config `version` (06 §6.1). Invalid config ⇒ exit 2 (I3, never
fail-open). Consequence: a cached hook verdict can outlive a config change by at most the cache TTL
(03 §3.4); uncached verdicts always see the current file.

## 2.6 Example session (one shot each)

```
hook → spawn checker, write letter to stdin, close
chk → {"version":1,"invocationId":"...","verdict":"deny","message":"...","commands":[...]}
chk → exit 0
hook → permission.reply(decision:"reject", message) / "once" / silence
```

```
hook → spawn checker (config invalid)
chk → (stderr: config invalid: stages[0].rules[1].flagValue.-v must be a string)
chk → exit 2, no stdout
hook → onCheckerError (default "ask"): no reply → human sees the prompt
```
