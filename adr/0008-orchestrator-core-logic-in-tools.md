# 0008 — Engine core is a pure orchestrator; decisions live in stage tools

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/06](../spec/shell-warden/06-engine-config.md), [07](../spec/shell-warden/07-command-parsing.md), [08](../spec/shell-warden/08-request-processing.md)

## Context and Problem Statement

The v1.0 draft specified a declarative rule grammar inside the engine (scopes,
kinds, families, when-conditions with flagValues, paths, git/env/time
context). Every design discussion added grammar: kind, scope, family, failure
policies — and each addition needed its own "what wins" semantics. Separately,
the readability gate (deny unreadable, recommend reformat) removes the need for
deep universal parsing: agents are forced to issue readable commands, which are
trivial to match.

## Decision Drivers

- Expressiveness: any new requirement (branch checks, ticket lookups, MCP
  routing) must not require engine grammar extensions.
- A thin, permanently auditable core (LOC budget).
- Fast, reliable decisions without "a quorum of agents" (no semantic guessing).
- Precedent: Claude Code parses/presents commands automatically — burden of
  readability can sit on the model/harness side, not on an analysis engine.

## Considered Options

1. **Full declarative grammar in the engine** — expressive, but the grammar
   grows with every use case; spec churn; "config as a poor programming
   language".
2. **Grammar + external checks as an escape hatch** (bash-guard model) —
   two matching mechanisms, two vocabularies.
3. **Tool-first: every stage is an external tool; the core only walks stages,
   invokes tools and aggregates.** Declarative matching ships as a reference
   tool (`warden-match`) with its own rule-file contract.

## Decision Outcome

Option 3. The engine core contains **zero decision logic**; all semantics live
in stage tools behind a versioned invocation contract (06 §6.4).

## Consequences

- (+) The core is permanently thin and audit-friendly; expressiveness is
  unlimited (any language, any logic) without touching the core.
- (+) Reference tools keep the easy path: "deny `rm -rf`" = install
  `warden-match` + five config lines, no binary authoring.
- (+) Parsing depth becomes a per-tool decision (compile-language tools make
  deep parsing cheap) instead of a spec commitment.
- (−) Distribution: config is no longer self-sufficient — stage binaries ship
  alongside (user-global, sha256-pinned; ADR-0003).
- (−) Parsing is duplicated across tools that need it; accepted — each tool
  parses exactly as deeply as its decisions require.
- (−) Behavior is no longer fully described by config alone; the stage-tool
  invocation contract (06 §6.4) and tool docs together form the truth.
