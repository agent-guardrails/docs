# opencode-skills: Specification Set

Status: initial skeleton. Repository design is in
[`design/opencode-skills-repository.md`](../../design/opencode-skills-repository.md),
with the repository choice recorded in
[ADR-0017](../../adr/0017-public-opencode-skills-repository.md).

`opencode-skills` is planned as a public pack of standalone OpenCode
v2-compatible skills in `agent-guardrails/opencode-skills`.

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
