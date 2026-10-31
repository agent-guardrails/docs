# 0009 — Message resolution across stages: `onExistingDeny`

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** ADR-0007, [spec/shell-warden/08](../spec/shell-warden/08-request-processing.md) §8.3

## Context and Problem Statement

Several stages can deny the same command with different actionable reasons:
format ("rewrite it readable"), redirect ("use the MCP tool instead"), policy
("forbidden by rule s1/no-push"). Appending all reasons produces contradictory
guidance: should the agent rewrite the command or switch to the MCP tool?
Following the format advice leads to a second denial by the redirect rule — a
wasted iteration.

## Decision Drivers

- The agent must receive exactly one non-contradictory next action.
- Resolution must be order-independent (config array order should not change
  the outcome's meaning).
- The verb set must be closed and small (no per-stage coordination logic).

## Considered Options

1. **Append everything** ("full picture") — contradictory guidance; the agent
   may follow the format advice and burn an iteration before hitting the
   redirect denial.
2. **Last writer wins** — order-dependent outcomes.
3. **Typed resolution verbs per stage** — `onExistingDeny: append | skip |
   replace` — with recommended defaults per family.

## Decision Outcome

Option 3, as a per-stage parameter:

| Verb | Behavior on stage deny | Family default |
|---|---|---|
| `append` | reason is added to the accumulated message | policy |
| `skip` | if a deny already exists, the stage is not invoked at all (and contributes nothing) | format |
| `replace` | message is replaced by this stage's reason — a redirect subsumes format demands (switching tools makes the command moot) | redirect |

The aggregate verdict is always most-restrictive (`deny > ask > allow`),
independent of the verbs; verbs govern the **message** and invocation economy
only.

## Consequences

- (+) Order-independent outcomes for all verified combinations; the agent gets
  one coherent action.
- (+) `skip` doubles as an invocation economy: a format stage is not called
  when a deny already exists.
- (−) The verb set is closed in v1.1; a new resolution style requires a
  protocol version bump.
