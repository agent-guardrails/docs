# 12 — Contextual parameters: configuration and verdict v3

Version 3.2 · 2026-11-28

Decision: [ADR-0026](../../adr/0026-contextual-parameter-evidence.md).
Option-value extension: [ADR-0027](../../adr/0027-option-value-parameter-grants.md),
https://github.com/agent-guardrails/docs/issues/60 and
https://github.com/agent-guardrails/shell-warden/issues/80.
Feature: https://github.com/agent-guardrails/shell-warden/issues/69.
Contract: https://github.com/agent-guardrails/docs/issues/50.
Hook: https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/27.

Executable-spelling integration:
https://github.com/agent-guardrails/shell-warden/issues/73 and
https://github.com/agent-guardrails/docs/issues/51, following
[ADR-0025](../../adr/0025-explicit-same-name-executable-spellings.md).

Schemas:
[configuration v3](../../schemas/shell-warden.config.v3.schema.json),
[verdict v3](../../schemas/shell-warden.verdict.v3.schema.json).

This section defines the active v3 additions and replaces the earlier literal-only
allow assumptions. Unchanged letter, trust, resource limits, option grammar,
coordinate catalogs, redirect-policy assembly, and vote precedence remain in force.
Historical schemas and accepted ADRs remain provenance, not alternate runtime paths.

## 12.1 Single active contract

The checker MUST accept configuration `version: 3` only and MUST emit
`shell-warden.verdict.v3` only. The hook MUST accept that exact closed envelope
only. V1/v2 configuration or verdict input, missing or unknown versions, malformed
fields, and semantic inconsistencies MUST fail closed through the existing
configuration-error or checker-error path. There MUST NOT be a compatibility
evaluator, response negotiation, translation, downgrade, or fallback parser.

The letter remains version 1 and contains no runtime environment values. Checker
and hook MUST be upgraded as a coordinated pair. These specifications and tests
do not claim a production release or deployment.

## 12.2 Typed words and structural classification

All rules MUST inspect the same parsed evidence. Values are literal, supported
parameter, or opaque; malformed structure and resource failures retain explicit
invalid evidence. Supported parameter values MUST NOT be represented as literal
argv or resolved paths.

A supported value consists of one leading `$NAME` or `${NAME}` reference and a
literal suffix, including an empty suffix. The complete case-sensitive identifier
MUST be parsed before the suffix. A shorter name MUST NOT cover a longer name.
Shell line continuations MUST be removed before identifier tokenization without
mistaking an escaped backslash for a continuation. Quote and escape information
MUST be retained from original source, not reconstructed from decoded markers.

Arguments, supported option values, and write/append redirect targets MUST be
wholly double quoted.
Direct prefix assignments and the declaration form
unquoted `export NAME=value [NAME=value ...]` also support unquoted parameter values where
assignment semantics suppress splitting and globbing. The initial unquoted value
grammar excludes brace/tilde expansion, concatenated quoting, and shell operators.
Quoted suffix spaces, glob characters, escaped dollar signs, and `..` are literal;
they do not prove a safe filesystem location.

Operators, indirect/array/special parameters, arithmetic, substitutions, multiple
references, malformed quoting, dynamic executable/option spellings, and dynamic
wrapper/interpreter operands do not qualify through this
feature. Their executable children MUST NOT disappear. Redirect targets MUST use
the same quote/expansion scanning as ordinary words. Every redirect occurrence,
assignment destination/kind/ordinal, empty literal argument, and executable child
MUST remain observed evidence.

Fixed literal shell scripts MUST use that same evidence model. A shell wrapper
MUST remain a participating parent and preserve its outer assignment/redirect
obligations on both itself and executable descendants. Every parent and child
MUST independently select an exact profile and prove full coverage, including
its own rule-local parameter grants. Extra wrapper operands MUST NOT be manufactured into
child argv or options. Assignment-only sibling parts remain participating asks
when no executable profile applies; they MUST NOT disappear beside allowed parts.

Part states are `complete`, `parameter`, `opaque`, and `invalid`, independent of a
rule's permissions. A part is `parameter` only when its nonliteral values are all
supported parameter candidates. Invalid dominates opaque, opaque dominates
parameter, and parameter dominates complete in command aggregation.

| Command evidence | Classification | Match | Verdicts |
|---|---|---|---|
| `complete` | `static` | `argv` | allow, ask, deny |
| `parameter` | `parameter` | `expression` | allow, ask, deny |
| `opaque` | `opaque` | `raw` | ask, deny |
| `invalid` | `invalid` | `raw` | ask, deny |

Unsupported words MUST NOT become supported merely because a rule mentions a
variable name. Opaque and invalid evidence MUST NOT allow.

Known dynamic code/executable operands cannot use ordinary argument grants. The
closed blocking catalog includes `eval`, `exec`, `command`, `builtin`, `source`,
`bash`, `sh`, `node`, `nodejs`, `python`, `python2`, `python3`, `perl`,
`awk`, `ruby`, `php`, `lua`, `Rscript`, `deno`, and `bun`. The shared lexical
basename helper (06 §6.3, 07 §7.2) supplies this blocking check without granting
profile selection or permission. This is not
semantic discovery of arbitrary generic programs.

The wrapper blocking check for `sudo`, `nohup`, `nice`, `timeout`, `env`, and
`xargs` MUST likewise recognize valid bare names and normalized absolute POSIX
spellings through that helper. Recognized wrappers retain independent parents
and children; unknown wrapper operands remain opaque.

Relative or irregular heads, including bare `.` and `..`, cannot be enrolled
under 06 §6.3. They MUST NOT be normalized or receive command-specific basename
dispatch. Their classification follows the general evidence model: for example,
`./env -- "$HOME"` has parameter evidence and an expression match, but MUST
default to ask because no profile can select that head. Ordinary parameter grants
MUST NOT authorize an unselected head.

For `awk`, a literal `--` is not proof of a data role: the next operand can be
program source. Without a program-role analyzer, nonliteral `awk` operands MUST
remain opaque even when an argument grant covers their variable name.

With `sed-v1`, a positional program MUST remain literal; parameter file operands
after a literal program and operand boundary can qualify. Dynamic `expression`
and `file` option values MUST remain opaque and cannot provide an alternative
program proof. Declared analyzers MUST NOT silently
omit their catalog merely because a configured literal spelling differs.
Without `sed-v1`, nonliteral `sed` operands, including option values, MUST remain
opaque rather than acquiring an unproved program/data role.

Unresolved declaration destinations, including `export -- "$HOME"`, MUST remain
unsupported even if an argument grant names HOME. An `env` utility assignment is
not a direct prefix-assignment value in this slice; the unsupported wrapper stays
opaque while known executable children remain observable for restrictions.

## 12.3 Rule-local context permissions

An allow rule MAY contain this closed `expansions` object:

```json
{
  "arguments": ["HOME"],
  "optionValues": ["HOME"],
  "redirectTargets": ["TMPDIR"],
  "assignmentValues": ["HOME", "TMPDIR"]
}
```

Each member is optional and defaults to an empty list. Lists MUST contain at most
64 unique names, each 1–128 ASCII characters matching
`[A-Za-z_][A-Za-z0-9_]*`. Unknown members, wildcards, configured runtime values,
wrong types, and explicit nulls MUST invalidate configuration. `expansions` is
allow-only, including when its object or lists are empty.

Each gate applies to that rule and context only. A rule MUST NOT borrow grants
from another rule, profile, or assembled configuration file. The assignment gate
names variables read by the expression, not destinations that may be changed.

Allow `match.classification` is optional. When present it MUST be `complete` or
`parameter` and MUST filter by that actual state. Omission permits either
supported state to attempt coverage; it does not permit opaque or invalid evidence.
An explicit old `complete` filter remains literal-only.

Before enabling grants, policy owners MUST also review old `opaque`
classification restrictions: supported parameters now have a separate structural
classification. Broaden or duplicate a restriction explicitly where both classes
are intended.

An unknown positional value can become an option. Every parameter argument
therefore MUST occur after a literal `--` recognized as the selected profile
grammar's operand boundary, not consumed as an option value. A boundary after the
parameter does not suffice. Executable names and option spellings remain literal.

`optionValues` independently grants names read in values consumed by declared
fixed-arity options. It MUST NOT grant positional, assignment, redirect, executable,
or option-name permissions; other context grants MUST NOT grant option values.
Separate values MAY use any declared alias, fixed value ordinal, and occurrence.
They do not require `--`, because option arity establishes the role. A consumed
literal `--` is a value, not an operand boundary.

Inline parameters MUST use a literal unquoted alias followed by `=` and a wholly
double-quoted supported value, for example `--config="${HOME}/config.yaml"`.
The selected profile MUST declare that alias with arity one and `inline: true`.
Whole-word quoting, concatenated quoting, dynamic aliases, unquoted values, and
inline values for other arities do not qualify. An inline candidate consumed as
another option's value or appearing after the operand boundary MUST NOT be
reinterpreted as a leading-parameter word.

The checker MUST NOT read or simulate runtime variable values. A grant covers
unset, empty, changed, non-exported shell-local, option-looking, and other values.
Execution may fail under `nounset`; the checker does not simulate that failure.
Preceding assignments MUST NOT be used to infer another expression's value.

## 12.4 Coverage remains a complete proof

Context permission alone MUST NOT qualify an allow. Arguments, options,
assignments, redirect structure/targets, tracked paths, facts, nested parts, and
limits MUST still be covered by the same rule.

A supported unknown argument requires the value-independent token selector
`{"any": true}` in remainder coverage. A supported assignment value likewise
requires an explicit `value: {"any": true}`, destination-name coverage,
`occurrence`, and assignment kind. `environment.prefix: true` selects command
prefixes; `false` selects declaration assignments. Declaration destination facts
from `export-v1` retain their ordinary coverage obligation.

A supported option value requires its rule-local `optionValues` grant and
`{"any": true}` at the corresponding `values.each` or `values.byPosition`
selector. Every occurrence and value ordinal MUST remain covered; required and
repeatable constraints are unchanged. Unresolved option path coordinates MUST
remain observed and additionally require value-independent path coverage.

Path-policy entries additionally accept `any: true` as an alternative to exactly
one `exact`, `within`, or `outside` selector. This form is value independent.
`any: false`, multiple selector arms, and nulls are invalid. A tracked unresolved
coordinate MUST remain observed and requires both value-independent path coverage
and its argument/option-value/assignment context gate. Redirect targets require their redirect
context gate and value-independent redirect-path coverage.

The redirect target-kind catalog adds `parameterPath`. It pairs only with `>` or
`>>`, never input or FD-duplication operators. A parameter target MUST be covered
as `parameterPath`, not as `literalPath` or `fd`; operator, source FD, occurrence,
and every other redirect occurrence remain covered independently.

Literal equality, regexes over runtime values, and resolved-path comparisons
cannot be proved from the variable's name. They MUST NOT compare displayed
expression text as though it were the effective value. Required runtime-value
coverage fails the allow proof; it does not veto a different qualifying allow.

## 12.5 Three-valued ordinary predicates

Every complete ordinary rule evaluates to `match`, `no-match`, or `unknown`.
Runtime equality, glob/regex, and path predicates on unresolved observed values
are unknown; value-independent tests and known structural facts remain decidable.
Omitted constraints do not introduce uncertainty.

Results MUST compose across the complete rule:

- Conjunction: any no-match decides no-match; otherwise any unknown decides
  unknown; otherwise match.
- Disjunction: any match decides match; otherwise any unknown decides unknown;
  otherwise no-match.
- Negation, only where a supported grammar operation defines it, exchanges match
  and no-match and preserves unknown. There is no general new negation syntax.
- Quantified any/all use disjunction/conjunction over observed items. Known-empty
  any is no-match; known-empty all is match. Existence/cardinality constraints
  remain separate. Unresolved values MUST NOT be dropped to manufacture emptiness.

An unknown conjunct MUST NOT prevent evaluation of a known false condition that
decides the complete rule. Only rules in the selected profile participate.

| Complete result | Allow | Ask/deny |
|---|---|---|
| match | Emits allow only after all context gates and coverage succeed. | Emits its configured vote. |
| no-match | No vote. | No vote or floor. |
| unknown | No allow vote; no veto of another allow. | Establishes a part-local ask floor without a matched vote. |

The floor MUST be applied before part/command/letter aggregation and before
diagnostic truncation. A conclusive deny still wins. An uncertainty-only ask MUST
NOT claim the unresolved restrictive rule as a matched vote or winning `ruleId`.
A real ask vote retains ordinary winning-rule attribution.

For an otherwise qualifying `ls -- "$HOME"`, an applicable deny comparing the
argument with `/secret` is unknown: the result MUST be ask. Corresponding
literal `/secret` and `/public` cases yield deny and allow. A restrictive
conjunction with a known absent required option is no-match even when its path
comparison is unknown.

## 12.6 Closed v3 diagnostics

Full facts have exactly `evidence`, `reasons`, `selectedProfiles`, `matched`,
`qualified`, `rejected`, `votes`, and `uncertain`. The new `uncertain` member is
required, including when empty. Each entry has exactly:

```json
{
  "ruleId": "restriction",
  "predicates": ["/parts/0/match/paths/any/0"]
}
```

Entries are grouped once per rule ID and sorted by UTF-8 bytes. `predicates` is
nonempty, sorted, unique, and bounded to 4096 coordinates per rule; the array of
rules is bounded to 4096. Coordinates are at most 256 Unicode code points, have no
whitespace, and identify `/parts/<u32>/match/<dimension>/...`; dimensions use the
closed match vocabulary. A rule can have known matches in other parts without
erasing the responsible uncertain part coordinates.

The stable reason catalog adds `parameter-expansion` and `predicate-unknown`.
Parameter evidence requires the former and excludes opaque/invalid causes.
Nonempty full `uncertain` MUST correspond exactly to `predicate-unknown`. That
reason MUST prevent allow, including in truncated diagnostics. Unknown policy
predicates are not checker anomalies and are not proven deny matches.

Truncated facts retain exactly `evidence`, `reasons`, and
`diagnostics: "truncated-after-decision"`. At most eight sorted unique reasons
remain. Selection MUST reserve the evidence anchor and, when present,
`predicate-unknown`, then fill the remaining slots with UTF-8-smallest other
reasons. Mandatory uncertainty evidence MUST NOT be lost at small diagnostic
thresholds. The configured full-detail threshold and existing fixed truncated
shape do not change the 16 KiB/depth-8 facts or 64 KiB verdict hard caps.

Parameter commands require diagnostics. Every full allow, static or parameter,
requires a qualified emitted allow vote. Positional indexes, invocation echo,
aggregate consistency, deny messages, canonical ordering, vote/rule-ID coherence,
and all other consumer checks remain mandatory. Both producer and hook MUST
reject impossible classification/match/verdict tuples and malformed uncertainty.
