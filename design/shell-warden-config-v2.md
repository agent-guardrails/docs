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
sources, an optional redirect-policy override, one optional built-in analyzer,
rules, and optional fallback hints.
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
before voting. An option maps one canonical ID to aliases and arity zero through
four. `--long=value` is valid only for a declared positive-arity option that
accepts that inline form. The option parser records the `--` boundary and every
option/value occurrence.

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
| `arguments` | `exact: token[]`, or `prefix: token[]` plus `remainder: { "none": true } | { "each": tokenSelector }` | `exact` covers the whole positional list. `prefix` covers its prefix and applies the explicit remainder policy to every remaining positional argument. |
| `options` | `{ "none": true }` or `{ "allowed": [optionPolicy, ...] }` | Every option occurrence and every consumed or inline value satisfies one entry. Repeated options are never collapsed. Each entry references one canonical profile option and states `required` and `repeatable`; universal coverage and presence or repetition are separate. |
| `environment` | `{ "none": true }` or `{ "all": [environmentPolicy, ...] }` | Every assignment occurrence satisfies name, literal-value, prefix-position, and occurrence selectors. |
| redirects and redirect-target paths | Mandatory resolved effective `redirectPolicy` | Every redirect occurrence satisfies source FD, including the explicit `default` selector, operator, occurrence, and target kind; every emitted redirect path coordinate satisfies its lexical policy. Literal-path and FD-duplication targets are separate closed target kinds. |
| `paths` | `{ "none": true }` or `{ "all": [pathPolicy, ...] }` | Every emitted non-redirect exact coordinate satisfies an `exact`, `within`, or `outside` lexical policy. Redirect coordinates never appear in this allow matcher. |
| `facts` | `{ "none": true }` or `{ "all": [factPolicy, ...] }` | Every emitted fact satisfies analyzer ID/version, fact name, occurrence, and typed value selectors. Safety-relevant facts cannot be ignored. |
| `nestedParts` | `{ "none": true }` or `{ "all": [nestedPartPolicy, ...] }` | Every nested executable part satisfies relation, occurrence, profile, evidence state, and required reduced verdict selectors. |

`prefix` without `remainder` is invalid. `remainder.each` applies only to
positional arguments, never to option tokens or option values. An exact allow is
the usual form for a command with a fixed positional shape. Every observed option
must match one `allowed` entry by canonical `option` reference. `required: true`
means at least one occurrence exists; `required: false` makes it optional.
`repeatable: false` permits at most one occurrence, while `repeatable: true`
permits multiple occurrences within resource limits. Together, `required: true`
and `repeatable: false` mean exactly one. A positive-arity entry also covers each
consumed value with a closed value selector. Unknown or unlisted options prevent
allow, and aliases that normalize to the same canonical option are repeated
occurrences.

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
coverage, inherited and extended redirect coverage, and a
replacement with no redirects. `node-version` has one executable grammar. Other
tools that need version checks, including npm, pnpm, bun, cargo, go, and
terraform, use separate profiles unless their aliases are genuinely
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
option grammar.

## Evaluation scenarios

| Input or assumption | Result | Reason |
|---|---|---|
| `git push --force --dry-run origin main` | deny | `force` is not allowed by the dry-run policy and the force-push deny emits. |
| `git log --oneline` plus an explicit matching ask | ask | Ask dominates allow. |
| `git log` | ask | The `oneline` entry is required, so its absence cannot qualify the allow. |
| `git push origin main` | ask | The `dryRun` entry is required, so its absence cannot qualify the allow. |
| `node` | ask | The `version` entry is required, so its absence cannot qualify the allow. |
| `git log --oneline --oneline` | ask | `oneline` is not repeatable, so the second occurrence prevents allow. |
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
  values?: each(valueSelector)           // positive arity only

redirectPolicy override
  mode: "inherit" | "extend" | "replace"
  policies?: policyId[]
  inline?: closed RedirectPolicy

profile
  id
  executables: literal alias[]
  options: { canonicalOptionId: { aliases: string[], arity: 0..4, inline?: boolean } }
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
  inside a profile.
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
  profile option. `required` checks whether at least one occurrence exists and
  `repeatable` checks whether more than one occurrence is permitted. Positive-
  arity entries also select every consumed value. Environment entries select name,
  literal value, prefix position, and occurrence. Redirect
  policy entries select source FD, operator, occurrence, and target kind,
  including literal paths and FD duplication.
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
`required-option-missing`, `option-not-repeatable`, and `option-not-allowed`.
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

## Migration and disposition

V1 syntax is not accepted by v2. Backward compatibility, automatic translation,
and compatibility shims are out of scope. A user-config migration guide and
tooling ticket can map intended policies into profiles, named redirect policies,
and coverage-aware allow matchers, but a v2 checker reads v2 only.

The v1 stage model, unrelated shared executable grammars, implicit refinement,
priorities, order semantics, and raw-based allow are retired. Existing raw deny
and ask policy can migrate where useful; every allow needs complete typed
evidence and universal coverage.

## Acceptance and rollout

After design acceptance:

1. Update specs 02, 06, 07, 08, 09, and 10 together with the v2 config schema
   and verdict schema. This synchronizes parsing, redirect evidence, named
   policy resolution, diagnostics, trust invariants,
   property tests, and wire validation.
2. Create one implementation ticket and one user-config migration ticket.
3. Keep the hook policy mapping and request-letter envelope unchanged while the
   checker and coordinated verdict contract gain v2 evidence diagnostics.
4. Update pull request 14 to this direction rather than merging its original
   stage and refinement design.
