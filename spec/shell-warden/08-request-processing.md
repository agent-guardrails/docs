# 08 — Stage Walk (Orchestrator)

Version 1.1 · 2026-10-31

End-to-end behavior of `policy/check` inside the engine. The engine core is a
pure orchestrator (ADR-0008): no parsing, no matching — only invocation of stage
tools and composition of their verdicts.

## 8.1 Pipeline

```
validate(request)                          → -32602 on schema violation
for each stage, in config array order:
    if !stage.enabled:                     continue
    if stage.voteOn == "ask" and verdict != "ask":
                                           continue   # не пересматриваем policy-доверие
    ensure tool (persistent pool or spawn) — supervisor, deadlines
    outcome = invoke(stage.tool, request, deadline)        # 06 §6.4
    classify(outcome)                      → onError-policy or (verdict, message)
    if verdict == deny:                    break     # первый deny останавливает walk (ADR-0012)
    if stage.exclusive:                    break     # ненулевой вердикт — поздние не вызываются
aggregate(outcomes)                        → most-restrictive-wins + message per §8.3
audit(...) + respond(result)               → 06 §6.4.3 response shape
```

## 8.2 Invocation and outcome per stage

1. **Call**: write request JSON (06 §6.4.2) to the stage tool's stdin; deadline
   = stage `tool.timeoutMs`.
2. **Outcome** (06 §6.4.4): valid verdict, or onError.
3. **onError** ⇒ this stage contributes the `onError` action (skip/ask/deny)
   with no message; violation counted; **walk continues** unless the tool pool
   is restarting (then remaining stages still run — each stage fails
   independently; one broken tool must not disable the others).

## 8.3 Aggregation

| Combination | Aggregate |
|---|---|
| any `deny` | `deny` |
| else any `ask` (incl. defaults/`onError`) | `ask` |
| else all `allow` (≥ 1 contributing stage) | `allow` |
| no stage contributed | `defaults.action` (top-level `defaults.action`, default `ask`) |

**Message composition** (order = array order):

| Stage `messageMode` | Contribution to `message` |
|---|---|
| `append` (policy/format default) | `message = compose(message, reason)` — `existing — reason` |
| `replace` (redirect-family) | `message = stage reason` — replaces everything accumulated |

Walk rule: **the first `deny` stops the walk** — later stages are not invoked,
and the denying stage's reason is the message. Together with `messageMode`
this replaces the v1.0 `skip` verb (ADR-0012).

Order-independence: with these three verbs the final message is identical for
any plugin/stage ordering (verified cases in `adr/0009`).

## 8.4 Rejection budget (per stage, per session)

Stages with a `budget` (06 §6.3) are subject to ADR-0010: the engine counts
this stage's deny verdicts per `(stage, sessionID)` within `windowMs`; on
exhausting `maxRejections` the stage is **bypassed** for the session (walk
continues without it; first bypass adds the suspension notice to the message).
Reset: stage produced a non-deny verdict, or window expired. Never auto-allow:
bypassed stages simply do not contribute — commands fall to `defaults.action`
(ask) or other stages.

## 8.5 Pseudocode

```ts
async function check(req: CheckParams, deadline: Deadline): Promise<CheckResult> {
  assertSchema(req)
  let verdict: Verdict = "allow", message: string | undefined
  for (const stage of stages.filter(s => s.enabled)) {
    if (stage.voteOn === "ask" && verdict !== "ask") continue
    const o = await invoke(stage, req, deadline)   // §8.2; onError → stage.onError
    verdict = mostRestrictive(verdict, o.action)
    message = composeMessage(message, o, stage.messageMode)
    budget.charge(stage, o, req.invocation)
    if (verdict === "deny") break                  // первый deny останавливает walk (ADR-0012)
  }
  audit({ verdict, message, req })
  return { invocationId: req.invocation.id, verdict, message, engine: { checkMs: elapsed() } }
}
```

Per-stage `verdict`/`stage`/`ruleId` diagnostics are returned in
`result.commands[]` only if the stage tool provided them; the core adds stage id
and onError reasons.
