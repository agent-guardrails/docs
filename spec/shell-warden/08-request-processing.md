# 08 — Request Processing (Engine Check Pipeline)

Version 0.1 · 2026-10-30

End-to-end behavior of `policy/check` (02 §2.4) inside the engine.

## 8.1 Pipeline

```
validate(params)                    → -32602 on schema violation (no side effects)
  ↓
enforceLimits(params)               → degrade per command if over (maxCommands handled by shim)
  ↓
buildContext(invocation, deadline)  → git/env/time facts per §8.4; deadline-guarded
  ↓
for each command (in order):
    normalize(raw, cwd, stageFlags) → 07 §7.3          {classification, tokens, argv, …}
    walkStages(command, ctx)        → per-command outcome (§8.2)
  ↓
aggregate(outcomes)                 → most-restrictive-wins (§8.3)
  ↓
audit(...)  +  respond(result)      → 02 §2.4 response shape
```

Any engine-internal exception per command ⇒ that command's outcome = `defaults.onError` (`ask`|`deny`), `stage: null`,
reason `internal-error` — the check as a whole still answers. A deadline breach mid-walk ⇒ remaining commands get
`defaults.onError`; already-walked commands keep their outcomes unless the aggregate is already `deny`.

## 8.2 Stage walk (per command, normative order)

```
outcome = none
for stage in stages (array order):
    if not scopeMatches(stage.scope, command):        continue      # 06 §6.3 matchers
    if stage.passive:
        r = matchRules(stage.rules, command, ctx)                   # audit recording only
        record(stage, r); continue
    ownOutcome = matchRules(stage.rules, command, ctx)              # first match wins (order)
    if ownOutcome == none: ownOutcome = defaults.action
    outcome = ownOutcome; ownedStage = stage
    if stage.exclusive: break            # owned here; later stages never see it (06 §6.3)
    if stage.terminal and matchedARule:  break
    # terminal with NO rule match, non-exclusive → continue to next stage
if outcome == none: outcome = defaults.action; ownedStage = null
```

Rules:

- `matchRules` evaluates `rules[]` in array order; ALL `when` conditions must hold (AND); first match is final
  for the stage. Matching semantics per condition type: `07-command-parsing.md` §7.4–7.6.
- Allow-classification rule: `action: "allow"` matches only `static` commands (07 §7.2).
- Context conditions (`git`, `env`, `time`) whose provider is disabled or whose lookup failed NEVER match —
  including for `deny` rules (a deny that silently matched everything on provider failure would be surprising;
  the command simply proceeds to later stages / defaults, which are ask-biased).
- `outcome` records `{action, stage.id, rule.id, reason, facts}` for the response's `commands[]`.

## 8.3 Aggregation

The shim applies one `event.effect`, so the engine MUST aggregate per-command outcomes into one verdict:

| Combination | Aggregate |
|---|---|
| any `deny` | `deny` |
| else any `ask` (incl. unowned/`defaults.action`) | `ask` |
| else all `allow` (and ≥ 1 command) | `allow` |

`message`: the first deny/ask reason in command order. `commands[].verdict` echoes per-command outcomes.

## 8.4 Context providers

| Provider | Facts | Rules |
|---|---|---|
| `git` | `branch`, `upstream`, `dirty`, `worktree` | resolved once per invocation (cached per session with staleness cap from `limits`); lookups run with cwd = command cwd; failures ⇒ conditions non-matching (see above) |
| `env` | values of allowlisted vars only | never logged, never echoed into `facts` |
| `time` | wall clock, cron-window membership | evaluated against UTC unless a rule specifies TZ (v1: UTC only) |

Context building shares the invocation deadline: git lookups get at most half the remaining budget; if exceeded,
git conditions are non-matching for this invocation.

## 8.5 Idempotence & side-effect rules

- `policy/check` is read-only (05 §5.4); safe to retry. The shim does not retry automatically (deadline policy covers
  it); engines MUST tolerate duplicate `invocation.id`s (idempotent).
- Audit emission (`audit/event`) is fire-and-forget; audit failures never alter verdicts.

## 8.6 Reference pseudocode

```ts
async function check(req: CheckParams, deadline: Deadline): Promise<CheckResult> {
  assertSchema(req)                                        // -32602
  const ctx = await buildContext(req.invocation, deadline) // §8.4, deadline-guarded
  const outcomes = []
  for (const cmd of req.commands) {
    const norm = normalize(cmd.raw, cmd.cwd)               // 07 §7.3
    const outcome = walkStages(norm, cmd, ctx, deadline)   // §8.2
    outcomes.push({ index: cmd.index, ...outcome })
  }
  const verdict = aggregate(outcomes)                      // §8.3
  audit({ verdict, outcomes, req })                        // fire-and-forget
  return { invocationId: req.invocation.id, verdict, commands: outcomes,
           message: firstReason(outcomes), engine: { checkMs: elapsed() } }
}
```
