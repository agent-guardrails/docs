# 06 — Checker Configuration: Command Profiles (v2)

Version 2.1 · 2026-11-04 · Checker configuration v2 (command profiles) accepted per
[docs#15](https://github.com/agent-guardrails/docs/issues/15)
([design/shell-warden-config-v2.md](../../design/shell-warden-config-v2.md)); the v2 profile
grammar supersedes the v1 stage grammar of ADR-0016 (retained as a non-normative appendix at
the end of this document for the v1→v2 migration reference).

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
  "version": 2,                        // REQUIRED, MUST be 2
  "defaults": {                        // §6.3 — all fields default
    "action": "ask",                   // MUST be "ask" (fail-closed; nothing else accepted)
    "message": "No approved command profile matched.",   // optional generic ask message, ≤ 512 chars
    "redirectPolicy": "safe-local-io"  // named policy in effect for every profile and allow rule
  },
  "limits": {                          // all fields optional; defaults below
    "configBytes": 262144,
    "profiles": 256,
    "rules": 4096,
    "evidenceItems": 1024,
    "diagnosticsBytes": 16384
  },
  "redirectPolicies": { /* §6.8 — named, flat, reusable bundles */ },
  "profiles": [ /* §6.3 — unordered; profile order MUST NOT change meaning */ ]
}
```

`defaults.redirectPolicy` is REQUIRED when any rule of any profile has `"action": "allow"`.
When it is omitted and no allow rule exists, the explicit name `no-redirects` (both coverage
dimensions `none`) is available implicitly; a named-policy reference inside any override still
requires a declared bundle.

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
  "redirectPolicy": { /* optional override, §6.8 */ },
  "analyzer": "generic-v1",            // optional closed analyzer id
  "rules": [ /* §6.4 */ ],
  "fallbackHints": [ /* optional non-voting messages for the bare default ask */ ]
}
```

- **Executable selection is lexical.** The checker selects the profile whose `executables`
  contain the part's head token; the part's head MUST be a resolvable literal token. The head
  token is evidence of selection and is NOT part of the positional arguments (08 §8.2).
- A singleton `executables` list is always valid. A multi-spelling list MUST equal one complete
  entry of the implementation-owned, versioned lexical alias catalog; the current entries are
  `["node", "nodejs"]` and `["python", "python3"]`. Such an entry asserts identical option
  grammar and analyzer behavior — it does NOT assert resolved binary identity. Unrelated
  executables MUST get separate profiles.
- **Option grammar.** `arity` 0 is a flag; arity 1–4 consumes that many following tokens as
  values, regardless of their shape. Aliases (1–16 per option, each 1–32 chars) are exactly as
  they appear in argv and MUST be unique inside the profile; two aliases of one canonical ID
  normalize to repeated canonical occurrences. The inline form `--alias=value` is valid only
  for a declared arity-1 option and only unless the option sets `"inline": false`.
- **Analyzer.** `analyzer` names one closed built-in: `generic-v1`, `sed-v1`, `export-v1`,
  `xargs-v1`. They are versioned evidence producers, never extension points, never verdict
  issuers, never policy loaders (§6.7, 08 §8.4). The closed compatibility table restricts
  `sed-v1` profiles to the canonical option IDs `inPlace`, `expression`, `file`; the other
  analyzers impose no canonical-ID table (their fact catalogs have modeled option grammars
  only via `sed-v1`).

## 6.4 Rule schema (v2)

```jsonc
{
  "id": "git/deny-force-push",               // REQUIRED, 1–128 chars, unique per profile
  "action": "deny",                          // REQUIRED, "allow" | "ask" | "deny"
  "message": "Push without force, or create a branch and open a pull request.",
                                             // ≤ 512 chars; SHOULD be present on deny/ask (07 §7.7);
                                             // ignored on allow
  "match": { /* REQUIRED, §6.6/§6.7 */ },
  "redirectPolicy": { /* OPTIONAL; allow rules only, §6.8 */ }
}
```

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
| occurrence selectors | `"all"` or a 1-based occurrence number, wherever a dimension names occurrences (`options`-less dimensions, redirect entries, nested parts). |

## 6.6 Action-sensitive `match`: ordinary predicates (ask/deny)

Multiple dimensions on one `match` MUST all hold (AND). A `match` with no dimensions matches
nothing for allow (invalid — §6.7) and is rejected for ask/deny when a present dimension is
empty.

| Dimension | Type (v2, wire names) | Ordinary meaning |
|---|---|---|
| `arguments` | `exact` / `prefix` (anchored sequences), `containsAny` | as §6.5; an explicit `remainder` is an allow-only form and MUST be rejected on ask/deny |
| `options` | `presentAll`, `presentAny`, `absentAll` (canonical ID lists), `values` (map ID → glob list) | presence tests over canonical IDs; `values` holds when any occurrence's value matches any listed glob; every referenced ID MUST be a declared profile option; `none: true` requires no option at all and excludes presence/value conditions (the `allowed` coverage form is allow-only) |
| `environment` | `none` \| `any` \| `all` of `EnvironmentTest` (name, exact `value`, `prefix`) | exactly one of `none`/`any`/`all`; `any` = ∃ assignment × ∃ test, `all` = ∀ assignment ∃ test; `prefix: true` requires the assignment to sit in the command prefix |
| `redirects` | `none` \| `any` \| `all` of `RedirectTest` (operator, `sourceFd`, `targetKind`) | exactly one of `none`/`any`/`all`; omitted test dimensions are unconstrained; `targetKind` distinguishes `literalPath` from `fd`; `redirects` is invalid on allow (§6.7) |
| `paths` | `none` \| `any` \| `all` of `PathEntry` (coordinate selector + exactly one of `exact`/`within`/`outside`) | predicates over the path coordinates the profile's `pathSources` produced; `within`/`outside` roots MUST be absolute lexical paths; redirect-coordinate `paths` on allow are invalid (§6.7) |
| `facts` | `none` \| `any` \| `all` of `FactTest` (analyzer, name, exact/glob `value`) | exactly one of `none`/`any`/`all`; every `name` MUST be in the closed fact catalog of the profile's analyzer, which MUST be declared |
| `nestedParts` | `none` \| `any` \| `all` of `NestedPartTest` (relation, executable, profile, analyzer, state, verdict, occurrence) | exactly one of `none`/`any`/`all`; `profile` MUST name a declared profile id; `state` ∈ `complete` \| `opaque` \| `invalid`; `verdict` ∈ `allow` \| `ask` \| `deny` |
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
  positional token is one of the listed literals or a resolvable path within an absolute
  lexical root). `containsAny` has no allow spelling.
- An explicit `options` policy: `{"none": true}`, or `{"allowed": [entry, ...]}`. Each entry
  references a declared canonical profile option and states `required` and `repeatable`;
  `required: true` + `repeatable: false` means exactly one occurrence. Every observed
  occurrence satisfies one entry by canonical ID; every consumed or inline value satisfies the
  entry's `values` selector — `{"each": [literal, ...]}` (REQUIRED for a positive-arity entry:
  every consumed value is one of the listed literals), or `{"none": true}` when none exist;
  a zero-arity entry MUST NOT carry a `values` selector. Unknown or unlisted options prevent
  the allow.
- An explicit `environment` policy: `{"none": true}` or `{"all": [entry, ...]}` — every
  assignment occurrence is covered by name, exact literal value, and prefix position.
- An effective redirect policy (§6.8) covers every redirect occurrence structurally — source
  FD (including the explicit `"default"` selector), operator, occurrence, and target kind —
  and every literal redirect target path through the bundle's redirect-coordinate path entries.
- An explicit non-redirect `paths` policy: `{"none": true}` or `{"all": [entry, ...]}` over
  the coordinates produced by `pathSources` or the analyzer's fact catalog — never over
  redirect coordinates. `exact` is literal equality on the recorded path text;
  `within`/`outside` are lexical component comparisons on cwd-joined, dot-dot-normalized
  paths (`/work/repo2` is NOT within `/work/repo`, 07 §7.6).
- An explicit `facts` policy: `{"none": true}` or `{"all": [entry, ...]}` — every emitted fact
  is covered by analyzer ID, fact name, and exact value. Facts are produced only by a declared
  analyzer; names are closed catalog references.
- An explicit `nestedParts` policy: `{"none": true}` or `{"all": [entry, ...]}` — every nested
  executable part is covered by relation, occurrence, profile, evidence state, and required
  reduced verdict.

A partial match, a first-or-last-only match, or an unselected repeated occurrence does not
qualify an allow. An allow rule MAY carry a `redirectPolicy` override; it is invalid on ask
and deny.

## 6.8 Reusable redirect policies

`redirectPolicies` is a top-level map of named, FLAT redirect-policy bundles. Each bundle is a
`RedirectPolicy`: redirect-structure coverage (`redirects`: `{"none": true}` or
`{"all": [RedirectEntry, ...]}`) and redirect-target lexical path coverage (`paths`) as one
reusable unit. Named policies neither reference nor inherit other named policies, so cycles
cannot be expressed. Redirect-entry operators are the closed catalog `<`, `>`, `>>`, `>&`,
`<&`; input/truncate/append entries carry `literalPath` targets and duplication entries carry
`fd` targets (07 §7.5). Bundle path entries MUST select redirect coordinates.

- `defaults.redirectPolicy` names the policy initially effective for every profile and allow
  rule (§6.2); it is REQUIRED when any allow rule exists.
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

JSON Schema rejects unknown keys and wrong shapes; semantic validation proves the
relationships JSON Schema cannot:

- `version` MUST be `2`; `defaults.action` MUST be `"ask"`; `defaults.message` and rule
  `message` MUST be ≤ 512 chars; profile/rule/hint ids MUST be 1–128 chars; profile and rule
  ids MUST be unique.
- Caps: profiles count ≤ `limits.profiles`; total rules ≤ `limits.rules` (also enforced per
  profile); the raw file MUST be ≤ `limits.configBytes` bytes.
- Cross-profile closure: every `executables` alias MUST belong to exactly one profile;
  multi-spelling lists MUST equal one lexical alias catalog entry.
- Options: canonical ids 1–64 chars, arity 0–4, aliases 1–16 per option (each 1–32 chars) and
  unique inside the profile; canonical ids of a `sed-v1` profile MUST be in the analyzer
  compatibility table.
- `pathSources` MUST carry at least one selector dimension per entry, MUST NOT select redirect
  coordinates, and MUST be within 64 entries.
- Overrides and the default reference MUST resolve against `redirectPolicies` (the implicit
  `no-redirects` bundle is valid only as `defaults.redirectPolicy`); `inherit` MUST carry no
  additions; `extend`/`replace` MUST carry at least one; inline bundles MUST validate as
  bundles; redirect entries MUST pair operator and target kind; redirect-policy path entries
  MUST select redirect coordinates; path policies select exactly one of
  `exact`/`within`/`outside` with absolute `within`/`outside` roots.
- Allow rules MUST satisfy §6.7 exactly (the shape list is enforced point by point);
  ask/deny rules MUST satisfy the ordinary-shape exclusions of §6.6; rule-level
  `redirectPolicy` overrides are allow-only.
- Fact references MUST exist in the closed fact catalog of the profile's declared analyzer;
  `nestedParts.profile` MUST name a declared profile id.
- `fallbackHints` MUST be ≤ 64 per profile, with unique hint ids and ordinary (ask/deny)
  match shapes.

Bad JSONC, unknown keys, duplicate aliases, unresolved references, incompatible analyzers, or
failed semantic validation make the config invalid. The checker uses its established config
failure behavior (exit 2, no stdout; 02 §2.4) rather than widening a verdict.

## 6.10 Checker CLI

- `shell-warden [--config FILE]` — letter on stdin (02 §2.2), verdict on stdout (02 §2.3);
  the only mode; exit codes per 02 §2.4.
- Config default path: `$XDG_CONFIG_HOME/shell-warden/config.jsonc` (§6.1).
- Implementation language: Rust (ADR-0015); repository `shell-warden`.

## 6.11 Golden requirement

Every shipped example config MUST be covered by the golden suite (10 §10.2); every rule in it
MUST have at least one positive and one negative case.

## 6.12 Worked example

The shipped example `examples/configs/shell-warden.example.jsonc` (also mirrored in the
accepted design draft) exercises exact positional shape, complete allow coverage, inherited /
extended / replaced redirect coverage, an option-value allow, and cross-profile isolation:

```jsonc
{
  "version": 2,
  "defaults": { "action": "ask", "message": "No approved command profile matched.",
                "redirectPolicy": "safe-local-io" },
  "redirectPolicies": {
    "safe-local-io": {
      "redirects": { "all": [ { "sourceFd": "default", "operator": ">", "occurrence": "all",
                                "target": { "kind": "literalPath" } } ] },
      "paths": { "all": [ { "coordinate": { "redirect": { "operator": ">", "sourceFd": "default",
                                                            "occurrence": "all" } },
                            "within": "/tmp/reports" } ] }
    }
  },
  "profiles": [ { "id": "git", "executables": ["git"],
      "options": { "force": { "aliases": ["--force", "-f"], "arity": 0 },
                   "dryRun": { "aliases": ["--dry-run", "-n"], "arity": 0 },
                   "oneline": { "aliases": ["--oneline"], "arity": 0 } },
      "analyzer": "generic-v1",
      "rules": [
        { "id": "git/deny-force-push", "action": "deny",
          "message": "Push without force, or create a branch and open a pull request.",
          "match": { "arguments": { "prefix": ["push"] }, "options": { "presentAny": ["force"] } } },
        { "id": "git/allow-status", "action": "allow",
          "match": { "classification": "complete", "arguments": { "exact": ["status"] },
                     "options": { "none": true }, "environment": { "none": true },
                     "paths": { "none": true }, "facts": { "none": true },
                     "nestedParts": { "none": true } } },
        { "id": "git/allow-status-append-report", "action": "allow",
          "redirectPolicy": { "mode": "extend", "inline": { /* ">>" under /var/tmp/git-reports */ } },
          "match": { "classification": "complete", "arguments": { "exact": ["status"] },
                     "options": { "none": true }, "environment": { "none": true },
                     "paths": { "none": true }, "facts": { "none": true },
                     "nestedParts": { "none": true } } },
        { "id": "git/allow-log-oneline", "action": "allow",
          "redirectPolicy": { "mode": "replace", "policies": ["no-redirects"] },
          "match": { "classification": "complete", "arguments": { "exact": ["log"] },
                     "options": { "allowed": [ { "option": "oneline", "required": true,
                                                  "repeatable": false } ] },
                     "environment": { "none": true }, "paths": { "none": true },
                     "facts": { "none": true }, "nestedParts": { "none": true } } }
      ] },
    { "id": "node-version", "executables": ["node"],
      "options": { "version": { "aliases": ["--version", "-V"], "arity": 0 } },
      "rules": [ { "id": "node-version/allow-bare-version", "action": "allow",
                   "match": { "classification": "complete", "arguments": { "exact": [] },
                              "options": { "allowed": [ { "option": "version", "required": true,
                                                          "repeatable": false } ] },
                              "environment": { "none": true }, "paths": { "none": true },
                              "facts": { "none": true }, "nestedParts": { "none": true } } } ] }
  ]
}
```

## Superseded v1 grammar (historical, non-normative — retained for the v1→v2 migration reference)

The v1 rules grammar (config schema `schemas/shell-warden.config.v1.schema.json`) was a flat
stage model derived from ADR-0016. It is retired and is NOT accepted by a v2 checker; its
shape was:

- Top level: `version: 1`, `defaults { action, message }`, `limits { configBytes, stages,
  rules }`, and `stages[]` — a **stage** was a family scope with an `id`, a `scope.anyOf`
  condition group (a `scope.argv` token sequence or a `scope.pattern` raw glob), a `flags`
  arity table (flag name → 0–4), and `rules[]`.
- A rule carried a closed condition set — `argv` (token sequence with `{anyOf}`), `argValue`
  (positional globs), `pattern` (raw glob), `classification` (`static` | `opaque`), `flag`
  (`present`/`absent` map), `flagValue` (glob per flag) — plus `action` and `message`.
- Rules and scope conditions operated on the **stage tail**: the tokens remaining after the
  matched scope anchor and after flag tokens with their consumed arity values were removed.
- Verdict semantics: only stages whose scope matched were consulted; all matching rules voted;
  the first deny was final; a matched rule strictly refined by another matched rule was
  discarded ("precise over broad") before the most-restrictive reduction, so a narrow allow
  survived the broad allow it refined; an allow required the command to be fully parsed by
  that stage (unknown flags blocked allow only for the stage's own grammar, shared across a
  multi-binary stage).

The v2 profile grammar removed exactly those constructs (docs#15): shared stage scopes and
flag tables became per-executable profiles with declared options; scope anchoring and stage
tails became anchored positional matching on the part after the executable head; rule
refinement, first-only deny, and priorities became the fixed `allow < ask < deny` lattice with
every matching rule voting; flag-value and raw-pattern allows became typed-evidence coverage
proofs; and v1 `argv`/`argValue`/`flag`/`flagValue`/`pattern`/`classification` condition
operators were replaced by the closed `Match` dimensions of §6.6–§6.7. A user-config migration
guide can map intended v1 policies into profiles, named redirect policies, and coverage-aware
allow matchers; the checker itself offers no translation.
