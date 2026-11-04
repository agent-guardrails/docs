# Design: shell-warden config v2 — structured rule matching

v0.1 · 2026-11-04 · Status: draft for review
Ticket: https://github.com/agent-guardrails/docs/issues/13

A field-by-field transformation from the v1 rules grammar
(`schemas/shell-warden.config.v1.schema.json`, spec 06 §6) to a v2 grammar whose
field names state their matching semantics. No backward compatibility with v1
syntax is kept — the engine reads v2 only; migration is mechanical per the
matrix in §3.

## 1. Why the grammar changes

Two structural defects, both hit while hardening a production policy:

1. **Flag-only allow rules are unsafe in multi-binary stages.** The `dev` stage
   covers node/npm/pnpm/bun/cargo/go/terraform. A rule
   `{ "flag": { "--version": "present" }, "action": "allow" }` cannot say
   "the bare version check"; it matches *any* command of *any* stage binary
   that carries the flag — `npm install --version`, `cargo publish --version`.
   The deployed workaround is a hand-maintained deny list of mutating
   subcommands (`dev/deny-mutating`), which is enumeration whack-a-mole and
   silently converts previously-`ask` commands into `deny`.
2. **Names do not communicate semantics.** `argv` is a prefix match over
   flag-cleaned tokens anchored after the stage scope; `flag` is a
   presence/absence map; `argValue` is exists-over-positions globs. Every
   config author must read spec 06 first.

## 2. The rule, before and after

One real rule (deny force-push), both grammars:

```diff
 {
   "id": "git/deny-force-push",
-  "argv": ["push"],
-  "flag": { "--force": "present" },
+  "match": {
+    "executable": "git",
+    "arguments": { "startsWith": ["push"] },
+    "options": { "present": ["--force"] }
+  },
   "action": "deny",
   "message": "git push --force rewrites remote history — forbidden"
 }
```

And the rule v1 cannot express safely (the motivation case):

```jsonc
{
  "id": "dev/allow-version-check",
  "action": "allow",
  "match": {
    "executable": { "anyOf": ["node", "npm", "pnpm", "bun", "cargo", "go", "terraform"] },
    "arguments": { "exact": [] },
    "options": { "present": ["--version"] }
  }
}
```

`arguments.exact: []` reads as "no positional arguments" — so `node --version`
matches and `npm install --version` does not, without any deny list.

## 3. Field-by-field transformation matrix

Legend: **rename** = same semantics, new name; **move** = same semantics, new
location; **restructure** = semantics preserved but shape changes; **new** = no
v1 equivalent; **dropped** = removed without replacement.

### 3.1 Top-level document

| v1 | v2 | Kind | Notes |
|---|---|---|---|
| `version: 1` | `version: 2` | restructure | v2 engine rejects `version: 1` |
| `defaults.action` | `defaults.action` | unchanged | still `ask`-only |
| `defaults.message` | `defaults.message` | unchanged | |
| `limits.*` | `limits.*` | unchanged | configBytes/stages/rules caps |

### 3.2 Stage object

| v1 | v2 | Kind | Notes |
|---|---|---|---|
| `stages[].id` | `stages[].id` | unchanged | |
| `stages[].scope` | `stages[].appliesTo` | rename | "which commands enter this stage" |
| `stages[].scope.anyOf[].argv` | `stages[].appliesTo.anyOf[].executable` | restructure | v1 accepted a multi-token prefix sequence; v2 takes exactly the executable name (string or `{anyOf}`) — anchor is always 1 token. Multi-token scopes were indistinguishable from rule `argv` and are the main source of naming confusion |
| `stages[].scope.anyOf[].pattern` | `stages[].appliesTo.anyOf[].rawCommand` | rename | glob on the raw command text; anchor 0 as before |
| `stages[].flags` | `stages[].options` | rename | the arity table `0..4` the parser consumes; unchanged semantics |

```diff
 {
   "id": "dev",
-  "scope": { "anyOf": [ { "argv": ["node"] }, { "argv": ["npm"] } ] },
-  "flags":  { "--force": 0, "-C": 1 },
+  "appliesTo": { "anyOf": [ { "executable": "node" }, { "executable": "npm" } ] },
+  "options":  { "--force": 0, "-C": 1 },
   "rules": [ … ]
 }
```

### 3.3 Rule object — core conditions

| v1 | v2 | Kind | Notes |
|---|---|---|---|
| `rule.argv` | `rule.match.arguments.startsWith` | rename+move | prefix match over flag-cleaned positional tokens of the stage tail — identical algorithm |
| — | `rule.match.arguments.exact` | **new** | the full positional list, compared exactly; `[]` = bare command. The key that makes flag-only allows safe |
| `rule.argValue` | `rule.match.arguments.values` | rename+move | exists-over-positions globs on decoded token text (OR over globs, ∃ over positions) |
| `rule.flag` (`{name: "present"\|"absent"}`) | `rule.match.options.present: [name…]` / `rule.match.options.absent: [name…]` | restructure | the presence map becomes two lists; AND within and across the lists — exactly the v1 conjunction, now readable |
| `rule.flagValue` (`{name: glob}`) | `rule.match.options.values` (`{name: glob}`) | rename+move | anyOf across entries as in v1 |
| `rule.pattern` | `rule.match.rawCommand` | rename+move | glob on the raw part text |
| `rule.classification` | `rule.match.classification` | move | `static`/`opaque` guard |
| `rule.paths.within` / `rule.paths.notWithin` | `rule.match.paths.within` / `.notWithin` | move | unchanged |

```diff
 {
   "id": "gh/allow-api-get",
-  "argv": ["api"],
-  "flag": { "-X": "absent", "--method": "absent", "-f": "absent", "-F": "absent", "--field": "absent", "--input": "absent" },
+  "match": {
+    "executable": "gh",
+    "arguments": { "startsWith": ["api"] },
+    "options": { "absent": ["-X", "--method", "-f", "-F", "--field", "--input"] }
+  },
   "action": "allow"
 }
```

### 3.4 Rule object — action side

| v1 | v2 | Kind | Notes |
|---|---|---|---|
| `rule.action` | `rule.action` | unchanged | `allow`/`ask`/`deny` |
| `rule.message` | `rule.message` | unchanged | deny/ask only, ≤512 chars |
| `rule.id` | `rule.id` | unchanged | |

### 3.5 Summary of dropped / new

| Change | Item | Reason |
|---|---|---|
| dropped | multi-token `scope.anyOf[].argv` sequences | replaced by single `executable`; multi-token anchoring was implicit and unreadable |
| new | `match.arguments.exact` | bare-command and exact-subcommand matching |
| new | validation: `allow` requires `match.executable` **and** an `arguments` (`exact` or `startsWith`) or `rawCommand` constraint | a flag alone is never sufficient for `allow` — the invariant that removes the deny-list workaround |
| dropped (workaround) | `dev/deny-mutating` in the reference policy | no longer needed once version checks are pinned by `exact: []` |

## 4. New validation invariants (v2)

1. `action: "allow"` ⇒ `match.executable` present **and** at least one of
   `match.arguments.exact`, `match.arguments.startsWith`, `match.rawCommand`
   present. (Flags/options may refine, never carry an allow alone.)
2. `match.options.present`/`absent`/`values` keys must be declared in the
   stage `options` arity table (as v1 required for `flag`/`flagValue`).
3. `match.arguments.exact` and `startsWith` are mutually exclusive in one rule.
4. Everything else from v1 validation carries over (id patterns, message caps,
   arity ≤ 4, deny requires message, allow forbids message).

## 5. Semantics explicitly preserved (no behavior change beyond naming)

- Unknown option (not in the stage `options` table) ⇒ the part is not fully
  parsed for the stage ⇒ `allow` rules do not vote (I10) — unchanged.
- `deny` short-circuits rule matching inside a part; first deny is final.
- Reduction across parts and rules: `deny > ask > allow`, most-restrictive
  wins; aggregate message rules unchanged (spec 08 §8.4).
- Refinement (spec 08 §8.3) carries over with renamed fields: a rule with a
  longer `startsWith`, an `exact` in place of `startsWith`, or strictly more
  bound options/arguments predicates refines the broader one.
- Stage tail anchoring: `appliesTo.executable` consumes exactly the executable
  token; `rawCommand` conditions anchor at 0 — rules match the same cleaned
  tail as in v1.

## 6. Full v2 JSON Schema (draft)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/agent-guardrails/docs/main/schemas/shell-warden.config.v2.schema.json",
  "title": "shell-warden checker configuration v2 (structured rule matching)",
  "type": "object",
  "required": ["version", "stages"],
  "additionalProperties": false,
  "properties": {
    "version": { "const": 2 },
    "defaults": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action": { "enum": ["ask"], "default": "ask" },
        "message": { "type": "string", "maxLength": 512 }
      }
    },
    "limits": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "configBytes": { "type": "integer", "maximum": 262144, "default": 262144 },
        "stages": { "type": "integer", "minimum": 1, "maximum": 64, "default": 64 },
        "rules": { "type": "integer", "minimum": 1, "maximum": 512, "default": 512 }
      }
    },
    "stages": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": { "$ref": "#/definitions/stage" }
    }
  },
  "definitions": {
    "stage": {
      "type": "object",
      "required": ["id", "appliesTo", "options", "rules"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
        "appliesTo": { "$ref": "#/definitions/appliesTo" },
        "options": {
          "type": "object",
          "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 4 }
        },
        "rules": {
          "type": "array",
          "maxItems": 256,
          "items": { "$ref": "#/definitions/rule" }
        }
      }
    },
    "appliesTo": {
      "type": "object",
      "required": ["anyOf"],
      "additionalProperties": false,
      "properties": {
        "anyOf": {
          "type": "array",
          "minItems": 1,
          "maxItems": 16,
          "items": {
            "oneOf": [
              { "required": ["executable"], "additionalProperties": false,
                "properties": { "executable": { "$ref": "#/definitions/nameOrAnyOf" } } },
              { "required": ["rawCommand"], "additionalProperties": false,
                "properties": { "rawCommand": { "type": "string", "minLength": 1, "maxLength": 512 } } }
            ]
          }
        }
      }
    },
    "nameOrAnyOf": {
      "oneOf": [
        { "type": "string", "minLength": 1 },
        { "type": "object", "required": ["anyOf"], "additionalProperties": false,
          "properties": { "anyOf": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1 } } } }
      ]
    },
    "arguments": {
      "type": "object",
      "additionalProperties": false,
      "maxProperties": 2,
      "properties": {
        "exact": { "type": "array", "maxItems": 16, "items": { "type": "string", "minLength": 1 } },
        "startsWith": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1 } },
        "values": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 512 } }
      }
    },
    "optionsMatch": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "present": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1 } },
        "absent": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1 } },
        "values": { "type": "object", "additionalProperties": { "type": "string", "minLength": 1, "maxLength": 256 } }
      }
    },
    "rule": {
      "type": "object",
      "required": ["id", "action"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z][a-z0-9/.-]{0,63}$" },
        "action": { "enum": ["allow", "ask", "deny"] },
        "message": { "type": "string", "minLength": 1, "maxLength": 512 },
        "match": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "executable": { "$ref": "#/definitions/nameOrAnyOf" },
            "arguments": { "$ref": "#/definitions/arguments" },
            "options": { "$ref": "#/definitions/optionsMatch" },
            "rawCommand": { "type": "string", "minLength": 1, "maxLength": 512 },
            "classification": { "enum": ["static", "opaque"] },
            "paths": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "within": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 512 } },
                "notWithin": { "type": "array", "minItems": 1, "maxItems": 16, "items": { "type": "string", "minLength": 1, "maxLength": 512 } }
              }
            }
          }
        }
      }
    }
  }
}
```

(JSON Schema cannot express §4.1 — "allow requires executable + an arguments
constraint"; that stays in engine validation, exactly as v1 kept I10 out of the
schema.)

## 7. Worked migration of the reference policy fragments

| Command | v1 verdict | v2 verdict | Why |
|---|---|---|---|
| `node --version` | allow (flag-only rule) | allow (`exact: []` + `present: ["--version"]`) | pinned to bare commands |
| `npm install --version` | **allow (hole)** | ask | has positional `install`; `exact: []` fails; no allow matches |
| `cargo publish --version` | allow (hole) / deny only via workaround list | ask (or explicit policy deny) | same mechanism; the deny list is no longer load-bearing |
| `npm login -h` | deny (workaround list) | ask | unpinned help flags don't allow; login isn't allowed by anything |
| `git push origin main` | deny | deny | `startsWith: ["push","origin",{anyOf:[main,master]}]` unchanged shape |
| `rm -rf ~/x` | deny (`rm/deny-home`) | deny | `arguments.values` globs, same list |

Full old→new diff of the three dev-stage rules that motivated this:

```diff
-        { "id": "dev/deny-mutating", "argv": [{ "anyOf": ["publish","deploy","login","logout","uninstall","remove","unlink","owner","deprecate","access","token","dist-tag","org","team"] }],
-          "action": "deny", "message": "mutating npm/cargo/go op — forbidden for agents" },
-        { "id": "dev/allow-version-check", "flag": { "--version": "present" }, "action": "allow" },
-        { "id": "dev/allow-version-shortv", "flag": { "-V": "present" }, "action": "allow" },
-        { "id": "dev/allow-help-check", "flag": { "--help": "present" }, "action": "allow" },
-        { "id": "dev/allow-help-shorth", "flag": { "-h": "present" }, "action": "allow" },
+        { "id": "dev/allow-version-check",
+          "match": { "executable": { "anyOf": ["node","npm","pnpm","bun","cargo","go","terraform"] },
+                     "arguments": { "exact": [] },
+                     "options": { "present": ["--version", "-V"] } },
+          "action": "allow" },
+        { "id": "dev/allow-help-check",
+          "match": { "executable": { "anyOf": ["node","npm","pnpm","bun","cargo","go","terraform"] },
+                     "arguments": { "exact": [] },
+                     "options": { "present": ["--help", "-h"] } },
+          "action": "allow" },
```

Four broad flag rules plus a fourteen-entry deny list collapse into two
self-pinned rules; `npm login` returns to `ask` (human decides) instead of
being auto-denied by enumeration.

## 8. Implementation & rollout

1. **This PR (docs)**: design draft; on acceptance promote to
   `spec/shell-warden/06-engine-config.md` + `08-request-processing.md` edits
   and land `schemas/shell-warden.config.v2.schema.json` in the same change.
2. **Follow-up ticket (shell-warden)**: grammar types (`grammar.rs`), matcher
   (`matcher.rs`: `arguments.exact` comparison, executable pin), refinement
   (`refine.rs`: renamed predicates, `exact` > `startsWith` strictness order),
   validation (§4), tests including the verdict table in §7.
3. **User-global config migration**: mechanical per §3 (scriptable
   v1→v2 mapping); deployed together with the engine release.
4. The hook (letter/verdict wire) is untouched — this is config-surface only.

## 9. Open questions

1. Keep multi-binary stages (`dev` covering seven executables), or split into
   per-executable stages and let `appliesTo` shrink to one name? (v2 as drafted
   keeps stages; `match.executable` still pins rules.)
2. Should `arguments.exact` support `{anyOf}` tokens (e.g.
   `exact: [{anyOf:["main","master"]}]`) like `startsWith` does in v1 today?
3. Refinement strictness between `exact` and `startsWith` of the same length —
   proposed: `exact` strictly refines `startsWith`; confirm in implementation.
