# 0026, Contextual parameter evidence and three-valued predicates

* **Status:** Accepted (2026-11-17)
* **Related:** https://github.com/agent-guardrails/shell-warden/issues/69, https://github.com/agent-guardrails/docs/issues/50, https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/27
* **Design:** https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-exact-home-arguments.md
* **Supersedes:** [ADR-0020](0020-versioned-shell-warden-verdict-envelope.md) and [ADR-0023](0023-shell-warden-verdict-v2-only.md) for the active verdict version and literal-only allow classification.

## Context and Problem Statement

A policy may intentionally permit a variable reference without knowing its runtime
value. Treating that reference as literal text would invent argv evidence. Treating
an unresolved restrictive path test as false could bypass a deny rule.

The requester approved contextual variable-name allowlists, not runtime HOME
verification. The implementation needs one evidence model shared by all rules.

## Decision Drivers

- Keep permissions local to one allow rule and one expression context.
- Preserve unresolved values, coordinates, executable children, and resource limits.
- Never infer a runtime value, path confinement, or a literal option spelling.
- Keep the checker and hook on one active contract without compatibility branches.

## Considered Options

1. Resolve variables from the checker environment. Rejected: it cannot establish
   the shell's effective runtime values.
2. Keep opaque evidence for restrictions and a separate symbolic allow view.
   Rejected: inconsistent predicates and hidden restrictions.
3. Preserve typed parameter evidence and evaluate predicates in three values.
   Accepted: explicit grants can cover unknown values without silently bypassing
   restrictions.

## Decision Outcome

Use literal, supported parameter, and opaque word values in one evidence graph.
The supported parameter word has one leading simple identifier and a literal
suffix. Argument and redirect forms are wholly double quoted. Assignment forms
also admit unquoted references only where assignment semantics are established.
Arguments require a literal operand boundary; dynamic options and wrapper operands
remain unsupported.

Allow rules grant independent `arguments`, `redirectTargets`, and `assignmentValues`
name lists under `expansions`. These lists do not prove runtime constraints.
Value-independent coverage can cover a granted parameter; runtime equality,
regex, and path tests remain unknown.

Predicates compose `match`, `no-match`, and `unknown` over complete rules. Unknown
allow proofs cast no vote. An unknown applicable ask/deny rule establishes a
part-local ask floor without becoming a matched vote. A decisive false conjunct
removes that floor; a conclusive deny still dominates. Full diagnostics identify
uncertain restrictive rules and predicate coordinates; truncated diagnostics retain
`predicate-unknown` without inventing a winning rule.

Replace the active configuration and verdict contracts together, advancing their
versions. The letter stays v1. Historical contracts remain historical; runtime
readers and writers support only the replacement contract, with no fallback.

## Consequences

- Unknown variable values can be authorized explicitly without being called static.
- Restrictive rules continue to block automatic allow when their values are unknown.
- Owned policies and the hook require coordinated migration; mixed versions fail closed.
- General templates, multiple references, runtime verification, and arbitrary
  wrappers remain separate work.
