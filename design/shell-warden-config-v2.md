# Design: Shell Warden configuration v2

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/docs/issues/21
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0017-schema-first-shell-warden-config-contract.md
Provenance: reviewed edits from
https://github.com/agent-guardrails/docs/issues/15 are retained and refined
here. This design supersedes the direction proposed in
https://github.com/agent-guardrails/docs/issues/13.

## Purpose

Shell Warden v1 groups several binaries into a stage and shares one option
grammar across them. That shape made a flag-only allow dangerous in production:
an allow for `--version` in a multi-binary development stage could also allow a
mutating command carrying that flag. The compensating deny list became
whack-a-mole. V1 field names such as `argv`, `flag`, and `argValue` also obscure
their matching semantics.

V2 replaces stages with command profiles. An allow is a typed-evidence coverage
proof, not a rule that later rules may refine. Explicit deny and ask always
dominate allow. No vote asks a human.

This is a design draft, not a normative specification. After acceptance, the
documents named in [Acceptance and rollout](#acceptance-and-rollout) will carry
the normative contract.

## Goals and boundaries

V2 retains the existing security posture:

- The user-global config is trusted executable policy. Repository content cannot
  supply or alter it.
- The checker is one-shot and pure. Raw command text is authoritative and the
  checker parses it defensively.
- Allow needs complete static evidence. Opaque or invalid evidence cannot allow.
- The fixed default is ask. Every executable part participates in the same
  `deny > ask > allow` reduction.
- The request letter, aggregate verdict values, and hook mapping remain the same
  at their policy boundary: allow maps to `once`, deny maps to `reject`, and ask
  maps to silence.

V2 does not add a general programming language, config-loaded code, plugins,
arbitrary analyzers, shell execution, filesystem/network/subprocess I/O, PATH
lookup, compatibility shims, Scode or OpenCode sandbox configuration, or a
generic sandbox launcher. Sandbox work is separately tracked future work and
has no design link yet.

V2 is a replacement grammar. It reads only `version: 2`: there is no backward
compatibility, legacy parser, deprecation mode, automatic migration, or fallback
to an earlier configuration shape.

## Selected architecture

A profile owns the complete lexical grammar and policy for one executable.
It names executable aliases, option aliases and arities, profile-scoped path
sources, an optional redirect-policy override, one optional built-in analyzer,
rules, and optional fallback hints.
`option` is the umbrella term:
an option with arity zero is a flag; an option with positive arity consumes that
fixed number of values. Arity is an integer from zero through four. Variadic
options are outside the v2 grammar: a CLI represents a homogeneous list as
repeated fixed-arity options, for example `--file a --file b`, rather than one
`--files` occurrence that consumes an open-ended token sequence. This keeps the
option boundary unambiguous. Profiles never share option grammars.

A singleton `executables` list is always valid. Several spellings may occur only
when the complete set equals one entry in an implementation-owned, versioned
lexical alias catalog. Such an entry asserts identical option grammar and
analyzer behavior; it does not assert resolved binary identity. Unrelated
executables require separate profiles even when their current rules look
similar. Validation is therefore machine-checkable without filesystem or PATH
lookup, executable selection remains unique, and profile order is irrelevant.

```text
raw shell text
     |
     v
shell parser and recursive executable-part extractor
      |
      v
recursive profile option parsing, analyzer facts, and analyzer-command parts
      |
      v
complete recursive part and evidence graph
      |
      v
policy resolution -> local predicate satisfaction -> allow coverage validation
      -> emitted votes
     |
     v
deny > ask > allow across every part
```

Executable matching is lexical. It proves neither the resolved binary identity
nor what a PATH lookup would execute. Path containment is also lexical and is
not symlink-safe filesystem containment. Allow policies needing either guarantee
are outside this checker model and cannot be expressed.

## Public contract and implementation representation

The future JSON Schema and matching specification define the public v2 JSON
contract. This design defines that contract before implementation. Rust or other
implementation DTOs adapt validated public objects into internal types. They do
not establish an alternate public representation.

Every selector and coverage union below is a one-level object. Its discriminator
is the only key at that union level and maps directly to its payload. A
serializer's externally tagged enum layout is never part of the public contract.
For example, `{ "none": true }` is valid where a `none` coverage form is
allowed. `{ "none": { "none": true } }` is explicitly rejected. Likewise,
`{ "each": { "any": true } }` is valid where `each` accepts a token selector,
while `{ "each": { "each": { "any": true } } }` is explicitly rejected.

The schema rejects unknown keys and rejects a union object carrying more than one
discriminator. Semantic validation rejects a discriminator with a value of the
wrong type, empty selector alternatives, duplicate members where uniqueness is
required, and every cross-field violation defined below. No public input is
accepted merely because an implementation DTO can deserialize it.

### Engine grammar snapshot (structural drift guard)

Every config-v2 declaration a checker implements sits in one contiguous region
of its grammar source, wrapped by the marker comments
`// shell-warden-config-v2-grammar: begin` and
`// shell-warden-config-v2-grammar: end`. The contract repository normalizes
that region (comments stripped, serde attributes retained, one token stream per
`pub struct`/`pub enum`) and compares it, declaration by declaration, with
`schemas/shell-warden.config.v2.grammar.snapshot`. The guard fails closed on a
missing marker, a second marker pair, an unbalanced comment or string,
malformed or duplicate declarations, missing or extra declarations, and any
changed declaration. The same comparison runs remotely against
`agent-guardrails/shell-warden@main`.

The snapshot is a point-in-time manifest of the checker grammar, tier-checked
against the paired implementation state. The approved implementation
sequencing is:

1. https://github.com/agent-guardrails/shell-warden/issues/34 aligns the
   `RemainderPolicy`/`TokenSelector` wire forms to the one-level contract and
   introduces the marker region
   (https://github.com/agent-guardrails/shell-warden/pull/37, engine commit
   `841478922499ad32f2d91f8101ca25f60eed5765`); after that merge the remote
   check turns green against the interim grammar.
2. https://github.com/agent-guardrails/shell-warden/issues/32 (fixed option
   arity and option-value selectors) and
   https://github.com/agent-guardrails/shell-warden/issues/35 (typed facts and
   `sed-v1`) implement the remaining v2 arms this schema defines — including
   the rich token selector (`any`/`oneOf`/`regex`/`path`), `EnvironmentTest`
   occurrence, and typed `FactTest` fields. Each lands by regenerating the
   snapshot from the engine marker region and re-running the guard against
   both the local target and remote main.

Until those tickets merge, the snapshot legitimately encodes the interim
grammar; the schema and fixtures remain the sole normative v2 contract, and
they, not the snapshot, decide acceptance of public input. The snapshot guards
drift; it never rewrites protocol semantics.

## Parsing, parts, and evidence states

The checker parses raw shell syntax before profile selection and does not trust a
harness split. It recursively extracts executable parts from the following
closed relation enum:

`chain`, `pipeline`, `wrapper`, `command-substitution`, `analyzer-command`.

The ordinary shell parser emits only the first four relations. An analyzer may
emit only `analyzer-command`; this prevents analyzers from duplicating ordinary
shell nesting. Every part retains raw source text, span, quote/syntax classes,
parent ID, relation, and relation occurrence ordinal.

Evidence is always exactly one of these states:

| State | Meaning | Allow effect |
|---|---|---|
| `complete` | Supported shell syntax, profile option parsing, analyzer processing, and resource limits yielded all typed evidence. | May proceed to matching and allow coverage validation. |
| `opaque` | Supported syntax contains runtime-dependent content whose words or values are not safely known. | Cannot allow; ask and deny may match typed classification or raw text. |
| `invalid` | Syntax or evidence construction is malformed, unsupported for this parser, or exceeds a resource/evidence limit. | Cannot allow; the part reduces no more permissively than ask. |

Single-quoted text is literal. Escaped metacharacters are literal. Double-quoted
text remains literal when it has no active expansion. Active `$VAR`, `${...}`,
`$(...)`, backticks, arithmetic expansion, and process substitution remain
opaque even inside double quotes. A literal regex `$`, such as in `'^[a-z]+$'`
or `\$`, is not dynamic. Unquoted glob syntax and unquoted brace expansion are
opaque because the shell may expand them; quoted or escaped glob and brace
characters are literal. A tilde in any shell position that performs tilde
expansion is opaque; quoted or escaped tilde characters are literal.

Unknown options, missing option values, invalid inline option forms, malformed
analyzer input, and resource/evidence overflow are `invalid`. Active expansion
is `opaque`. Unsupported shell syntax is `invalid` when parsing cannot establish
a supported structure and `opaque` when its structure is preserved but runtime
words remain unknown. Any limit overflow before complete evidence or complete
coverage prevents allow. Diagnostics may truncate only after the decision has
been computed.

## Limits

Limits are fail-closed. A config may lower a configurable limit but cannot raise
the implementation maximum. Zero, negative values, fractional values, unknown
limit keys, and values above the maximum invalidate the config. Exceeding any
limit while loading config makes the config invalid. Exceeding an evaluation
limit makes affected evidence `invalid`, so it cannot allow.

| Limit | Config key | Maximum | Effect when exceeded |
|---|---|---:|---|
| Config bytes | `configBytes` | 262144 | Config invalid. |
| Profiles | `profiles` | 256 | Config invalid. |
| Rules across profiles | `rules` | 4096 | Config invalid. |
| Evidence items per command part | `evidenceItems` | 1024 | Part invalid. |
| Diagnostic bytes per request | `diagnosticsBytes` | 16384 | Decision completes, then diagnostics truncate at a stable boundary. |
| Option arity | not configurable | 4 | Config invalid. |
| Shell and nested-part depth | not configurable | 32 | Part invalid. |
| Selector alternatives in one array | not configurable | 64 | Config invalid. |
| Regex UTF-8 bytes | not configurable | 1024 | Config invalid. |
| Lexical path UTF-8 bytes | not configurable | 4096 | Config invalid. |

The `limits` object may contain only the first five keys. Omitted configurable
keys use their maximum values. Limits cap work and diagnostics, not policy
meaning: diagnostics never decide the verdict and cannot be used to recover an
allow after evidence becomes invalid.

## Closed evidence catalogs and coordinates

The checker produces only these closed evidence dimensions:

| Dimension | Per-occurrence contents |
|---|---|
| positional arguments | Decoded literal token, argument index, span, and quote class. |
| options | Canonical option ID, used alias, option occurrence ordinal, each value ordinal and span, inline-versus-separate form, and source order. |
| environment assignments | Assignment occurrence ordinal, name, literal value, span, and prefix position. |
| redirects | Redirect occurrence ordinal, source FD or default source FD, operator, typed target kind and value, target span, and source order. |
| lexical paths | Literal raw text, lexical normalized path, cwd-relative lexical path, source coordinate, and source span. |
| analyzer facts | Analyzer ID/version, closed fact name, fact occurrence ordinal, typed value, span, and catalog safety metadata. |
| nested parts | Part ID, relation enum value, relation occurrence ordinal, selected profile, evidence state, and reduced nested verdict. |

Positional arguments exclude option tokens and every value consumed by an option.
The `--` boundary is retained in evidence and ends option recognition. Source
order is retained even when a matcher groups occurrences by canonical ID. No
first-occurrence or last-occurrence collapse occurs. Repeated options and every
one of their values remain separate evidence items.

The `--` boundary is parsing metadata, not a security-relevant
evidence dimension. Its effect is fully represented by classification of every
following token as a positional argument, which must still satisfy argument
matching and universal coverage. Diagnostics retain the boundary span and
source position, but its presence alone creates no separate coverage obligation.

Path coordinates are closed:

- `argument(index)`
- `optionValue(canonicalOptionId, optionOccurrence, valueOrdinal)`
- `environment(assignmentOccurrence)`
- `redirect(redirectOccurrence, operator, sourceFd)`
- `analyzerFact(analyzerId, version, factName, factOccurrence)`

For supported literal-path redirects, the parser always emits the corresponding
`redirect(...)` path coordinate before profile selection. Redirect policies cover
that evidence without depending on `pathSources`. All other path evidence appears
only from profile `pathSources` declarations or the selected analyzer's fact
catalog. Rules cannot cause new evidence to be produced. A profile with no path
source declaration does not gain non-redirect path evidence merely because an
argument resembles a path. This keeps allow coverage obligations independent of
which rules happen to match.

Evidence production performs no I/O and no PATH lookup.

## Profiles, option grammars, and analyzers

A profile has `id`, `executables`, `options`, optional `pathSources`, optional
`redirectPolicy`, optional `analyzer`, `rules`, and optional `fallbackHints`. A
path source declaration is
one closed source selector: positional argument index or remainder, option ID
plus value ordinal, environment assignment selector, redirect target selector,
or analyzer fact selector. It produces actual per-occurrence path coordinates
before voting. An option maps one canonical ID to aliases and fixed arity zero
through four. `--long=value` is valid only for a declared arity-one option that
accepts that inline form; options with arity two through four consume separate
following tokens. The option parser records the `--` boundary and
every option occurrence, value ordinal, and consumed or inline value. Repeated
aliases normalize to distinct occurrences of the same canonical option. The
parser never infers a variable option boundary from later tokens.

The built-in analyzer IDs are `generic-v1`, `sed-v1`, `export-v1`, and
`xargs-v1`. They are versioned evidence producers, not extension points. They
cannot load config code, issue a verdict, alter evaluation order, or grant a
command.

The implementation owns versioned compatibility and fact-catalog tables. Each
table names supported profile shapes, analyzer-compatible option grammars, fact
names, value types, and whether a fact is safety-relevant. Validation consults
these tables. An unknown analyzer, incompatible analyzer/profile combination, or
unknown fact reference invalidates config. Safety relevance is catalog metadata,
not configurable; each emitted safety-relevant fact needs allow coverage.

`generic-v1` supplies only the generic evidence described above. `sed-v1` can
emit closed execution-primitive and program-form facts. `export-v1` can emit
closed assignment facts. `xargs-v1` can emit a determinate nested command as an
`analyzer-command` part.

## Action-sensitive matching and emitted votes

Each rule has an ID, action, optional ask/deny message, and one closed `match`
object. Selectors are written once. Their meaning depends on the action.

For ask and deny, `match` asks whether its supplied predicates hold. Those
predicates may be existential or conjunctive, and need not account for unrelated
evidence. A deny for force push can therefore match a `force` option without
describing every argument, redirect, or analyzer fact in the command.

For allow, `match` is both the shape constraint and the total coverage proof.
It contains `classification: "complete"`, has no `raw` predicate, and states an
explicit policy for `arguments`, `options`, `environment`, non-redirect `paths`,
`facts`, and `nestedParts`. Redirect structure and redirect-target paths come
only from the mandatory effective redirect policy. An allow emits only when its
match selectors hold and every observed security-relevant item is universally
covered by the applicable selector or policy. Omitted non-redirect dimensions are
invalid config, not an implicit `none` policy. Use `{ "none": true }` where no
item is permitted, and a dimension's `{ "all": [...] }` form where items are
permitted.

The internal phases remain separate even though configuration has one selector
object: predicate satisfaction, allow coverage validation, then vote emission.
Ask and deny emit when ordinary predicate satisfaction succeeds. A rejected
allow emits no vote and records its coverage failure.

The action-neutral predicate forms are:

| Predicate | Ordinary ask/deny meaning |
|---|---|
| `arguments.exact`, `arguments.prefix`, `arguments.containsAny` | Exact, prefix, or existential positional-token test. |
| `options.presentAll`, `presentAny`, `absentAll`, `values` | Tests over canonical option IDs and selected occurrences or values. |
| `environment`, `redirects`, `paths`, `facts`, `nestedParts` | Typed tests over the corresponding evidence. |
| `classification` | One of `complete`, `opaque`, or `invalid`. |
| `raw` | Raw-text pattern, available only to ask and deny. |

For allow, the same `match` fields use the following closed coverage forms. A
partial match, a first-or-last-only match, or an unselected repeated occurrence
does not qualify an allow.

| Dimension | Required allow `match` form | Coverage rule |
|---|---|---|
| `arguments` | `exact: token[]`, or `prefix: token[]` plus `remainder: { "none": true } | { "each": tokenValueSelector }` | `exact` covers the whole positional list. `prefix` covers its prefix and applies the explicit remainder policy to every remaining positional argument. |
| `options` | `{ "none": true }` or `{ "allowed": [optionPolicy, ...] }` | Every option occurrence and every consumed or inline value satisfies one entry. Repeated options are never collapsed. Each entry references one canonical profile option and states `required` and `repeatable`; universal coverage and presence or repetition are separate. |
| `environment` | `{ "none": true }` or `{ "all": [environmentPolicy, ...] }` | Every assignment occurrence satisfies name, literal-value, prefix-position, and occurrence selectors. |
| redirects and redirect-target paths | Mandatory resolved effective `redirectPolicy` | Every redirect occurrence satisfies source FD, including the explicit `default` selector, operator, occurrence, and target kind; every emitted redirect path coordinate satisfies its lexical policy. Literal-path and FD-duplication targets are separate closed target kinds. |
| `paths` | `{ "none": true }` or `{ "all": [pathPolicy, ...] }` | Every emitted non-redirect exact coordinate satisfies an `exact`, `within`, or `outside` lexical policy. Redirect coordinates never appear in this allow matcher. |
| `facts` | `{ "none": true }` or `{ "all": [factPolicy, ...] }` | Every emitted fact satisfies analyzer ID/version, fact name, occurrence, and typed value selectors. Safety-relevant facts cannot be ignored. |
| `nestedParts` | `{ "none": true }` or `{ "all": [nestedPartPolicy, ...] }` | Every nested executable part satisfies relation, occurrence, profile, evidence state, and required reduced verdict selectors. |

An occurrence selector is either the string `"all"` or a positive integer. It
selects every occurrence or one one-based occurrence ordinal. A coverage `all`
array is non-empty. Every entry is an alternative for covering an observed item;
every observed item must satisfy at least one entry. `none` is exactly
`{ "none": true }`, not a nested wrapper.

The public entry shapes are explicit:

- `environmentPolicy` is `{ "name": string, "value"?: stringValueSelector,
  "prefix": true | false, "occurrence": occurrenceSelector }`. `prefix`
  selects assignments before the executable word. `value` selects the complete
  literal assignment value.
- `pathPolicy` is `{ "coordinate": pathCoordinateSelector, ...pathSelector }`.
  `coordinate` is exactly one of `argument`, `optionValue`, `environment`, or
  `analyzerFact`; redirect coordinates belong only to redirect policies. The
  coordinate value carries every required closed catalog field and an optional
  occurrence selector where that coordinate repeats.
- `factPolicy` is `{ "analyzer": analyzerId, "version": string,
  "name": factName, "occurrence": occurrenceSelector,
  "value": typedValueSelector }`. Its value selector must match the catalogued
  fact type.
- `nestedPartPolicy` is `{ "relation": relation, "occurrence":
  occurrenceSelector, "profile": profileId | "none", "classification":
  evidenceClass, "verdict": "allow" | "ask" | "deny" }`.

The positive fragments below exercise the `none` and `all` coverage forms and
every entry type. They use closed catalog names from the surrounding design.

```jsonc
{
  "environment": {
    "all": [{ "name": "LANG", "value": { "oneOf": ["C"] }, "prefix": true, "occurrence": "all" }]
  },
  "paths": {
    "all": [{ "coordinate": { "argument": { "index": 1 } }, "within": "/work/project" }]
  },
  "facts": {
    "all": [{ "analyzer": "sed-v1", "version": "1", "name": "executionPrimitive", "occurrence": "all", "value": { "exact": "readOnly" } }]
  },
  "nestedParts": {
    "all": [{ "relation": "analyzer-command", "occurrence": 1, "profile": "rm-safe", "classification": "complete", "verdict": "ask" }]
  },
  "noEnvironment": { "none": true },
  "noPaths": { "none": true },
  "noFacts": { "none": true },
  "noNestedParts": { "none": true }
}
```

`prefix` without `remainder` is invalid. `remainder.each` applies only to
positional arguments, never to option tokens or option values. An exact allow is
the usual form for a command with a fixed positional shape. Every observed option
must match one `allowed` entry by canonical `option` reference, and canonical
option IDs are unique within one `allowed` list. `required: true`
means at least one occurrence exists; `required: false` makes it optional.
`repeatable: false` permits at most one occurrence, while `repeatable: true`
permits multiple occurrences within resource limits. Together, `required: true`
and `repeatable: false` mean exactly one. A positive-arity entry also covers each
consumed value with an explicit `values` policy. `each` applies one token-value
selector to every value of every occurrence. `byPosition` applies one selector
to each value ordinal and has exactly as many entries as the option's fixed
arity. A zero-arity entry has no `values`; a positive-arity entry without
`values` is invalid. Unknown or unlisted options prevent allow, and aliases that
normalize to the same canonical option are repeated occurrences.

Duplicate option declarations, duplicate aliases in one declaration, and a
duplicate canonical option entry in one allow `allowed` list are invalid config.
At evaluation time, a second observed occurrence for `repeatable: false` rejects
that allow with `option-not-repeatable`; it does not collapse occurrences or
reinterpret the command. A repeated option with `repeatable: true` still needs
every occurrence and value to satisfy its one coverage entry.

`optionValueCoverage` is exactly one of `{ "each": tokenValueSelector }` or
`{ "byPosition": [tokenValueSelector, ...] }`. The `each` form covers every
value ordinal of every occurrence. The `byPosition` array has exactly the
declared fixed arity and its zero-based array position selects the corresponding
one-based value ordinal. It is invalid for arity zero, invalid when absent for a
positive-arity option, and never expresses a variable number of values.

`optionValueCoverage` applies after parsing has consumed the fixed number of
values. It does not alter parsing, consume positional arguments, or turn a
repeated option into a variadic option. An inline value is value ordinal one and
is permitted only when the option has arity one and declares `inline: true`.

The public option declaration is exactly:

```jsonc
{
  "aliases": ["--name"],
  "arity": 1,
  "inline": true
}
```

`aliases` is non-empty and unique. `arity` is an integer from zero through four.
`inline` is absent or `false` for arity zero and arities two through four, and is
optional for arity one. `--name=value` is rejected unless `inline` is `true`.
An option with arity two through four always consumes separate following tokens.
No `variadic`, `minArity`, `maxArity`, remainder, or open-ended option form
exists in v2.

String-value selectors are a closed union:

- `{ "any": true }` covers any complete literal token, including an empty inline
  value;
- `{ "oneOf": [literal, ...] }` covers one listed string by exact equality;
- `{ "regex": pattern }` covers one string by whole-value regular-expression
  matching.

Each form is a single-key object. `any` has the literal boolean value `true`.
`oneOf` is a non-empty, duplicate-free array of strings. `regex` is one string.
There is no glob selector, implicit coercion, or second key in a
string-value selector.

A token-value selector is either one string-value selector or

- `{ "path": pathSelector }` interprets the literal token as a lexical path and
  applies an `exact`, `within`, or `outside` path selector.

A path selector is exactly one of `{ "exact": absoluteLexicalPath }`,
`{ "within": absoluteLexicalPath }`, or `{ "outside": absoluteLexicalPath }`.
Each path is a normalized absolute lexical path. `exact` compares one complete
path. `within` accepts that root and descendants on a component boundary.
`outside` rejects that root and its descendants on a component boundary. A path
selector cannot be an array, carry two path operations, or perform I/O.

Regex selectors use the fixed `re2-v1` dialect: RE2-compatible UTF-8 syntax and
semantics, case-sensitive matching, no backreferences or look-around, and no
configurable flags. They are compiled when configuration loads and match the
entire decoded token. Unsupported syntax or a pattern outside configured limits
invalidates the config. A later dialect requires a new closed dialect ID rather
than changing `re2-v1`. A path selector accepts only complete literal evidence
and uses the same normalization and lexical-containment rules as other path
coverage; it performs no filesystem or symlink lookup. These explicit forms
avoid overloading strings: `"*"` in `oneOf` is a literal asterisk, while wildcard
behavior exists only inside a `regex` selector.

Analyzer facts do not reuse token selectors implicitly. A closed typed-value
selector first agrees with the fact type from the analyzer catalog, then applies
one of `any`, scalar `exact`, `string`, `integer`, `number`, `boolean`, or `path`.
`string` contains a string-value selector and cannot request path semantics;
integer and number selectors contain
closed inclusive `min` and/or `max` bounds; boolean selects one exact boolean;
and path contains a lexical path selector. No selector coerces a typed fact to a
string. The one-level forms are `{ "any": true }`, `{ "exact": scalar }`,
`{ "string": stringValueSelector }`, `{ "integer": { "min"?, "max"? } }`,
`{ "number": { "min"?, "max"? } }`, `{ "boolean": true | false }`, and
`{ "path": pathSelector }`. Numeric bounds are finite JSON numbers, at least
one bound is required, and `min` cannot exceed `max`.

For example, a profile can declare `file` with arity one and allow homogeneous
values through repeated occurrences without introducing variadic parsing:

```jsonc
{
  "option": "file",
  "required": false,
  "repeatable": true,
  "values": { "each": { "path": { "within": "/work/project" } } }
}
```

An option such as `rename` with fixed arity two can instead constrain each value
ordinal independently:

```jsonc
{
  "option": "rename",
  "required": false,
  "repeatable": true,
  "values": {
    "byPosition": [
      { "regex": "[a-z][a-z0-9_-]*" },
      { "path": { "within": "/work/project" } }
    ]
  }
}
```

Every occurrence of `rename` applies the same two ordinal selectors.

The following valid selector fragments give a positive example for every
selector and coverage shape. They are fragments inserted at the documented
selector position, not independently complete configurations.

```jsonc
{
  "stringValueSelectors": [
    { "any": true },
    { "oneOf": ["check", "test"] },
    { "regex": "[a-z][a-z0-9_-]*" }
  ],
  "tokenValueSelector": { "path": { "exact": "/work/project/README.md" } },
  "pathSelectors": [
    { "within": "/work/project" },
    { "outside": "/work/project/private" }
  ],
  "typedValueSelectors": [
    { "any": true },
    { "exact": "inPlace" },
    { "string": { "oneOf": ["safe", "readOnly"] } },
    { "integer": { "min": 1, "max": 9 } },
    { "number": { "min": 0.0 } },
    { "boolean": true },
    { "path": { "within": "/work/project" } }
  ],
  "optionValueCoverage": [
    { "each": { "oneOf": ["json", "yaml"] } },
    { "byPosition": [{ "regex": "[a-z]+" }, { "path": { "within": "/work/project" } }] }
  ],
  "argumentRemainderCoverage": { "each": { "path": { "within": "/work/project" } } }
}
```

These JSON objects are rejected even though they resemble implementation enum
wrappers. They appear only as rejected input examples:

```jsonc
{
  "rejectedNestedNone": { "none": { "none": true } },
  "rejectedNestedEach": { "each": { "each": { "any": true } } }
}
```

The implementation owns a versioned, closed redirect catalog. V2 supports input
`<`, truncate output `>`, append output `>>`, and FD duplication `>&` and `<&`.
Target kinds are closed and include `literalPath` for path-bearing redirects and
`fd` for duplication. Unsupported operators or target forms produce invalid or
opaque evidence and fail closed for allow. Heredocs and here-strings are invalid
until a later design adds typed support; this draft does not treat them as
redirects that can be allowed.

## Reusable redirect policies

`redirectPolicies` is a top-level map of named, flat redirect policy bundles.
Each bundle is closed and contains redirect structure entries and the matching
redirect-target lexical path entries as one reusable unit. A bundle therefore
describes a safe redirect destination and operator once, rather than requiring
each profile to coordinate `redirects` and `paths` selectors for that target.
Named policies do not reference or inherit other named policies, so they cannot
form cycles.

`defaults.redirectPolicy` names the policy initially effective for every profile
and allow rule. A profile or allow rule may set `redirectPolicy` to an override:

| Mode | Result |
|---|---|
| `inherit` | Keeps the current effective policy unchanged. |
| `extend` | Takes the set union of the current canonical entries and named and/or inline additions. |
| `replace` | Discards inherited permissive entries and uses only named and/or inline entries. |

`inherit` carries no named or inline additions. `extend` and `replace` each carry
at least one named policy or inline bundle. An inline bundle always contains both
the redirect and redirect-target path coverage forms.

Resolution is structural, not list-ordered: config default, then profile
override, then allow-rule override. The implementation expands named bundles,
canonicalizes entries, and deduplicates the resulting sets before validation or
evaluation. Reordering policy entries, named references, inline additions,
rules, or profiles does not change meaning. Omitting an override has the same
effect as `inherit`.

Redirect policy entries provide redirect coverage only. They do not emit an allow
vote and cannot rescue a command that fails another allow dimension. Every allow
rule resolves an effective redirect policy from the mandatory config default and
optional scope overrides, and separately states `match.paths` for non-redirect
path evidence. Effective redirect policy entries compose with, and never replace,
`match.paths`: the policy exclusively covers redirect structure and redirect
target coordinates, while `match.paths` exclusively covers non-redirect
coordinates. An inline `RedirectPolicy` appears only inside a rule
`redirectPolicy` override, never in `match.redirects` or redirect-coordinate
`match.paths` for allow. The expanded effective policy is part of the allow
coverage proof; an uncovered redirect means the allow emits no vote and the
result is at least ask unless another vote wins. Unsupported or dynamic redirect
forms remain invalid or opaque and cannot allow. Ask and deny ordinary matchers
may inspect `match.redirects` and any exact path coordinate, including a redirect
coordinate.

Redirect-wide policy is an overridable default, not a deny vote. A true local
deny still follows `deny > ask > allow` and cannot be overridden. When a profile
or command needs different redirect coverage, it uses policy inheritance,
extension, or replacement rather than a global-deny/local-allow conflict.

## Lattice reduction and fallback hints

The emitted votes, not merely matching rules, reduce by this fixed lattice:

```text
allow < ask < deny
```

No emitted vote yields ask. The checker reduces each executable part and all
parts using the same lattice. Rules and profiles have no numeric priority,
first-match or last-match behavior, configuration-order meaning, or refinement
phase. Adding a matching allow cannot lower a result because it only adds an
allow vote; an existing ask or deny remains dominant.

Messages do not decide a verdict. At the winning action, the checker selects the
message from the lexicographically smallest rule ID. Fallback hints are
non-voting profile-local messages considered only when no rule emits a vote and
the default ask applies. Matching hints use lexicographic hint ID selection.

## Lexical path policy

Path comparison combines a relative literal with the letter's cwd, normalizes
`.` and `..` lexically, then compares components. It does not expand `$HOME`,
resolve symlinks, stat paths, inspect mounts, or check existence. Trusted roots
are explicit absolute lexical config values. `/work/repo2` is not within
`/work/repo`.

A redirect target and an argument with identical text are different coordinates.
Selecting one does not select the other. The lexical-only consequence is
intentional: resolved-binary identity and symlink-safe containment require
external lookup and remain outside the checker.

## Illustrative JSONC configuration

This compact configuration shows exact positional shape, complete allow
coverage, positive-arity option-value coverage, inherited and extended redirect
coverage, and a replacement with no redirects. `node-version` and `cargo-init`
each have one executable grammar. Other tools that need version checks or
project initialization use separate profiles unless their aliases are genuinely
grammar-equivalent.

```jsonc
{
  "version": 2,
  "defaults": {
    "action": "ask",
    "message": "No approved command profile matched.",
    "redirectPolicy": "safe-local-io"
  },
  "redirectPolicies": {
    "safe-local-io": {
      "redirects": { "all": [{ "sourceFd": "default", "operator": ">", "occurrence": "all", "target": { "kind": "literalPath" } }] },
      "paths": { "all": [{ "coordinate": { "redirect": { "operator": ">", "sourceFd": "default", "occurrence": "all" } }, "within": "/tmp/reports" }] }
    },
    "no-redirects": {
      "redirects": { "none": true },
      "paths": { "none": true }
    }
  },
  "profiles": [
    {
      "id": "git",
      "executables": ["git"],
      "options": {
        "force": { "aliases": ["--force", "-f"], "arity": 0 },
        "dryRun": { "aliases": ["--dry-run", "-n"], "arity": 0 },
        "oneline": { "aliases": ["--oneline"], "arity": 0 }
      },
      "analyzer": "generic-v1",
      "rules": [
        {
          "id": "git/deny-force-push",
          "action": "deny",
          "message": "Push without force, or create a branch and open a pull request.",
          "match": {
            "arguments": { "prefix": ["push"] },
            "options": { "presentAny": ["force"] }
          }
        },
        {
          "id": "git/allow-status",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["status"] },
            "options": { "none": true },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        },
        {
          "id": "git/allow-status-append-report",
          "action": "allow",
          "redirectPolicy": {
            "mode": "extend",
            "inline": {
              "redirects": { "all": [{ "sourceFd": "default", "operator": ">>", "occurrence": "all", "target": { "kind": "literalPath" } }] },
              "paths": { "all": [{ "coordinate": { "redirect": { "operator": ">>", "sourceFd": "default", "occurrence": "all" } }, "within": "/var/tmp/git-reports" }] }
            }
          },
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["status"] },
            "options": { "none": true },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        },
        {
          "id": "git/allow-log-oneline",
          "action": "allow",
          "redirectPolicy": { "mode": "replace", "policies": ["no-redirects"] },
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["log"] },
            "options": { "allowed": [{ "option": "oneline", "required": true, "repeatable": false }] },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        },
        {
          "id": "git/allow-push-dry-run",
          "action": "allow",
          "redirectPolicy": { "mode": "replace", "policies": ["no-redirects"] },
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["push", "origin", "main"] },
            "options": { "allowed": [{ "option": "dryRun", "required": true, "repeatable": false }] },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        }
      ]
    },
    {
      "id": "node-version",
      "executables": ["node"],
      "options": { "version": { "aliases": ["--version", "-V"], "arity": 0 } },
      "redirectPolicy": { "mode": "replace", "policies": ["no-redirects"] },
      "analyzer": "generic-v1",
      "rules": [
        {
          "id": "node-version/allow-bare-version",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": [] },
            "options": { "allowed": [{ "option": "version", "required": true, "repeatable": false }] },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        }
      ]
    },
    {
      "id": "cargo-init",
      "executables": ["cargo"],
      "options": {
        "name": { "aliases": ["--name"], "arity": 1, "inline": true }
      },
      "redirectPolicy": { "mode": "replace", "policies": ["no-redirects"] },
      "analyzer": "generic-v1",
      "rules": [
        {
          "id": "cargo-init/allow-named-package",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["init"] },
            "options": {
              "allowed": [{
                "option": "name",
                "required": true,
                "repeatable": false,
                "values": { "each": { "regex": "[a-z][a-z0-9_-]*" } }
              }]
            },
            "environment": { "none": true },
            "paths": { "none": true },
            "facts": { "none": true },
            "nestedParts": { "none": true }
          }
        }
      ]
    }
  ]
}
```

`git/allow-status` inherits `safe-local-io` without repeating its redirect and
path selectors. `git/allow-status-append-report` extends that effective policy
with `>>` under `/var/tmp/git-reports`. The log and dry-run rules replace it with
`no-redirects`. The `node-version` profile deliberately replaces the default with
`no-redirects` without changing the Git profile. `npm install --version` has no
selected profile in this compact example and asks; it cannot inherit Node's
option grammar. `cargo-init` keeps `--name` at its real arity and covers the
consumed value directly; no positional-remainder workaround is involved.

## Evaluation scenarios

| Input or assumption | Result | Reason |
|---|---|---|
| `git push --force --dry-run origin main` | deny | `force` is not allowed by the dry-run policy and the force-push deny emits. |
| `git log --oneline` plus an explicit matching ask | ask | Ask dominates allow. |
| `git log` | ask | The `oneline` entry is required, so its absence cannot qualify the allow. |
| `git push origin main` | ask | The `dryRun` entry is required, so its absence cannot qualify the allow. |
| `node` | ask | The `version` entry is required, so its absence cannot qualify the allow. |
| `git log --oneline --oneline` | ask | `oneline` is not repeatable, so the second occurrence prevents allow. |
| `cargo init --name my_project` | allow | The `name` occurrence is unique and its consumed value satisfies the whole-value regex selector. |
| `cargo init --name '*'` | ask | The literal asterisk does not satisfy the `name` regex selector, so option-value coverage fails. |
| `cargo init --name one --name two` | ask | Both values satisfy the selector, but `name` is not repeatable. |
| `git status --unknown-option` | ask | Unknown option makes evidence invalid; allow emits no vote. |
| `git log "$BRANCH"` | ask | Active double-quoted expansion is opaque. |
| `git status > /tmp/reports/status.txt` | allow | The status rule inherits `safe-local-io`; its effective policy covers the redirect and parser-produced target coordinate. |
| `git status > /tmp/other/status.txt` | ask | The redirect is outside the effective policy's lexical root, so allow emits no vote. |
| `git status >> /var/tmp/git-reports/status.txt` | allow | The append-report rule extends the default set with the `>>` entry for its additional root. |
| `git log --oneline > /tmp/reports/log.txt` | ask | The log rule replaces permissive coverage with `no-redirects`. |
| `git status 2>&1` | ask | FD duplication is a distinct redirect target kind and is not selected. |
| `git status > "$REPORT"` | ask | The dynamic redirect target is opaque and cannot allow. |
| `GIT_DIR=/tmp/repo git status` | ask | The status allows require `environment: { "none": true }`. |
| `git status; git push --force` | deny | Both chain parts reduce, then deny dominates. |
| `sed -i 's/a/b/' file` with a `sed-v1` profile containing a deny rule for fact `executionPrimitive: inPlace` | deny | The analyzer emits the fact; the rule, not the analyzer, emits deny. |
| `xargs rm -rf /` with `xargs-v1` and a nested `rm` profile that declares zero-arity option `recursiveForce` as alias `-rf`, then denies exact arguments `["/"]` plus that option | deny | `xargs-v1` emits one `analyzer-command` nested part; its deny joins the lattice. |
| Reorder profiles, rules, options, hints, or policy entries | unchanged | Profile selection, policy resolution, and reduction are order-free. |
| Add a matching allow where ask already emits | ask | An added allow cannot lower the lattice result. |

The sed and xargs rows are scenario templates: their stated surrounding profile
rules are part of each scenario and make the verdict deterministic. Golden tests
should encode those complete profiles, not assert analyzer verdicts in isolation.

## Policy resolution properties

Property tests cover the following invariants:

- Reordering entries within a policy, named policy references, inline additions,
  profiles, or rules does not change a verdict or resolved canonical policy set.
- `extend` resolves to set union of inherited, named, and inline canonical
  entries; duplicates do not change the set.
- Option coverage rejects every occurrence or consumed value outside its policy.
  `required` independently rejects absence, `repeatable` independently rejects
  a second occurrence, and duplicate aliases normalize to repeated canonical
  occurrences.
- `replace` changes permissive redirect coverage only. It does not alter another
  allow dimension. Local deny votes remain dominant under the fixed lattice.
- Unknown policy references, malformed entries, and any attempted policy cycle
  are invalid. Named policies are flat, so a cycle can only arise from an
  unsupported reference shape and is rejected.

## Draft closed schema outline and validation

The eventual schema is a closed JSON Schema object model. It checks primitive
shape, enum values, caps, `additionalProperties: false`, and local union forms.
The engine performs the cross-field validation described below.

```text
config
  version: 2
  defaults: { action: "ask", message?, redirectPolicy: policyId }
  limits?: { configBytes?, profiles?, rules?, evidenceItems?, diagnosticsBytes? }
  redirectPolicies: { policyId: closed RedirectPolicy }
  profiles: profile[]

RedirectPolicy
  redirects: closed redirect coverage form
  paths: closed redirect-target path coverage form

optionPolicy
  option: canonicalOptionId
  required: boolean
  repeatable: boolean
  values?: optionValueCoverage           // required for positive arity, absent for zero arity

optionValueCoverage
  one of:
    { each: tokenValueSelector }
    { byPosition: tokenValueSelector[] } // length equals fixed option arity

tokenValueSelector
  one of:
    stringValueSelector
    { path: pathSelector }

stringValueSelector
  one of:
    { any: true }
    { oneOf: string[] }
    { regex: string }

typedValueSelector
  one of:
    { any: true }
    { exact: scalar }
    { string: stringValueSelector }
    { integer: { min?, max? } }
    { number: { min?, max? } }
    { boolean: boolean }
    { path: pathSelector }

pathSelector
  one of:
    { exact: absoluteLexicalPath }
    { within: absoluteLexicalPath }
    { outside: absoluteLexicalPath }

redirectPolicy override
  mode: "inherit" | "extend" | "replace"
  policies?: policyId[]
  inline?: closed RedirectPolicy

profile
  id
  executables: literal alias[]
  options: { canonicalOptionId: { aliases: string[], arity: integer 0..4, inline?: boolean } }
           // inline is valid only when arity is one
  pathSources?: closed path source selector[]
  redirectPolicy?: redirectPolicy override
  analyzer?: analyzerId
  rules: rule[]
  fallbackHints?: hint[]

rule
  id
  action: "allow" | "ask" | "deny"
  message?: string
  match: closed Match                    // action-sensitive semantics
  redirectPolicy?: redirectPolicy override // allow only

Match
  arguments?, options?, environment?, redirects?, paths?, facts?, nestedParts?,
  classification?, raw?
```

Semantic validation includes:

- Profile aliases are unique across profiles. A multi-spelling `executables`
  list equals one complete entry in the implementation-owned versioned lexical
  alias catalog; a singleton needs no catalog entry. Option aliases are unique
  inside a profile. Inline option values are available only for arity one;
  arities two through four consume separate following tokens.
- Every option, analyzer, fact, value type, path coordinate, relation, and
  nested profile reference exists in the relevant closed catalog.
- `redirectPolicies` are flat named bundles with both redirect and redirect-path
  coverage. The default reference, every override reference, and inline entry
  validate against their closed forms. Unknown policy references are invalid;
  named policy inheritance is absent, so cycles cannot occur.
- `inherit` has no additions. `extend` and `replace` have one or more named or
  inline additions. Their expansion follows config default, profile override,
  then allow-rule override, canonicalizes and deduplicates entries, and does not
  depend on any configuration-list order.
- JSON Schema selects closed local shapes and rejects unknown keys. Semantic
  validation applies the action-sensitive meaning of `match`, checks catalog
  references, and proves relationships that JSON Schema cannot express.
- Raw appears only in ask or deny. An allow has `classification: "complete"`, no
  raw predicate, exactly one positional coverage selector, and an explicit
  coverage policy for every other evidence dimension. Every allow resolves an
  effective redirect policy, while `match.paths` explicitly covers only
  non-redirect path evidence. `match.redirects` and redirect-coordinate
  `match.paths` are invalid for allow.
- An allow prefix has explicit `remainder`; exact has no remainder. Allow option
  entries cover every occurrence and every consumed or inline value rather than a
  first or last occurrence. Each option entry references a declared canonical
  profile option, and one `allowed` list cannot repeat a canonical option ID.
  `required` checks whether at least one occurrence exists and
  `repeatable` checks whether more than one occurrence is permitted. Positive-
  arity entries have exactly one `values` policy; zero-arity entries have none.
  `each` covers every consumed value of every occurrence with one selector, while
  `byPosition` has exactly one selector per fixed value ordinal. Profile option
  arity is always a fixed integer; no variadic form exists. Homogeneous lists use
  repeated fixed-arity options and remain subject to `repeatable` coverage.
  Environment entries select name, literal value, prefix position, and occurrence. Redirect
  policy entries select source FD, operator, occurrence, and target kind,
  including literal paths and FD duplication.
- String-value selectors are closed single-key objects. `oneOf` performs literal
  equality, `regex` performs bounded whole-value matching in the fixed `re2-v1`
  dialect, and `any` explicitly covers every complete literal token. A
  token-value selector adds the distinct `path` form for lexical path selection.
  Regex compilation and selector limits are checked when config loads. Opaque or
  invalid token evidence satisfies none of these forms. Analyzer fact policies
  use typed-value selectors; string facts accept only string-value selectors,
  path facts accept path selectors, and no selector coerces between catalog
  types.
- Non-redirect paths use exact closed coordinates and lexical policy, and every
  coordinate originates from a valid profile-scoped `pathSources` declaration or
  analyzer catalog entry. Supported literal redirect target paths are always
  parser-produced and are available to redirect policies. Facts
  and nested parts use explicit `none` or `all`
  coverage policies. Nested entries include relation, occurrence or quantifier,
  profile, evidence state, and verdict.
- Resolution applies config default, profile override, then allow-rule override;
  `extend` is set union and `replace` changes only permissive redirect coverage.
  Redirect policies never emit votes. Local deny, ask, and allow votes reduce by
  the fixed lattice.
- Analyzer compatibility and safety metadata come only from implementation-owned
  versioned tables. Trusted roots are absolute normalized lexical paths.
- Limits bound config bytes, profiles, rules, nesting, alternatives, evidence,
  facts, and diagnostics.

Bad JSONC, unknown keys, duplicate aliases, unresolved references, incompatible
analyzers, or failed semantic validation make the config invalid. The checker
uses its established config-failure behavior rather than widening a verdict.

## Diagnostics and verdict wire

The checker computes full evidence and all decisions before applying diagnostic
bounds. Per part, diagnostics record sorted and bounded matched-rule IDs,
matched allow IDs, coverage-qualified allow IDs, rejected allow IDs with stable
coverage reason codes, emitted votes, selected profile, evidence state, resolved
redirect policy IDs and canonical entries, and parser/option reasons.
Examples of stable reasons are `opaque-expansion`, `unknown-option`,
`option-value-missing`, `evidence-limit`, `allow-evidence-not-complete`, and
`allow-coverage-missing`. Option diagnostics additionally use
`required-option-missing`, `option-not-repeatable`, `option-not-allowed`,
`option-value-uncovered`, and `option-value-position-uncovered`.
Redirect-policy diagnostics additionally use stable reasons such as
`redirect-policy-uncovered` and
`redirect-policy-reference-unknown`.

The current verdict contract in spec 02 and the v1 verdict schema cannot encode
this model completely: it has only `static|opaque`, one deciding `ruleId`, and
one `match` value per request command. V2 does not claim that schema remains
byte-for-byte unchanged. The letter envelope, aggregate `allow|ask|deny` values,
and hook action mapping remain unchanged, but the accepted implementation needs
a coordinated spec 02 and verdict-schema update to represent v2 diagnostics and
the `invalid` evidence state without weakening the hook's closed validation.

## Version disposition

V1 syntax is not accepted by v2. Backward compatibility, automatic translation,
compatibility shims, migration paths, migration tooling, deprecation periods,
and auto-migration do not exist. A v2 checker reads v2 only.

The v1 stage model, unrelated shared executable grammars, implicit refinement,
priorities, order semantics, and raw-based allow are retired. V2 allow rules
need complete typed evidence and universal coverage.

## Acceptance and rollout

After design acceptance:

1. Update specs 02, 06, 07, 08, 09, and 10 together with the v2 config schema
   and verdict schema. This synchronizes parsing, redirect evidence, named
   policy resolution, diagnostics, trust invariants,
   property tests, and wire validation.
2. Create one implementation ticket and record v2-only parser readiness.
3. Keep the hook policy mapping and request-letter envelope unchanged while the
   checker and coordinated verdict contract gain v2 evidence diagnostics.
4. Update pull request 14 to this direction rather than merging its original
   stage and refinement design.
