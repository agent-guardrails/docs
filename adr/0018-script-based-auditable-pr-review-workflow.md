# 0018, Script-based auditable PR review workflow

* **Status:** Accepted (2026-11-08)
* **Deciders:** preved911
* **Related:** [docs issue 23](https://github.com/agent-guardrails/docs/issues/23), [implementation issue 25](https://github.com/agent-guardrails/.github/issues/25), [Auditable PR review workflow design](https://github.com/agent-guardrails/docs/blob/main/design/auditable-pr-review-workflow.md), [agent-guardrails/.github](https://github.com/agent-guardrails/.github)

## Context and Problem Statement

Pull request reviews need repeatable evidence, safe local inspection at one
commit, offline collaboration, and a deliberate boundary before any comment is
created. Duplicating this workflow in each product repository would produce
inconsistent trust decisions and maintenance burden. A generic GitHub client or
an MCP-first service would create a larger permission surface before the review
artifact and reviewer workflow are proven.

The organization already assigns shared AI pull request review logic to
https://github.com/agent-guardrails/.github. The MVP needs one small local CLI
contract that works for humans, automation, and agents without making one runtime
or transport the permanent center of the design.

## Decision Drivers

- One reusable source of review workflow behavior for organization repositories.
- Exact-head evidence and explicit write consent for auditable publication.
- Script contracts usable by local terminals, CI, and offline agents.
- Small credential and mutation surface.
- A future MCP transport without a competing workflow contract.
- Node.js standard-library implementation with no Python dependency for this
  feature.

## Considered Options

1. **Agent skills as the primary workflow.** Rejected. Skills can guide an
   agent, but they do not provide a durable, independently testable artifact
   format or a common permission boundary for humans and automation.
2. **Product-local tooling in every repository.** Rejected. It duplicates
   security-sensitive review behavior and lets contracts drift across projects.
3. **Dynamic command chains assembled by callers.** Rejected. Caller-owned
   sequences make exact-head capture, evidence hashing, redaction, and
   stale-head publication checks optional and hard to audit.
4. **MCP-first service.** Rejected for the MVP. It adds transport, deployment,
   session, and credential concerns before the core artifact and publication
   contract is stable.
5. **Reusable fixed scripts in `.github`, with MCP deferred as an optional
   transport.** Accepted.

## Decision Outcome

Option 5.

https://github.com/agent-guardrails/.github will host reusable Node.js
standard-library tooling with three stable entry points:

```text
pr-review-sync
pr-review-collect
pr-review-publish
```

Those scripts define the MVP boundary. They use the fixed interfaces documented
by the design: explicit repository and PR identifiers, one caller-selected
worktree, one caller-selected bundle output, and a findings/bundle publication
pair. They create or update a clean exact-head worktree, collect a locally
generated pinned source diff plus remote-only evidence, and publish only a
previewed, confirmed, stale-head-checked `COMMENT` review with review comments.
Read collection and remote publication remain separate operations with separate
permissions.

The design, normative specification, and versioned bundle and findings schemas
define the shared contract. They cover content hashes, safe paths, finding-ID
deduplication, bounded subprocess and artifact handling, and failure behavior.
Scripts invoke external tools through argv arrays without a shell and never
execute evidence or repository content.

An MCP transport may be added after the script contracts are proven. It will
preserve the same entry-point behavior and artifact contracts rather than
creating an alternate collection or publication path.

## Consequences

- (+) Shared review behavior lives once in the repository responsible for shared
  organization automation.
- (+) Evidence can be verified and reviewed offline without sharing credentials.
- (+) Preview, confirmation, and stale-head checks make remote writes explicit
  and repeatable.
- (+) The scripts remain useful outside an agent runtime and give a future MCP
  layer a narrow, tested backend contract.
- (−) Initial users need Git, GitHub CLI authentication, and Node.js available.
- (−) The MVP deliberately supports only pull request review evidence and
  review-comment publication, not general GitHub or CI automation.
- (−) A later MCP integration must preserve the stable script contract instead
  of redesigning it around transport-specific state.

## Specification and implementation impact

The implementation-ready design and the normative specification are maintained
under [docs issue 23](https://github.com/agent-guardrails/docs/issues/23). The
corresponding Node `.mjs` scripts and `node:test` coverage belong to
[implementation issue 25](https://github.com/agent-guardrails/.github/issues/25).
The bundle and findings schemas are present in this repository and change with
the normative contract. No Python, generic GitHub wrapper, MCP server, workflow
caller, rollout change, or product-local duplicate is part of this decision's
initial delivery.
