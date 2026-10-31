# 0010 — Bounded rejection: budget → suspension to ask

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/06](../spec/shell-warden/06-engine-config.md) §6.6

## Context and Problem Statement

Deny-and-recommend stages (format gate, redirect) can loop the agent: a false
positive in the classifier, or a task that inherently requires the flagged
construct, means the agent rewrites and is denied again — each iteration is a
full model turn (tokens, time). An unbounded gate turns a buggy classifier into
a token-consumption failure that looks like productive work.

## Decision Drivers

- The loop must be guaranteed to terminate.
- No automatic widening: suspension must not become silent allow.
- The human remains the final authority.

## Considered Options

1. **Unbounded enforcement** — rejected: classifier false positives burn tokens
   indefinitely.
2. **Suspension to `allow`** — rejected: silent widening (I3).
3. **Suspension to `ask`** — after a per-stage, per-session budget of rejections
   the stage stops contributing; commands fall through to the human.

## Decision Outcome

Option 3. Per stage: `budget { maxRejections, windowMs }`. The engine counts
the stage's deny verdicts per `(stage, sessionID)`; on exhaustion the stage is
bypassed for the session (walk continues without it) and a one-time suspension
notice is added to the next message. Reset: the stage produces a non-deny
verdict for the session, or the window expires.

Scope note: this pattern belongs to **recommendation gates** (format, redirect)
where a retry loop is organic. Policy stages (warden rules) are intentional
prohibitions — no budget; the resolution for a wrong policy rule is editing the
rule, not retrying.

## Consequences

- (+) Worst-case token burn is bounded and configurable (`maxRejections`).
- (+) The human decides the residual cases — exactly where a classifier is
  least trustworthy.
- (−) During suspension, unreadable/routed commands reach the human as plain
  prompts (friction, but visible and bounded by window).
