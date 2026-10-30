# 06 — Engine Configuration (`shell-warden.jsonc`)

Version 1 · Schema: `../../schemas/shell-warden.config.v1.schema.json`

## 6.1 Discovery & trust

| Precedence | Path | Trust |
|---|---|---|
| 1 (only) | `$XDG_CONFIG_HOME/opencode/shell-warden.jsonc` (default `~/.config/opencode/shell-warden.jsonc`) | **trusted** — stages, rules, context grants |
| — | `<project>/.opencode/shell-warden.jsonc` | **NOT loaded in v1.** If present ⇒ warning, ignored. Reserved for v2 behind an explicit global-file opt-in (`"allowProjectPolicy": ["<abs path>"]`) |

Rationale: rules are executable policy; a repository MUST NOT be able to ship them (D9/I2). Single file, no cascade.
Reload semantics: `05-engine-runtime.md` §5.3 (watch → validate → atomic swap or last-good).

## 6.2 Top-level schema

```jsonc
{
  "$schema": "./schemas/shell-warden.config.v1.schema.json",
  "version": 1,                              // REQUIRED, must be 1

  "defaults": {
    "action": "ask",                         // verdict when nothing matched — "ask" | "deny" (NOT "allow")
    "onError": "ask"                         // engine-internal failure — "ask" | "deny" (NOT "allow")
  },

  "limits": {                                // engine self-limits (informational to the shim)
    "checkBudgetMs": 4000,                   // keep < shim budgets.checkTimeoutMs
    "factsBytes": 16384,
    "factsDepth": 8,
    "maxAuditPerMinute": 600
  },

  "context": {                               // dynamic context providers (optional, all default off)
    "git": true,                             // branch, upstream, dirty state (per session, staleness-capped)
    "env": ["CI", "POLICY_ENV"],             // env allowlist the engine may read
    "time": true                             // wall-clock windows for rules
  },

  "stages": [ /* §6.3 — REQUIRED, 1..32 entries, unique ids */ ]
}
```

Unknown top-level keys ⇒ config invalid (strict; keep last-good / start fatal). This differs from shim options
(warn+default) deliberately: policy files are trusted input and should be precise.

## 6.3 Stages — routing model

`stages` is an **ordered** array. Per command, the engine walks stages in order; the first stage whose `scope`
matches **owns** the command; owned commands are evaluated against that stage's `rules`.

```jsonc
"stages": [
  {
    "id": "s1",                              // REQUIRED, ^[a-z][a-z0-9-]{0,31}$, unique
    "description": "fast rejects for VCS",   // optional
    "scope": {                               // REQUIRED — which commands enter the stage
      "action": ["shell"],                   // permission actions; default ["shell"]
      "anyOf": [
        { "argv": ["git"] },                 // token-sequence prefix: first token equals "git"
        { "argv": ["gh", "pr"] },            // first two tokens equal "gh","pr"
        { "pattern": "docker *" }            // glob on the raw command; " *" suffix also matches bare "docker"
      ]
    },
    "flags": { "-m": 1, "--message": 1 },    // optional flag arity for this stage's parsing (0 = value-less, 1 = takes value)
    "terminal": true,                        // default true: first matching rule is final for the command
    "exclusive": false,                      // default false: true ⇒ owned commands are REMOVED from later stages
    "passive": false,                        // default false: true ⇒ evaluate rules, never own/exclude (audit-only)
    "rules": [ /* §6.4 */ ]                  // REQUIRED (may be empty ⇒ stage yields defaults.action for owned cmds)
  }
]
```

### Stage semantics

| Field | Default | Meaning |
|---|---|---|
| `scope` | required | `anyOf[]` of matchers; a command matching any matcher enters the stage |
| `terminal` | true | after the first matching rule, stop the stage walk for this command |
| `exclusive` | false | commands owned here never reach later stages — even when no rule matches (they then fall to `defaults.action`) |
| `passive` | false | rule outcomes recorded for audit, but ownership/walk continue; passive stage cannot produce the final verdict |
| `rules` | required | evaluated in order; first `when` match wins (per-command) |

Unowned commands (no stage matched, or only passive stages) ⇒ `defaults.action`, `stage: null`.

This encodes the pipeline the user specified: **stage 1** (small scope, rejects), **stage 2** (catch-all), **stage 3**
(pattern scope, `exclusive: true` so its commands never reach stage 2). Order in the array is the walk order —
register stage 3 *before* stage 2, exactly like hook registration order in the multi-hook mental model.

## 6.4 Rule grammar

```jsonc
{
  "id": "s1/no-push-protected",          // REQUIRED, unique within stage
  "when": {                              // REQUIRED — ALL present conditions must hold (AND)
    "argv": ["push"],                    // ordered subsequence of tokens
    "argvAt": { "1": "push" },           // exact token at 0-based position
    "pattern": "git push *",             // glob on raw command (07 §4)
    "classification": "static",          // "static" | "opaque" — see 07 §2
    "flag": { "--force": "present", "-n": "absent" },
    "flagValue": { "--branch": "release/*" },   // base-flag → value glob (needs stage.flags arity)
    "paths": [ { "within": "project", "glob": "*.env" } ],  // operand-path conditions (07 §6)
    "git": { "branch": { "in": ["main", "release/*"] }, "dirty": false },   // requires context.git
    "env":  { "CI": "true" },            // requires context.env allowlist
    "time": { "cron": "0 18-23 * * 1-5" }   // requires context.time
  },
  "action": "deny",                      // REQUIRED — "allow" | "ask" | "deny"
  "message": "push to protected branch {git.branch} is denied",  // optional; {field} interpolation from context facts
  "cacheTtlMs": 0                        // optional; shim caches allow verdicts only
}
```

Validation rules:
- Unknown `when` keys ⇒ **config invalid** (strict mode — the whole file is last-good/fatal, not per-rule degradation).
- `action: "allow"` rules MUST NOT depend on volatile context (`git`, `env`, `time`) **unless** `cacheTtlMs` is 0 —
  prevents caching context-dependent allows (I9). Validator enforces.
- `argv`/`argvAt`/`flag`/`flagValue` conditions on an `opaque` command never match `allow` actions
  (allow requires `classification: "static"` — 07 §2.3).

## 6.5 Worked example

```jsonc
{
  "version": 1,
  "defaults": { "action": "ask", "onError": "ask" },
  "context": { "git": true },
  "stages": [
    { "id": "s1",
      "scope": { "anyOf": [ { "argv": ["git"] } ] },
      "rules": [
        { "id": "s1/no-push-protected",
          "when": { "argv": ["push"], "git": { "branch": { "in": ["main", "release/*"] } } },
          "action": "deny",
          "message": "branch {git.branch} is protected; use a worktree + PR" },
        { "id": "s1/allow-inspect",
          "when": { "argv": [ { "anyOf": ["status", "diff", "log"] } ] },
          "action": "allow", "cacheTtlMs": 60000 }
      ] },
    { "id": "s3",
      "exclusive": true,
      "scope": { "anyOf": [ { "pattern": "docker *" } ] },
      "flags": { "-v": 1, "--volume": 1 },
      "rules": [
        { "id": "s3/no-mount-root", "when": { "flagValue": { "-v": ":/:*" } }, "action": "deny" },
        { "id": "s3/allow-build",   "when": { "argv": ["build"] }, "action": "allow", "cacheTtlMs": 30000 }
      ] },
    { "id": "s2",
      "scope": { "anyOf": [ { "pattern": "*" } ] },
      "rules": [ { "id": "s2/deny-sudo", "when": { "argv": ["sudo"] }, "action": "deny" } ] }
  ]
}
```

Walk of `git push origin main`: s1 scope ✓ → `s1/no-push-protected` matches (argv ∧ branch) → `deny`, terminal.
Stage s2 never sees it. Walk of `docker run -v /:/host alpine`: s3 owns (exclusive) → `s3/no-mount-root` → `deny`;
s2 excluded. Walk of `npm test`: s1 ✗, s3 ✗, s2 scope ✓ → no rule matches → `defaults.action` = `ask`.

## 6.6 Size & sanity limits

| Limit | Value |
|---|---|
| stages | ≤ 32 |
| rules per stage | ≤ 512 |
| `scope.anyOf` matchers | ≤ 64 |
| total file size | ≤ 256 KiB |
| `message` length | ≤ 512 chars |
| interpolation placeholders | context fields only; unknown field ⇒ config invalid |
