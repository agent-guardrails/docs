# 0012 — Stage message composition: `messageMode`, first-deny-stops

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Supersedes:** [0009](0009-message-resolution-on-existing-deny.md)
* **Related:** [spec/shell-warden/08](../spec/shell-warden/08-request-processing.md) §8.3

## Context and Problem Statement

ADR-0009 defined per-stage resolution verbs `onExistingDeny: append | skip |
replace`. Two problems emerged during contract finalization:

1. **`skip` is redundant.** With the rule "the first `deny` stops the walk",
   a format stage is never reached after a deny — its skip-behavior ("don't
   criticize an already-dead command") is expressed by the walk itself.
2. **The name is wrong.** After `skip` removal the parameter governs only how a
   stage's reason joins the accumulated **message** — `onExistingDeny` describes
   neither the trigger nor the effect.

## Decision Drivers

- One coherent next action for the agent (inherited from ADR-0009).
- Minimal verb set; no dead semantics.
- Order-independent message outcomes.

## Decision

1. Stage parameter renamed: **`messageMode: "append" | "replace"`** (default
   `"append"`).
   - `append` (policy, format): the stage's reason is added to the accumulated
     message — `existing — reason`.
   - `replace` (redirect): the stage's reason replaces everything accumulated —
     a redirect instruction subsumes prior format advice (switching tools makes
     the command moot).
2. **The first `deny` stops the walk**: later stages are not invoked, the
   denying stage's reason is the message.
3. `skip` verb removed. Family defaults: policy `append`, format `append`
   (practically standalone — its deny usually stops the walk), redirect
   `replace`.

## Consequences

- (+) Two orthogonal knobs per stage: `voteOn` (when it votes, ADR-0011) and
  `messageMode` (how its reason joins). No dead verb, no naming mismatch.
- (+) Deny path is strictly one iteration: nothing after the deny is evaluated.
- (−) With `append`, an ask reason may precede a later deny reason in the same
  message; acceptable — both inform the agent, the deny is the operative part.
- Supersedes ADR-0009; `onExistingDeny`/`skip` removed from schema and spec.
