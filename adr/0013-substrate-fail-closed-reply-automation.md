# 0013 — Substrate is the fail-closed boundary; the hook answers published permission requests

* **Status:** Accepted (2026-11-01)
* **Deciders:** preved911
* **Supersedes:** the evaluate-hook verdict application (03-shim §3.2) and stage params `voteOn`/`applyWhen`/`passive`
* **Related:** [10-testing §10.5–10.5.1](../spec/shell-warden/10-testing.md) (live findings), ADR-0009, ADR-0011

## Context and Problem Statement

Live smoke on OpenCode v2.2.2 and v2.2.5 (latest):

- An evaluate-hook `allow` does **not** suppress a configured `ask`: the prompt
  is still published and the headless run-mode client auto-rejects it.
  (Escalation ask→deny is honored; allow-downgrade is not. Confirmed with a
  pure-V2 permissions config.)
- `ctx.session.get` inside the evaluate hook **deadlocks** (re-entrant HTTP
  into the server during permission evaluation).
- Meanwhile the reply path works: `ctx.permission.reply` exists
  (`hook, list, get, reply, assert`), published requests arrive as
  `permission.asked` events (`data.{id, sessionID, action, resources}`), and an
  in-process reply resolved a request in **28 ms** with its `message`
  (`"probe-reject-marker"`) reaching the agent — ahead of the client's
  auto-reject (~40 ms).

Consequence: ask→allow automation through the evaluate hook is not viable on
current OpenCode, while the alternative substrate (native allow + hook denies)
is fail-open when the hook is absent — the operator's explicit requirement is
"OpenCode without the loaded hook must not work (shell-wise)".

## Decision Drivers

- Failure of the hook must equal **fail-closed**, not silent passage.
- Independence from OpenCode version drift and undocumented API behavior.
- The quality gate (readability) and routing keep working — via engine verdicts.

## Considered Options

1. **Evaluate-hook allow** — rejected: ignored by v2.2.x (proven live).
2. **Native allow substrate + hook denies** — rejected: fail-open when the
   hook is absent.
3. **Native `shell → ask` substrate + hook replies to published requests** —
   fail-closed by substrate; automation is a programmatic "Allow once" click.

## Decision

Option 3.

1. Substrate polarity: native permissions `shell → ask`. The published ask is
   the fail-closed boundary: with the hook absent, every shell command prompts
   the human (TUI) or is auto-rejected (headless run) — nothing executes
   silently.
2. The shim replies to `permission.asked` events: consult the engine (stage
   tools, persistent pool), then
   `ctx.permission.reply({sessionID, requestID, decision, message})`:
   - engine `allow` → `decision: "once"` — command runs, human not involved;
   - engine `deny` → `decision: "reject"`, `message` = composed stage reason
     (live-proven: the reason reached the agent);
   - engine `ask` → **stay silent** — the dialog goes to the human
     (escalation by silence).
3. The evaluate hook, event-effect mutation (`applyToEvent`), and stage
   `voteOn`/`applyWhen`/`passive` are removed. `exclusive` (stop the walk after
   a non-noop stage verdict) is kept; stages run in config order, aggregate =
   most-restrictive, message composed engine-side.

## Consequences

- (+) Fail-closed by substrate: does not depend on hook load state, version
  drift, or undocumented evaluate-allow behavior.
- (+) Live-proven: reply works on v2.2.x, wins the race against client
  auto-reject, delivers the reason to the agent.
- (+) The hook is now purely an automation/enrichment layer over a native
  guarantee — a cleaner separation of trust.
- (−) One publication + reply roundtrip per guarded command (measured 28 ms
  incl. engine consult).
- (−) Headless degradation with the hook absent: the agent cannot execute
  shell commands without a human (accepted by design).
- (−) Cwd is unavailable in the hot path in v0.1 (the deadlock finding); M1
  restores it via a session-event cache.
