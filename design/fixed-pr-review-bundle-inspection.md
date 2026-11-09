# Design: Fixed PR review bundle inspection

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/docs/issues/27
Implementation ticket: https://github.com/agent-guardrails/.github/issues/35
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0019-fixed-evidence-bundle-inspection.md
Implementation repository: https://github.com/agent-guardrails/.github

## Purpose

Offline reviewers need focused access to verified evidence without reconstructing
their own parsers or gaining arbitrary file access. This design adds one bounded,
read-only inspection interface to the existing review workflow. It does not change
the evidence format, collection behavior, publication boundary, or versioned
schemas.

The trusted tooling exposes four fixed launchers:

```text
pr-review-sync --repo OWNER/REPO --pr NUMBER --worktree PATH [--head EXPECTED_SHA]
pr-review-collect --repo OWNER/REPO --pr NUMBER --worktree PATH --out PATH
pr-review-inspect --bundle PATH --view VIEW [view-specific flags]
pr-review-publish --bundle PATH --findings PATH [--confirm]
```

`pr-review-inspect` belongs between collection and offline review. Its later
implementation is a thin launcher plus `pr-review/inspect.mjs`, sharing
`verifyBundle()` with publication. It has no package dependencies.

## Scope and trust boundary

The inspector accepts a canonical absolute bundle path and one fixed view. It
resolves and validates the path before use, calls `verifyBundle()` before decoding
any payload, and reads only artifact bytes returned by that successful
verification. It never decodes an unchecked artifact, trusts an unlisted path, or
accepts an artifact path from the caller.

The inspector is read-only. It creates no files, changes no bundle content, starts
no subprocess, accesses no network, and executes no repository, bundle, CI, or
reviewed code. A verified bundle remains immutable. The command writes one JSON
success or failure record to stdout, diagnostics to stderr, and exits nonzero on
failure.

Every success record includes `contractVersion: 1`, repository, PR number, base
SHA, head SHA, `bundlePath`, and `view`. Failures use the workflow's stable codes,
including `invalid-input`, `unsafe-path`, `bundle-invalid`, `hash-mismatch`, and
`local-io-failure`. No success or failure record includes raw credentials.

The command is not a generic artifact reader. It has no `--artifact` option, query
language, arbitrary file path, raw bundle dump, compatibility alias, or write
mode. Reviewers must not replace it with inline Node or Python, heredocs, `jq`,
or `cat`, `grep`, `sed`, or `awk` parsing. They must not dump raw CI logs or run
reviewed code during review.

## Views and arguments

`--view` is required and accepts only `pr`, `files`, `diff`, `ci`, `discussion`,
or `manifest`. A flag for one view is invalid for every other view.

| View | Required and optional flags | Projection |
|---|---|---|
| `pr` | `--body-offset N`, `--body-limit N` optional | PR contract: URL, title, author, state, labels, base and head refs and SHAs, and a bounded body preview. |
| `files` | `--offset N`, `--limit N` optional | Changed-file metadata: path, status, and prior path when present. |
| `diff` | `--path PATH` required; `--offset N`, `--limit N` optional | The requested safe changed-file path's structured patch: old and new paths, change status, text and binary availability, and ordered hunk and line records. Binary and metadata-only changes return an empty bounded line page instead of raw bytes. |
| `ci` | `--offset N`, `--limit N` optional | Normalized check and CI-run summary: identity, name, state, conclusion, URLs, evidence state, and log availability. Raw log text is excluded. |
| `discussion` | `--offset N`, `--limit N` optional | Reviews, review comments, and issue comments as normalized ordered context records with bounded text previews. |
| `manifest` | No view-specific flags | Provenance, evidence completeness, selected CI identity, artifact paths, byte counts, hashes, and manifest self-digest. |

`--path` is a repository path from verified changed-file metadata. It is never a
bundle-member path. It may name a changed path on either side of a rename or copy.
The inspector rejects a path that is absent, unsafe, or cannot be uniquely matched
to a path-scoped patch.

## Bounds and continuation

All limits are exact implementation limits. Collection views, `files`, `ci`, and
`discussion`, use an item `offset` starting at zero. Their default `limit` is 20
items and their maximum is 100 items. A response includes `returned`, `total`, and
`nextOffset`; `nextOffset` is the next item index or `null` when no further item
exists.

`diff` uses a zero-based patch-line `offset`. Its default `limit` is 200 lines and
its maximum is 1,000 lines. The response includes the total selected patch-line
count and `nextOffset` using the same rule. Each returned line carries its hunk
identity, kind, and old or new line number when that side exists, so consumers do
not parse patch text themselves.

`pr` uses zero-based Unicode code-point `bodyOffset` and `bodyLimit`. The default
body limit is 16,384 code points and the maximum is 65,536 code points. Its response
includes `bodyTotal`, `nextBodyOffset`, and the selected body text. A text preview
in `discussion` is at most 16,384 Unicode code points. The inspector reports
truncation and the next offset rather than silently cutting text. Text offsets,
limits, totals, and continuation offsets use Unicode code points and never split a
surrogate pair.

Credential redaction runs over complete evidence values before item or text
pagination, so a page boundary cannot expose part of a recognized secret. Diff
inspection scans and validates the complete patch but retains structured records
only for the requested line page; memory remains bounded by the verified patch
bytes plus the requested page rather than total patch-line count.

The complete UTF-8 encoding of any stdout JSON record is at most 1,048,576 bytes,
including JSON syntax. If the selected projection cannot fit within that limit,
the command fails with `output-too-large`; it does not widen truncation, omit
identity fields, or emit partial JSON.

## Expected reviewer flow

1. Run sync and collect from the trusted tooling checkout.
2. Run `pr-review-inspect --bundle PATH --view pr` before inspecting source.
3. Use `files` and path-scoped `diff` for source evidence, `ci` for normalized
   verification context, and `discussion` for review context.
4. Use `manifest` when validating provenance or evidence completeness.
5. Produce separate schema-valid findings. Do not modify the bundle.

The schemas `schemas/pr-review-bundle.v1.schema.json` and
`schemas/pr-review-findings.v1.schema.json` remain version 1 and unchanged. The
inspector creates no persisted artifact, so it creates no new schema surface.

## Acceptance criteria

Tests cover canonical bundle-path validation, verification before every payload
decode, hash and manifest failures, immutable read-only behavior, and rejection of
unlisted or arbitrary artifacts. They cover each fixed view and its invalid flags,
zero-based continuation, item and text bounds, the 1,048,576-byte JSON cap,
structured path-scoped diff records, CI summaries without raw logs, and discussion
previews without reviewed-code execution. Diff fixtures include header-like hunk
content, no-newline markers, Git binary patches, quoted non-ASCII paths, and changed
paths beginning with dashes. Redaction tests cross text-page boundaries. Permission
tests prove that shell composition and substitution override fixed-launcher allows.
