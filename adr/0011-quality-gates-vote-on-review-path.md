# 0011 — Quality gates vote only on the review path

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** 0007 (one evaluation component), [0009](0009-message-resolution-on-existing-deny.md) (message resolution), [spec/shell-warden/06 §6.3](../spec/shell-warden/06-engine-config.md)

## Context and Problem Statement

Stage families differ in their relation to policy trust:

- **Decision stages** (policy rules, routing) produce the automated trust
  verdict — they vote on every command.
- **Quality gates** (readability/format) shape what the human sees at review
  time: a format denial of a command that policy explicitly allowed would
  re-litigate automated trust and burn an agent iteration on a rewrite that
  changes nothing about oversight. The operator's objection, verbatim: policies
  exist precisely so that not everything is validated by hand.

In the merged single-component evaluation (ADR-0007) the quality stage's tool
cannot know the running policy verdict unless the walk exposes it.

## Decision Drivers

- Policy `allow` = automated trust; quality gates must not re-litigate it.
- Human review happens only at `ask` — unreadable commands must not reach a
  human prompt.
- Minimal schema; engine-side skip beats per-tool no-op logic (no wasted
  invocation).

## Considered Options

1. **Quality stage always votes** — rejected: re-litigates policy trust and
   burns iterations on policy-allowed commands.
2. **Always pass the running aggregate into every tool; tools decide** —
   rejected: family semantics leak into each tool, and an invocation is paid
   even when the tool will no-op.
3. **Walk-level gate `voteOn: "always" | "ask"`** (default `"always"`) — the
   engine skips ask-voting stages unless the aggregate verdict is `ask`.

## Decision Outcome

Option 3. Per-stage parameter `voteOn`:

- decision stages (policy, routing) vote `"always"`;
- quality gates (legibility) vote `"ask"` — they shape the command only when it
  is heading to a human.

## Consequences

- (+) Policy trust is never re-litigated by quality gates; policy-allowed
  commands run without format friction.
- (+) Engine-side skip: no wasted tool invocations.
- (+) Readability-only profiles still enforce: with decision stages disabled
  the aggregate is `defaults.action` = `ask`, so the gate votes on every
  command.
- (−) Decision stages must precede ask-voting gates (recommended stage order in
  [06 §6.5](../spec/shell-warden/06-engine-config.md)).
- (−) Gate/verb sets are closed in v1.1; extensions require a protocol bump.
