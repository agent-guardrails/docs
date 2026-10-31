# 07 — Parsing: Guidance for Stage-Tool Authors

Version 1.1 · 2026-10-31

Since v1.1 the engine core does **no command parsing** (ADR-0008). Every stage
tool receives the raw command and parses it itself. This document is guidance:
**normative for the reference tools** (`warden-match`, `warden-legible`),
recommended for third-party tools.

## 7.1 Input contract

Per invocation the tool receives on stdin (06 §6.4.2):

```json
{ "protocolVersion": 1,
  "command": { "raw": "curl -s api.example.com", "cwd": "/work/repo" },
  "session": { "id": "ses_…", "agent": "build" },
  "mcp": [ { "name": "http", "status": "connected" } ],
  "hostEnv": { } }
```

- `command.raw` — command text exactly as OpenCode produced it. The native
  OpenCode scanner has already split compound commands into subcommands and
  refuses to execute what it cannot analyze — but **re-parse defensively**:
  never assume the split is complete.
- `command.cwd` — session working directory.
- `hostEnv` — only the allowlisted server variables (default: empty). This is
  host-session context, **not** the environment the command will execute with —
  that is unknowable at decision time by design.

## 7.2 Classification: `static` vs `opaque`

Every command is classified before verdict production:

| Class | Meaning |
|---|---|
| `static` | Fully analyzable after normalization: literal tokens, wholly-static quoting, no expansions |
| `opaque` | Contains constructs the tool refuses to resolve: `$(`, backticks, `${`, `$VAR`, process substitution, residual operators (`\|`, `&&`, `;`) after the scanner split |

**Normative rule (fail-closed matching):** an `allow` verdict may originate
ONLY from a rule matched against a `static` command. `deny`/`ask` MAY match any
classification. On `opaque`, allow-rules are treated as non-matching and the
walk continues — the command degrades toward `ask`, never silently runs.

Rationale: the tool is fast and deterministic, not intelligent. It cannot judge
whether an encoded string is dangerous — it only guarantees the human sees
commands in a form they can parse at a glance.

## 7.3 Normalization recommendations (for `static` classification)

Light pipeline, in order; any unresolvable step ⇒ `opaque`:

1. UTF-8 / NFC; trim; collapse whitespace outside quotes.
2. Decode **wholly-static** quoting only (`'…'`, `"…"` without expansions).
3. Expansion scan ⇒ opaque on: `$(`, backticks, `${`, `$VAR`, process
   substitution, arithmetic `$((`, brace expansion.
4. Operator scan ⇒ opaque on any residual `|`, `&&`, `;`, `&`, redirections
   (the OpenCode scanner should have split these; seeing them means the input is
   outside the assumed contract).
5. Strip env-prefix assignments (`FOO=1 cmd` → record, exclude from argv).
6. Tokenize on whitespace respecting decoded quoting; token 0 = command word.

## 7.4 Matching vocabulary

- **Glob on raw string** (OpenCode-compatible): `*` = zero+ chars incl. spaces;
  `?` = one char; trailing `" *"` also matches the bare command
  (`git status *` matches `git status` too).
- **Token prefix** (`argv: ["git","push"]`): ordered equality on the first N
  tokens of the token sequence.
- **Flags**: base-flag identity (`-x`, `--long`, `--long=value` → base +
  inline value); arity declared per stage/tool config; `--` terminates flags.
- **Path conditions** (optional): lexical canonicalization only — symlinks are
  NOT resolved (documented limitation; `within` checks are advisory for hostile
  layouts).

## 7.5 Verdict hygiene

- `allow` ⇒ only `static`, only fully-analyzed constructs (I10).
- `deny`/`ask` messages MUST be prescriptive: tell the agent what to do
  ("call commands directly, without bash -c"), not just what failed. Budgeted
  rejection (ADR-0010) assumes one iteration usually suffices.
- `facts` ≤ 16 KiB, depth ≤ 8, no secrets (I6).
