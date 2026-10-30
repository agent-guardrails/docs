# 01 — Overview

Version 0.1 · 2026-10-30

## 1. Summary

`opencode-shell-warden-hook` enforces arbitrary permission policy in OpenCode V2 through two components:

1. **Shim** — a thin V2 plugin (`@opencode/plugin`, in-process). It owns only: spawning/supervising the engine,
   speaking the wire protocol (`02-protocol.md`), applying verdicts to hook events, enforcing budgets, and
   fail-closed degradation. Target ≤ 400 lines.
2. **Engine (`shell-warden`)** — a persistent child process owning everything about policy: command parsing
   (`07-command-parsing.md`), stage routing and rule matching (`08-request-processing.md`), verdicts, audit.
   Implementable in any language; this spec fixes only the **wire contract** and **config schema**.

**D1 (foundational decision):** the shim registers **one** `ctx.permission.hook("evaluate", ...)`. Multi-stage
pipelines ("stage 1 rejects a subset; stage 2 only for the rest; stage 3 owns pattern matches exclusively") are
expressed in **engine config**, not as separate OpenCode hook registrations. Rationale: the harness invokes every
registered evaluate hook — per-stage skipping cannot be configured, only implemented; keeping it engine-side makes
it testable without OpenCode and keeps the shim auditable.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Enforce policy with verdicts `allow / ask / deny` and human-readable reasons surfaced in native prompts/denials |
| G2 | Engine reusable from other harnesses (Claude Code hooks, CI, wrappers) — one engine, many thin adapters |
| G3 | Fail-closed: every anomaly degrades to `ask` or `deny`, never `allow` |
| G4 | Deterministic, versioned wire protocol with budgets enforced on both sides |
| G5 | Policy config a repository cannot widen (user-global trust anchor) |

## 3. Non-goals (v1)

| # | Non-goal |
|---|---|
| N1 | Not a sandbox — the engine decides; execution stays unconstrained (OS sandbox is a separate layer) |
| N2 | No prompting of its own — `ask` delegates to OpenCode's native permission prompt |
| N3 | No remote/network policy sources |
| N4 | No MCP face (planned post-v1) |

## 4. Architecture

```
┌─ OpenCode server ──────────────────────────────────────────────┐
│  permission rules ─ policies   (native layers, outrank plugin) │
│  ┌─ shim (in-process) ───────────────────────────────────────┐ │
│  │  ctx.permission.hook("evaluate", applyVerdict)            │ │
│  │  ctx.shell.hook("create.before", observe)    [audit-only] │ │
│  │  ctx.tool.hook("execute.after", cacheEvict)               │ │
│  │  supervisor: spawn ▸ handshake ▸ pool ▸ restart           │ │
│  └──────────────┬────────────────────────────────────────────┘ │
└─────────────────┼──────────────────────────────────────────────┘
                  │ NDJSON / JSON-RPC 2.0 over stdio   (02-protocol.md)
          ┌───────▼──────────────────────────┐
          │ shell-warden engine (persistent child)│
          │ config shell-warden.jsonc (06)        │
          │ parse (07) → walk (08) → verdict │
          └──────────────────────────────────┘
```

Decision pipeline for one shell tool call:

1. Native permission rules evaluate. `deny` → final, hooks never run. `allow`/`ask` → continue.
2. Shim `evaluate` hook fires → `policy/check` → engine verdict (possibly cached).
3. Shim applies verdict **tighten-only** to `event.effect` / `event.message`; unchanged `ask` = native prompt.
4. Native policies may still hard-deny after the chain.
5. Execution; `create.before` optionally observes the final command (audit only).

## 5. Component boundaries

| Concern | Owner | Spec |
|---|---|---|
| Hook registration, verdict application, cache | shim | 03 |
| Plugin options | shim | 04 |
| Process supervision (spawn/restart/health) | shim | 03, 05 (contract) |
| Wire messages, budgets, errors | both | 02 |
| Config format (stages, rules) | engine | 06 |
| Command parsing/normalization | engine | 07 |
| Check pipeline, stage walk, aggregation | engine | 08 |
| Trust, invariants, fail-closed | both | 09 |

## 6. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Single `evaluate` registration; stages live in engine config | see §1 |
| D2 | NDJSON JSON-RPC 2.0, id-multiplexed, no batching | minimal, auditable shim; MCP ceremony buys nothing for a private 1:1 channel |
| D3 | Fail-closed everywhere; `onEngineError ∈ {ask, deny}` | bash-guard heritage; a checker can never widen access |
| D4 | Engine path from user-global config only; absolute argv; empty env | repo cannot point the shim at its own engine |
| D5 | Budgets enforced by the shim regardless of engine behavior | deadline, frame caps, in-flight cap, kill grace |
| D6 | Shim caches `allow` verdicts only, TTL from engine | deny must stay fresh; caching a deny risks staleness after config change |
| D7 | Engine `message` copied to `event.message` | reasons visible in native prompts |
| D8 | Protocol version exact-match at handshake | mismatch ⇒ degrade, never guess |
| D9 | Engine config: user-global file only; project file ignored with warning | rules are executable policy [R§5.2] |
