# Design: Auditable PR review workflow

Status: accepted design direction
Ticket: https://github.com/agent-guardrails/.github/issues/25
Decision: https://github.com/agent-guardrails/docs/blob/main/adr/0018-script-based-auditable-pr-review-workflow.md
Implementation repository: https://github.com/agent-guardrails/.github

## Purpose

This design defines reusable, auditable local CLI tooling for reviewing GitHub
pull requests. It creates an exact-head worktree, collects a fixed immutable
evidence bundle, permits offline multi-agent analysis, and publishes only a
previewed and confirmed COMMENT review with inline review comments.

The initial implementation is Node.js standard-library code in
https://github.com/agent-guardrails/.github. It exposes exactly these interfaces:

```text
pr-review-sync --repo OWNER/REPO --pr NUMBER --worktree PATH [--head EXPECTED_SHA]
pr-review-collect --repo OWNER/REPO --pr NUMBER --worktree PATH --out PATH
pr-review-publish --bundle PATH --findings PATH [--confirm]
```

The arguments above are the complete MVP interfaces. This design does not add
PR URLs as input, inferred output paths, workspace roots, bundle roots, CI
selector flags, workflow callers, or rollout configuration.

This is a non-normative design, not the specification. The versioned schemas and
normative contract are tracked by [docs issue 23](https://github.com/agent-guardrails/docs/issues/23),
and implementation work by [implementation issue 25](https://github.com/agent-guardrails/.github/issues/25).

## Scope and non-goals

The workflow provides:

- Exact base and head revision capture for repeatable source inspection.
- A dedicated local worktree at a caller-supplied stable path.
- Local source diff evidence generated from pinned commits.
- Remote-only metadata, review, check, CI-run, and CI-log evidence.
- An immutable evidence bundle suitable for credential-free offline sharing.
- Versioned findings, preview, explicit confirmation, stale-head refusal, and
  stable finding-ID deduplication.

The workflow does not run tests, builds, package scripts, CI jobs, or untrusted
repository code. It does not approve, request changes, resolve review threads,
edit comments, merge, create issues, create issue comments, alter labels or
assignees, or make any GitHub mutation other than one COMMENT review and its
review comments during confirmed publication. It is not a generic GitHub API or
generic CI wrapper.

The MVP accepts only `OWNER/REPO` identifiers for repositories under
https://github.com/agent-guardrails. Inputs outside that organization fail before
git or GitHub access.

## Trust boundaries and execution safety

```text
trusted CLI arguments
       |
       v
pr-review-sync -----> explicit local dedicated worktree at exact head
       |
       v
pr-review-collect --> local base..head diff + remote-only evidence
       |
       v
immutable bundle --> offline reviewers and agents --> findings JSON
       |
       v
pr-review-publish --> preview --> --confirm --> COMMENT review only
```

The caller controls repository identifier, PR number, supplied paths, optional
expected SHA, and confirmation. Pull-request text, repository content, diffs,
remote API bodies, CI output, findings prose, and fork metadata are untrusted
data. The scripts store and display them as data only; they never execute,
source, import, or interpret them as commands.

Credentials come only from the authenticated GitHub CLI context or a documented
implementation environment mechanism. Credentials never appear in CLI arguments,
findings, bundles, manifests, output JSON, diagnostics, or test fixtures.
Persisted diagnostics redact recognized GitHub tokens, bearer tokens,
authorization headers, and configured credential values as `[REDACTED]`.

All subprocesses use `child_process.spawn` or `execFile` with argv arrays,
`shell: false`, an explicit working directory, and controlled output capture.
The implementation does not construct shell command strings, call `eval`, or
execute repository files. Git and `gh` are external prerequisites, not Node
package dependencies.

Paths supplied as `--worktree`, `--out`, `--bundle`, and `--findings` are
absolute, resolved, and validated before use. NUL paths, symlink escapes outside
an explicit caller path, and wrong file kinds fail. Bundle-member paths are
relative POSIX paths, never absolute, and never contain `.` or `..` segments.
Repository paths accept dot-leading components, spaces, and Unicode, but reject
traversal components, control characters, backslashes, and empty components.

Each subprocess has a 60-second deadline, a 16 MiB stdout limit, and a 4 MiB
stderr limit. Individual artifacts are limited to 8 MiB. The 64 MiB completed
bundle limit is cumulative across all evidence artifacts, including locally
generated payloads, downloaded CI logs, and `file-hashes.json`. Exceeding a
limit stops the operation without a completed bundle.

## Common behavior

The executable `.mjs` scripts write JSON success or failure records to stdout,
diagnostics to stderr, and return a nonzero status for failure. Every successful
record includes `contractVersion: 1`, repository, PR number, base SHA, head SHA,
and the principal caller-supplied path. Failures use stable codes including
`invalid-input`, `unsupported-repository`, `auth-required`, `not-found`,
`permission-denied`, `remote-failure`, `pagination-failure`, `unsafe-path`,
`worktree-conflict`, `worktree-dirty`, `head-mismatch`, `bundle-exists`,
`bundle-invalid`, `hash-mismatch`, `findings-invalid`, `stale-head`,
`confirmation-required`, and `local-io-failure`.

## `pr-review-sync`: exact revisions in an explicit worktree

`pr-review-sync --repo OWNER/REPO --pr NUMBER --worktree PATH [--head EXPECTED_SHA]`
resolves the PR's exact base SHA and head SHA through GitHub metadata. If
`--head` is present, the resolved head SHA equals `EXPECTED_SHA` or sync fails as
`head-mismatch`. The resolved base and head commits are the only remote git
revisions it fetches for this operation.

`--worktree` names one dedicated, stable path. Sync creates the worktree there
when absent, or safely updates the same managed worktree when present and clean.
It records repository, PR number, base SHA, head SHA, and contract version in an
atomic sidecar file adjacent to the worktree, named `<worktree>.pr-review.json`.
Management metadata never enters the reviewed tree or changes its clean status.
Sync verifies the resulting detached `HEAD` equals the resolved head SHA before
success.

For an existing path, sync first verifies its Git worktree registration and
adjacent sidecar match the supplied repository and PR, then verifies that the
worktree is clean. An untracked, modified, wrong-repository, wrong-PR, missing-
sidecar, or malformed managed worktree fails. A
clean managed worktree may move to the newly resolved exact head after the two
required revisions have been fetched. Sync never uses a path derived from SHA,
never changes the main checkout, never checks out a moving branch name, never
deletes a worktree automatically, and never runs tests.

Fork PRs use the recorded head repository and exact head SHA only to fetch the
needed head object. No fork branch configuration is checked out or trusted. A
missing head repository or an unfetchable required SHA fails rather than falling
back to a branch name.

Git subprocesses ignore system and global Git configuration, disable hooks and
attribute-driven text conversion, and use only the fixed `gh auth git-credential`
helper for private HTTPS fetch authentication. No credential from reviewed
repository content is loaded.

## `pr-review-collect`: verified worktree and immutable bundle

`pr-review-collect --repo OWNER/REPO --pr NUMBER --worktree PATH --out PATH`
requires the dedicated supplied worktree. It reads PR metadata, resolves current
base and head SHAs, verifies the Git worktree registration and adjacent sidecar
match repository and PR, verifies its detached `HEAD` equals the resolved head,
verifies it is clean, and verifies the required base and head commits exist
locally. A mismatch or dirty worktree fails; collection does not repair it.

A completed bundle is one immutable snapshot of the verified PR identity and
the evidence selected during that collection attempt. Collection never merges
prior evidence, reuses a prior payload as current evidence, or refreshes a
completed bundle in place. Reuse returns only a fully verified existing bundle.

The collector produces `diff.patch` locally from the pinned base and head commits
in that verified worktree. It neither obtains nor stores a source patch from a
remote API.
Remote APIs supply remote-only evidence: PR metadata, changed-file metadata,
reviews, review comments, issue comments, checks, CI runs, and available CI logs.
Collection does not run tests or execute repository content.

The collector reads PR identity before remote evidence pagination and again
after it. A changed base or head fails collection as `stale-head`. Every remote
collection follows monotonically increasing page numbers to exhaustion, detects
repeated non-empty pages, and fails as `pagination-failure` instead of storing a
prefix. This applies
independently to changed files, reviews, review comments, issue comments, checks,
CI runs, and CI log job lists where pagination exists.

### Bundle inventory

The output directory is exactly the `--out` path. A completed format-version-one
bundle contains at least:

| Relative path | Contents |
|---|---|
| `manifest.json` | Bundle identity, provenance, evidence completeness, and hashes. |
| `pr.json` | PR metadata, base/head refs and SHAs, title, body, author, state, labels, and PR URL. |
| `changed-files.json` | Every changed file's remote metadata, including status and prior path when supplied. |
| `diff.patch` | Local `baseSha..headSha` source diff from the verified worktree. |
| `reviews.json` | Paginated submitted review data. |
| `review-comments.json` | Paginated existing pull-request review comments. |
| `issue-comments.json` | Paginated issue comments, retained as read-only review context. |
| `checks.json` | Check suites and check runs associated with the reviewed head. |
| `ci-runs.json` | Selected CI run/job identity, state, conclusion, URLs, and log availability. |
| `ci-logs/` | Text log files for selected available CI jobs, named by safe stable IDs. |
| `file-hashes.json` | SHA-256 records for payload files except itself and `manifest.json`. |

Missing, unavailable, failed, pending, cancelled, skipped, or inaccessible checks
and logs are explicit evidence states in `manifest.json` and `ci-runs.json`.
A missing log is reported by the provider as absent. An inaccessible log exists
but cannot be read by the caller. They do not create alternate CLI modes or
implicit success. The default selection uses `filter=all` for every check run on
the exact head and `filter=all` for every associated job attempt. A completed
available text log is collected; an unavailable log is recorded with its reason.
The collector never executes, decompresses, or follows links found in CI output.

### Manifest, hashes, and atomic output

`manifest.json` contains at least:

```text
schemaVersion
collectorVersion
repository { owner, name, url }
pullRequest { number, url }
baseSha
headSha
collectedAt
localWorktree { path, verifiedHeadSha }
selectedCi [ { runId, jobId?, url, logUrl?, state, conclusion?, evidenceState } ]
artifacts [ { path, bytes, sha256 } ]
incompleteOrUnavailableEvidence [ { kind, identity, reason } ]
fileHashesSha256
manifestCanonicalSha256
```

Artifact paths are relative and `artifacts` includes every non-self-referential
artifact: each payload file and `file-hashes.json`, but not `manifest.json`.
`file-hashes.json` maps every payload path to its exact-byte SHA-256, excluding
itself and `manifest.json`. `manifest.json` records the SHA-256 of
`file-hashes.json`.

The unavoidable manifest self-hash follows this rule: canonicalize the manifest
with `manifestCanonicalSha256` omitted, then SHA-256 those exact canonical bytes.
Store that result in `manifestCanonicalSha256`. The manifest is not listed in
`file-hashes.json` and does not claim a direct byte hash, because adding its own
byte hash changes its bytes. Verification recomputes the canonical self-digest,
verifies `file-hashes.json`, then verifies every payload artifact and artifact
record.

Collection stages output in a fresh sibling temporary directory of `--out`.
It writes payloads and `file-hashes.json` with exclusive creation, fsyncs files,
writes `manifest.json` last, fsyncs it, and atomically renames the staged
directory to exactly `--out`. The parent directory is fsynced where supported.

If `--out` already exists, collect accepts it only when it is a complete,
verified bundle for the same repository, PR, base SHA, head SHA, schema version,
and current CI selection identity. It rereads the current selection and compares
it with the recorded `selectedCi` records before returning the verified bundle
without overwriting it. Another head, a different selection, unsafe content,
missing artifact, extra unlisted file, wrong hash, or incomplete content fails.
No different output path is derived.

## Findings contract and offline reviewer flow

Offline reviewers and agents receive a verified immutable bundle and write a
separate findings JSON file. They do not edit the bundle and do not need GitHub
credentials.

The versioned JSON Schema contracts are
`schemas/pr-review-bundle.v1.schema.json` and
`schemas/pr-review-findings.v1.schema.json` in
https://github.com/agent-guardrails/docs. The implementation validates findings
against the versioned schema and performs
cross-field checks against the bundle before preview or publication.

The findings document contains these top-level fields:

```text
schemaVersion
repository
prNumber
reviewedHeadSha
overallVerdict
findings
```

Each finding contains:

```text
findingId
defectClass
severity
title
explanation
filePath?
line?
diffSide?
evidenceReferences
remediation
blocking
```

`severity` is `blocker`, `major`, `minor`, or `nit`. `overallVerdict` is the documented
review conclusion, separate from publication behavior. `blocking` is a boolean.
A review-level finding has no location. A file-level finding has only `filePath`,
which is a safe changed-file path. An inline finding has `filePath`, `line`, and
`diffSide` together. An inline location identifies a changed hunk: `RIGHT` is a
head-side line and `LEFT` a base-side line. Renamed and copied files use the path
on that selected side. Deleted files use only `LEFT`; new files use only `RIGHT`.
`evidenceReferences` name bundle artifacts and their verified hashes.
`remediation` is reviewer-authored Markdown text.

`findingId` is the stable deduplication key. It is a non-empty deterministic ID
chosen from immutable reviewed facts, such as repository, PR, reviewed head,
file path, diff side, line, and defect identity. Its generation method is defined
by the versioned schema contract and implementation documentation; it remains
stable when only prose explanation or severity changes. A findings document cannot contain
duplicate IDs. Publish compares IDs with exact hidden markers in existing review
bodies and review comments: `<!-- agent-guardrails-pr-review:<findingId> -->`.
It skips an already-marked ID and never edits or resolves it.

Reviewer flow:

1. Sync the explicit worktree to the exact PR head.
2. Collect one bundle at the explicit output path.
3. Verify the bundle before distributing it to offline reviewers.
4. Produce one schema-valid findings file tied to that bundle's reviewed head.
5. If GitHub publication is wanted, obtain explicit approval before running
   publish without `--confirm`, then inspect the exact review body and inline comments.
6. Rerun with `--confirm` only after accepting that preview.

Steps 1 through 4 are the unattended review path. Every publisher invocation is
outside that path and requires explicit approval because shell command matching
cannot safely distinguish all quoted forms of a confirmation argument.

## `pr-review-publish`: COMMENT review only

`pr-review-publish --bundle PATH --findings PATH [--confirm]` validates the
bundle hashes, manifest self-digest, findings schema, findings cross-field
relationships, current repository/PR identity, and duplicate finding IDs.

Without `--confirm`, it is preview-only. It displays the exact COMMENT review
body and every inline review comment body, path, line, side, and marker that a
confirmed invocation would submit. It performs no write.

With `--confirm`, it re-reads the current PR head immediately before any write.
If it differs from `reviewedHeadSha`, publication fails as `stale-head` before
creating a review or comment. It then submits exactly one GitHub review with the
`COMMENT` event, `commit_id` equal to `reviewedHeadSha`, and its valid inline
review comments. It does not create issue
comments, submit approval or request-changes reviews, resolve threads, edit any
comment, merge, create issues, or alter unrelated comments.

Deduplication occurs before constructing the review: existing review bodies and
review comments are scanned for exact stable-ID markers. Findings already marked
are omitted from the preview and confirmed review. If every finding is already
marked, preview reports no publication work and confirmation creates nothing.

## Reproducibility and failures

The completed bundle is the cache. It is reusable only at the exact explicit
absolute `--out` path after full verification and only for matching repository,
PR, base SHA, head SHA, schema version, and current CI selection identity. The
worktree is reusable only at its caller-supplied absolute path after clean-state
and exact-HEAD verification.

Aside from `collectedAt`, canonical manifest content is deterministic for the
same pinned local revisions, normalized remote evidence, and selected CI result.
Objects use lexical key order. Arrays retain semantically meaningful remote order
or sort by documented stable identity where order is not meaningful. The
timestamp is intentionally excluded when comparing deterministic manifests.

Remote authentication, authorization, rate limit, invalid response, pagination,
missing required revision, dirty worktree, stale head, unavailable CI evidence,
malformed findings, hash mismatch, and atomic-write failure stop the relevant
operation. The scripts do not retry by changing revision, branch, output path,
finding, or mutation type. Interrupted collection leaves no completed bundle.

The repository-local OpenCode V2 configuration uses an ordered
`permission.bash` map that asks by default and allows only the fixed sync and
collect commands. Every publisher invocation, including read-only preview,
remains at `ask`. It does not allow generic `git`, `gh`, shell, package, test, or
build commands. Trusted tooling tests run in this repository's CI, not in a local
PR-review session. The trusted tooling checkout's `AGENTS.md` requires invocation
there, never from a reviewed worktree, and bars reviewed instructions, hooks,
configuration, and executables from becoming authority. The trusted tooling
checkout and fixed command contracts are the only workflow authority. The
reviewed repository, its metadata, and collected evidence are untrusted data.

## Proposed implementation layout

The later implementation belongs in https://github.com/agent-guardrails/.github
and uses no Python for this feature:

```text
.github/scripts/
  pr-review-sync.mjs
  pr-review-collect.mjs
  pr-review-publish.mjs
  pr-review/
    cli.mjs
    paths.mjs
    git.mjs
    github.mjs
    bundle.mjs
    findings.mjs
    publish.mjs
  test_pr_review_sync.mjs
  test_pr_review_collect.mjs
  test_pr_review_publish.mjs
  test_pr_review_bundle.mjs
  test_pr_review_findings.mjs
  test_pr_review_schema.mjs
  fixtures/pr-review/
```

The three launchers are the supported fixed CLI surface. Modules below
`.github/scripts/pr-review/` are private. Tests use Node's built-in `node:test`
runner, captured JSON/text fixtures, and fake subprocess or API boundaries.
They do not execute a reviewed repository, tests, package scripts, or real
GitHub writes. A repository-local GitHub Actions workflow runs those trusted
tooling tests. It does not check out or execute a reviewed target repository.

CI checks out the canonical `agent-guardrails/docs` schemas at `.review-docs` and
runs:

```text
PR_REVIEW_REQUIRE_SCHEMAS=1 \
PR_REVIEW_SCHEMA_DIR=.review-docs/schemas \
  node --test .github/scripts/test_pr_review_*.mjs
```

## Tests and acceptance criteria

The implementation test suite explicitly covers:

- Clean dedicated-worktree creation at the supplied path and safe clean-path
  update for a later exact head.
- Dirty-worktree refusal and preservation of the main checkout.
- Exact base/head resolution, optional expected-head mismatch, exact-revision
  fetch, detached `HEAD` verification, and no test execution by sync or collect.
- Collect refusal when the supplied worktree is missing, unmanaged, dirty, or at
  another head; local generation of `diff.patch` from pinned base and head.
- Pagination for changed files, reviews, review comments, issue comments, checks,
  CI runs, and paginated CI job/log discovery.
- Missing CI logs and explicit manifest evidence state; failed, pending,
  cancelled, skipped, and unavailable checks and jobs.
- CI-log retrieval with explicit terminal-sequence opt-in only at the raw log
  boundary, followed by escape/control sanitization before hashing and storage.
- Review starts from the title and description in `pr.json`, treats their claims
  as untrusted evidence, and compares intent and verification claims with the diff,
  repository contract, and collected CI.
- Fork PR source handling, exact-SHA fetch, and missing/unfetchable fork revision
  failure.
- Output collision handling, atomic sibling staging, atomic rename, crash cleanup,
  and verified reuse only at the supplied `--out` path.
- Deterministic manifest content except timestamp, payload hashes,
  `file-hashes.json` exclusion rules, manifest canonical self-digest, tamper
  detection, and rejection of unlisted or unsafe paths.
- Malformed findings, schema/version rejection, invalid evidence references,
  invalid inline locations, and duplicate finding IDs.
- Existing-marker duplicate suppression using review bodies and review comments.
- Preview with no writes, exact previewed review body and inline comments,
  explicit `--confirm`, and stale-head refusal before every publication attempt.
- COMMENT-review-only publication and prohibition tests for issue creation, issue
  comments, approval, request changes, thread resolution, edits, merge, and
  unrelated-comment mutation.
- Path traversal and symlink-escape rejection, argv-array and `shell: false`
  subprocess use, credential non-persistence, and diagnostic redaction.

Acceptance requires a clean explicit worktree at the resolved head, a verified
bundle at exactly `--out` containing the fixed inventory and locally generated
diff, valid offline findings, a no-write preview of exact publication text, and
a confirmed COMMENT review only when the current head still equals the reviewed
head. Corrupt evidence, a dirty worktree, stale source, or malformed findings
never become publishable.

## Future transport

An MCP transport may later invoke or faithfully implement these three fixed
contracts. It retains the same arguments, worktree and bundle semantics,
versioned schemas, preview/confirm behavior, stale-head refusal, and COMMENT-only
publication boundary. It does not introduce a second evidence format, a hidden
write path, or a broader GitHub API surface.
