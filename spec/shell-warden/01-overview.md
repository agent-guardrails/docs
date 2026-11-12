# 01 — Overview

Version 2.2 · 2026-11-12 · Revised per [ADR-0016](https://github.com/agent-guardrails/docs/blob/main/adr/0016-two-tier-enforcement.md)
and [ADR-0023](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md). [ADR-0020](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md)
and [ADR-0022](https://github.com/agent-guardrails/docs/blob/main/adr/0022-post-schema-shell-warden-verdict-validation.md) are historical provenance.

## 1. Summary

`opencode-shell-warden-hook` enforces arbitrary permission policy in OpenCode V2 through two tiers:

1. **Hook** — a thin V2 plugin (`@opencode/plugin`, in-process). It owns only: receiving permission
   events, building the **letter** (request JSON), spawning the decision binary once per check with a
   deadline, applying the **verdict** tighten-only, per-session state (deny budgets, allow cache,
   debug log), and fail-closed degradation. Target ≤ 400 lines.
2. **Decision binary (`shell-warden`)** — a one-shot process owning everything about policy:
   command parsing and chain splitting (`07-command-parsing.md`), rule matching and verdict
   composition (`08-request-processing.md`), the rules grammar (`06-engine-config.md`). It is a pure
   function of the letter and its config: reads the letter from stdin, writes one verdict JSON to
   stdout, exits. Implemented in Rust (ADR-0015); this spec fixes the **letter/verdict contract**
   and the **rules grammar**, not internals.

**D1 (foundational decision):** the substrate itself is the fail-closed boundary (ADR-0013).
The hook does NOT register a permission evaluate hook (a hook-allow cannot suppress a configured
`ask` on OpenCode v2.2.x, and re-entrant HTTP inside permission processing deadlocks). Instead the
user configures `shell → ask` natively, and the hook **answers published permission requests**
(`permission.reply`): allow executes, deny rejects with the reason, and an unanswered ask reaches
the human by silence.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Enforce policy with verdicts `allow / ask / deny` and human-readable reasons surfaced in native prompts/denials |
| G2 | Binary reusable from other harnesses (Claude Code hooks, CI, wrappers) — one binary, thin adapters per harness |
| G3 | Fail-closed: every anomaly degrades to `ask` or `deny`, never `allow` |
| G4 | Policy as one auditable artifact: parsing, classification, rules and verdict composition in a single binary |
| G5 | Policy config a repository cannot widen (user-global trust anchor, ADR-0003) |

## 3. Non-goals (v1)

| # | Non-goal |
|---|---|
| N1 | Not a sandbox — the checker decides; execution stays unconstrained (OS sandbox is a separate layer) |
| N2 | No prompting of its own — `ask` resolves to OpenCode's native permission prompt |
| N3 | No remote/network policy sources |
| N4 | No MCP face (planned post-v1) |
| N5 | Shell only — the name is the scope; other action types (edit/read) need path-canonicalization work first |
| N6 | No context lookups (git/env/time) in v1 — placement rules from command text suffice for v1 rules (ADR-0016) |

## 4. Architecture

```
┌─ OpenCode server ──────────────────────────────────────────────┐
│  permission rules ─ policies   (native layers, outrank plugin) │
│  ┌─ hook (in-process) ──────────────────────────────────────┐  │
│  │  permission.asked subscriber → reply automation          │  │
│  │  ctx.tool.hook("execute.after", cacheEvict + budgets)    │  │
│  │  invoker: spawn ▸ letter ▸ deadline ▸ verdict ▸ exit     │  │
│  │  state: deny budgets (0010) · allow cache · debug log    │  │
│  └──────────────────┬───────────────────────────────────────┘  │
└─────────────────────┼──────────────────────────────────────────┘
                      │ one letter in, one verdict out (02-letter-verdict.md)
          ┌───────────▼─────────────────────────┐
          │ shell-warden (one-shot)     │
          │ config ~/.config/shell-warden/...   │
          │ parse (07) → match (08) → verdict   │
          └─────────────────────────────────────┘
```

Decision flow for one shell tool call:

1. Native permission rules evaluate. `deny` → final, hooks never run. `allow`/`ask` → continue.
2. For a configured `ask`, OpenCode publishes the permission request; the hook's subscriber fires.
3. Hook builds the letter and spawns the checker (fresh or cached verdict).
   Checker: parse → classify → match staged rules → verdict.
4. Hook applies the verdict tighten-only via `permission.reply` (`allow` → "once",
   `deny` → reject with reason, `ask` → no reply → human).
5. Native policies/rule layers still outrank everything the hook did.
6. Execution; `create.before` optionally observes the final command (audit only).

## 5. Component boundaries

| Concern | Owner | Spec |
|---|---|---|
| Reply automation, letter/verdict application, per-session state | hook | 03 |
| Hook options | hook | 04 |
| Spawn contract (one-shot), letter/verdict shapes, exit codes | both | 02 |
| Checker invocation failure semantics | hook | 03, 09 (matrix) |
| Rules grammar (stages, rules, flags, conditions) | checker | 06 |
| Parsing: normalization, chain split, classification | checker | 07 |
| Single-command pipeline: match, refine, aggregate | checker | 08 |
| Trust, invariants, fail-closed | both | 09 |

## 6. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Substrate is the fail-closed boundary; hook answers published permission requests | ADR-0013; evaluate-hook allow-downgrade and deadlock findings (10 §10.5) |
| D2 | Two tiers: thin hook + one-shot decision binary; no persistent process, handshake or supervision | ADR-0016; fewest moving parts after policy left the orchestrator |
| D3 | One policy artifact: parsing, classification, rules, verdict composition live in the binary | ADR-0016 supersedes 0005/0007/0008; auditability |
| D4 | Fail-closed everywhere; `onCheckerError ∈ {ask, deny}` | ADR-0001 heritage; a checker anomaly can never widen access |
| D5 | Checker + config from user-global scope only; project copies ignored with warning | ADR-0003; rules are executable policy |
| D6 | Hook owns per-session state: deny budgets (ADR-0010), allow cache, debug log | ADR-0016; the binary is stateless, hook keeps no policy logic |
| D7 | `allow` originates only from `static` classification; `opaque` and `invalid` cannot allow | ADR-0001/0016; defense against obfuscation and malformed evidence (I10) |
| D8 | Checker in Rust (ADR-0015); letter/verdict shapes stay harness-neutral | compiled-binary spawn is milliseconds against the guarded command |
| D9 | Tighten-only application; the reply API never loosens an existing deny | ADR-0013; reducing to `ask` is not loosening — allow only on a checker `allow` |
| D10 | Verdict v2 is the only active response envelope and carries explicit `invalid` classification, with fail-closed post-schema validation | ADR-0023; v1 schemas and prior ADRs are historical provenance, never runtime fallback |
