# Design: public `agent-skills` repository

v0.2 · 2026-11-12 · Status: ready for implementation

Implementation: [`agent-guardrails/agent-skills`](https://github.com/agent-guardrails/agent-skills). Parent implementation work: [agent-skills issue 2](https://github.com/agent-guardrails/agent-skills/issues/2). Documentation work: [docs issue 35](https://github.com/agent-guardrails/docs/issues/35). Architectural decision: [ADR-0021](../adr/0021-public-agent-skills-repository.md).

## 1. Purpose and boundaries

`agent-skills` is a repository-managed pack of portable Agent Skills. It provides a reviewable, versioned home for organization skills without making one harness configuration the source of truth.

The repository is public and distributes the pack free of charge for non-commercial use. Every copied or adapted skill carries its applicable license terms, preserved notices, provenance, and a prominent modification statement.

The pack does not provide an agent runtime, a browser workflow, UI or visual QA, frontend guidance, or data-processing guidance. Skills use each supported harness's normal skill mechanism and remain useful without an OMO runtime or OpenCode-specific contract.

## 2. Repository shape and distribution

Each skill is an independently selectable directory under `skills/<name>/`. The initial P0 catalog contains `ast-grep`, `coding-agent-sessions`, `debugging`, `git-master`, `lsp-setup`, and `review-work`.

Each package contains `SKILL.md`, `LICENSE.md`, and `NOTICE.md`, plus any package-specific references or scripts. The package directory is authoritative for its license and provenance. Harness adapters may live under `references/harnesses/`, while the portable workflow stays separate from those adapters.

Two distribution paths serve different consumers:

- The `npx skills` path installs and updates a selected skill as a consumer copy. Users select a skill and target agent with `npx skills add agent-guardrails/agent-skills --skill <name> -a <agent>`, then use the normal `npx skills` check, update, and remove commands.
- The OpenCode v2 HTTP catalog path starts at a configured catalog base URL ending in `skills/`. OpenCode reads `index.json` at that base, then reads each package file at `<name>/<file>` from the same origin. The catalog supports remote loading without replacing the separate `npx` workflow.

The catalog index has a `skills` array. Each entry carries a lowercase kebab-case package name, a content-derived version, and the package's complete sorted list of relative files. Package versions use `sha256:<64 lowercase hex digits>` and change when a package file is added, removed, renamed, or edited. The digest covers sorted relative paths and each file's exact bytes.

Catalog paths stay relative and safe for same-origin fetching. They have no absolute paths, parent traversal, backslashes, query or fragment syntax, or symbolic links. The OpenCode catalog refreshes one installed skill when that skill's catalog version changes.

## 3. Source policy and provenance

New material belongs to this repository. Existing material is classified before it is copied:

| Source treatment | Policy |
|---|---|
| Upstream as-is | Preserve source text, copyright and license notices, SUL-1.0 terms, and provenance. Local changes are limited to packaging or clearly separated organization notes. |
| Adapted | Keep copyright and license notices, SUL-1.0 terms, and provenance; identify the source material; and add a prominent modification statement describing organization-specific changes. The adapted text does not present itself as an untouched upstream copy. |

The repository records provenance beside copied or adapted material in the form appropriate to the package layout. Notices remain with material when it is distributed or moved. Adapted SUL-1.0 material stays free and non-commercial under those terms. A skill can use MIT only when its own source and licensing permit that exception; the P0 `ast-grep` package retains its component-level MIT license.

## 4. P0 skills

### `ast-grep`

`ast-grep` searches and rewrites source code by syntax-tree shape.

### `coding-agent-sessions`

`coding-agent-sessions` finds and reconstructs bounded coding-agent session history.

### `debugging`

`debugging` guides evidence-driven runtime debugging and verification through the affected surface.

### `git-master`

`git-master` covers Git inspection, history work, and explicitly authorized mutations.

### `lsp-setup`

`lsp-setup` configures and verifies Language Server Protocol support.

### `review-work`

`review-work` reviews completed implementation with manual QA and an independent gate review.

## 5. Validation and release flow

Before release, maintainers check package placement, metadata, trigger wording, internal links, required notices, provenance, and stated scope. Validation also checks the catalog index, package names, required files, complete sorted inventories, safe regular-file targets, content-derived versions, and the absence of symbolic links.

The release flow is author change, review in `agent-skills`, package and catalog validation, release publication, then adoption through either the `npx skills` or OpenCode catalog path. Documentation and notices travel with the release.

## 6. Public-release controls

Every release checks that distribution remains free and non-commercial, copied terms and notices remain present, adapted skills carry prominent modification statements, provenance resolves to a pinned source revision, and installation documentation matches the released layout. A change to commercial distribution or incompatible licensing requires a new decision before release.
