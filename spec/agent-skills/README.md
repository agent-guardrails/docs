# agent-skills: Specification Set

Status: initial skeleton. Repository design is in
[`design/agent-skills-repository.md`](../../design/agent-skills-repository.md),
with the repository choice recorded in
[ADR-0017](../../adr/0017-public-agent-skills-repository.md).

`agent-skills` is planned as a public pack of portable Agent Skills in
`agent-guardrails/agent-skills`.

## Planned scope

- Standard Agent Skills directories and per-skill `SKILL.md` files.
- Initial adapted `debugging` and `review-work` skills.
- Conceptual installation and updates through `npx skills`.
- SUL-1.0 terms, notices, modification markers, and provenance for copied or
  adapted material.
- Validation and public, free, non-commercial releases.

## Boundary

This skeleton does not define a normative skill format, installation command,
or release contract. Those details remain in the design until implementation
establishes accepted behavior.
