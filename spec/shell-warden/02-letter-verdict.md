# 02 — Letter & Verdict (one-shot contract)

Version 2.1 · 2026-11-04 · Revised for checker configuration v2 (command profiles) per
[docs#15](https://github.com/agent-guardrails/docs/issues/15): the letter envelope and the
verdict shapes are UNCHANGED — both schemas stay as they are byte-wise; the revision
documents only how v2 evidence states map into the unchanged wire values.

Schemas: `../../schemas/shell-warden.letter.v1.schema.json`,
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
| `invocation.projectDir` | no | carried for the harness and v2 semantic layers; unconsumed by the v1 grammar (06 §6.4) |
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
| `message` | yes on tighten | ≤ 512 chars; copied to the rejection reply / shown in native prompt (I11: rule `message` templates only); an aggregate deny with no rule message falls back to the constant `denied by shell-warden policy` (08 §8.6) |
| `commands[]` | yes | exactly one entry per request `commands[]`; `index` MUST match |
| `commands[].verdict` | yes | per-command aggregate verdict |
| `commands[].ruleId` | yes on ask/deny | id of the part-level deciding rule — the lexicographically smallest rule id among that command's deciding verdict at the winning action (08 §8.6, §8.3); audit string |
| `commands[].classification` | yes | `static / opaque` at this wire boundary. The checker's v2 evidence states are `complete / opaque / invalid` (07 §7.3): `complete` maps to `static`, and BOTH `opaque` AND `invalid` map to `opaque` — `invalid` blocks allow exactly like `opaque` and denies still match — with the true state and stable reason codes carried in `facts`. The coordinated hook change
that lifts `invalid` to its own classification value is tracked in
[opencode-shell-warden-hook](https://github.com/agent-guardrails/opencode-shell-warden-hook);
until that lands, this mapping is normative |
| `commands[].match` | yes | what the deciding rule matched: `argv` when the command's evidence is `complete` (the only kind an allow may carry), `raw` otherwise (07 §7.3, 08 §8.6) |
| `commands[].facts` | no | checker diagnostics, bounded after the decision by `limits.diagnosticsBytes` (06 §6.2). The v2 diagnostics object is `{ evidence, reasons, selectedProfiles, matched, qualified, rejected, votes }` (08 §8.7); when it exceeds the bound it reduces to `{ evidence, reasons, diagnostics: "truncated-after-decision" }`. ≤ 16 KiB serialized under the hook cap, depth ≤ 8 (I6) |

Verdict bounds: output ≤ 64 KiB; anything larger is a checker defect. `deny` MUST always carry a
`message` (prescriptive, 07 §7.7); `allow` carries `message` only if it will not tighten anything
(the hook ignores it). The v1 verdict schema stays UNCHANGED byte-wise: its `facts` field is
already a free-form object, so it carries the v2 diagnostics of §2.3 without any schema edit.

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

The checker re-reads its profiles file **on every spawn** — there is no reload channel, no handshake,
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
chk → (stderr: config invalid: defaults.redirectPolicy references unknown policy "safe-local-iox")
chk → exit 2, no stdout
hook → onCheckerError (default "ask"): no reply → human sees the prompt
```
