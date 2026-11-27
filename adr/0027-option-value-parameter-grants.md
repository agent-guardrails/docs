# 0027, Independent grants for parameter option values

* **Status:** Accepted (2026-11-28)
* **Related:** https://github.com/agent-guardrails/shell-warden/issues/80, https://github.com/agent-guardrails/docs/issues/60
* **Design:** [Rule-local parameters in option values](../design/shell-warden-option-value-parameters.md)
* **Supersedes:** [ADR-0026](0026-contextual-parameter-evidence.md) only for its exclusion of parameter option values.

## Context and Problem Statement

Declared fixed-arity options establish value roles without a positional operand
boundary. The existing argument grant cannot cover those roles without silently
changing previously configured permissions.

## Decision Drivers

- Keep each permission rule-local and context-specific.
- Preserve literal option names, fixed arity, and every occurrence.
- Never infer runtime strings, safe paths, or program semantics from a name.
- Retain the shared three-valued evidence model and closed verdict envelope.

## Considered Options

1. Extend `arguments` to option values. Rejected: existing grants gain a new role.
2. Resolve environment values. Rejected: checker values do not establish shell values.
3. Add `optionValues` using existing parameter evidence. Accepted: explicit,
   independent authorization with unchanged runtime uncertainty.

## Decision Outcome

Add an optional allow-only `expansions.optionValues` name list. Permit supported
wholly double-quoted values consumed by declared options, including explicitly
enabled arity-one inline forms with a literal unquoted alias. Keep all other
coverage obligations, restrictive unknown floors, and code/wrapper exclusions.

Configuration and verdict stay v3. The optional grant does not change existing
grant scopes; old readers reject the new field rather than interpreting it.
Supported option values become structural parameter evidence even without a
grant, so policy owners review restrictions that select only opaque evidence.

## Consequences

Common configuration-path options can be explicitly allowed without claiming
path confinement. Runtime equality, regex, and path predicates remain unknown.
Dynamic executable/option names, complex expressions, and code operands remain
outside this feature.
