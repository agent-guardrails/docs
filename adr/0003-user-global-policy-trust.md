# 0003 — Policy code trusted from user-global scope only

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/09-security.md](../spec/shell-warden/09-security.md) (I2, D9)

## Context and Problem Statement

OpenCode merges configuration from several scopes: managed (MDM), system, organization console,
user-global, project, and `.opencode/` project-local. Policy rules decide which commands execute.
If a repository could supply policy, any cloned project would ship its own rules.

## Decision Drivers

- Repositories are untrusted input; the model reads and modifies them.
- The permission system already guarantees: explicit config `deny` is final and `policies` never
  widen access. The hook layer must not become a way around that.
- Operational usability: per-project tuning must remain possible for *non-widening* knobs.

## Considered Options

1. **Full cascade** — project config may contribute rules and even point at an engine.
2. **Cascade with widening filter** — project rules may only tighten.
3. **User-global only** — engine location, policy config and rules come exclusively from the
   user-global scope; project copies are ignored with a warning.

## Decision Outcome

Option 3.

- The engine `command[0]` is an absolute path resolved from user-global shim options only; a bad or
  relative path disables the plugin at load.
- The engine loads its policy config from the user-global path; a project-supplied policy file is
  ignored with a warning.
- Project-editable shim knobs are limited to non-widening values (budgets, actions subset, cache).

## Consequences

- (+) A cloned repository can never ship a "policy engine" or rules that widen access.
- (+) Matches the native layers: explicit `deny` and `policies` remain unoverridable above the hook.
- (−) No per-project policy out of the box; v2 may add an explicit, global-side opt-in allowlist
  (`allowProjectPolicy`) — tracked in the spec's open questions.
