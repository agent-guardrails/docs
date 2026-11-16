# Exact executable spellings and installation paths

Status: selected implementation design; not yet the shipped normative contract.
Tracking: https://github.com/agent-guardrails/docs/issues/46
Originating discussion: https://github.com/agent-guardrails/shell-warden/issues/71
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0025-explicit-same-name-executable-spellings.md

## Goal and selected model

An operator lists the exact executable spellings a profile covers. Runtime
selection compares the complete decoded head against the list. It never selects
a profile merely because the basename matches.

Illustrative profile field:

```json
{
  "executables": ["tool", "/opt/tools/tool", "/home/user/.local/bin/tool"]
}
```

All three spellings can select that profile. `/tmp/tool`, `./tool`, and
`/opt/tools/../tools/tool` cannot. This is explicit spelling enrollment, not path
normalization, discovery, a command rewrite, or a binary-identity claim.

All entries have the same basename unless their distinct basename set equals
one implementation-owned alias group. Keep `node`/`nodejs` and
`python`/`python3`: these small tables do not introduce a second runtime model.
One validation predicate handles bare names, absolute paths, and existing groups;
one exact-match algorithm selects the profile.

There is no `ignorePath` switch, trusted-directory matching, compatibility
catalog, or ordinary-profile-only first mode. Built-in analyzer, wrapper, and
alias catalogs remain closed and versioned; none enrolls installation paths.

## Why this approach

Agent guidance to prefer bare names reduces variation but is not enforcement.
Generated singleton profiles avoid a runtime change but retain policy copies.
Unrestricted basename matching accepts paths the operator never enrolled.
Removing the existing two alias groups would break configurations without
simplifying runtime selection.

Use the existing list and a basename-set validation predicate instead.
Prefer breaking changes when they remove conflicting behavior, such as the
transparent-wrapper exception; do not break existing groups merely to remove
two rows of validation data.

## Executable-list validation

Validation uses decoded JSON strings, before any command is evaluated:

1. Retain the 1–8 entries, nonempty-list, and unique-spelling requirements.
2. Each entry is either a bare name without `/`, or a normalized absolute POSIX
   path. Bare `.` and `..`, relative paths, empty path components, trailing `/`,
   and `.`/`..` path components are invalid. `/` does not name an executable.
3. Each entry is at most 4096 UTF-8 bytes and contains no NUL or ASCII control
   characters. Spaces and other Unicode characters remain literal; there is no
   case folding or Unicode normalization. Length is also checked semantically.
4. An absolute entry's basename is its final component; a bare entry is its own
   basename. Collect distinct basenames as an order-independent set. Accept the
   set if it has one member or exactly equals a complete alias-catalog group;
   reject every other combination. No union of groups is accepted.
5. Bare entries are optional. A paths-only profile is valid. There is no separate
   configurable canonical name, and list order does not select one.
6. Each full spelling belongs to exactly one profile, including the assembled
   input of repeatable `--config`. Duplicate ownership fails even when the two
   definitions are equal. Independent profiles may share a basename if their
   complete spelling sets are disjoint.

No entry expands `~`, variables, or glob syntax. Characters such as `*` are
literal filename characters when otherwise valid, not an enrollment pattern.
Backslash is a POSIX filename character, not a Windows separator. These rules
do not inspect filesystem existence, symlinks, permissions, or `PATH`.

| `executables` | Validation |
| --- | --- |
| `["tool"]` | Valid |
| `["/opt/tools/tool"]` | Valid |
| `["tool", "/opt/tools/tool", "/home/user/bin/tool"]` | Valid |
| `["/opt/tools/tool", "/home/user/bin/tool"]` | Valid; no bare spelling enrolled |
| `["node", "nodejs"]` | Valid; existing catalog group |
| `["node", "/opt/tools/node", "/usr/bin/nodejs"]` | Valid; basename set is the catalog group |
| `["/opt/tools/python", "/usr/bin/python3"]` | Valid; paths only, known group |
| `["node", "python"]` | Invalid; unrelated names |
| `["tool", "/opt/tools/other"]` | Invalid; unknown different-name group |
| `["tool", "./tool"]` | Invalid; relative executable spelling |
| `["tool", "/opt//tools/tool"]` | Invalid; empty path component |
| `["tool", "/opt/tools/../tools/tool"]` | Invalid; dot component |
| `["tool", "/opt/tools/tool/"]` | Invalid; trailing separator |
| `["tool", "tool"]` | Invalid; duplicate |

The catalog asserts modeled grammar compatibility, not installed version or
binary equivalence. For example, it does not inspect which Python version a
user's `python` executable runs.

The profile ID remains an arbitrary identifier, not executable identity.
Cross-file assembly still does not extend an existing profile with another
file's spellings. To combine spellings, place their complete definition in one
profile in one explicit configuration file.

## One evaluation path

The scanner establishes shell structure and decoded tokens. Use one lexical
helper to derive a basename from a valid bare name or normalized absolute head.
That helper has no permission effect. The existing extraction-before-evaluation
pipeline can remain:

```text
original source and decoded head
        |
recursive structural extraction using the lexical basename
        |
retained parent and child executable parts
        |
exact full-spelling profile selection for each part
        |
profile option parsing + basename-dispatched analyzer facts/command parts
        |
complete coverage and deny > ask > allow
```

The basename is internal semantic metadata, not a new config field, permission
matcher, or replacement for the raw head. Known different-name aliases retain
their actual basename; catalog validation does not arbitrarily rewrite `nodejs`
to `node`.

Selection consumes a resolvable head. This change does not resolve a dynamic
head or convert opaque/invalid evidence to complete. An unselected head
contributes the existing default ask even when structural extraction recognizes
its wrapper syntax. Its independently discovered children still participate,
including a child's deny. This avoids introducing an extractor dependency on
the profile configuration while preventing basename recognition from granting
permission. Recursion and evidence budgets cover the complete graph.

The chosen executable is not rewritten before execution. `/opt/tools/tool`
stays `/opt/tools/tool`, including in original-text evidence and diagnostics.
Different spellings can intentionally select different disjoint profiles;
no basename-global ownership rule or profile precedence is introduced.

## Analyzers and wrappers

All recognized literal spellings use the same lexical basename helper. An
analyzer runs only for an exactly selected profile and does not compare the
raw head with a bare-name string. Compatibility is validated against every
basename in the profile, not just its first entry.

- `generic-v1` retains generic evidence production.
- `sed-v1` is compatible only with command name `sed`. Existing option-grammar
  checks remain; `/opt/tools/sed` produces the same modeled facts as enrolled
  `sed` with the same arguments.
- `xargs-v1` is compatible only with command name `xargs`. Its child extraction,
  relation assignment, and opacity rules use that name, never a second raw-head
  check. A new spelling does not make stdin-appended arguments determinate.
- `export-v1` models the shell builtin `export`. Its profile enrolls only the
  bare spelling `["export"]`. A path ending in `/export` is not that builtin;
  reject such a binding for command name `export`, rather than silently applying
  builtin facts or providing an alternative generic mode for it.

External wrapper names currently modeled by the parser (`bash`, `sh`, `sudo`,
`nohup`, `nice`, `timeout`, `env`, `xargs`) use this same lexical name helper.
Structural extraction does not need a selected profile, and choosing
`generic-v1` does not suppress wrapper interpretation. Both the parent and
children subsequently require exact selection; extraction itself grants nothing.

Every wrapper is retained as a participating executable part. Remove the
transparent/collapsed-parent exemption for bare and absolute spellings alike:

- The parent needs its own profile, argument and option coverage, environment
  and redirect coverage, and coverage for its emitted nested parts.
- Each child independently needs exact profile selection and its own coverage.
  Parent allow is not inherited by a child, or vice versa.
- A parent ask/deny, unknown option, unsupported wrapper form, opaque command
  operand, or evidence overflow cannot be hidden by a permitted child.
- Preserve the existing supported command-operand forms and relation names;
  expanding the grammar or simulating shell execution is outside this change.
  Wrapper-owned operands and observations remain on the parent even when they
  also produce children. Environment effects and nested evidence are not dropped.
- Special analyzer/profile incompatibility is a configuration error, not an
  empty-facts fallback. Typed predicate checks remain in force.

For example, `/tmp/sh -c 'tool --help'` is not allowed merely because `tool` is.
Both `sh -c 'tool --help'` and an explicitly enrolled `/bin/sh` variant now need
a configured shell parent and child coverage. This deliberately breaks earlier
transparent-wrapper behavior rather than preserving two enforcement models.

## Original-text predicates and evidence

`raw` remains a predicate over original part source. No canonicalized-raw field,
automatic pattern rewriting, or compatibility expansion is introduced.

Consequently, `raw: "tool dangerous *"` need not match
`/opt/tools/tool dangerous ...`, even when both heads select the same profile.
This is explicit spelling-sensitive policy, not a violation of deny dominance:
a nonmatching predicate emitted no deny.

Use typed argument/option predicates for an operation restriction that should
apply to every enrolled spelling. Keep raw predicates for intentionally
source-specific conditions. Adding a spelling requires review of raw ask/deny
conditions; it is not a claim that every existing predicate will match
identically. The implementation does not guess or rewrite that intent.

Conformance cases distinguish spelling-independent typed decisions from
intentionally spelling-sensitive raw decisions. Original tokens, spans, selected
profile IDs, and stable reasons remain bounded evidence. No new verdict
envelope or public semantic-name field is required.

## Breaking disposition

Keep the existing v2 document shape and replace its executable-list semantics
in the implementing release. One checker validates one rule set:

- Apply the basename-set predicate to every list. Existing bare-name catalog
  pairs pass this predicate naturally, without a legacy validation branch.
- Formerly accepted relative/irregular executable strings fail configuration
  validation; use normalized explicit spellings instead.
- Apply one participation rule to all wrapper spellings. Earlier child-only
  allows are not a compatibility mode.
- Tighten analyzer-name compatibility and the bare-only builtin rule uniformly,
  including singleton profiles.
- Do not add automatic migration, configuration-version fallback, feature flags,
  or silent conversion. Atomic validation failure keeps the existing exit-2,
  empty-stdout behavior.

No existing configuration gains additional executable spellings automatically.
Release notes describe manual policy updates and possibly stricter verdicts.
Previously invalid same-name path lists become intentionally supported; old
binaries reject those lists rather than emulating the new contract.

## Implementation and contract synchronization

This design is an intended revision. Until implementation lands, the shipped
normative specs and schema still describe earlier behavior. Deliver the
following as one coordinated implementation change:

| Surface | Required change |
| --- | --- |
| Config validation/DTO | Basename-set validation, lexical string bounds, unique ownership, analyzer compatibility; update catalog comments |
| Pipeline and extractor | Shared lexical basename helper; exact selection per part; retain every parent; preserve nested evidence and budgets without configuration-dependent extraction |
| Analyzers | Dispatch on validated command name; no silent fact loss for absolute spellings |
| Config schema and grammar snapshot | Publish lexical restrictions and semantic basename-group/builtin/compatibility checks together |
| Spec 06 | List validation, ownership, assembled-policy conflicts, bounds, diagnostics |
| Specs 07 and 08 | Distinguish structural dispatch from permission selection; wrapper participation and complete nested coverage |
| Spec 09 | Distinguish configured installation spellings from catalog-owned different-name groups in I15/T13; retain no I/O, exact enrollment and deny dominance |
| Spec 10 and fixtures | Validation, typed equivalence, negative paths, raw distinctions, wrappers, budgets and assembly |
| Examples and release notes | Declare wrapper parents, review raw guards and irregular paths; describe breaking changes |

Schema-first validation and the other decisions in ADR 0017 remain. Disjoint
configuration assembly in ADR 0024 remains; this change adds no per-file
override or cross-file profile extension. Redirect-target pattern work in
https://github.com/agent-guardrails/shell-warden/issues/72 is independent.

## Verification cases

1. Validate every accepted/rejected example above, paths-only groups, mixed case,
   literal spaces/Unicode, NUL/control characters, and UTF-8 length bounds.
2. Test decoded quoting, an unenrolled same-basename absolute path, a relative
   head, a dot-component equivalent, literal wildcard characters, and opaque
   expansion. None becomes an implicitly enrolled spelling.
3. Run identical argument/option/environment/redirect cases through every
   explicitly enrolled same-name spelling; typed rules and facts agree.
4. Test retained different-name groups and their path variants, a group union,
   unknown pairs, two disjoint profiles with the same basename, duplicates
   within/across profiles and files, reversed order, and atomic failure.
5. Test incompatible analyzer names and verify that every list member is checked.
6. Test `sed` facts for bare and absolute heads, `export` bare-only validation,
   and `xargs` children retaining opacity, relations, and coverage requirements.
7. Exercise every supported wrapper through bare and absolute spellings: missing
   parent profile, missing parent allow, parent deny, parent redirects/environment,
   unknown options, unsupported forms, missing child profile, child deny, nested
   wrappers, command substitutions, and depth/evidence limits.
8. Demonstrate a typed deny applying to every enrolled spelling and a raw
   predicate deliberately distinguishing original strings. Verify dominance
   among emitted votes; do not assert equivalence for raw conditions.
9. Verify diagnostic bounds and protocol validation without new wire fields;
   run engine suites, config fixtures, and schema/grammar drift gates.
