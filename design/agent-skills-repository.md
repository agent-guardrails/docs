# Design: public `agent-skills` repository

v0.1 · 2026-11-04 · Status: ready for implementation

Implementation: [`agent-guardrails/agent-skills`](https://github.com/agent-guardrails/agent-skills), public from its first commit. Parent implementation work: [agent-guardrails/.github issue 23](https://github.com/agent-guardrails/.github/issues/23). Documentation work: [agent-guardrails/docs issue 18](https://github.com/agent-guardrails/docs/issues/18). Architectural decision: [ADR-0017](../adr/0017-public-agent-skills-repository.md).

## 1. Purpose and boundaries

`agent-skills` is a repository-managed pack of portable Agent Skills. It
provides a reviewable, versioned home for organization skills without making
one harness configuration the source of truth.

The repository is public and distributes the pack free of charge for
non-commercial use. Every copied or adapted skill ships with its applicable
license terms, preserved notices, provenance, and a prominent modification
statement.

This repository does not provide an agent runtime, a browser workflow, UI or
visual QA, frontend guidance, or data-processing guidance. Skills run through
each supported harness's normal skill mechanism and stay usable without an OMO
runtime or OpenCode-specific contract.

## 2. Repository shape and installation

Each skill follows the standard Agent Skills directory form:

```text
skills/
  debugging/
    SKILL.md
  review-work/
    SKILL.md
```

One repository owns the pack. Skills remain independently selectable by name;
separate repositories are reserved for a future case with distinct ownership,
licensing, or release cadence.

Each skill directory is self-contained. It includes `SKILL.md`, the applicable
license terms, provenance, and a prominent modification notice when adapted.
Harness-specific examples may live under `references/harnesses/`; the core
workflow does not require those adapters.

Installation and updates are designed around the `npx skills` workflow. The
repository documents the conceptual install and update path for organization
users, but does not link users to repositories outside the organization. The
installed copy is a consumer artifact, not the editable source. Changes are
made in this repository, reviewed, released, then adopted by users through the
same update path.

## 3. Source policy and provenance

New material belongs to this repository. Existing material is classified before
it is copied:

| Source treatment | Policy |
|---|---|
| Upstream as-is | Preserve the source text, copyright and license notices, SUL-1.0 terms, and provenance record. Limit local changes to packaging or clearly separated organization notes. |
| Adapted | Keep the copyright and license notices, SUL-1.0 terms, and provenance record; identify the source material; and add a prominent modification statement describing organization-specific changes. The adapted text must not imply it is an untouched upstream copy. |

The repository records provenance beside copied or adapted material in the form
appropriate to the skill layout. Notices remain with the material when it is
distributed or moved. A missing provenance record blocks acceptance of copied
or adapted content.

## 4. Initial skills

### `debugging`

The initial adapted public OMO skill is `debugging`. Its portable core teaches a
hypothesis-driven workflow:

1. State several plausible causes before changing code.
2. Gather evidence that distinguishes them.
3. Confirm the root cause before applying the smallest fitting fix.
4. Add or update a regression check when the project has a suitable test path.
5. Verify the behavior through the relevant CLI, API, test, or build surface.

The skill may suggest targeted external research or independent review when
evidence is insufficient or the problem crosses a specialist boundary. Such
delegation is optional and described by role rather than a harness-specific
agent name.

### `review-work`

The initial adapted public OMO skill is `review-work`. It orchestrates an
independent code review using evidence from the repository's CLI, API, tests,
and build.
Its scope is implementation correctness, security-relevant behavior, regressions,
and evidence gaps. It explicitly excludes UI and visual QA.

The workflow names external-research and independent-review roles, not concrete
agents. Harness adapters may map those roles to available subagents; the skill
remains useful when a harness has only one agent. It does not require team mode
or any named runtime.

## 5. Validation and release flow

Before release, each changed skill is checked for valid directory placement,
complete metadata, clear trigger wording, internal link integrity, provenance
and SUL-1.0 notices where applicable, and consistency with its stated scope.
The maintainers also exercise the skill through OpenCode's normal loading path
and run any repository checks available for the pack.

The release flow is: author change, review in `agent-skills`, validate the
pack, publish a versioned release, then update consumers through the documented
`npx skills` path. Documentation and notices travel with the release.

## 6. Public-release controls

Every release verifies that distribution remains free and non-commercial,
copied terms and notices remain present, adapted skills carry prominent
modification statements, provenance resolves to a pinned source revision, and
installation documentation matches the released layout. A change to commercial
distribution or incompatible licensing requires a new decision before release.
