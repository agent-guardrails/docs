# 0017: public repository-managed agent skills

* **Status:** Accepted (2026-11-04)
* **Deciders:** agent-guardrails maintainers
* **Related:** [design: public `agent-skills` repository](../design/agent-skills-repository.md); [parent implementation issue](https://github.com/agent-guardrails/.github/issues/23); [documentation issue](https://github.com/agent-guardrails/docs/issues/18)

## Context and Problem Statement

The organization needs a maintained home for portable Agent Skills.
The first skills are adapted public OMO material for debugging and review work.
They need a clear ownership boundary, repeatable installation and update path,
and preserved SUL-1.0 notices, license terms, modification markers, and
provenance. The pack is intended for free, non-commercial public distribution.

## Decision Drivers

- Skills need versioned, reviewable source independent of each developer's
  global OpenCode configuration.
- The pack must follow the Agent Skills format and avoid requiring any one
  agent harness or orchestration runtime.
- Adapted material needs durable SUL-1.0 notice and provenance handling.
- Public distribution must remain free and non-commercial and preserve all
  required license and copyright notices.

## Considered Options

1. **Repository-managed skill pack** in a public
   [`agent-guardrails/agent-skills`](https://github.com/agent-guardrails/agent-skills)
   repository. Skills use standard Agent Skills directories and are installed
   and updated through `npx skills` for supported harnesses.
2. **Edit global OpenCode configuration directly.** This makes local setup the
   source of truth, impedes review and versioning, and gives no durable home to
   notices or provenance.
3. **Create a harness-specific OpenCode skill pack.** This hard-codes one
   consumer's agent names and tool contracts into workflows that can otherwise
   remain portable.
4. **Adopt the full OMO runtime.** This imports runtime and orchestration
   assumptions beyond the need for standalone skills.

## Decision Outcome

Choose option 1.

Create `agent-guardrails/agent-skills` as a public repository-managed pack of
portable Agent Skills. The initial pack contains adapted
`debugging` and `review-work` skills. It uses the standard directory layout,
records source treatment and provenance, preserves SUL-1.0 terms and notices,
marks modified copies prominently, and documents installation and updates
through `npx skills`. One repository contains multiple skill directories;
consumers may install the whole pack or select one skill.

The debugging skill uses hypothesis-driven investigation and may optionally
delegate research or review. The review-work skill uses native `research` and
`review` agents for evidence-based review, while OpenCode's built-in `explore`
agent remains for local codebase search. Review-work covers CLI, API, test, and
build evidence, and excludes UI and visual QA.

## Consequences

- (+) Skills have one reviewable, versioned source and a clear release path.
- (+) Standalone use remains possible without a required OMO runtime,
`load_skills`, team mode, or harness-specific agent names.
- (+) SUL-1.0 notices and provenance can be reviewed with the adapted content.
- (-) Maintainers must validate metadata, installation behavior, notices, and
  provenance before each release.
- (-) Public distribution requires continuing license, notice, modification,
  and non-commercial-use review.

## Follow-up

Implementation begins after the design links are added to
[agent-guardrails/.github issue 23](https://github.com/agent-guardrails/.github/issues/23).
Release checks must continue to assess content, provenance, ownership,
non-commercial distribution, support, installation documentation, and license
notices.
