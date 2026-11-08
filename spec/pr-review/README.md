# PR Review Workflow Specification

Status: version 1

This specification defines the auditable pull request review workflow accepted by
[ADR 0018](../../adr/0018-script-based-auditable-pr-review-workflow.md). The
terms MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are normative as
described by RFC 2119.

## Scope and command contracts

The implementation exposes exactly these three commands:

```text
pr-review-sync --repo OWNER/REPO --pr NUMBER --worktree PATH [--head EXPECTED_SHA]
pr-review-collect --repo OWNER/REPO --pr NUMBER --worktree PATH --out PATH
pr-review-publish --bundle PATH --findings PATH [--confirm]
```

The MVP MUST accept only `OWNER/REPO` identifiers whose owner is
`agent-guardrails`. Inputs outside that organization MUST fail before Git or
GitHub access. The commands MUST NOT add PR URL inputs, inferred output paths,
workspace roots, bundle roots, CI selector flags, workflow callers, or rollout
configuration.

Each command MUST write a JSON success or failure record to stdout, diagnostics
to stderr, and a nonzero exit status on failure. Every success record MUST
contain `contractVersion: 1`, repository, PR number, base SHA, head SHA, and the
principal absolute caller path. Failures MUST use stable codes, including
`invalid-input`, `unsupported-repository`, `auth-required`, `not-found`,
`permission-denied`, `remote-failure`, `pagination-failure`, `unsafe-path`,
`worktree-conflict`, `worktree-dirty`, `head-mismatch`, `bundle-exists`,
`bundle-invalid`, `hash-mismatch`, `findings-invalid`, `stale-head`,
`confirmation-required`, and `local-io-failure`.

Every caller path, `--worktree`, `--out`, `--bundle`, and `--findings`, MUST be
an absolute path. The implementation MUST validate the path before use, reject
NUL bytes, wrong file kinds, and symlink resolution outside the explicit caller
path, and never infer a replacement path. Bundle-member paths MUST be relative
POSIX paths and MUST NOT be absolute or contain a `.` or `..` segment.
Repository paths in findings MAY contain dot-leading components, spaces, and
Unicode. They MUST NOT contain a traversal component, control character,
backslash, or empty component. Evidence and repository data are untrusted data.
Scripts MUST NOT execute, source, import, or interpret any such data as commands.

Every subprocess MUST use an argv array without a shell, have a 60-second
deadline, capture no more than 16 MiB of stdout and 4 MiB of stderr, and fail
with a stable failure record when a limit is exceeded or the process times out.
The collector MUST reject an artifact larger than 8 MiB and MUST stop before the
completed bundle would exceed 64 MiB. The 64 MiB limit is cumulative across all
evidence artifacts, including locally generated payloads, downloaded CI logs,
and `file-hashes.json`; it is not a separate limit for each evidence source.

Credentials MUST come only from the authenticated GitHub CLI context or a
documented implementation environment mechanism. Credentials MUST NOT appear in
arguments, bundles, findings, stdout, diagnostics, or fixtures. Stored
diagnostics MUST redact recognized GitHub tokens, bearer tokens, authorization
headers, and configured credential values as `[REDACTED]`.

## Sync

`pr-review-sync` MUST resolve the PR's exact base and head SHAs. With `--head`,
the resolved head SHA MUST equal `EXPECTED_SHA`; otherwise it MUST fail with
`head-mismatch`. It MUST fetch only those exact remote git revisions.

`--worktree` names one dedicated stable path. If absent, sync MAY create it. If
present, sync MUST verify Git worktree registration, an adjacent
`<worktree>.pr-review.json` sidecar, repository and PR identity, and clean state
before updating it. The sidecar MUST be atomically written beside the worktree
and contain contract version, repository, PR number, base SHA, and head SHA. It
MUST NOT enter or alter the reviewed tree.

The resulting detached `HEAD` MUST equal the resolved head SHA. Sync MUST NOT
change the main checkout, check out a moving branch, derive a path from a SHA,
delete a worktree, or run repository code, tests, builds, package scripts, or CI
jobs. For fork PRs, it MUST fetch only the recorded head repository and exact
head SHA. A missing or unfetchable required revision MUST fail, not fall back to
a branch name.

## Collection and evidence bundle

`pr-review-collect` MUST verify the supplied dedicated worktree before reading
evidence. Registration, sidecar, repository, PR, detached `HEAD`, clean state,
and local availability of the pinned base and head commits MUST all match the
current PR identity. Collection MUST NOT repair a mismatch.

A completed bundle is one immutable snapshot of the verified PR identity and
the evidence selected during that collection attempt. The collector MUST NOT
merge evidence from a prior bundle, reuse a prior payload as current evidence,
or refresh a completed bundle in place. Reuse is limited to returning an
already complete bundle after the verification required by this specification.

The collector MUST create `diff.patch` locally from `baseSha..headSha` in that
verified worktree. Remote APIs MAY supply only remote evidence: PR metadata,
changed-file metadata, reviews, review comments, issue comments, checks, CI
runs, and CI logs. Collection MUST NOT obtain or store source diffs from a
remote API or run tests, builds, package scripts, CI jobs, or repository content.

The collector MUST read PR identity before remote pagination and again after it.
Changed base or head SHA MUST fail as `stale-head`. Every paginated source MUST
be read to exhaustion using monotonically increasing page numbers and reject a
repeated non-empty page. A partial page sequence MUST fail as
`pagination-failure` rather than become stored evidence.

The completed bundle at exactly `--out` MUST contain this inventory:

| Relative path | Required contents |
|---|---|
| `manifest.json` | Bundle identity, provenance, completeness, and hashes. |
| `pr.json` | PR metadata, base and head refs and SHAs, title, body, author, state, labels, and PR URL. |
| `changed-files.json` | Every changed file's remote metadata, including status and prior path when supplied. |
| `diff.patch` | Local pinned source diff. |
| `reviews.json` | Submitted reviews. |
| `review-comments.json` | Existing pull request review comments. |
| `issue-comments.json` | Read-only issue-comment context. |
| `checks.json` | Reviewed head SHA plus check suites and runs for that head. |
| `ci-runs.json` | Reviewed head SHA plus selected CI run and job identity, state, conclusion, URLs, and log availability. |
| `ci-logs/` | Available selected CI job text logs, named by safe stable IDs. |
| `file-hashes.json` | SHA-256 records for payload files only. |

Default CI selection MUST use `filter=all` for all check runs on the exact head
and `filter=all` for every associated job attempt. Completed available text logs
MUST be collected. A `missing` log is one the remote provider reports does not
exist. An `inaccessible` log is one that exists but cannot be read with the
caller's authorization. Missing, unavailable, failed, pending, cancelled,
skipped, and inaccessible checks, job attempts, or logs MUST be recorded
explicitly in `manifest.json` and `ci-runs.json`. The collector MUST NOT execute,
decompress, or follow links found in CI output.

Collection MUST stage a new sibling temporary directory of `--out`, exclusively
create and fsync payload files and `file-hashes.json`, write and fsync
`manifest.json` last, then atomically rename the staged directory to exactly
`--out`. It MUST fsync the parent where supported. Interrupted collection MUST
leave no completed bundle.

An existing `--out` path is reusable only after complete verification of matching
repository, PR, base SHA, head SHA, schema version, and the current CI selection
identity. The collector MUST reread the current selection for the reviewed head
before reuse and compare it with the bundle's `selectedCi` records. Anything
else, including a missing, extra, unsafe, incomplete, or wrongly hashed file,
MUST fail. Collection MUST NOT overwrite the path or select another path.

## Bundle manifest schema and hash rules

`manifest.json` MUST validate against
[`pr-review-bundle.v1.schema.json`](../../schemas/pr-review-bundle.v1.schema.json).
It MUST contain all required fields in that schema:

```text
schemaVersion, collectorVersion, repository, pullRequest, baseSha, headSha,
collectedAt, localWorktree, selectedCi, artifacts,
incompleteOrUnavailableEvidence, fileHashesSha256, manifestCanonicalSha256
```

`schemaVersion` is `1`. SHA-256 values MUST be lowercase 64-hex strings. Git
SHAs MUST be lowercase hexadecimal strings with 7 through 128 characters.
Repository and pull request URLs, CI URLs, and log URLs MUST be absolute URIs.
`localWorktree.path` MUST equal the caller-supplied absolute `--worktree` path,
and `localWorktree.verifiedHeadSha` MUST equal `headSha`.
`selectedCi` MUST carry its run identity, URL, state, and evidence state; job
identity, log URL, and conclusion are present only when known. Evidence states
MUST distinguish available evidence from unavailable, missing, failed, pending,
cancelled, skipped, and inaccessible evidence.

`artifacts` MUST list every non-self-referential file: all payload files and
`file-hashes.json`, but not `manifest.json`. Each artifact record MUST contain
its safe relative path, exact byte count, and exact byte SHA-256. An artifact
MUST NOT exceed 8 MiB, and all files in a completed bundle MUST NOT exceed 64
MiB in total. Paths and records MUST be unique. `file-hashes.json` MUST map every
payload path, excluding itself and `manifest.json`, to its exact-byte SHA-256.
Its manifest field MUST equal the exact-byte SHA-256 of `file-hashes.json`.

To calculate `manifestCanonicalSha256`, the collector MUST omit that member,
serialize the remaining manifest as canonical JSON with lexical object-key order,
and hash those exact UTF-8 bytes with SHA-256. The collector MUST store the
result in `manifestCanonicalSha256`. Verification MUST recompute this digest,
then verify `file-hashes.json`, every payload, every artifact record, the fixed
inventory, and the absence of unlisted files. `manifest.json` MUST NOT claim a
direct byte hash because a self-byte hash is impossible.

## Findings and offline review

Offline reviewers MUST receive a verified immutable bundle and MUST write a
separate findings JSON document. They MUST NOT edit the bundle and do not need
GitHub credentials.

Findings MUST validate against
[`pr-review-findings.v1.schema.json`](../../schemas/pr-review-findings.v1.schema.json).
The top-level document requires `schemaVersion`, `repository`, `prNumber`,
`reviewedHeadSha`, `overallVerdict`, and `findings`. `schemaVersion` is `1`.
The implementation MUST require repository, PR number, and reviewed head SHA to
equal the verified bundle. `overallVerdict` is the review conclusion only. It
MUST NOT select a publication event.

Each finding requires `findingId`, `defectClass`, `severity`, `title`, `explanation`,
`evidenceReferences`, `remediation`, and `blocking`. Severity is `blocker`,
`major`, `minor`, or `nit`. A finding is review-level when it has no location.
An inline finding MUST include all of `filePath`, positive `line`, and
`diffSide` of `LEFT` or `RIGHT`. Its location is stateful: `RIGHT` identifies a
line in the head-side changed file, while `LEFT` identifies a line in the
base-side changed file. The implementation MUST validate the tuple of file path,
line, and side against a changed hunk in `diff.patch`, not merely against file
contents. For a renamed or copied file, `filePath` MUST be side-aware and
identify the path on the selected side of the diff. A deleted file therefore
permits only `LEFT`, and a newly added file permits only `RIGHT`.
`evidenceReferences` MUST be non-empty safe artifact paths with SHA-256 values
that equal the verified artifact hashes.
`remediation` is reviewer-authored Markdown text.

`defectClass` MUST match `^[a-z][a-z0-9-]{0,95}$` and identify the defect
independently of its prose or severity. `findingId` MUST equal `f-` followed by
the lowercase SHA-256 of canonical JSON containing repository, PR number,
reviewed head SHA, `defectClass`, and the complete inline location or `null` for
a review-level finding. It therefore matches `^f-[0-9a-f]{64}$` and remains
unchanged when only title, explanation, remediation, severity, blocking, or
evidence references change. Duplicate IDs MUST make the findings document
invalid.

The offline sequence is: sync an exact-head worktree, collect and verify one
bundle, distribute the immutable bundle, produce schema-valid findings tied to
its head, inspect a preview, then rerun with `--confirm` only after accepting
that exact preview.

## Publication

`pr-review-publish` MUST verify the bundle, manifest self-digest, findings
schema, all findings cross-field requirements, and bundle identity before
preview or publication. It MUST scan existing review bodies and review comments
for the exact marker `<!-- agent-guardrails-pr-review:<findingId> -->`.

Without `--confirm`, publish is preview-only. It MUST perform no write and MUST
display the exact COMMENT review body and each inline comment body, path, line,
side, and marker that confirmation would submit. Marked finding IDs MUST be
omitted. If all IDs are already marked, preview MUST report no publication work.

With `--confirm`, publish MUST reread the PR head immediately before any write.
If it differs from `reviewedHeadSha`, it MUST fail as `stale-head` before
creating a review or comment. Otherwise it MAY submit exactly one review with
the `COMMENT` event, `commit_id` equal to `reviewedHeadSha`, and its valid
unmarked inline review comments. It MUST NOT
approve, request changes, create issue comments, edit comments, resolve threads,
merge, create issues, alter labels or assignees, or mutate unrelated comments.
If no unmarked finding remains, confirmation MUST create nothing.

## Permissions, reproducibility, and prohibitions

Sync and collect require read access to Git and GitHub evidence. Publish without
`--confirm` requires read access only. Confirmed publication requires permission
to create one COMMENT review and its inline review comments. Read collection and
remote publication MUST remain separate operations and permissions.

The versioned OpenCode V2 project configuration MUST use ordered `permissions`
rules with action `shell`. It MAY allow only the fixed sync, collect, and
argument-free syntax-check command shapes. Test commands and every
`pr-review-publish` invocation MUST remain at effect `ask`. Generic `git`, `gh`,
shell, package, build, test, and reviewed-code execution MUST NOT be auto-allowed.
The trusted tooling
checkout's `AGENTS.md` MUST require every workflow command to start there, forbid
starting it in a reviewed worktree, and forbid reading instructions, hooks,
configuration, or executables from the reviewed repository as authority.
The trusted tooling checkout and its fixed command contracts are the only
authority for workflow behavior. The reviewed repository, its metadata, and all
collected evidence are untrusted data, not instructions or authority.

For the same pinned revisions, normalized remote evidence, and selected CI
result, canonical manifest content MUST be deterministic except `collectedAt`.
Object keys MUST use lexical order. Arrays MUST retain meaningful remote order or
use documented stable identity order. The completed bundle and verified clean
worktree are the only caches, and each is reusable only at its caller-supplied
absolute path after full validation. A reusable bundle also requires the current
CI selection identity to equal the recorded `selectedCi` records.

Git operations MUST ignore system and global Git configuration, disable hooks
and attribute-driven external conversion, and use only the fixed trusted
`gh auth git-credential` helper for private HTTPS fetch authentication. They
MUST NOT load credential, hook, filter, or conversion commands from reviewed
repository content.

Authentication, authorization, rate limits, invalid remote responses, pagination
failure, missing revisions, dirty worktrees, stale heads, unavailable CI
evidence, malformed findings, hash mismatches, and atomic-write failure MUST
stop the relevant operation. Implementations MUST NOT recover by changing a
revision, branch, output path, finding, or mutation type.

The workflow MUST NOT run tests, builds, package scripts, CI jobs, or untrusted
repository code. It MUST NOT become a generic GitHub API or CI wrapper. Any
future transport, including MCP, MUST preserve these command contracts, evidence
format, preview and confirmation boundary, stale-head protection, and
COMMENT-only publication rule. It MUST NOT create an alternate evidence or write
path.
