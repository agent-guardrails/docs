# 0005 — Single evaluate hook; stages live in the engine

* **Status:** Superseded by [0016 — Two-tier enforcement](0016-two-tier-enforcement.md) (2026-11-01)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/08-request-processing.md](../spec/shell-warden/08-request-processing.md) (§8.2 stage walk)

## Context and Problem Statement

Policy pipelines need ordered, conditional stages: "stage 1 rejects a subset; stage 2 runs only for
the rest; stage 3 owns pattern-matched commands exclusively". The natural OpenCode mapping is one
`permission.evaluate` hook per stage — but hooks have no filters, no per-stage routing channel, and
the harness invokes every registered hook.

## Decision Drivers

- The harness always calls every registered evaluate hook; skipping must be implemented by the hooks
  themselves (early return), not configured.
- Cross-hook state has no documented carrier: `effect`/`message` are the only mutable channels, and
  any later hook may rewrite them.
- Stage logic should be testable without OpenCode.

## Considered Options

1. **One hook registration per stage** in one plugin — needs a closure-shared claims map keyed by
   invocation; ordering fragile, eviction bookkeeping required.
2. **Stages as separate plugins** — no reliable claims channel across plugins; cooperative only.
3. **Single evaluate registration; stage routing inside the engine** — the check request carries the
   whole invocation; the engine walks its configured stages and returns the aggregate verdict plus
   per-command diagnostics.

## Decision Outcome

Option 3. The shim registers exactly one `permission.evaluate` hook. Stage order, ownership
(`exclusive`), terminality and matching live in engine config; the response reports per-command
`stage` / `ruleId` for attribution and audit.

## Consequences

- (+) Pipeline semantics are ordinary code: explicit order, short-circuit, engine-side golden tests.
- (+) The shim is stage-agnostic and stays thin.
- (+) Stage configuration is a policy artifact, editable without touching the plugin.
- (−) Per-stage OpenCode-level attribution is diagnostics-only; verdict attribution inside prompts
  comes from the engine's `message` (per-line reasons), not from separate prompts per stage.
