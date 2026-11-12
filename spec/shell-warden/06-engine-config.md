# 06 — Checker Configuration: Command Profiles (v2)

Version 2.4 · 2026-11-12 · Schema-first checker configuration v2 accepted by
[ADR-0017](https://github.com/agent-guardrails/docs/blob/main/adr/0017-schema-first-shell-warden-config-contract.md), with normative
verdict output updates under [ADR-0023](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md),
and tracked by [docs#21](https://github.com/agent-guardrails/docs/issues/21). The accepted
[configuration design](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-config-v2.md) defines the public shapes that
this specification and the schema make normative.

Schema: `schemas/shell-warden.config.v2.schema.json` (`defaults`, `limits`, `redirectPolicies`,
`profiles`). A v2 checker reads v2 only; backward compatibility, automatic translation, and
compatibility shims are out of scope.

The checker owns ALL policy: recursive parsing and executable-part extraction
(`07-command-parsing.md`), action-sensitive rule matching and verdict composition
(`08-request-processing.md`). The config is a declarative profiles file — there are no
external stage tools, no walk invocations, no second process tier.

## 6.1 Config file & trust

| | |
|---|---|
| Path | `$XDG_CONFIG_HOME/shell-warden/config.jsonc` — single file, user-global only (ADR-0003) |
| Override | `--config FILE` argv (absolute path after `{env:NAME}` expansion toward an absolute path; hook option, 04) |
| Trust | The file IS executable policy; a repository can never supply it (ADR-0003). The hook validates this posture per 04 §4.3 |

**No reload machinery**: the checker re-reads and re-validates the file on every spawn (02
§2.5). Strict validation: unknown keys (closed JSON Schema plus `denyUnknownFields`-equivalent
strictness), wrong types, cap violations, unresolved cross-references ⇒ config invalid ⇒
exit 2 (never fail-open, 09 I3). Valid comments (`jsonc`) are allowed; a JSONC syntax error is
invalid config. The `configBytes` cap is checked on the raw file bytes before parsing.

## 6.2 Top-level schema

```jsonc
{
  "version": 2,
  "defaults": {
    "action": "ask",
    "redirectPolicy": "no-redirects"
  },
  "redirectPolicies": {
    "no-redirects": {
      "redirects": { "none": true },
      "paths": { "none": true }
    }
  },
  "profiles": []
}
```

The optional `limits` object has `configBytes`, `profiles`, `rules`, `evidenceItems`, and
`diagnosticsBytes` keys only. Omitted keys use the maxima in the accepted design; configured
values are positive integers no larger than those maxima.

`defaults`, `redirectPolicies`, and `profiles` are REQUIRED. `defaults.action` and
`defaults.redirectPolicy` are REQUIRED inside `defaults`; the action MUST be `"ask"`, and the
policy name MUST resolve to a declared bundle. There is no implicit bundle. A configuration
that permits no redirects declares a named bundle whose `redirects` and `paths` are both
`{ "none": true }`.

## 6.3 Command profiles (executable selection and option grammars)

A **profile** owns the complete lexical grammar and policy for one executable. It has:

```jsonc
{
  "id": "git",                         // REQUIRED, 1–128 chars, unique
  "executables": ["git"],              // REQUIRED, 1–8 literal aliases, non-empty, globally unique
  "options": {                         // canonical option ID → aliases + arity (+ inline form)
    "force": { "aliases": ["--force", "-f"], "arity": 0 },
    "path":  { "aliases": ["-C"], "arity": 1, "inline": false }
  },
  "pathSources": [],                   // optional path-coordinate producers (§6.7, closed selectors)
  "redirectPolicy": { "mode": "inherit" },
  "analyzer": "generic-v1",            // optional closed analyzer id
  "rules": [],
  "fallbackHints": []
}
```

- **Executable selection is lexical.** The checker selects the profile whose `executables`
  contain the part's head token; the part's head MUST be a resolvable literal token. The head
  token is evidence of selection and is NOT part of the positional arguments (08 §8.2).
- A singleton `executables` list is always valid. A multi-spelling list MUST equal one complete
  entry of the implementation-owned, versioned lexical alias catalog. Such an entry asserts
  identical option grammar and analyzer behavior — it does NOT assert resolved binary identity.
  Unrelated executables MUST get separate profiles.
- **Option grammar.** `arity` 0 is a flag; arity 1–4 consumes that many following tokens as
  values, regardless of their shape. Aliases (1–16 per option, each 1–32 chars) are exactly as
  they appear in argv and MUST be unique inside the profile; two aliases of one canonical ID
  normalize to repeated canonical occurrences. The inline form `--alias=value` is valid only
  for a declared arity-1 option with `"inline": true`. For arity zero and arities two through
  four, `inline` MUST be absent or `false`; those positive arities always consume separate
  following tokens. Variadic, minimum/maximum arity, and option remainder forms do not exist.
- **Analyzer.** `analyzer` names one closed built-in: `generic-v1`, `sed-v1`, `export-v1`,
  `xargs-v1`. They are versioned evidence producers, never extension points, never verdict
  issuers, never policy loaders (§6.7, 08 §8.4). Implementation-owned, versioned compatibility
  and fact-catalog tables validate analyzer/profile combinations, fact names, and fact types.

## 6.4 Rule schema (v2)

```jsonc
{
  "id": "git/deny-force-push",
  "action": "deny",
  "message": "Push without force, or create a branch and open a pull request.",
  "match": {
    "arguments": { "prefix": ["push"] },
    "options": { "presentAny": ["force"] }
  }
}
```

Rule IDs are 1–128 chars and unique per profile. `action` is `allow`, `ask`, or `deny`.
Ask/deny messages are at most 512 chars. A `redirectPolicy` override is optional on allow rules
only.

`match` is written once; its meaning depends on the action:

- **ask/deny**: an ordinary predicate set — existential or conjunctive, and it need not account
  for unrelated evidence (§6.6).
- **allow**: both the shape constraint and the total coverage proof (§6.7).

## 6.5 Matching vocabulary

| Element | Semantics |
|---|---|
| positional arguments | The decoded literal tokens that remain after the executable head, the parsed option tokens, and every value consumed by an option are removed. Everything after the `--` boundary is a positional argument (the boundary itself is parsing metadata, not an evidence dimension). |
| option occurrences | Matched by canonical option ID. Every occurrence and every one of its values remains a separate evidence item; repeated options are never collapsed to first/last. |
| `arguments.exact` / `arguments.prefix` | ANCHORED positional sequences: the listed tokens match positionally from index 0; trailing tokens beyond the listed ones are irrelevant to the ordinary meaning. For allow, `exact` covers the whole positional list (§6.7). |
| `arguments.containsAny` | **∃ token × ∃ glob** — some positional token matches some listed glob. Ask/deny only. |
| `raw` | Glob on the part's raw text (OpenCode-compatible): `*` = zero+ chars including spaces; `?` = one char; a trailing `" *"` also matches the bare command. Ask/deny only. |
| occurrence selectors | `"all"` or a positive 1-based occurrence number. |
| string-value selector | Exactly one of `{ "any": true }`, `{ "oneOf": [literal, ...] }`, or `{ "regex": pattern }`. `oneOf` is non-empty and duplicate-free. Regex uses bounded, whole-value `re2-v1` matching. |
| token selector | One string-value selector or `{ "path": pathSelector }`. A path selector is exactly one of `exact`, `within`, or `outside`, with a normalized absolute lexical path. |

## 6.6 Action-sensitive `match`: ordinary predicates (ask/deny)

Multiple dimensions on one `match` MUST all hold (AND). A `match` with no dimensions matches
nothing for allow (invalid — §6.7) and is rejected for ask/deny when a present dimension is
empty.

| Dimension | Type (v2, wire names) | Ordinary meaning |
|---|---|---|
| `arguments` | `exact` / `prefix` (anchored sequences), `containsAny` | as §6.5; an explicit `remainder` is an allow-only form and MUST be rejected on ask/deny |
| `options` | `presentAll`, `presentAny`, `absentAll` (canonical ID lists), `values` (map ID → `TokenSelector`) | presence tests over canonical IDs; `values` holds when any occurrence value satisfies its selector; every referenced ID MUST be a declared profile option; `none: true` requires no option at all and excludes presence/value conditions (the `allowed` coverage form is allow-only) |
| `environment` | `none` \| `any` \| `all` of `EnvironmentTest` (`name`, optional string-value `value`, `prefix`, `occurrence`) | exactly one of `none`/`any`/`all`; `any` = ∃ assignment × ∃ test, `all` = ∀ assignment ∃ test; `prefix: true` requires the assignment to sit in the command prefix |
| `redirects` | `none` \| `any` \| `all` of `RedirectTest` (`operator`, `sourceFd`, `targetKind`, `occurrence`) | exactly one of `none`/`any`/`all`; omitted test dimensions are unconstrained; `targetKind` distinguishes `literalPath` from `fd`; `redirects` is invalid on allow (§6.7) |
| `paths` | `none` \| `any` \| `all` of `PathEntry` (coordinate selector + exactly one of `exact`/`within`/`outside`) | predicates over the path coordinates the profile's `pathSources` produced; `within`/`outside` roots MUST be absolute lexical paths; redirect-coordinate `paths` on allow are invalid (§6.7) |
| `facts` | `none` \| `any` \| `all` of `FactTest` (`analyzer`, `version`, `name`, `occurrence`, typed `value`) | exactly one of `none`/`any`/`all`; every `name` and value type MUST agree with the closed catalog of the profile's declared analyzer |
| `nestedParts` | `none` \| `any` \| `all` of `NestedPartTest` (`relation`, `occurrence`, `profile`, `classification`, `verdict`) | exactly one of `none`/`any`/`all`; relation is the hyphenated closed wire enum; `profile` is a declared profile id or `"none"` |
| `classification` | one of `complete` \| `opaque` \| `invalid` | the part's evidence state equals (07 §7.3) |
| `raw` | string glob | the part's raw text matches; ask/deny only — MUST be rejected on allow |

## 6.7 Allow: the coverage proof

An allow `match` is simultaneously the shape constraint and the total coverage proof. The
checker first validates the action-sensitive shape, then validates that every observed
security-relevant item is universally covered; a rejected allow emits no vote and records its
coverage failure (08 §8.3). The following are REQUIRED of every allow rule:

- `"classification": "complete"` and no `raw` predicate; `match.redirects` is absent — redirect
  coverage comes exclusively from the effective redirect policy (§6.8).
- An explicit `arguments` policy: `exact`, or `prefix` plus an explicit `remainder` —
  `{"none": true}` (no further arguments) or `{"each": tokenSelector}` (every remaining
  positional token satisfies one string-value or lexical-path selector). `containsAny` has no
  allow spelling. `prefix` without `remainder` and `exact` with `remainder` are invalid.
- An explicit `options` policy: `{"none": true}`, or `{"allowed": [entry, ...]}`. Each entry
  references a declared canonical profile option and states `required` and `repeatable`;
  `required: true` + `repeatable: false` means exactly one occurrence. Every observed
  occurrence satisfies one entry by canonical ID; every consumed or inline value satisfies the
  entry's `values` selector. `{"each": tokenSelector}` applies one selector to every value of
  every occurrence. `{"byPosition": [tokenSelector, ...]}` has exactly the declared arity's
  number of entries and applies its zero-based array entries to one-based value ordinals. A
  positive-arity entry MUST carry `values`; a zero-arity entry MUST NOT. Canonical option IDs
  MUST be unique within `allowed`. Unknown or unlisted options prevent the allow.
- An explicit `environment` policy: `{"none": true}` or `{"all": [entry, ...]}` — every
  assignment occurrence is covered by an `EnvironmentPolicy` with required `name`, `prefix`,
  and `occurrence`, plus an optional complete-literal string-value selector.
- An effective redirect policy (§6.8) covers every redirect occurrence structurally — source
  FD (including the explicit `"default"` selector), operator, occurrence, and target kind —
  and every literal redirect target path through the bundle's redirect-coordinate path entries.
- An explicit non-redirect `paths` policy: `{"none": true}` or `{"all": [entry, ...]}` over
  the coordinates produced by `pathSources` or the analyzer's fact catalog — never over
  redirect coordinates. `exact` compares the complete normalized lexical path;
  `within`/`outside` are lexical component comparisons on cwd-joined, dot-dot-normalized
  paths (`/work/repo2` is NOT within `/work/repo`, 07 §7.6).
- An explicit `facts` policy: `{"none": true}` or `{"all": [entry, ...]}` — every emitted fact
  is covered by required analyzer ID, analyzer version, fact name, occurrence, and a typed-value
  selector. Typed values use exactly one of `any`, scalar `exact`, `string`, bounded `integer`,
  bounded `number`, exact `boolean`, or lexical `path`; no type coercion occurs.
- An explicit `nestedParts` policy: `{"none": true}` or `{"all": [entry, ...]}` — every nested
  executable part is covered by required `relation`, `occurrence`, `profile`, `classification`,
  and reduced `verdict`.

A partial match, a first-or-last-only match, or an unselected repeated occurrence does not
qualify an allow. An allow rule MAY carry a `redirectPolicy` override; it is invalid on ask
and deny.

Path coordinates are one-level, single-key selectors. Non-redirect policies and `pathSources`
use exactly one of:

- `{ "argument": { "index": nonNegativeInteger, "remainder"?: boolean } }`;
- `{ "optionValue": { "option": canonicalId, "occurrence"?: occurrenceSelector,
  "valueOrdinal": integer1Through4 } }`;
- `{ "environment": { "occurrence"?: occurrenceSelector } }`;
- `{ "analyzerFact": { "analyzer": analyzerId, "version": string, "name": factName,
  "occurrence"?: occurrenceSelector } }`.

Redirect-policy paths instead use exactly
`{ "redirect": { "operator": redirectOperator, "sourceFd": fdSelector,
"occurrence"?: occurrenceSelector } }`. An allow `match.paths` and a profile `pathSources`
MUST NOT use that redirect arm.

## 6.8 Reusable redirect policies

`redirectPolicies` is a top-level map of named, FLAT redirect-policy bundles. Each bundle is a
`RedirectPolicy`: redirect-structure coverage (`redirects`: `{"none": true}` or
`{"all": [RedirectEntry, ...]}`) and redirect-target lexical path coverage (`paths`) as one
reusable unit. Named policies neither reference nor inherit other named policies, so cycles
cannot be expressed. Redirect-entry operators are the closed catalog `<`, `>`, `>>`, `>&`,
`<&`; input/truncate/append entries carry `literalPath` targets and duplication entries carry
`fd` targets (07 §7.5). Bundle path entries MUST select redirect coordinates.

- `defaults.redirectPolicy` is REQUIRED and names the policy initially effective for every
  profile and allow rule (§6.2).
- A profile or allow rule MAY set `redirectPolicy` to an override:

| Mode | Result |
|---|---|
| `inherit` | Keeps the current effective policy unchanged; carries no named or inline additions. |
| `extend` | Adds the named and/or inline entries to the current effective set (set union). |
| `replace` | Discards the inherited permissive entries; the effective set is only the named and/or inline entries. |

- `extend` and `replace` MUST carry at least one named policy or an inline bundle; an inline
  bundle always contains both the redirect and the redirect-target path coverage forms.
- Resolution is structural, not list-ordered: config default → profile override → allow-rule
  override. The checker expands named bundles, canonicalizes entries, and deduplicates the
  resulting sets before evaluation. Reordering policy entries, named references, inline
  additions, rules, or profiles MUST NOT change meaning.
- Redirect policy entries provide redirect coverage only. They never emit a vote and cannot
  rescue a command that fails another allow dimension. Their expanded form is part of the
  allow coverage proof (§6.7); an uncovered redirect means the allow emits no vote.
- Ask and deny ordinary matchers MAY inspect `match.redirects` and any exact path coordinate,
  including a redirect coordinate.

## 6.9 Semantic validation (closed catalogs, fail-closed)

The draft-2020-12 JSON Schema rejects unknown keys, wrong types, local union/composition
shapes, selector cardinality violations, and action-sensitive rule shapes. Semantic validation
proves relationships JSON Schema cannot express across declarations:

- `version` MUST be `2`; `defaults.action` MUST be `"ask"`; `defaults.message` and rule
  `message` MUST be ≤ 512 chars; profile/rule/hint ids MUST be 1–128 chars; profile and rule
  ids MUST be unique.
- Caps: profiles count ≤ `limits.profiles`; total rules ≤ `limits.rules` (also enforced per
  profile); the raw file MUST be ≤ `limits.configBytes` bytes.
- Cross-profile closure: every `executables` alias MUST belong to exactly one profile;
  multi-spelling lists MUST equal one lexical alias catalog entry.
- Options: canonical ids 1–64 chars, arity 0–4, aliases 1–16 per option (each 1–32 chars) and
  unique inside the profile; analyzer/profile combinations MUST occur in the versioned
  compatibility table.
- `pathSources` MUST carry at least one selector dimension per entry, MUST NOT select redirect
  coordinates, and MUST be within 64 entries.
- Overrides and the default reference MUST resolve against `redirectPolicies`; `inherit` MUST
  carry no additions; `extend`/`replace` MUST carry at least one; inline bundles MUST validate as
  bundles; redirect entries MUST pair operator and target kind; redirect-policy path entries
  MUST select redirect coordinates; path policies select exactly one of
  `exact`/`within`/`outside` with normalized absolute lexical paths.
- Allow rules MUST satisfy §6.7 exactly. The schema requires every allow dimension and rejects
  ordinary-only fields; semantic validation checks a coverage entry against the referenced
  option's arity, rejects differing entries for the same canonical option ID, and resolves all
  catalog and profile references.
- Regex patterns MUST compile under the bounded `re2-v1` dialect and meet the UTF-8 byte cap;
  typed bounds MUST have `min <= max`; no selector performs type coercion.
- Ask/deny rules MUST satisfy the ordinary-shape exclusions of §6.6; rule-level
  `redirectPolicy` overrides are allow-only.
- Fact references MUST exist in the closed fact catalog of the profile's declared analyzer;
  `nestedParts.profile` MUST name a declared profile id.
- `fallbackHints` MUST be ≤ 64 per profile, with unique hint ids and ordinary (ask/deny)
  match shapes.

Bad JSONC, unknown keys, duplicate aliases, unresolved references, incompatible analyzers, or
failed semantic validation make the config invalid. The checker uses its established config
failure behavior (exit 2, no stdout; 02 §2.4) rather than widening a verdict.

## 6.10 Checker CLI

- `shell-warden [--config FILE]` — letter on stdin (02 §2.2), v2 verdict on stdout (02 §2.7);
  the only mode; exit codes per 02 §2.4.
- Config default path: `$XDG_CONFIG_HOME/shell-warden/config.jsonc` (§6.1).
- Implementation language: Rust (ADR-0015); repository `shell-warden`.

## 6.11 Golden requirement

Every shipped example config MUST be covered by the golden suite (10 §10.2); every rule in it
MUST have at least one positive and one negative case.

## 6.12 Contract examples

The complete minimal configuration fixture is
`schemas/fixtures/shell-warden.config.v2/valid/Config/minimal.json`. Definition-scoped fixtures
under the same tree exercise every selector arm without pretending that fragments are complete
configurations. The following positive-arity option declaration is one `options` map value:

```json
{ "aliases": ["--rename"], "arity": 2, "inline": false }
```

Its corresponding `options.allowed` entry is:

```json
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

These are schema-position fragments, not complete configurations. The complete fixture uses the
same shapes in their documented positions. Nested implementation-enum wrappers,
`values: { "none": ... }`, and `values.each` arrays are invalid v2 input.
