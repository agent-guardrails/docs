# 07 — Parsing (normative for the decision binary)

Version 2.0 · 2026-11-01 · Re-targeted per [ADR-0016](../../adr/0016-two-tier-enforcement.md):
this is the normative parsing guide of the checker; harness-supplied splitting
is never trusted (0014's principle, enforced inside the binary).

Parsing is the checker's own and complete (ADR-0016): normalization, AST-level
chain splitting, per-part classification and flag recognition all live here.
The checker is fast and deterministic, not intelligent — it guarantees the
human sees commands in a form they can parse at a glance; it never judges
semantics.

## 7.1 Input contract

Per check the binary reads one letter from stdin (02 §2.2):

```json
{ "version": 1,
  "invocation": { "id": "msg:call", "sessionID": "ses…", "projectDir": "/work/repo" },
  "action": "shell",
  "commands": [ { "index": 0, "raw": "curl -s api.example.com", "cwd": "/work/repo" } ] }
```

- `commands[].raw` — command text exactly as OpenCode produced it. The native
  OpenCode scanner pre-splits compound commands, but the checker MUST re-parse
  from `raw` and never assume that split is complete or truthful (§7.2).
- `commands[].cwd` / `invocation.projectDir` — carried for the harness and
  v2 semantic layers; the v1 grammar performs no path interpretation
  (`argValue` compares decoded token text, ADR-0016 N6).
- No other context exists: the checker spawns with an empty environment and
  performs no lookups (no git/env/time context in v1, ADR-0016/N6).

## 7.2 Chain splitting (normative, recursive)

Each part is split into sub-parts the command would actually execute:

1. **Operators**: `|`, `&&`, `;`, `&`, `||` split top-level first (respecting
   quoting).
2. **Wrappers/interpreters** (recursively into their operands): `bash -c`,
   `sh -c`, `sudo`, `env`, `nohup`, `xargs`, `timeout` — the wrapped command is
   evaluated on its own as a part.
3. **Substitutions**: `$(…)`, backticks — the inner text is a part.
4. **Redirects and their targets** are recorded as path evidence (§7.4), not
   dropped: `rm -f /tmp/x > /etc/passwd` produces a part with both paths.

Every produced part carries its own raw text and evaluated independently
(08 §8.1). The letter's split (multiple `commands[]` entries) is replicated as
parts but never trusted to be complete — a single `raw` containing chains is
split here too.

## 7.3 Classification: `static` vs `opaque`

Every part is classified before verdict production:

| Class | Meaning |
|---|---|
| `static` | Fully analyzable after normalization: literal tokens, wholly-static quoting, no expansions |
| `opaque` | Contains constructs the checker refuses to resolve: `$(`, backticks, `${`, `$VAR`, process substitution, arithmetic `$((`, brace expansion, residual operators after §7.2 splitting |

**Normative rule (fail-closed matching):** an `allow` verdict may originate
ONLY from a rule matched against a `static` part (and, in the aggregate, from
fully parsed evidence overall). `deny`/`ask` MAY match any classification. On
`opaque`, allow-rules are treated as non-matching and evaluation continues —
the command degrades toward `ask`, never silently runs.

Rationale: the checker only guarantees legibility for the human, not safety —
anything it cannot show plainly is escalated (ADR-0001/0016 posture).

## 7.4 Normalization (for `static` classification)

Light pipeline, in order; any unresolvable step ⇒ `opaque`:

1. UTF-8 / NFC; trim; collapse whitespace outside quotes.
2. Decode **wholly-static** quoting only (`'…'`, `"…"` without expansions).
3. Expansion scan ⇒ opaque on: `$(`, backticks, `${`, `$VAR`, process
   substitution, arithmetic `$((`, brace expansion.
4. Operator scan ⇒ opaque on any residual operators after the §7.2 split
   (their presence means the input is outside the assumed contract).
5. Strip env-prefix assignments (`FOO=1 cmd` → record, exclude from argv).
6. Tokenize on whitespace respecting decoded quoting; token 0 = command word.
7. **No path-evidence channel**: the v1 grammar has no path-coordinate conditions (`argValue` compares decoded token text); how tokens relate to filesystem locations is a v2 semantic layer (§11.3 Q6). Redirection targets are recorded (§7.2 step 4) and are visible only to raw `pattern`.

## 7.5 Matching vocabulary

- **Glob on raw string** (OpenCode-compatible): `*` = zero+ chars incl. spaces;
  `?` = one char; trailing `" *"` also matches the bare command
  (`git status *` matches `git status` too).
- **Token prefix** (`argv: ["git","push"]`): ordered equality on the first N
  tokens of the **stage tail** — the tokens that remain after the stage's
  scope argv prefix is consumed and flags with their consumed arity values are
  removed (06 §6.4).
- **Flags**: base-flag identity (`-x`, `--long`, `--long=value` → base +
  inline value); arity declared in the stage's `flags` table (06 §6.3); `--`
  terminates flags.

## 7.6 Verdict hygiene

- `allow` ⇒ only `static`, only fully-analyzed constructs (I10).
- `deny`/`ask` messages MUST be prescriptive: tell the agent what to do
  ("push to a branch and open a PR", "call commands directly, without bash -c"),
  not just what failed. Hook-side deny budgets (ADR-0010) assume one iteration
  usually suffices.
- `facts` ≤ 16 KiB, depth ≤ 8, no secrets (I6).
- Messages: rule templates + allowlisted interpolation only (I11); checker
  error text never enters `message` (02 §2.4).
