# 0001 — Fail-closed degradation

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/09-security.md](../spec/shell-warden/09-security.md) (invariants I3, I5; matrix §9.4)

## Context and Problem Statement

A permission hook consults an external engine before every guarded action. The engine, the transport
and the configuration can each fail: crash, timeout, malformed output, bad protocol version, invalid
config. The hook must decide what to do with the guarded action in every failure case.

## Decision Drivers

- The guarded action runs with the host user's full authority (shell is the dangerous tool).
- A checker that fails "open" makes the whole system decorative.
- Permanent unavailability must not make the agent unusable.

## Considered Options

1. **Fail-open** — allow when the checker is unavailable. Agent keeps working; policy silently disappears.
2. **Fail-closed to `deny`** — block on any anomaly. Safe, but a crashed checker bricks the agent.
3. **Fail-closed to `ask`** — degrade to the native permission prompt; the human decides. Blocks only
   where the human would have been asked anyway, depending on configured rules.
4. **Per-call config of the failure verdict**, `ask` by default, `deny` for hard-fail environments.

## Decision Outcome

Option 4, with option 1 excluded outright:

- `onEngineError ∈ { ask, deny }` — **`allow` is not a valid value**, rejected at config validation.
- Every transport-level anomaly (parse error, bad version, timeout, oversize frame, crash, spawn
  failure) resolves the invocation to `onEngineError`. Invariants I3.
- Fatal misconfiguration at load time (bad engine path, bad protocol version) disables the plugin —
  there is nothing to degrade to in-process.

## Consequences

- (+) A checker failure can never widen access; the model cannot benefit from breaking the engine.
- (+) Default posture keeps the agent usable: worst case is a native prompt.
- (−) Availability depends on supervision quality (restart ladder, unhealthy cooldown — ADR-0002 scope).
- (−) `deny` mode can hard-brick sessions on engine trouble; documented as a hard-fail option.
