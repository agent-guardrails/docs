# 07 — Parsing (normative for the checker)

Version 2.3 · 2026-11-11 · Revised for the schema-first v2 contract accepted by
[ADR-0017](https://github.com/agent-guardrails/docs/blob/main/adr/0017-schema-first-shell-warden-config-contract.md) and post-schema verdict
validation in [ADR-0021](https://github.com/agent-guardrails/docs/blob/main/adr/0021-post-schema-shell-warden-verdict-validation.md). Parsing remains the
checker's own and complete; harness-supplied splitting is never trusted.

Parsing is the checker's own (ADR-0016): one scanner turns raw command text into segments per
operator, and a recursive extractor turns segments into the complete executable-part and
evidence graph (08 §8.1). The checker is fast and deterministic, not intelligent — it
guarantees the human sees commands in a form they can parse at a glance; it never judges
semantics.

## 7.1 Input contract

Per check the binary reads one letter from stdin (02 §2.2):

```json
{ "version": 1,
  "invocation": { "id": "msg:call", "sessionID": "ses…", "projectDir": "/work/repo" },
  "action": "shell",
  "commands": [ { "index": 0, "raw": "curl -s api.example.com", "cwd": "/work/repo" } ] }
```

- `commands[].raw` — command text exactly as OpenCode produced it. The native OpenCode scanner
  pre-splits compound commands, but the checker MUST re-parse from `raw` and never assume that
  split is complete or truthful (§7.2).
- `commands[].cwd` — the working directory used for lexical path comparison (§7.6). A relative
  literal path is compared as if joined under `cwd`; this is lexical joining only, never
  filesystem resolution (07 §7.6).
- No other context exists: the checker spawns with an empty environment and performs no
  lookups — no PATH lookup, no filesystem I/O, no binary identity resolution.

## 7.2 Recursive executable-part extraction

Each command is split into the executable parts it would actually run. Parts form a graph
(retaining raw text, span, parent ID, relation, and relation occurrence ordinal); every part
carries decoded argv tokens, environment assignments, redirects, and analyzer facts.

The parsed relations are a CLOSED enum:

| Relation | Emitted when |
|---|---|
| `chain` | Operator-bounded executable segment (the default root relation) |
| `pipeline` | Segment following `\|` |
| `wrapper` | Recursive unwrap of a transparent interpreter (below) — children of the wrapper part |
| `command-substitution` | Inner text of `$(…)`, deprecated backticks, and process substitution, split recursively |
| `analyzer-command` | MAY be emitted ONLY by an analyzer (`xargs-v1`); prevents analyzers from duplicating ordinary shell nesting |

Wrappers unwrap into child parts; the wrapped command evaluates on its own under relation
`wrapper`:

| Head | Unwrap |
|---|---|
| `bash -c`, `sh -c` | each operand segment becomes a wrapper child; extra words after the operand are appended to the last child argv (they can only add arguments; `$0`/`$1` are not symbolically resolved) |
| `sudo`, `nohup` | transparent: the rest of the argv becomes the child; options of the wrapper head make the part opaque; a bare wrapper head is opaque |
| `nice` | `-n N` is skipped; other wrapper options are opaque |
| `timeout` | the duration argument (`<n>[smhd]`) is skipped and validated; a missing or non-parsing duration is opaque |
| `env` | assignments are transparent prefixes; wrapper options are opaque |
| `xargs` | stays VISIBLE: emits the operand as an opaque child and marks itself opaque ("executes from stdin") — the child only becomes a matchable `analyzer-command` part when the selected profile runs `xargs-v1` (08 §8.4) |

A wrapper part that has been unwrapped ("collapsed") carries no votes, no selected profile,
and contributes no independent evidence of its own — its children carry the execution
semantics. Collapsed parts collide with nothing: they are excluded from selection, reduction,
and the evidence-state aggregates in one pass.

Command substitution children emit BEFORE (in evaluation order of) the surrounding part.
Shell and nested-part depth is bounded at 32; exceeding that bound makes affected evidence
`invalid` with the `evidence-limit` reason and therefore unable to allow.

## 7.3 Evidence states (closed)

Every executable part carries exactly one evidence state:

| State | Meaning | Allow effect |
|---|---|---|
| `complete` | Supported shell syntax, profile option parsing, analyzer processing, and resource limits yielded all typed evidence. | May proceed to matching and allow coverage validation. |
| `opaque` | A coherent supported structure contains runtime-dependent content whose words or values are not safely known. Unterminated quoting remains opaque because its token is unresolvable. | Cannot allow; ask and deny may still match typed classification or raw text. |
| `invalid` | A required typed structure cannot be constructed because evidence is malformed, unsupported where required, internally inconsistent, or exceeds a resource/evidence limit. | Cannot allow; the part reduces no more permissively than ask; deny/ask may still match the typed evidence kept for diagnostics (heredoc parts keep argv). |

Stable reason codes (the implemented spellings — 08 §8.5):

| Reason | Meaning |
|---|---|
| `complete` | Fully typed evidence. |
| `opaque-expansion` | Active expansion, unquoted glob/brace/tilde, or an unresolvable wrapper shape. |
| `unknown-option` | Profile option parse found an undeclared option token. |
| `option-value-missing` | An option consumed fewer values than its arity. |
| `invalid-inline-option` | Inline form `--alias=value` on an option that refuses or cannot take it. |
| `unsupported-syntax` | Heredoc/here-string or another unsupported structural form. |
| `empty-command` | Whitespace-only command text. |
| `evidence-limit` | Evidence items cap or nesting depth bound reached. |
| `allow-evidence-not-complete` | An allow rule saw evidence that is not `complete`. |
| `allow-coverage-missing` | An allow coverage selector did not cover an item (generic). |
| `required-option-missing` | `required: true` option entry had no occurrence. |
| `option-not-repeatable` | More occurrences than `"repeatable": false` permits. |
| `option-not-allowed` | Observed option not in the `allowed` coverage set. |
| `option-value-uncovered` | A consumed or inline option value is not covered by an `each` selector. |
| `option-value-position-uncovered` | A consumed value is not covered by its `byPosition` ordinal selector. |
| `remainder-uncovered` | Prefix remainder tokens not covered by the remainder policy. |
| `redirect-policy-uncovered` | Redirect occurrence or target not covered by the effective redirect policy. |

For recognized diagnostics, complete evidence requires `complete`. Opaque evidence
requires `opaque-expansion`, may also include `complete` for mixed complete and
opaque parts, and excludes invalid-cause reasons. The invalid-cause reasons are
`unknown-option`, `option-value-missing`, `invalid-inline-option`,
`unsupported-syntax`, `empty-command`, and `evidence-limit`; invalid evidence
requires at least one of them. Allow-coverage reasons do not by themselves make
evidence invalid.

## 7.4 Tokens and quote classes

One scanner per raw part produces segments per operator (`|`, `||`, `;`, `&`, `&&`, newline);
`&` alone is an asynchronous chain operator, and a comment starting at an unquoted `#` ends
the input. Tokens carry decoded literal text, a source span, quote class, resolvability, and
captured inner texts of active substitutions. Quote-class rules (closed):

| Form | Class |
|---|---|
| Single-quoted text `'…'` | literal, fully resolved |
| Escaped metacharacter `\$` | literal |
| Double-quoted text without an active expansion | literal, fully resolved |
| Active `$VAR`, `${…}`, `$(…)`, backticks, arithmetic `$((…))`, process substitution — including inside double quotes | opaque; the inner text is captured for recursive splitting and a replacement marker occupies the site |
| Unquoted glob metacharacters `*` `?` `[`, unquoted brace expansion, and a tilde in any position that performs tilde expansion | opaque |
| Quoted or escaped glob/brace/tilde characters | literal |
| Unterminated quotes | the token is unresolvable ⇒ opaque |
| An empty decoded token | dropped |

A literal regex `$` (inside quotes, or escaped) is NOT dynamic. A bare `$` is opaque noise.
When any word of the segment is unresolvable, the part is `opaque` (`opaque-expansion`).

**Spans (non-normative).** Token spans are diagnostic bookkeeping only: a token's recorded end
is its decode length from the start — they MUST NOT be consulted by decision logic, and their
exact values are not part of the contract.

## 7.5 Environment assignments and redirects

- **Environment assignments**: a leading word shaped `NAME=VALUE` (identifier name) before any
  argv token is recorded as an environment assignment (occurrence, name, literal value, span,
  prefix position) and excluded from argv. `env` wrapper assignments behave as transparent
  prefixes.
- **Redirect records**: the scanner emits one typed record per redirect occurrence, in source
  order, with operator, source FD, and typed target. Digits immediately before the operator
  are the source FD (`2>`); absent digits mean the operator's default FD.

| Operator | Target kind |
|---|---|
| `<` (input), `>` (truncate output), `>>` (append output) | `literalPath` |
| `>&`, `<&` (FD duplication, numeric or `-` close) | `fd` |

- **Unsupported forms**: `&>`/`&>>`, `<>`, heredoc, here-string, FD close `<&-`, and
  non-numeric duplication targets are unsupported ⇒ `invalid` evidence (fail-closed). A
  heredoc or here-string invalidates the whole segment while argv and redirects already parsed
  are kept so deny/ask can still match them.
- **Redirect targets** are read quote-aware and carry the same resolvability rules as tokens
  (§7.4): a dynamic target (`> "$REPORT"`) is opaque and can never allow.

The parser ALWAYS emits the redirect path coordinate for a supported literal-path redirect
before profile selection — redirect policies (06 §6.8) cover that evidence without depending
on `pathSources`.

## 7.6 Lexical path policy

Path comparison combines a relative literal with the letter's `cwd`, normalizes `.` and `..`
lexically, then compares components. It does not expand `$HOME`, does not resolve symlinks,
does not `stat` paths, and checks no existence or mounts. Trusted roots are explicit absolute
lexical config values. `/work/repo2` is NOT within `/work/repo`. A redirect target and an
argument with identical text are different coordinates; selecting one does not select the
other.

## 7.7 Matching vocabulary and verdict hygiene

- **Glob on raw string** (OpenCode-compatible): `*` = zero+ chars including spaces; `?` = one
  char; a trailing `" *"` also matches the bare command (`git status *` matches `git status`
  too).
- **Positional matching** is anchored on the part's positional arguments AFTER profile option
  parsing — the executable head is absent (08 §8.2).
- Option recognition is per-profile (06 §6.3): unknown option, missing value, and invalid
  inline forms make the part `invalid`; the unknown token remains visible as a positional
  token for diagnostics and raw rules.

- `allow` ⇒ only `complete` evidence AND the full coverage proof (06 §6.7) (09 I12).
- `deny`/`ask` messages MUST be prescriptive: tell the agent what to do ("push to a branch and
  open a pull request"), not just what failed. Hook-side deny budgets (ADR-0010) still assume
  one iteration usually suffices.
- `facts` ≤ 16 KiB, depth ≤ 8, no secrets (I6). Edges: aggregate `allow` and
  `ask` may carry an optional message;
  aggregate `deny` falls back to the constant `"denied by shell-warden policy"` when no rule
  carried a message (08 §8.6).
- Messages: rule templates + allowlisted interpolation only (I11); checker error text never
  enters `message` (02 §2.4).
