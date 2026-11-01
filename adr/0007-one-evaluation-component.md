# 0007 — One evaluation component: legibility and routing merge into the warden engine

* **Status:** Superseded by [0016 — Two-tier enforcement](0016-two-tier-enforcement.md) (2026-11-01)
* **Deciders:** preved911
* **Related:** ADR-0004 (naming; artifact table amended by this decision), ADR-0009 (message resolution)

## Context and Problem Statement

Stage one planned two hook plugins: `shell-warden` (policy) and `shell-legible`
(readability of agent-run scripts). During design, a dependency chain emerged:
the readability decision is **conditioned on the policy verdict** —

- warden `allow` → legible stands down (policy trusted it; style gate must not
  re-litigate trust),
- warden `deny` → legible is silent (format critique of a dead command is noise),
- warden `ask` → legible enforces (ensure the human sees a readable command).

OpenCode V2 provides no cross-plugin channels: only `effect`/`message` are
mutable in the evaluate event, hook order is the only "priority", and plugin
ordering is a fragile contract. Simulating the dependency produced: message
tagging conventions, ordering contracts, priority lint — three mechanisms, none
guaranteeing a consistent next step for the agent.

## Decision Drivers

- The agent must always receive exactly one non-contradictory next action
  ("rewrite readable" vs "switch to MCP" must never compete).
- Legibility rules and policy rules can conflict (an allow-rule for a wrapped
  command vs a format rule against wrappers) and must be resolved by one
  authority with deterministic precedence.
- Component count should follow from necessity, not symmetry.

## Considered Options

1. **Two hook plugins + family message protocol** (tagged reasons, append
   rules, ordering contracts) — three coordination mechanisms, no guarantees.
2. **Two-tier enforcement** (evaluate = soft, execute.before = hard) — solves
   finality but not contradiction; tiers died with the merge.
3. **One evaluation component** — legibility and routing become stage families
   inside the warden engine; one verdict, conflicts resolved by stage order.

## Decision Outcome

Option 3. There is **one hook** (`opencode-shell-warden-hook`) and **one
engine**; legibility and routing are stage families (ADR-0008). The separate
hook plugin `opencode-shell-legible-hook` will not be created; `shell-legible`
names the readability reference tool.

## Consequences

- (+) Contradictions are resolved inside one evaluation, before they exist.
- (+) "Readability-only" deployments remain possible as an engine config
  profile (only legibility stages enabled) — configuration, not a component.
- (−) ADR-0004's artifact table is amended by this decision: the
  `opencode-shell-legible-hook` artifact is cancelled.
- (−) The readability stage is coupled to the warden release cycle.
