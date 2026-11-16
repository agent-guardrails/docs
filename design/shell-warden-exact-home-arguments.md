# Design draft: contextual variable allowlists

Status: agreed user-facing direction; schema details proposed
Current refinement: https://github.com/agent-guardrails/docs/issues/49
Earlier refinements: https://github.com/agent-guardrails/docs/issues/43, https://github.com/agent-guardrails/docs/issues/45, and https://github.com/agent-guardrails/docs/issues/47
Feature request: https://github.com/agent-guardrails/shell-warden/issues/69
Design PR: https://github.com/agent-guardrails/docs/pull/44
Policy contract: https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/06-engine-config.md
Verdict contract: https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md

## 1. Agreed behavior

A policy author can explicitly permit variable references separately in command
arguments, redirect targets, and assignment values. Permitting `HOME` covers
`$HOME` and `${HOME}` followed by any literal text, including no text.

| Word | Interpretation |
|---|---|
| `"$HOME"` | Reference to HOME with an empty suffix. |
| `"$HOME/.config/app"` | Reference to HOME followed by literal `/.config/app`. |
| `"${HOME}/cache"` | The same reference followed by literal `/cache`. |
| `"$HOME-backup"` | Reference to HOME followed by literal `-backup`. |
| `"$HOME_BACKUP"` | Reference to the different variable HOME_BACKUP. |
| `"$HOME/$USER"` | Contains another reference; the suffix is not all literal. |
| `"$HOME/$(command)"` | Contains command substitution; a HOME grant does not cover it. |
| `'$HOME/cache'` | Literal dollar text, not a variable reference. |

“Literal” describes shell syntax, not a safe filesystem location. Inside double
quotes, spaces and `*` can be literal characters. A suffix such as `/../other`
is also literal. This permission deliberately does not constrain the suffix or
prove confinement of the expanded path.

There are no separate exact-suffix, prefix-suffix, or expression-template
selectors in this feature. The name allowlist is the explicit escape hatch.

## 2. Proposed configuration

Illustrative allow-rule fragment; these field names are proposed, not released:

```json
{
  "expansions": {
    "arguments": ["HOME", "TMPDIR"],
    "redirectTargets": ["TMPDIR"],
    "assignmentValues": ["HOME", "TMPDIR"]
  }
}
```

Each list is independent. A permission for HOME in an argument does not permit
HOME in a redirect or assignment. The gate is local to the allow rule, and a
rule cannot borrow names from another rule or assembled config file.

Omitted or empty lists grant nothing. Names are case-sensitive, unique valid
identifiers matching `[A-Za-z_][A-Za-z0-9_]*`, subject to the existing selector
count limit. Wildcards and configured runtime values are not accepted.

The assignment list names variables **read by the expression**, not variables
that the command may change. For `export CACHE="$HOME/cache"`, HOME needs this
read permission and CACHE separately needs destination-name coverage.

## 3. Small expression model

The initial supported word consists of one leading, simple parameter reference
and a literal suffix. Parse the complete identifier and preserve quote/escape
information before producing a typed value:

```text
"$HOME/cache" and "${HOME}/cache" -> Parameter(HOME, "/cache")
'$HOME/cache'                    -> Literal("$HOME/cache")
```

The gate recognizes a parameter node; it never uses textual `startsWith("$HOME")`.
Unsupported operators, indirect/array references, special parameters, arithmetic,
tilde, substitutions, malformed quoting, and additional references do not
qualify through this first implementation. A supported reference never hides
another expansion or its executable children.

The checker does not evaluate shell code, read runtime variable values, or infer
them from its own environment. Empty, unset, changed, and non-exported shell-local
values are within the permission the author grants. Under `nounset`, execution
may fail; this is not a value the checker attempts to simulate.

## 4. Syntax and coverage by context

### Arguments

Initially accept wholly double-quoted parameter words. Quoting proves one field,
but does not prove that an unknown value cannot become an option. A positional
argument beginning with a parameter therefore needs a literal `--` boundary
under the selected profile grammar.

For example, `ls -- "$HOME/.config/app"` can qualify; a variable-name grant alone
does not justify treating `ls "$HOME/.config/app"` as known non-option argv.
Executable names and option spellings remain literal. Dynamic option values
and wrapper/interpreter operands are outside this first slice.

### Redirect targets

Initially accept double-quoted parameter targets on supported write/append
redirects. Every occurrence stays in the evidence graph. The effective redirect
policy still covers operator, source FD, occurrence, and target kind.

An allowed target variable does not by itself permit the command, every redirect
operator, or another target. The parser never discards a redirect because its
target appears on an allowlist.

### Assignment values

Use the same value gate for directly parsed prefix assignments and the supported
declaration form. Preserve destination name, occurrence, and assignment kind.
Unquoted parameter values are eligible only where the supported grammar proves
assignment semantics without ordinary argument splitting/globbing; other
unquoted forms remain unsupported.

Permission to read HOME never implies permission to assign HOME, PATH, or any
other destination. A preceding assignment also does not prove what value another
argument expands to: expansion and assignment ordering remains shell behavior.

### Value constraints

The allowlist permits handling an unknown parameter value; it does not make
every rule containing that value match. Argument shape, all other value
constraints, assignment names, redirects, facts, nested parts, and limits still
need coverage.

For an allow rule, an explicit value-independent policy, such as `any`, can cover
a parameter value only after that rule's matching context gate succeeds. Where
a coverage union lacks this form, extend that union rather than add a template
language.

Literal equality, regexes over runtime values, and resolved-path constraints such
as `within` cannot be proved from a variable name. Such a required constraint
keeps the allow from qualifying. Do not compare the displayed expression as if
it were its expanded value, or remove unresolved path coordinates to avoid
coverage. A tracked parameter path needs explicit value-independent coverage
and its argument/redirect/assignment context permission.

## 5. One evidence model

All rules inspect the same parsed values: literal, supported parameter, or opaque;
invalid structure and limits retain their explicit errors. Structural
classification does not depend on whether a particular allow rule succeeds.

A supported parameter is not a literal and is not globally made safe by any
allowlist. Each allow rule proves its own context permission and full coverage.
Ask/deny rules inspect the same parameter classification, including the
uncertainty of its runtime value. Evaluation uses the three-valued result below
before reducing votes with `deny > ask > allow`.

Remove the earlier proposal's dual view in which old predicates saw opaque
content while allow rules saw a separate symbolic representation. Migrate rules
whose old classification assumptions conflict with the unified model.

### Unknown predicates and restrictive rules

Every predicate evaluates to `match`, `no-match`, or `unknown`. A runtime path
comparison, equality test, or regex over an unresolved parameter value returns
`unknown`, not `no-match`. Known structural facts remain decidable: a wrong
executable/profile, an absent required option, or a classification mismatch can
still prove non-applicability. Value-independent tests do not become unknown
merely because a parameter is present.

Combine results for the **whole rule**:

- Conjunction: any `no-match` decides `no-match`; otherwise any `unknown` gives
  `unknown`; otherwise `match`.
- Disjunction: any `match` decides `match`; otherwise any `unknown` gives
  `unknown`; otherwise `no-match`.
- Negation, where the grammar defines it: exchange `match` and `no-match`;
  `unknown` stays `unknown`.
- Quantified `any` and `all` use disjunction and conjunction over the observed
  items. A known-empty `any` is `no-match`, and a known-empty `all` is `match`;
  explicit existence/cardinality constraints are still evaluated separately.
  Unresolved values remain observed items, not an empty collection.

Only rules in the selected profile participate. No new symbolic solver is
required: retain unknown runtime comparisons and combine them with known facts.
Evaluate enough conditions to find a decisive result; an unknown condition alone
does not short-circuit a conjunction before a known false condition is examined.

| Complete rule result | Allow rule | Ask rule | Deny rule |
|---|---|---|---|
| `match` | Emits allow only with full coverage and required context gates. | Emits ask. | Emits deny. |
| `no-match` | No vote. | No vote. | No vote. |
| `unknown` | No allow vote; this failed proof does not veto another allow rule. | Establishes an ask floor. | Establishes an ask floor. |

An unknown ask/deny predicate therefore prevents automatic allow even when a
different rule qualifies. Apply the floor to that part before command/chain
aggregation. A conclusive deny still wins. A rule conclusively ruled out by
another condition establishes no floor; the presence of an unrelated restriction
does not block every parameterized command.

This is policy uncertainty, not a checker failure and not a proven deny match.
Record a `predicate-unknown` reason with the responsible restrictive rule IDs
and predicate coordinates in full diagnostics. An uncertainty-only ask does not
report the deny rule as a matched vote or as the winning ask `ruleId`; if a real
ask vote also decides, ordinary winning-rule attribution applies. Preserve the
uncertainty reason in truncated diagnostics, applying the floor before diagnostic
limits. Update the closed diagnostic schema and fixtures in the contract change.

### Required restricted-path example

For `ls -- "$HOME"`, suppose one allow rule permits HOME and provides
value-independent argument/path coverage, while an applicable deny rule tests
whether that argument is within `/secret`. The deny's path predicate is
`unknown`, so the result is **ask**, even though the allow rule qualifies. The
checker does not read HOME to distinguish `/secret` from another runtime value.

With literal `ls -- "/secret"` and otherwise equivalent coverage, the predicate
matches and the result is deny. With literal `ls -- "/public"` it does not match,
so an otherwise qualifying allow can win.

## 6. Coordinated contract replacement

Update checker, hook, config/verdict schemas, fixtures, examples, and documentation
together. Advance contract versions where their shapes or meanings change and
support only the resulting active contract. Keep the request letter if it needs
no new data.

There is no parallel v2/v3 runtime, protocol selector, compatibility validator,
or downgrade path. Incompatible configurations fail to load; incompatible
responses fail validation and follow the existing checker-error behavior.
Version identifiers detect mismatched installations rather than select old logic.

Record accepted architectural decisions and any supersession of existing ADRs
in the same design work before implementation. Historical records stay historical;
they do not require retaining contradictory runtime behavior.

## 7. Delivery and regression cases

Deliver one bounded feature slice: preserve parameter evidence, add the three
context gates, connect value-independent coverage and three-valued restrictive
predicates, and update the single evaluator/validator path. Replace boolean
shortcuts that turn unresolved values into false throughout predicate and
quantifier evaluation. Migrate owned configs and remove contradictory old paths
in that coordinated change. General templates, multiple references per word,
runtime-value verification, and arbitrary wrappers are separate work.

Required regressions:

- `$NAME` and `${NAME}` agree; longer identifiers do not match a shorter name.
- No suffix, ordinary suffix, spaces, quoted glob characters, and `..` have the
  documented literal behavior.
- Missing permission, wrong context, and another rule's grant do not qualify.
- Another expansion, substitution, or unsupported syntax is not hidden.
- Value-independent coverage can qualify; required literal or resolved-path
  proof remains unavailable.
- Unset/empty values and option-looking values do not change the analyzed
  argument role; the literal operand boundary is enforced.
- Every redirect occurrence and assignment destination remains covered.
- Ask/deny votes, uncovered sibling parts, and resource limits remain effective.
- A qualifying HOME allow plus an applicable deny for `/secret` yields ask for
  `ls -- "$HOME"`; the literal restricted/public variants yield deny/allow.
- An applicable ask rule with an unknown value predicate also blocks automatic
  allow. A failed unknown allow proof does not veto a different qualifying allow.
- A restrictive conjunction with a known false condition has no effect even if
  another condition is unknown; a true alternative in a disjunction is decisive.
- Unknown under negation or quantification is not converted to false or hidden
  by dropping the parameter value. Known-empty domains retain the stated identities.
- A conclusive deny overrides uncertainty elsewhere; a part's uncertainty ask
  survives aggregation with allowed siblings and diagnostic truncation.
- Full/truncated diagnostics explain the uncertainty without claiming that the
  unresolved deny matched or assigning its ID as a winning ask rule.
- Incompatible versions reject; no fallback or second evaluator runs.

Validate scanner/matcher cases, checker/hook contract fixtures, schema/grammar
consistency, and one real permission round trip. This document records the target
design; it changes no runtime or normative schema by itself.
