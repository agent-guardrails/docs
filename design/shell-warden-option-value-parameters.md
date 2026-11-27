# Rule-local parameters in option values

Status: Accepted for implementation · 2026-11-28

Tracking: https://github.com/agent-guardrails/docs/issues/60 and
https://github.com/agent-guardrails/shell-warden/issues/80.
Decision: [ADR-0027](../adr/0027-option-value-parameter-grants.md).

## Problem

The existing contextual-parameter contract deliberately excludes option values.
Consequently `example-tool --config "$HOME/config.yaml" list` asks even when
coverage is value independent. Reusing an argument grant would silently enlarge
permissions that were approved for a different context.

## Design

Add the optional allow-only `expansions.optionValues` variable-name list, with
the same validation and empty default as the other context lists. Option parsing
establishes the role using literal aliases, fixed arity, and existing occurrence
rules. A value uses the existing leading simple parameter plus literal suffix
grammar and is wholly double quoted. Separate values need no operand boundary:
fixed arity already establishes their role.

For inline forms, retain original source evidence for a literal, unquoted alias
followed by `=` and a wholly double-quoted value. The profile still explicitly
enables inline syntax for arity one. Quote concatenation, unquoted values,
dynamic aliases, and whole-word quoting of alias plus value remain unsupported.
An inline candidate consumed as another option's value or appearing after `--`
does not become an ordinary leading-parameter word.

Carry unknown values through canonical option occurrences and path coordinates.
Require both a local option-value grant and value-independent `each` or
`byPosition` coverage for every consumed parameter. Runtime predicates remain
three-valued; an applicable unknown restriction establishes an ask floor.

Keep code-bearing analyzer options (including sed program/file options) opaque
when dynamic; a general option-value grant does not prove a code role safe.
Existing wrapper/interpreter blocking and executable-child discovery stay intact.
Configuration and verdict remain v3: the new grant is optional, older readers
reject it, and the emitted verdict uses the existing parameter/expression shape.

## Verification

Exercise the public checker pipeline and wire validation with literal controls,
both parameter forms, aliases, multi-value arity, clusters, inline opt-in,
occurrence coverage, context isolation, unsupported syntax, path coordinates,
and restrictive unknown predicates. Validate configuration fixtures against both
the schema and Rust loader. Reuse the unchanged hook validator for actual
checker-produced option-value verdicts.
