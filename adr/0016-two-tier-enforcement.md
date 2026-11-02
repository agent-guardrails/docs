# 0016 — Two-tier enforcement: thin harness hook + one-shot decision binary

* **Status:** Proposed (2026-11-01)
* **Deciders:** preved911
* **Related:** supersedes [0002](0002-stdio-ndjson-rpc-over-mcp.md), [0005](0005-single-evaluate-hook-stages-in-engine.md), [0007](0007-one-evaluation-component.md), [0008](0008-orchestrator-core-logic-in-tools.md); carries 0003, 0009, 0010, 0012, 0013, 0014, 0015 (semantics carried over — see Supersession)

## Context and Problem Statement

The engine M0 (wire, config, stage supervisor, walk) was implemented against
ADR-0002/0005/0008. Reviewing the implemented system surfaced that ADR-0008 had
drained the middle tier of its original justification: the engine owned no
policy ("zero decision logic"), all semantics moved to external stage tools.
What remained between the hook and the tools was one more process, a persistent
protocol with handshake and supervision, and a second config — while the
original design intent (the decision component owns policy; one engine, many thin
adapters) had dissolved. The system returns to the original two-tier sketch:

```
OpenCode → hook (thin, harness-specific) → shell-warden (decision binary: parse + rules + verdict)
```

## Decision Drivers

- The policy must be one auditable artifact: parsing, classification, rules and
  verdict composition live in a single place.
- Fewest moving parts: no persistent protocol, no supervision state machine, no
  second config format.
- Fail-closed end to end, deterministic verdict composition, the model cannot
  influence the checker (I3/I5 posture of 09) — unchanged.
- Harness reuse: the same binary, thin adapters per harness (the reuse goal of
  0002, kept without the engine process).

## Considered Options

1. **Keep three tiers** (persistent engine orchestrator + external stage tools)
   — rejected: after the policy left the engine, the tier's remaining benefits
   (one shared aggregate; supervision) no longer covered its costs; walk
   semantics and tool supervision were already implemented twice (engine walk;
   shim supervision above the engine).
2. **Two tiers: thin hook + one-shot decision binary** — accepted. This is
   ADR-0002's option 3 ("one-shot subprocess per check", the bash-guard posture)
   re-weighed and accepted: its prior drawbacks (interpreter startup, no rule
   compilation, no per-session state) have measured fixes — a compiled-binary
   spawn is milliseconds against the guarded command's runtime, config is
   reread per check, and per-session state moved to the hook.

## Decision Outcome

Option 2.

**shell-warden is a single decision binary**, invoked once per check: it reads
the letter (request JSON) from stdin, writes one JSON verdict to stdout, and the
process exits. No handshake, no id echo, no persistent process, no cache, no
budgets, no audit channel — it is a pure function of the letter and its config.

- **Parsing is the binary's own and complete.** Normalization, AST-level chain
  splitting (recursive: substitutions, redirects, wrappers, interpreters),
  per-part classification (fully analyzable vs undecidable constructs), flag
  recognition against declared arities. Harness-supplied splitting is never
  trusted (0014's principle, enforced inside the binary); a single non-chain
  command is a trivial chain that parses the same way.
- **Shell only** in v1 (the name is the scope); no agent scoping; the
  legibility gate is a standalone binary (see Supersession of 0007). No
  git/env/time context in v1 (placement rules from m1 command text are
  sufficient for v1 rules; context lookups are a v2 candidate).
- **Config** is a user-global rules file (0003 posture): v1.0-flat grammar —
  `stages` (family `scope` with `anyOf` of `argv`/`pattern`, plus the family
  flag-arity table) and **flat rules** (no `when` wrapper): conditions
  `argv` / `argValue` / `pattern` / `classification` /
  `flag(present|absent)` / `flagValue` carried directly on the rule next to
  `action` and optional `message`. Three verdicts `allow | ask | deny`;
  `defaults.action` is always `ask`; unknown fields fail validation. No
  `cacheTtl` anywhere. *(Amended 2026-11-02 during the M1 implementation
  review: the dedicated `paths` condition and positional `argvAt` are folded
  into `argValue` — an array of globs over positional tokens, the mirror of
  `flagValue`; token-semantic interpretation stays out of v1 per N6.)*
- **Matching semantics.** A stage enters on `scope`; all its matching rules
  vote; verdict-wise **the first deny is final** — nothing later can out-rank
  it, and rule matching may short-circuit once a deny is known. Absent denies,
  a rule strictly refined by another matched rule is discarded (precise over
  broad: level-prefix of tokens plus contained flag predicates; the refinement
  code of bash-guard is the reference), survivors reduce most-restrictive.
  `deny`/`ask` may match on partially parsed evidence (raw `pattern` globs);
  **`allow` requires the command to be fully parsed** — unknown flags,
  undecidable substitutes or unparseable input block allow and resolve to ask.
  All chain parts are evaluated regardless (complete per-part diagnostics in
  one pass); only rule matching inside a part may stop early.
- **The hook** (per-harness adapter, OpenCode-specific) builds the letter from
  events, spawns the binary with a deadline, reads the verdict, applies it
  tighten-only ("the most denying wins") and fails closed on spawn failure,
  timeout or garbage (never `allow`). It owns the state, kept next to the
  harness's own config/state: per-session deny budgets (0010), allow cache,
  debug log (letter, verdict, matched rule ids, timing). The hook carries no
  policy logic; the project cannot supply the binary's config (0003).

**Worked config sketch** (full grammar lands in the rewritten 06):

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

## Consequences

- (+) The daemon disappears: handshake, version pinning of a protocol,
  restart/backoff, unhealthy cooldown and in-flight bookkeeping are retired;
  the contract surface is the letter + verdict shapes.
- (+) Policy is one auditable artifact; golden tests cover parsing and rules
  without a harness.
- (+) Harness reuse survives without the engine process: other agents port the
  thin adapter (letter → binary → tighten-only) rather than the engine.
- (−) Per-check process spawn replaces one compiled rule pass (accepted:
  spawn ≪ the guarded command's runtime; measurement re-confirmed in golden
  tests before M1).
- (−) The hook gains invoker/budget/cache logic; the retired shim LOC budget is
  revised in the shim rewrite.
- (=) Security posture unchanged end to end: everything unparseable or unowned
  asks the human; deny dominates; the harness cannot loosen. 0003 (user-global
  trust), 0009 (message composition), 0010 (budgets; now hook-owned), 0012
  (deny dominance), 0013 (substrate/reply automation), 0014 (untrusted payload;
  enforced inside the binary), 0015 (Rust for the decision binary) carry over
  semantically.

## Supersession

| ADR | Disposition |
|---|---|
| [0002](0002-stdio-ndjson-rpc-over-mcp.md) | Superseded — the persistent NDJSON protocol is retired; **stdio with JSON letter/verdict shapes survives** as the one-shot contract; its rejected option 3 (one-shot subprocess) becomes this decision. |
| [0005](0005-single-evaluate-hook-stages-in-engine.md) | Superseded — the single evaluate hook stays, but stages are a config grouping of the binary rather than a routed engine walk; the hook is stage-agnostic. |
| [0007](0007-one-evaluation-component.md) | Superseded — the legibility gate returns to a standalone binary; the guarantee of one non-contradictory next action is deferred to that project's design (out of this ADR's scope). |
| [0008](0008-orchestrator-core-logic-in-tools.md) | Superseded — no orchestrator/tool split; decision logic lives in shell-warden itself; 0014's untrusted-payload principle continues to hold inside the binary. |

## Spec impact and implementation plan

Rewrites land with the implementation PRs (each carries its doc slice; schemas
change with the spec that describes them):

- `02` (protocol) and `05` (engine runtime) retire; letter/verdict shapes are
  frozen as the one-shot contract.
- `06` → the binary's rules grammar (flat, per this document); `07` becomes the
  normative parsing guide of the binary; `08` → decision pipeline of the
  binary + hook application duties.
- `03`/`04` (shim) gain the one-shot invoker, budgets, cache and debug log;
  `09` invariants extend to one-shot anomalies; `10` re-targets the golden
  config; `11` re-baselines the roadmap. Schemas: `wire.v1` retired; new
  letter/verdict and rules-grammar schemas replace it.
- The retired M0 engine implementation stays in the `shell-warden` repository
  as the reference implementation of the retired contracts; the decision core
  (parser + matcher) and the hook's invoker/budgets are new work tracked on
  the board.
