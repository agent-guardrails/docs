# Repeatable shell-warden configuration

Status: implementation design; disjoint-profile assembly selected by the user.

Design tracking: https://github.com/agent-guardrails/docs/issues/39.
Implementation: https://github.com/agent-guardrails/shell-warden/issues/51.

## Goal and alternatives

Explicit `--config FILE` arguments assemble one policy from independently valid
v2 documents. This is policy modularization, not a project overlay or policy
intersection. New executable profiles intentionally extend the set of configured
commands; existing profiles cannot be replaced or extended.

Disjoint assembly preserves each profile's grammar and rules. Restrictive
overlays would need a new grammar for identifying safe changes to an existing
profile. Independent-policy intersection would change verdict evaluation and
evidence composition. Neither alternative is part of this change. Last-file-wins
merging is rejected because it can silently remove deny rules or widen coverage.

## Candidate contract

- Process arguments in their supplied order. With explicit files, do not read
  the default path. Without them, retain the existing XDG/HOME fallback.
- Expand `{env:NAME}` separately in each explicit path, require an absolute
  result, and canonicalize existing paths. A repeated canonical path, including
  a symlink alias, is an error. Distinct hard links remain distinct inputs.
- Parse JSONC with duplicate-key rejection, then validate each complete document
  independently using the existing v2 schema and semantic checks. Empty bytes,
  `{}`, and incomplete fragments are invalid. A complete policy with no profiles
  is valid. Cross-file references are not introduced.
- Every document has version 2. `defaults` objects must be equal after decoding,
  including the optional message and default redirect-policy name. Missing
  optional values and their decoded defaults have the existing meaning.
- Concatenate profiles in argument order. Duplicate profile IDs or executable
  spellings are errors even when their definitions are equal. Option aliases
  stay scoped to their profile. Rule IDs and fallback-hint IDs retain their
  existing profile-local uniqueness rules; they are never merged or replaced.
- Union named redirect policies. A shared name is accepted only when decoded
  definitions are equal; conflicting definitions are errors. No policy body is
  extended or replaced. List order remains significant in equality checks.
- For each limit, use the minimum of the effective values in all documents,
  where omitted fields retain the existing engine maxima. Limits remain
  positive and bounded by those maxima.
- Apply `configBytes` to the sum of original file bytes, including comments.
  Apply profile and rule count limits to the assembled policy, and evidence and
  diagnostic limits to the normal evaluation scope. Bound file reads by the
  engine's maximum configuration size before parsing.
- Validate the assembled policy again before returning it. All loading occurs
  before stdin consumption or verdict evaluation. Any path, parse, validation,
  conflict, or aggregate-budget failure exits 2 with empty stdout; no valid
  prefix becomes active.
- Per-file errors name their input path. Conflicts name both source paths and
  the conflicting field/identifier. Aggregate errors identify the input set.
- Add `--help` documenting repetition, no override precedence, default-path
  suppression, and atomic failure. Existing one-file usage remains supported.

No implicit discovery, trust-boundary change, runtime reload, new config field,
or wire-protocol change is introduced. The hook's configuration is unchanged.

## Verification

Loader and real-binary tests cover both argument orders; single/default paths;
explicit default suppression; identical and conflicting redirect-policy names;
default mismatches; duplicate profiles and executables; profile-local rule/hint
IDs; canonical duplicates, symlinks, and environment-expanded paths; missing,
invalid, empty, and incomplete later inputs; aggregate byte/profile/rule caps;
minimum evidence/diagnostic limits; independent reference validation; and no
stdout on configuration failure. Run the Rust suite, formatting, Clippy, docs
schema fixtures, and schema/grammar drift checks.

## Documentation delivery

Record the selected architecture in a new ADR. Update the configuration spec
and schema descriptions together; individual JSON documents keep their v2
shape. Synchronize documentation under a separate implementation ticket.
