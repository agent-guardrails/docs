# 06 — Checker Configuration: Rules Grammar (flat, v1)

Version 2.0 · 2026-11-01 · Supersedes config v1.1 (tool-first stages) per
[ADR-0016](../../adr/0016-two-tier-enforcement.md)

Schema: `schemas/shell-warden.config.v1.schema.json`

The checker owns ALL policy: normalization, chain splitting, classification
(`07-command-parsing.md`), rule matching and verdict composition
(`08-request-processing.md`). The config is a declarative rules file — there
are no external stage tools, no walk invocations, no second process tier
(ADR-0016 supersedes 0005/0007/0008; ADR-0008's orchestrator/tool split is
retired together with the persistent engine).

## 6.1 Config file & trust

| | |
|---|---|
| Path | `$XDG_CONFIG_HOME/shell-warden/config.jsonc` — single file, user-global only (ADR-0003) |
| Override | `--config FILE` argv (absolute path; hook option, 04) |
| Trust | The file IS executable policy; a repository can never supply it (ADR-0003). The hook validates this posture per 04 §4.3 |

**No reload machinery**: the checker re-reads and re-validates the file on
every spawn (02 §2.5). Strict validation: unknown keys, wrong types, cap
violations, unresolved cross-references ⇒ config invalid ⇒ exit 2 (never
fail-open, I3). Valid comments (`jsonc`) allowed; JSONC syntax errors are
invalid config.

## 6.2 Top-level schema

```jsonc
{
  "version": 1,                       // REQUIRED, must be 1
  "defaults": {
    "action": "ask",                  // MUST be "ask" (fail-closed default); no other value accepted
    "message": "no rule matched — ask the human"   // optional generic ask message
  },
  "limits": {
    "configBytes": 262144,            // file size cap; larger ⇒ invalid
    "stages": 64,                     // hard cap on stage count
    "rules": 512                      // hard cap on total rule count
  },
  "stages": [ /* §6.3 — REQUIRED, unordered (order is NOT significant) */ ]
}
```

## 6.3 Stage schema (scope + flag table + rules)

A **stage** is a family scope: the checker enters a stage when the command
satisfies its `scope`, then evaluates the stage's rules. Nothing else is
carried on a stage — no tool, no lifecycle, no budget, no `messageMode`, no
`exclusive`, no per-stage `onError` (all of that either lives in the binary's
pipeline or is hook-owned, 03/08).

```jsonc
{
  "id": "vcs",                         // REQUIRED, ^[a-z][a-z0-9-]{0,31}$, unique
  "scope": {                           // REQUIRED; stage enters when ANY condition matches
    "anyOf": [
      { "argv": ["git"] },             // ordered token-prefix match (§6.4)
      { "pattern": "docker *" }        // raw glob on the raw command string (§6.4)
    ]
  },
  "flags": {                           // the family flag-arity table (§6.4)
    "-f": 0, "--force": 0, "-C": 1, "-m": 1
  },
  "rules": [ /* §6.5 — REQUIRED (may be empty) */ ]
}
```

- `scope.conditions`: `argv` (array of strings or `{ "anyOf": [strings] }` values) or
  `pattern` (string glob). An empty `anyOf` ⇒ invalid.
- `flags`: map flag-name → arity (`0`–`4`). A flag used in rules but absent from
  the stage table ⇒ invalid config (arity alone decides how values are consumed:
  `--long=value` consumes none; arity N consumes the next N tokens).

## 6.4 Matching primitives

| Primitive | Semantics |
|---|---|
| `argv` tokens | ordered equality on token positions; strings compare literally; `{anyOf}` matches one of the alternatives; tokens MUST match contiguously from left to right |
| `pattern` | glob on the **raw** string (OpenCode-compatible): `*` = zero+ chars incl. spaces; `?` = one char; trailing `" *"` also matches the bare command (`git status *` matches `git status` too) |
| flag recognition | base-flag identity: `-x`, `--long`, `--long=value` → base flag + inline value; arity N ⇒ the next N tokens are values; `--` terminates flag parsing (rest = positional) |
| paths | lexical canonicalization only — symlinks are NOT resolved (documented limitation, T9); `within` checks are advisory for hostile layouts |

## 6.5 Rule schema (flat)

```jsonc
{
  "id": "vcs/no-force-push",           // REQUIRED, ^[a-z][a-z0-9/.-]{0,63}$, unique within file
  "argv": ["push"],                    // condition: token sequence (§6.4)
  "flag": { "--force": "present" },    // condition: flag → "present" | "absent"
  "action": "deny",                    // REQUIRED, "allow" | "ask" | "deny"
  "message": "push --force is forbidden — history is protected; push to a branch and open a PR"
                                     // OPTIONAL per ADR-0016, but SHOULD be present on
                                     // deny/ask (prescriptive, 07 §7.6); absence ⇒
                                     // defaults.message. Ignored on allow.
}
```

Full condition set (v1, closed — new conditions need a schema+spec bump):

| Condition | Type | Matches when |
|---|---|---|
| `argv` | array (string or `{anyOf}`) | contiguous token sequence from the part's token list |
| `argvAt` | array of `{ "at": int, "one": string or {anyOf} }` | the token at each given 0-based position matches (order of entries irrelevant) |
| `pattern` | string glob | the **raw** command string matches (07 §7.5) |
| `classification` | `"static"` \| `"opaque"` | the part's classification equals (07 §7.3) |
| `flag` | map flag → `"present"` \| `"absent"` | every entry holds for the parsed flag set |
| `flagValue` | map flag → glob | the flag's value (inline `--flag=v` or the following token per arity) matches the glob |
| `paths` | `{ "within": [globs], "notWithin"?: [globs] }` — against `paths` arguments of the command, resolved per 07 §7.4 | every referenced path resolves inside/outside all globs (`$project` token expands to the letter's `invocation.projectDir`) |

Multiple conditions on one rule AND together. A rule with zero conditions
matches everything. Unknown conditions, unknown fields ⇒ invalid config
(strict).

## 6.6 Verdict semantics (see 08 for the full pipeline)

- Only stages whose `scope` matched are consulted; within them, all matching
  rules **vote**.
- **First deny is final**: nothing outranks a deny; rule matching may
  short-circuit once a deny is known (08 §8.2). Absent denies, a matched rule
  strictly refined by another matched rule is discarded (precise over broad —
  08 §8.3), and survivors reduce most-restrictively.
- `deny`/`ask` rows may match on **partially parsed evidence** (raw `pattern`
  globs, per-part classifications). **`allow` requires the command to be fully
  parsed** — unknown flags, undecidable substitutions or unparseable input
  block allow and resolve to `defaults.action` (`ask`), never silently run (I10).
- `defaults.action` is always `ask`; there is no configurable default action
  and no `allow` default.

## 6.7 Worked example

```jsonc
{
  "version": 1,
  "defaults": { "action": "ask" },
  "stages": [
    { "id": "vcs",
      "scope":  { "anyOf": [ { "argv": ["git"] } ] },
      "flags":  { "-f": 0, "--force": 0, "-C": 1, "-m": 1 },
      "rules": [
        { "id": "vcs/no-force-push",
          "argv": ["push"], "flag": { "--force": "present" },
          "action": "deny", "message": "push --force is forbidden — history is protected" },
        { "id": "vcs/allow-inspection",
          "argv": [ { "anyOf": ["status", "log", "diff"] } ],
          "action": "allow" }
      ] },
    { "id": "docker",
      "scope":  { "anyOf": [ { "argv": ["docker"] }, { "pattern": "docker *" } ] },
      "flags":  { "-v": 1, "-d": 0 },
      "rules": [
        { "id": "docker/no-root-mount",
          "argv": ["run"], "flagValue": { "-v": ":/:*" },
          "action": "deny", "message": "do not mount / into the container" }
      ] },
    { "id": "catch-all",
      "scope":  { "anyOf": [ { "pattern": "*" } ] },
      "flags":  {}, "rules": [] }   // no rule matches ⇒ defaults.action = ask
  ]
}
```

## 6.8 Checker CLI

- `shell-warden [--config FILE]` — letter on stdin (02 §2.2), verdict
  on stdout (02 §2.3); the only mode; exit codes per 02 §2.4.
- Config default path: `$XDG_CONFIG_HOME/shell-warden/config.jsonc` (§6.1).
- Implementation language: Rust (ADR-0015); repository `shell-warden` (the
  retired M0 engine implementation remains there as reference only).

## 6.9 Profiles

Enabling/disabling families = editing the file (remove/disable a stage's rules
or empty its `rules`), with the `catch-all` stage left in place. There is no
runtime profile mechanism: one file, re-read per check (§6.1). Keep a `-`
suffixed comment copy of disabled stages if rollback matters.

## 6.10 Golden requirement

Every shipped example config MUST be covered by the golden suite (10 §10.2);
every rule in it MUST have at least one positive and one negative case.
