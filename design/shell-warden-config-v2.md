# Design: Shell Warden configuration v2

Status: draft for review
Ticket: https://github.com/agent-guardrails/docs/issues/15
Disposition: this design supersedes the direction proposed in
https://github.com/agent-guardrails/docs/issues/13. Pull request
https://github.com/agent-guardrails/docs/pull/14 should be updated to this
design, not merged as originally written.

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

## Selected architecture

A profile owns the complete lexical grammar and policy for one executable.
It names executable aliases, option aliases and arities, profile-scoped path
sources, one optional built-in analyzer, rules, and optional fallback hints.
`option` is the umbrella term:
an option with arity zero is a flag; an option with positive arity consumes that
many values. Profiles never share option grammars.

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
     +--> complete / opaque / invalid evidence
     |               |
     v               v
profile option parser and built-in analyzer facts
     |
     v
match satisfaction -> authorization satisfaction -> emitted votes
     |
     v
deny > ask > allow across every part
```

Executable matching is lexical. It proves neither the resolved binary identity
nor what a PATH lookup would execute. Path containment is also lexical and is
not symlink-safe filesystem containment. Allow policies needing either guarantee
are outside this checker model and cannot be expressed.

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
| `complete` | Supported shell syntax, profile option parsing, analyzer processing, and resource limits yielded all typed evidence. | May proceed to match and authorization. |
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

## Closed evidence catalogs and coordinates

The checker produces only these closed evidence dimensions:

| Dimension | Per-occurrence contents |
|---|---|
| positional arguments | Decoded literal token, argument index, span, and quote class. |
| options | Canonical option ID, used alias, option occurrence ordinal, each value ordinal and span, inline-versus-separate form, and source order. |
| environment assignments | Assignment occurrence ordinal, name, literal value, span, and prefix position. |
| redirects | Redirect occurrence ordinal, source FD or default source FD, operator, literal target, target span, and source order. |
| lexical paths | Literal raw text, lexical normalized path, cwd-relative lexical path, source coordinate, and source span. |
| analyzer facts | Analyzer ID/version, closed fact name, fact occurrence ordinal, typed value, span, and catalog safety metadata. |
| nested parts | Part ID, relation enum value, relation occurrence ordinal, selected profile, evidence state, and reduced nested verdict. |

Positional arguments exclude option tokens and every value consumed by an option.
The `--` boundary is retained in evidence and ends option recognition. Source
order is retained even when a matcher groups occurrences by canonical ID. No
first-occurrence or last-occurrence collapse occurs. Repeated options and every
one of their values remain separate evidence items.

The `--` boundary is non-authorizable parsing metadata, not a security-relevant
evidence dimension. Its effect is fully represented by classification of every
following token as a positional argument, which must still satisfy argument
matching and universal coverage. Diagnostics retain the boundary span and
source position, but its presence alone creates no authorization obligation.

Path coordinates are closed:

- `argument(index)`
- `optionValue(canonicalOptionId, optionOccurrence, valueOrdinal)`
- `environment(assignmentOccurrence)`
- `redirect(redirectOccurrence, operator, sourceFd)`
- `analyzerFact(analyzerId, version, factName, factOccurrence)`

`generic-v1` does not infer that every string is a path. Before rule matching,
path evidence appears only from sources selected by the profile's closed
`pathSources` declarations or from the selected analyzer's fact catalog. Rules
can match or authorize emitted path evidence but cannot cause new evidence to be
produced. A profile with no path source declaration does not gain path evidence
merely because an argument resembles a path. This keeps authorization
obligations independent of which rules happen to match.

Evidence production performs no I/O and no PATH lookup.

## Profiles, option grammars, and analyzers

A profile has `id`, `executables`, `options`, optional `pathSources`, optional
`analyzer`, `rules`, and optional `fallbackHints`. A path source declaration is
one closed source selector: positional argument index or remainder, option ID
plus value ordinal, environment assignment selector, redirect target selector,
or analyzer fact selector. It produces actual per-occurrence path coordinates
before voting. An option maps one canonical ID to aliases and arity zero through
four. `--long=value` is valid only for a declared positive-arity option that
accepts that inline form. The option parser records the `--` boundary and every
option/value occurrence.

The built-in analyzer IDs are `generic-v1`, `sed-v1`, `export-v1`, and
`xargs-v1`. They are versioned evidence producers, not extension points. They
cannot load config code, issue a verdict, alter evaluation order, or authorize a
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

## Matching, authorization, and emitted votes

Each rule has an ID, action, optional ask/deny message, and `match`. All supplied
predicates must hold. `match` is closed and may contain:

| Predicate | Meaning |
|---|---|
| `arguments.exact` | Exact positional sequence; each token is literal or `{ "anyOf": [...] }`. |
| `arguments.prefix` | Positional prefix; each token is literal or `{ "anyOf": [...] }`. |
| `arguments.containsAny` | At least one positional argument matches a token alternative. |
| `options.presentAll`, `presentAny`, `absentAll`, `values` | Predicates over canonical option IDs and specified occurrence/value selectors. |
| `environment` | Typed predicates over assignment name, literal value selector, prefix position, and occurrence. |
| `redirects` | Typed predicates over source FD, operator, occurrence, and literal target/path selector. |
| `paths` | Typed predicates over an exact path coordinate and lexical policy. |
| `facts` | Typed predicates over analyzer ID/version, fact name, occurrence, and value selector. |
| `nestedParts` | Predicates over relation, occurrence or quantifier, profile, evidence state, and nested verdict. |
| `classification` | `complete`, `opaque`, or `invalid`. |
| `raw` | Raw-text pattern, available only to ask and deny. |

Environment and redirect fields can appear in both `match` and `authorize`.
Raw is forbidden for allow, including through `authorize`.

Match satisfaction, authorization satisfaction, and vote emission are separate:

1. Ask and deny emit their action vote when `match` succeeds.
2. Allow emits an allow vote only when `match` succeeds and every authorization
   dimension succeeds against complete evidence.
3. A rejected allow emits no vote and records why.

The old safety invariant becomes precise: an allow selects one executable
profile, constrains positional argument shape, and explicitly covers every
option plus every other security-relevant evidence occurrence. An option match
alone never authorizes a command.

### Closed authorization object model

`authorize` is a closed object. Omitted dimensions authorize none. Every
observed occurrence/item in every dimension must be universally covered by at
least one compatible authorization entry; a partial or first/last-only match
fails.

| Dimension | Closed authorization entry | Universal coverage rule |
|---|---|---|
| `arguments` | `exact: token[]`, or `prefix: token[]` with `remainder: none | each(tokenSelector)` | `exact` covers the whole positional sequence. `prefix` covers the prefix and applies its stated policy to every remaining positional argument. |
| `options` | keyed by canonical ID; each entry states occurrence selector and zero-arity presence or positive-arity `values: each(valueSelector)` | Every occurrence of every observed option is keyed and selected; every consumed or inline value is covered. |
| `environment` | name, literal value selector, prefix-position selector, occurrence selector | Every assignment occurrence is covered. |
| `redirects` | source-FD selector including default, operator selector, occurrence selector, literal target selector or path policy | Every redirect occurrence is covered. |
| `paths` | exact path coordinate and lexical policy: exact, within explicit trusted root, or outside explicit trusted root | Every emitted path item is covered by its exact source coordinate and policy. |
| `facts` | analyzer ID/version, fact name, occurrence selector, typed value selector | Every emitted fact is covered. Safety-relevant status remains implementation-owned catalog metadata. |
| `nestedParts` | relation, occurrence selector or `all`, selected profile, evidence state, required nested verdict | Every nested executable part is covered and has the required reduced verdict. |

`prefix` without `remainder` is invalid. `remainder.each` applies only to
positional arguments, never to option tokens or option values. An exact allow is
the usual form for a command with a fixed positional shape.

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
Authorizing one does not authorize the other. The lexical-only consequence is
intentional: resolved-binary identity and symlink-safe containment require
external lookup and remain outside the checker.

## Illustrative JSONC configuration

This compact configuration shows exact positional shape, option coverage, and
deny overlap. `node-version` has one executable grammar. Other tools that need
version checks, including npm, pnpm, bun, cargo, go, and terraform, use separate
profiles unless their aliases are genuinely grammar-equivalent.

```jsonc
{
  "version": 2,
  "defaults": { "action": "ask", "message": "No approved command profile matched." },
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
          "match": { "classification": "complete", "arguments": { "exact": ["status"] } },
          "authorize": { "arguments": { "exact": ["status"] } }
        },
        {
          "id": "git/allow-log-oneline",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["log"] },
            "options": { "presentAll": ["oneline"] }
          },
          "authorize": {
            "arguments": { "exact": ["log"] },
            "options": { "oneline": { "occurrences": "all", "present": true } }
          }
        },
        {
          "id": "git/allow-push-dry-run",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": ["push", "origin", "main"] },
            "options": { "presentAll": ["dryRun"], "absentAll": ["force"] }
          },
          "authorize": {
            "arguments": { "exact": ["push", "origin", "main"] },
            "options": { "dryRun": { "occurrences": "all", "present": true } }
          }
        }
      ]
    },
    {
      "id": "node-version",
      "executables": ["node"],
      "options": { "version": { "aliases": ["--version", "-V"], "arity": 0 } },
      "analyzer": "generic-v1",
      "rules": [
        {
          "id": "node-version/allow-bare-version",
          "action": "allow",
          "match": {
            "classification": "complete",
            "arguments": { "exact": [] },
            "options": { "presentAll": ["version"] }
          },
          "authorize": {
            "arguments": { "exact": [] },
            "options": { "version": { "occurrences": "all", "present": true } }
          }
        }
      ]
    }
  ]
}
```

After option parsing, `git push --dry-run origin main` has positional arguments
`["push", "origin", "main"]` and one `dryRun` option occurrence, so the exact
allow can emit. `git push --force --dry-run origin main` has the same positional
shape, matches the allow and force-push deny, and resolves deny. `npm install
--version` has no selected profile in this compact example and asks; it cannot
inherit Node's option grammar.

## Evaluation scenarios

| Input or assumption | Result | Reason |
|---|---|---|
| `git push --force --dry-run origin main` | deny | The exact dry-run allow emits, the force-push deny emits, and deny dominates. |
| `git log --oneline` plus an explicit matching ask | ask | Ask dominates allow. |
| `git status --unknown-option` | ask | Unknown option makes evidence invalid; allow emits no vote. |
| `git log "$BRANCH"` | ask | Active double-quoted expansion is opaque. |
| `git status > out.txt` | ask | The status allow lacks redirect authorization. |
| `GIT_DIR=/tmp/repo git status` | ask | The status allow lacks environment authorization. |
| `git status; git push --force` | deny | Both chain parts reduce, then deny dominates. |
| `sed -i 's/a/b/' file` with a `sed-v1` profile containing a deny rule for fact `executionPrimitive: inPlace` | deny | The analyzer emits the fact; the rule, not the analyzer, emits deny. |
| `xargs rm -rf /` with `xargs-v1` and a nested `rm` profile that declares zero-arity option `recursiveForce` as alias `-rf`, then denies exact arguments `["/"]` plus that option | deny | `xargs-v1` emits one `analyzer-command` nested part; its deny joins the lattice. |
| Reorder profiles, rules, options, or hints | unchanged | Profile selection is unique and semantics are order-free. |
| Add a matching allow where ask already emits | ask | An added allow cannot lower the lattice result. |

The sed and xargs rows are scenario templates: their stated surrounding profile
rules are part of each scenario and make the verdict deterministic. Golden tests
should encode those complete profiles, not assert analyzer verdicts in isolation.

## Draft closed schema outline and validation

The eventual schema is a closed JSON Schema object model. It checks primitive
shape, enum values, caps, `additionalProperties: false`, and local union forms.
The engine performs the cross-field validation described below.

```text
config
  version: 2
  defaults: { action: "ask", message? }
  limits?: { configBytes?, profiles?, rules?, evidenceItems?, diagnosticsBytes? }
  profiles: profile[]

profile
  id
  executables: literal alias[]
  options: { canonicalOptionId: { aliases: string[], arity: 0..4, inline?: boolean } }
  pathSources?: closed path source selector[]
  analyzer?: analyzerId
  rules: rule[]
  fallbackHints?: hint[]

rule
  id
  action: "allow" | "ask" | "deny"
  message?: string
  match: closed Match
  authorize: closed Authorization     // allow only

Match
  arguments?, options?, environment?, redirects?, paths?, facts?, nestedParts?,
  classification?, raw?

Authorization
  arguments?, options?, environment?, redirects?, paths?, facts?, nestedParts?
```

Semantic validation includes:

- Profile aliases are unique across profiles. A multi-spelling `executables`
  list equals one complete entry in the implementation-owned versioned lexical
  alias catalog; a singleton needs no catalog entry. Option aliases are unique
  inside a profile.
- Every option, analyzer, fact, value type, path coordinate, relation, and
  nested profile reference exists in the relevant closed catalog.
- Raw appears only in ask or deny. Allow has no raw predicate and has exactly one
  positional selector plus compatible `authorize.arguments`.
- An allow prefix has explicit `remainder`; exact has no remainder. An option
  authorization covers occurrences and all values rather than a first or last
  occurrence.
- Environment and redirect predicates and authorization entries include all
  required typed selectors. Paths use exact closed coordinates and lexical
  policy, and every path coordinate originates from a valid profile-scoped
  `pathSources` declaration or analyzer catalog entry. Nested entries include
  relation, occurrence or quantifier, profile, evidence state, and verdict.
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
authorization-qualified allow IDs, rejected-allow IDs with stable reason codes,
emitted votes, selected profile, evidence state, and parser/option reasons.
Examples of stable reasons are `opaque-expansion`, `unknown-option`,
`option-value-missing`, `evidence-limit`, `allow-evidence-not-complete`, and
`allow-coverage-missing`.

The current verdict contract in spec 02 and the v1 verdict schema cannot encode
this model completely: it has only `static|opaque`, one deciding `ruleId`, and
one `match` value per request command. V2 does not claim that schema remains
byte-for-byte unchanged. The letter envelope, aggregate `allow|ask|deny` values,
and hook action mapping remain unchanged, but the accepted implementation needs
a coordinated spec 02 and verdict-schema update to represent v2 diagnostics and
the `invalid` evidence state without weakening the hook's closed validation.

## Migration and disposition

V1 syntax is not accepted by v2. Backward compatibility, automatic translation,
and compatibility shims are out of scope. A user-config migration guide and
tooling ticket can map intended policies into profiles and authorization
envelopes, but a v2 checker reads v2 only.

The v1 stage model, unrelated shared executable grammars, implicit refinement,
priorities, order semantics, and raw-based allow are retired. Existing raw deny
and ask policy can migrate where useful; every allow needs complete typed
evidence and universal coverage.

## Acceptance and rollout

After design acceptance:

1. Update specs 02, 06, 07, 08, 09, and 10 together with the v2 config schema
   and verdict schema. This synchronizes parsing, evidence, diagnostics, trust
   invariants, tests, and wire validation.
2. Create one implementation ticket and one user-config migration ticket.
3. Keep the hook policy mapping and request-letter envelope unchanged while the
   checker and coordinated verdict contract gain v2 evidence diagnostics.
4. Update pull request 14 to this direction rather than merging its original
   stage and refinement design.
