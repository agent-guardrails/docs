# agent-skills: Catalog Contract

Status: v1. This contract describes the public `agent-guardrails/agent-skills` repository and its OpenCode v2 HTTP catalog. Design context is in [the repository design](../../design/agent-skills-repository.md). The repository decision remains [ADR-0021](../../adr/0021-public-agent-skills-repository.md). Implementation is tracked by [agent-skills issue 2](https://github.com/agent-guardrails/agent-skills/issues/2) and this document by [docs issue 35](https://github.com/agent-guardrails/docs/issues/35).

The terms MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described by RFC 2119.

## 1. Scope

`agent-skills` MUST publish portable, independently installable skill packages beneath `skills/`. The P0 catalog MUST contain these six packages:

- `ast-grep`
- `coding-agent-sessions`
- `debugging`
- `git-master`
- `lsp-setup`
- `review-work`

The package name MUST use lowercase kebab-case: one or more lowercase ASCII letters or digits, with optional single hyphens between nonempty segments. A package name MUST match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

This contract defines the catalog and package distribution surface. It does not define a harness-specific instruction format beyond the required package files.

## 2. Skill packages

Each package MUST be a real directory at `skills/<name>/`. It MUST contain these regular, non-symbolic-link files:

- `SKILL.md`
- `LICENSE.md`
- `NOTICE.md`

Every distributed package file MUST be a regular file. A package, required file, nested directory, or nested file MUST NOT be a symbolic link. A package MAY contain additional files when they are listed in its catalog entry.

`LICENSE.md` is authoritative for that package's license. Copied or adapted content MUST preserve applicable license and copyright notices. Adapted content MUST identify its source revision and source path in `NOTICE.md` and MUST include a prominent modification statement. Content derived from SUL-1.0 material MUST remain free and non-commercial under those terms. A package MAY use MIT only when its own source and license allow it.

## 3. Catalog location and retrieval

An OpenCode v2 catalog base URL MUST identify the `skills/` directory and end with `/`. For a base URL `<base>`, the index URL is `<base>index.json`. For an entry with `name` and a listed `file`, its file URL is `<base><name>/<file>`.

OpenCode MUST fetch the index before downloading package files. Every package file URL MUST be resolved as a safe relative path under the configured base URL and MUST remain on that base URL's origin. Catalog retrieval MUST NOT follow a path outside the base directory or fetch a file from another origin.

OpenCode MUST refresh an installed catalog skill when its `version` value changes in a newly fetched index. An unchanged version identifies unchanged package content for refresh purposes.

The catalog path is separate from the `npx skills` path. The repository MUST continue to support selected-skill installation through `npx skills add agent-guardrails/agent-skills --skill <name> -a <agent>` and its normal check, update, and remove commands. OpenCode catalog retrieval MUST NOT replace or redefine that installation path.

## 4. Index document

`skills/index.json` MUST conform to [agent-skills-catalog.v1.schema.json](../../schemas/agent-skills-catalog.v1.schema.json). Its root object MUST contain only a `skills` array. Each entry MUST contain only `name`, `version`, and `files`.

The `skills` array MUST contain each published package exactly once. Each entry name MUST match an existing package directory. The P0 index MUST include every package named in section 1.

`files` MUST be the complete inventory of distributed files for its package. It MUST include `SKILL.md`, `LICENSE.md`, and `NOTICE.md`, contain no duplicates, and be sorted in ascending byte order by relative path. Every listed path MUST identify a real regular file inside the package. Every real file inside a package MUST appear in `files`.

Each file path MUST be relative to its package and use `/` separators. It MUST NOT be empty, absolute, include `.` or `..` segments, contain a backslash, or include a query or fragment delimiter. Every segment MUST match `^[A-Za-z0-9._-]+$`.

## 5. Content-derived versions

Each `version` MUST match `^sha256:[0-9a-f]{64}$`. The digest input is each package file in the entry's sorted `files` order. For each file, the producer appends the decimal byte length of the UTF-8 relative-path byte sequence, a colon, the path bytes, the decimal byte length of the exact file bytes, a colon, and the exact file bytes. It then prefixes the lowercase SHA-256 hexadecimal digest with `sha256:`.

For example, the per-file hash input is equivalent to:

```text
<path-byte-length>:<path-bytes><file-byte-length>:<file-bytes>
```

Adding, removing, renaming, or changing the exact bytes of any package file MUST change that package's version and catalog entry. A validator MUST reject a version that does not match the current complete package inventory and content.

## 6. Validation

A repository validator MUST reject a missing, malformed, or symbolic-link `skills/index.json`. It MUST reject duplicate package entries, package directories absent from the index, index entries without matching package directories, nonportable names, unsafe file paths, duplicate or unsorted file lists, missing files, non-regular files, symbolic links, incomplete file inventories, and stale content-derived versions.

Schema validation checks the JSON structure and local field formats. Repository validation performs the cross-file checks that JSON Schema cannot express, including package existence, sorted order, inventory completeness, symbolic-link rejection, and digest equality.
