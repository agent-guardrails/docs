# 02 — Letter & Verdict (one-shot contract)

Version 2.2 · 2026-11-11 · Revised for verdict v2 per
[docs issue 31](https://github.com/agent-guardrails/docs/issues/31) and
[ADR-0021](https://github.com/agent-guardrails/docs/blob/main/adr/0021-post-schema-shell-warden-verdict-validation.md), which supersedes
[ADR-0020](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md). The letter and released
verdict v1 remain immutable; this revision adds the separate v2 response contract.

Schemas: [`letter v1`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.letter.v1.schema.json),
[`verdict v1`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v1.schema.json),
[`verdict v2`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v2.schema.json)

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
| `commands`.index | yes | exactly its `commands[]` array position: contiguous `0..N-1`; the same position is required in the verdict |
| `commands`.raw | yes | command text exactly as OpenCode produced it; ≤ 8 KiB each |
| `commands`.cwd | yes | working directory for this command |

Limits (enforced by the hook **before spawning**; breach ⇒ local degrade, no spawn):
`budgets.maxRequestCommands` defaults to 32; a configured value above 128 MUST warn and clamp to
128. A request with more commands than the effective limit degrades locally. Letter size is ≤ 64 KiB. The letter contains no secrets
by construction (I6). OpenCode's scanner-split subcommands arrive as separate `commands[]` entries —
the checker NEVER trusts this split (`07-command-parsing.md` §7.2); it re-splits recursively.

## 2.3 Verdict v1 — immutable released response JSON

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
| `message` | required for deny; optional for allow/ask | ≤ 512 chars. A deny message is used for the rejection reply; allow and ask messages are accepted but ignored by the hook. An aggregate deny with no rule message falls back to the constant `denied by shell-warden policy` (08 §8.6). |
| `commands[]` | yes | one result at each letter command array position; both letter and verdict indexes are contiguous `0..N-1` and equal their positions |
| `commands[].verdict` | yes | per-command aggregate verdict |
| `commands[].ruleId` | required for deny; optional otherwise at schema level | id of the part-level deciding rule. With recognized full diagnostics, it MUST be present as the UTF-8-byte-order smallest emitted vote whose action matches the command verdict, and MUST be absent when no such vote exists. The immutable v1 `RuleId` syntax is narrower than broad config rule IDs; broad config IDs require v2. |
| `commands[].classification` | yes | `static / opaque` at this wire boundary. The checker's evidence states are `complete / opaque / invalid` (07 §7.3): `complete` maps to `static`, and BOTH `opaque` AND `invalid` map to `opaque`. Invalid blocks allow exactly like opaque, while deny and ask rules can still match retained evidence or raw text. The true state and stable reason codes are carried in `facts`. This is the immutable released v1 mapping. |
| `commands[].match` | yes | what the deciding rule matched: `argv` when the command's evidence is `complete` (the only kind an allow may carry), `raw` otherwise (07 §7.3, 08 §8.6) |
| `commands[].facts` | no | checker diagnostics, bounded after the decision by `limits.diagnosticsBytes` (06 §6.2). The v2 diagnostics object is `{ evidence, reasons, selectedProfiles, matched, qualified, rejected, votes }` (08 §8.7); when it exceeds the bound it reduces to `{ evidence, reasons, diagnostics: "truncated-after-decision" }`. Truncated reasons use the deterministic evidence-anchor selection in 08 §8.7. ≤ 16 KiB serialized under the hook cap, depth ≤ 8 (I6) |

Verdict bounds: output ≤ 64 KiB; anything larger is a checker defect. `deny` MUST always carry a
`message` (prescriptive, 07 §7.7). Aggregate `allow` and `ask` MAY carry a message, which the hook ignores. The v1 verdict schema stays UNCHANGED byte-wise: its `facts` field is
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
chk → {"invocationId":"...","verdict":"deny","message":"...","commands":[...]}
chk → exit 0
hook → permission.reply(decision:"reject", message) / "once" / silence
```

```
hook → spawn checker (config invalid)
chk → (stderr: config invalid: defaults.redirectPolicy references unknown policy "safe-local-iox")
chk → exit 2, no stdout
hook → onCheckerError (default "ask"): no reply → human sees the prompt
```

## 2.7 Verdict v2 envelope and command semantics

The new checker MUST write only this v2 envelope for every outcome; it MUST NOT
select v1 or v2 from command data, negotiate a response version, probe consumer
capability, or emit v1 as fallback:

```json
{
  "protocol": "shell-warden.verdict.v2",
  "result": {
    "invocationId": "msg:call",
    "verdict": "ask",
    "commands": [
      { "index": 0, "verdict": "ask", "classification": "invalid", "match": "raw" }
    ]
  }
}
```

The root MUST contain exactly `protocol` and `result`; `protocol` MUST equal
`shell-warden.verdict.v2`; and `result` MUST be the closed v2 `Result` object.
`result.invocationId` MUST echo the letter invocation id. `result.commands` MUST
have one entry at every letter command array position; both arrays use contiguous
indexes `0..N-1` equal to their positions.

| Classification | Producer condition | Match | Valid verdicts |
|---|---|---|---|
| `static` | Every participating part is complete: supported syntax, options, analyzers, and limits produced complete typed evidence. | `argv` | `allow`, `ask`, `deny` |
| `opaque` | Supported coherent structure remains, but runtime-dependent words or values are unknown, including active expansion or resolvable structure with dynamic content. | `raw` | `ask`, `deny` |
| `invalid` | Required structure or evidence is malformed, unsupported, internally inconsistent, or exceeds an evaluation/resource limit. | `raw` | `ask`, `deny` |

The stable reason categories and examples are those in 07 §7.3. Every other
classification, match, or verdict combination MUST fail validation. A deny command
MUST contain `ruleId`; allow and ask use the schema's optional field, with the
recognized-full-diagnostics coherence rules in §2.8. Aggregate deny MUST contain
`message`. Aggregate allow and ask MAY contain an optional message, which the hook
ignores.

Invalid evidence establishes an ask floor and MUST NEVER allow. When no ordinary
rule emits a vote, invalid evidence MUST produce a bare ask without `ruleId`.
Retained typed evidence or raw text MAY match ordinary ask or deny rules. An
emitted ask vote yields ask with the deterministic `ruleId` selection of §2.8;
deny remains dominant. Opaque evidence likewise MUST NOT auto-allow.

## 2.8 Consumer validation and dual-read selection

After JSON Schema validation, consumers MUST apply semantic invariants using the
expected letter context: its `invocation.id`, command count, and positional indexes.
They MUST verify positional contiguous command indexes `0..N-1` equal to their array
positions in both letter and result; legal
classification/match/verdict tuples; required deny messages; and
that `result.verdict` equals the most-restrictive command verdict, `deny > ask >
allow`. A mismatch is a checker anomaly. Thus invalid ask plus static allow
aggregates to ask, and invalid ordinary-rule deny aggregates to deny.

The hook MUST select one parser before validation:

1. When `protocol` is absent, it MUST exact-validate only flat v1.
2. When `protocol` exactly equals `shell-warden.verdict.v2`, it MUST exact-validate only v2.
3. Unknown, non-string, or malformed `protocol` is a checker anomaly.
4. Failed v2 validation is a checker anomaly and MUST NOT fall back to v1.

A flat object carrying `protocol` is not v1: the immutable v1 schema rejects its
unknown root key exactly. The future dual-read hook MUST apply the same post-schema
semantic invariants to an exact-valid v1 result without changing the v1 schema or
the released v1 producer behavior. Therefore impossible v1 tuples, including
`opaque` plus `argv` plus `allow`, fail through `onCheckerError ∈ {ask, deny}`.
Unknown classifications, protocol values, malformed types, missing classification
or match, invalid or opaque allow, raw allow, arbitrary v2 diagnostics, inconsistent
aggregates, or invalid command coverage likewise fail closed.

Recognized full facts have exactly the keys `evidence`, `reasons`,
`selectedProfiles`, `matched`, `qualified`, `rejected`, and `votes`. Recognized
truncated facts have exactly `evidence`, `reasons`, and `diagnostics` with
`diagnostics: "truncated-after-decision"`. Every member of either recognized key
set MUST have its specified type and bounds; malformed members fail closed.
Any v1 facts object that contains at least one reserved diagnostic key,
`evidence`, `reasons`, `diagnostics`, `selectedProfiles`, `matched`,
`qualified`, `rejected`, or `votes`, MUST be one of these exact valid full or
truncated shapes or fail closed. V1 facts disjoint from all reserved diagnostic
keys remain legacy-opaque. Recognized facts MUST use stable 07 §7.3 reason codes.
Full `reasons` MUST be deduplicated and sorted by UTF-8 bytes. Static evidence
requires `complete`. Opaque evidence requires `opaque-expansion`, may also carry
`complete` for mixed complete and opaque parts, and MUST NOT carry an invalid-cause
reason. Invalid evidence requires at least one stable invalid-cause reason.
Truncated `reasons` MUST be sorted, unique, and contain at most eight entries. When
full reasons exceed eight, truncated reasons MUST retain the evidence anchor:
`complete` for complete evidence, `opaque-expansion` for opaque evidence, or the
UTF-8-byte-order lowest invalid-cause reason for invalid evidence. The remaining
slots MUST contain the UTF-8-byte-order lowest other full reasons, after which the
selected entries MUST be sorted by UTF-8 bytes. A full `rejected` array MUST contain
one canonical entry per `ruleId`; each entry's complete coverage reasons MUST be
sorted and deduplicated by UTF-8 bytes. Duplicate `ruleId` entries are invalid
regardless of JSON object property order. For full facts, `votes` records emitted
votes only, not default asks. A part with no emitted vote
defaults to ask, so a command may be ask with only allow votes recorded. A command
verdict MUST NOT be less restrictive than any emitted vote. `matched` contains
rules whose ordinary predicates held, `qualified` contains matched allow rules
whose coverage passed. A recognized full static/argv/allow command MUST have at
least one emitted allow vote. A present `ruleId` MUST be the UTF-8-byte-order
smallest emitted vote whose action matches the command verdict; a default ask
with no emitted ask vote MUST omit `ruleId`. The aggregate remains the
restrictive reduction of command verdicts. Parser or library text MUST NOT be
serialized.
The existing 16 KiB facts/depth-8 and total 64 KiB verdict caps remain mandatory.

## 2.9 Compatibility, rollout, and release completion

| Checker | Hook | Required behavior |
|---|---|---|
| Old v0.4.0 | Old | Exact schema-valid v1 normal; internal invalid serializes opaque exactly as released. |
| Old v0.4.0 | New | Exact schema-valid v1 normal; opaque MUST NOT be reinterpreted as invalid. |
| New | Old | V2 rejects for every verdict because legacy flat root fields are missing; `onCheckerError` fails closed but this is operationally incompatible. |
| New | New | V2 normal. |

Compatible hook and checker releases MUST be published together as one coordinated
pair for [hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13).
Deployment MUST remain hook dual-read first, then checker v2. Rollback MUST restore
the checker first while the dual-read hook continues to accept v1. Migration MUST
NOT be reported complete until docs and
schema are merged, hook and checker releases are deployed, compatibility and
rollback tests pass, and v2 emission is verified.

The hook repository implementation handoff MUST add revision-pinned v0.4.0 and
v0.2.1 harness tests with revision provenance: v0.4.0 supplies exact schema-valid
v1 preservation cases, and v0.2.1 supplies v2-envelope rejection through
`onCheckerError`. This docs repository supplies no release-test evidence.
