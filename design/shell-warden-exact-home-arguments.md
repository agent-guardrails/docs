# Design draft: exact-source HOME argument authorization

Status: draft; implementation and wire format not approved
Design ticket: https://github.com/agent-guardrails/docs/issues/43
Feature request: https://github.com/agent-guardrails/shell-warden/issues/69
Current config design: https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-config-v2.md
Current verdict contract: https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md

## Reduced first step

The requester accepts explicit authorization of an exact argument expression
without knowing its expanded value. This is narrower in implementation than
trusted runtime expansion, but grants a different permission:

- Trusted expansion authorizes a resolved value, potentially subject to path
  confinement.
- Exact-source authorization permits a particular shell expression, independently
  of the value of HOME. It does not establish path confinement.

For example, a rule explicitly permitting `"$HOME/.config/example"` permits that
expression with HOME set to any value, including unset or empty. Shell failure
under options such as `nounset` remains an execution concern; the checker does not
evaluate or execute the expression.

The initial scope is positional arguments containing a simple, fully
double-quoted `$HOME/…` or `${HOME}/…` expression. HOME resolution, unquoted
expansion, tilde expansion, option values, redirects, assignment values, and
executable names are outside this first step.

## Opt-in and matching

An ordinary `arguments.exact` entry continues to mean a decoded literal argument.
Writing `$HOME/.config/example` there does not enable expansion authorization.
Existing configurations retain their current results.

A separate, explicitly named selector expresses source authorization. The working
name is `arguments.sourceExact`; this is proposed syntax, not valid released
configuration:

```json
{
  "arguments": {
    "sourceExact": ["\"$HOME/.config/example\""]
  }
}
```

The selector covers the entire positional argument tuple, with exact argument
count and byte-for-byte source equality per token. It is mutually exclusive with
`exact`, `prefix`, and `remainder`. It is not a raw-command rule or a glob matcher.
Non-expression entries in the tuple are restricted to fully resolved literal
tokens. The existing option grammar still identifies positional boundaries.

For an expression entry, validation and parsing establish all of the following:

- The entire token is a single balanced double-quoted word, without concatenated
  fragments.
- Its only active expansion is one leading `$HOME` or `${HOME}` reference.
- The reference is followed by `/` and a nonempty literal suffix.
- The suffix contains no further parameter references, command substitutions,
  backticks, escape sequences, or line continuations.
- The source spelling matches the configured spelling exactly. The two supported
  HOME spellings are not implicitly interchangeable.

Single-quoted and escaped-dollar words remain literals. They are not equivalent
to a source-authorized active expansion.

Source capture comes from the lexical scanner, not substring extraction from the
command or reconstruction from decoded token text. Current expansion markers
erase the original variable spelling, so they are insufficient evidence.

## Coverage and policy isolation

Exact source equality supplies evidence about the expression's syntax, not its
runtime value. The implementation keeps those evidence kinds distinct.

Executable selection, options, literal arguments, redirects, environment
assignments, nested parts, and resource limits continue through their normal
coverage checks. This selector does not bypass an uncovered dimension.

Runtime-value selectors never consume an expression's source as if it were the
expanded value. In particular, lexical path checks such as `within`, `exact`, or
`outside` do not prove anything about an unresolved HOME expression. A profile
requiring such proof for the expression cannot qualify for allow through this
mode. Facts that depend on its expanded value remain unavailable.

Existing ask and deny rules retain their view of unresolved expansion. An
explicit source allow does not suppress their votes. Reduction remains
`deny > ask > allow`; unmatched expressions remain ask.

The initial implementation rejects source authorization in wrapper children and
parts with environment assignments, redirects, or executable substitutions.
Literal sibling commands still need their own complete coverage. Supporting more
contexts later requires explicit rules and regression cases; no wrapper is
implicitly transparent to this selector.

## Environment semantics

No environment value is read, transmitted, or trusted for this mode.

Unset, empty, changed, or mismatched HOME does not invalidate a source permission:
the policy deliberately authorizes the expression for any value. This differs
from the original trusted-expansion request and needs prominent user-facing
documentation.

Command-local assignments and environment-changing wrappers are excluded from
the first step. These exclusions are scope limits, not claims that a source
comparison verifies HOME. The actual runtime environment remains unconstrained.

## Existing contract obstacle

The released verdict v2 contract permits allow only for `static/argv`, backed by
complete literal evidence. `opaque/raw` can only ask or deny. Both the schema and
the hook's post-schema validator enforce that boundary.

Consequently, changing only argument equality is insufficient. Marking an
unresolved expression as a literal would falsify the existing evidence contract;
allowing an ordinary opaque part would remove an existing safety boundary.
Neither is an acceptable implementation shortcut.

Before implementation, a wire-contract proposal needs to represent explicitly
authorized source expressions without calling them resolved argv. It also needs
coordinated checker, hook, schema, diagnostic, and fixture changes. Whether this
uses a new protocol version is deliberately undecided here; released protocol
identities and existing validator assumptions need explicit review first.

No specification, schema, or runtime behavior changes in this draft.

## Alternatives

1. Resolve HOME from checker environment or a configured value: does not prove
   equality with the executing shell; unnecessary for the reduced request.
2. Let existing `arguments.exact` accept any opaque token with matching text:
   silently changes existing policy semantics and cannot distinguish supported
   source expressions from substitutions or malformed words.
3. Match the entire raw command: loses argument-level structure and ordinary
   coverage guarantees.
4. Add a distinct source selector and evidence representation: preserves the
   distinction between expression authorization and runtime-value proof.

Option 4 is the proposed direction, not an accepted architectural decision.
Acceptance requires a separate ADR and the wire-contract decision above.

## Regression matrix

| Case | Expected result |
|---|---|
| Feature absent; ordinary exact selector; quoted HOME expansion | Existing opaque ask |
| Exact configured quoted spelling, count, and other coverage | Eligible for source-authorized allow under the future contract |
| Different suffix, HOME spelling, quote style, or argument count | No source allow |
| Unset, empty, or different HOME; identical authorized expression | Same source authorization, no path-confinement claim |
| Literal single-quoted or escaped-dollar spelling | Literal semantics only |
| `$USER`, `${HOME:-…}`, `${HOME:=…}`, arithmetic, substitutions, backticks | No source allow |
| Unquoted HOME, tilde, adjacent quoted fragments, extra expansion | No source allow |
| Expression used as executable, option value, or redirect target | No source allow |
| Environment assignment or environment-changing wrapper | No source allow in initial scope |
| Unknown option, uncovered literal argument, redirect, or nested part | No source allow |
| Required resolved path or analyzer fact for expression | No source allow |
| Existing matching ask or deny rule | Ask or deny still wins |
| Parser/evidence/depth/config limit exceeded | Existing fail-closed result |
| Old consumer receives unsupported future evidence | Reject and degrade, never reinterpret as static allow |

## Implementation gates

1. Accept or revise this scope and the explicit any-HOME-value permission.
2. Record the evidence/wire decision in a new ADR.
3. Update the normative specification, config/verdict schemas, grammar snapshot,
   and shared fixtures together.
4. Implement token source preservation, strict expression recognition, tuple
   matching, coverage isolation, and honest verdict evidence in the checker.
5. Implement the coordinated hook validator support.
6. Run checker and hook tests, schema/grammar drift checks, and a real permission
   round trip. Document unsupported-consumer degradation.
