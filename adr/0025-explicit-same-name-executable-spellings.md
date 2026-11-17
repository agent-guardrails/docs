# 0025 — Exact executable lists with same-name installation paths

Status: Accepted
Date: 2026-11-17
Tracking: https://github.com/agent-guardrails/docs/issues/46
Origin: https://github.com/agent-guardrails/shell-warden/issues/71
Design: https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-executable-spellings.md
Supersedes 0017 only for the multi-spelling catalog restriction in its adopted
configuration design. Its schema-first decision and other configuration rules remain.

## Context and problem

Agents use both command names and explicit installation paths. The checker
already selects profiles by exact membership in `executables`, but its catalog
check rejects a bare name and an absolute path in one profile. Duplicated
profiles increase policy maintenance; general basename matching would instead
authorize unlisted installations.

## Decision drivers

- Explicit enrollment of each spelling without duplicated policy.
- One execution model, accepting breakage where it removes real complexity.
- No filesystem, environment, PATH, or network lookup during command evaluation.
- The same typed analysis for enrolled spellings, including nested commands.

## Considered options

1. Bare-name guidance or generated duplicate profiles: workarounds, not the
   selected authoring model.
2. Global/per-profile basename fallback or trusted-directory matching: rejected;
   they implicitly enroll paths or introduce another matching mechanism.
3. Remove the existing alias groups: rejected; breaking these small validation
   tables does not simplify execution.
4. Validate basename sets and retain exact full-spelling selection: selected.

## Decision

Every profile's `executables` contains 1–8 explicit bare names or normalized
absolute paths. The set of distinct, case-sensitive basenames is either a
singleton or exactly one versioned alias-catalog group. Keep the `node`/`nodejs`
and `python`/`python3` groups. They are data in one validation predicate, not
legacy execution modes.

Selection uses the complete decoded head token. A basename supplies semantic
dispatch, never permission to use an unlisted path. Ownership remains unique
by full spelling across assembled configurations. There is no flag, implicit
path expansion, or automatic conversion.

Special analyzers and external wrappers consume the derived basename.
Structural extraction may precede selection; it never grants a parent profile.
Every executable wrapper remains a participating part requiring its own exact
profile and complete coverage; child permission cannot authorize its parent.
The modeled `export` builtin remains bare-only, not a filesystem alias.
Original source is retained; `raw` predicates remain spelling-sensitive.

## Consequences and delivery

Adding a spelling is an explicit policy change, not proof of binary identity.
Raw predicates need deliberate author review when the spelling set changes.
Previously transparent wrappers can now ask until parent profiles exist.
Relative/irregular configured spellings and incompatible analyzer bindings
become validation errors; no compatibility mode preserves them.

This is an accepted design direction, not a shipped contract. Deliver schema,
normative specs, grammar snapshot, fixtures, and engine changes together under
one revised v2 semantic contract. No new config mode or protocol envelope is
needed. Breaking changes receive release notes, not a second implementation.
Existing accepted ADR files remain immutable.
