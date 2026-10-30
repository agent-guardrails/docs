# 07 — Command Parsing (Engine Domain)

Version 0.1 · 2026-10-30

## 7.1 Input contract

For each `policy/check` the engine receives `commands[].raw` — the command text as OpenCode produced it — plus
`cwd`. OpenCode's native shell scanner has already split compound commands into subcommands across Bash/Zsh/sh/
PowerShell and refuses to execute what it cannot analyze (it returns a scanner error instead of running unverified
subcommands). The engine MUST still **re-parse defensively**: never assume the split is complete. Any operator
(`|`, `||`, `&&`, `;`, `&`, newline) or substitution remaining in `raw` classifies the whole command `opaque`
(defense in depth, §7.7).

## 7.2 Classification — `static` vs `opaque`

Every command element is classified before rule matching:

| Class | Meaning | Examples |
|---|---|---|
| `static` | fully analyzable after normalization: literal tokens, wholly-static quoting, no expansions | `git push origin main`, `docker run -v /data:/data alpine` |
| `opaque` | contains constructs the engine refuses to resolve | `echo $(whoami)`, `` git commit -m "`date`" ``, `rm $TARGET`, `git push "$BRANCH"`, `cat f_* | xargs rm` |

**Normative rule (fail-closed matching):** an `allow` verdict may originate ONLY from a rule matched against a
`static` command. `deny`/`ask` rules MAY match any classification. Concretely: `when` conditions of an
`action: "allow"` rule are evaluated only if `classification === "static"`; on `opaque` they are treated as
non-matching, and the walk continues (eventually reaching `defaults.action` = ask). An allow rule may make this
explicit with `"when": { "classification": "static", ... }`.

## 7.3 Normalization pipeline

Applied in order; each step feeds the next. Steps 4–6 produce the classification.

1. **Encoding**: UTF-8, Unicode NFC.
2. **Whitespace**: trim; collapse runs of whitespace outside quotes to single spaces.
3. **Quote decoding**: decode *wholly-static* quoting only — `'…'` and `"…"` whose contents contain no expansions
   (bash-guard heritage: "decodes wholly static quoting"). Records the original span for audit.
4. **Expansion scan** — any of the following marks the command `opaque`:
   `$(`, backtick, `${`, `$NAME` (parameter expansion), process substitution `<(`/`)>`, arithmetic `$((`,
   brace expansion `{a,b}`, tilde in a *command* token (tilde is allowed only inside path operands, §7.6),
   glob metacharacters in the **command word** (position 0).
5. **Operator scan** — any remaining operator or redirection (`|`, `&&`, `;`, `&`, newline, `>`, `>>`, `<`, `<<`,
   `2>`, `&>`) ⇒ `opaque`. (The scanner should have split compound commands; seeing operators means the input is
   outside the assumed contract.)
6. **Env-prefix extraction**: leading `NAME=value` tokens are stripped from the argv sequence and recorded as
   facts (`envAssignments`); they do not affect matching beyond audit.
7. **Tokenization**: split on whitespace respecting the decoded quoting. Token 0 = command word; remaining = argv.

Output of normalization: `{ classification, tokens[], argv[] (tokens minus command word), envAssignments[],
redirects[] (if any ⇒ opaque), raw }`.

## 7.4 Pattern semantics (`pattern` conditions and scope matchers)

OpenCode-compatible whole-value glob dialect on the **raw (normalized) command string**:

| Syntax | Meaning |
|---|---|
| `*` | zero or more characters, including spaces and `/` |
| `?` | exactly one character |
| other chars | literal, case-sensitive |
| trailing `" *"` | additionally matches the command without arguments: `git status *` matches both `git status` and `git status --short` |

`pattern` matching is performed against the normalized raw string (quotes decoded, whitespace collapsed).
Escaping is not supported in v1 — a literal `*` in a command cannot be expressed; treat such rules as invalid
config (strict mode).

## 7.5 Token & flag matching

Used by `argv`, `argvAt`, `flag`, `flagValue` conditions.

- **`argv: ["git","push"]`** — ordered prefix match on the token sequence (token 0 = command word).
- **`argvAt: {"1": "push"}`** — exact token at 0-based position (0 = command word).
- **Base-flag identity** (bash-guard heritage): a token is a flag iff it starts with `-`, is neither `-` nor `--`,
  and contains no whitespace or `=`. `--flag=value` is normalized to base flag `--flag` + inline value `value`.
- **Arity** — stage-level `flags` declaration (`{"-m": 1}`) is authoritative for consuming the next token as a
  value. Undeclared arity: a flag followed by a non-flag token records an *ambiguous* pair; `flagValue` conditions
  do not match ambiguous pairs (fail-closed).
- **`--` separator**: everything after a bare `--` is an operand; flags cannot appear after it; `flag` conditions
  do not see them.
- **`flag: {"--force": "present"}`** — presence/absence among declared-arity flags and inline-value normalizations.
- **`flagValue: {"--branch": "release/*"}`** — glob (§7.4) against the resolved value: explicit `--branch=x`,
  `--branch x` (arity 1), or inline normalization. Ambiguous ⇒ no match.

## 7.6 Path conditions (`when.paths`)

```jsonc
"paths": [ { "operandIndex": 0, "within": "project", "glob": "*.env" } ]
```

- `operandIndex` — 0-based index among non-flag operands (default: all operands).
- `within`: `"cwd"` | `"project"` | `"home"` | `"any"` — the canonicalized absolute path must be inside that root.
  `project` requires `invocation.projectDir`; commands without it cannot match `project` (fail-closed).
- Canonicalization: `~` and `$HOME` expanded (home root only); `..` resolved lexically; backslashes → slashes.
  **Symlinks are NOT resolved in v1** — documented limitation; `within` checks are lexical.
- Glob: §7.4 dialect relative to the `within` root.

## 7.7 Opaque handling

| Aspect | Rule |
|---|---|
| `allow` rules | never match (§7.2 — normative fail-closed) |
| `deny` / `ask` rules | match normally (e.g., a deny-by-pattern rule still blocks `sudo $(cat cmd)` if `pattern: "sudo *"` fits) |
| `when.classification` | explicit `"static"` or `"opaque"` condition for rules that care |
| no rule matched | `defaults.action` (`ask` by default) — the native prompt decides |
| response marking | `commands[].classification: "opaque"`; reason string notes the construct class (never the raw content beyond the command already visible in the prompt) |
| engine internals | opaque commands skip tokenization-dependent conditions; pattern-on-raw conditions still evaluated |

This mirrors OpenCode's own scanner philosophy: refuse to be clever about what cannot be proven; degrade to the
human.

## 7.8 Examples

| Raw command | Class | Notes |
|---|---|---|
| `git push origin main` | static | tokens: `git push origin main` |
| `git commit -m "fix typo"` | static | wholly-static quoting decoded |
| `FOO=1 npm test` | static | env prefix extracted, `npm test` matched |
| `git commit -m $MSG` | opaque | parameter expansion |
| `echo $(date)` | opaque | command substitution |
| `kubectl logs app \|\| true` | opaque | residual operator (scanner would normally split) |
| `tar -cf backup.tar ~` | static (tilde) | tilde in operand OK; matches only path conditions after expansion |
| `./run *` (literal asterisk arg) | static | glob char in non-command token stays literal for token matching; `pattern` globs still treat `*` as wildcard — document in rules |
| `docker run -v /:/host alpine` | static | `flagValue { "-v": ":/:*" }` matches inline-value form |
| `docker run -v /:/host --rm alpine` | static | same, arity-1 flag mid-argv |

