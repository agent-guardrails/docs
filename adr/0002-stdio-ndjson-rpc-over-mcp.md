# 0002 — Enforcement via persistent engine over NDJSON JSON-RPC stdio

* **Status:** Superseded by [0016 — Two-tier enforcement](0016-two-tier-enforcement.md) (2026-11-01)
* **Deciders:** preved911
* **Related:** [spec/shell-warden/02-protocol.md](../spec/shell-warden/02-protocol.md), ADR-0005

## Context and Problem Statement

OpenCode V2 plugins run in-process (TypeScript, plugin API). Policy logic beyond wildcards — command
parsing, stage routing, context lookups, per-session state — is substantial and changes often. Where
should this logic live, and how does the hook talk to it?

## Decision Drivers

- Enforcement must be unconditional: the model must not be able to skip or influence the checker.
- Policy machinery should be reusable from other harnesses (Claude Code hooks, CI) and testable
  without OpenCode.
- The hook plugin must stay thin and auditable (LOC budget, no heavy dependencies).
- Checks happen before every guarded command: overhead per call must stay negligible.

## Considered Options

1. **All logic in the plugin** — no external process. Monolithic, npm/TS-bound, hard to reuse.
2. **Engine as an OpenCode MCP server** — tools are model-invocable, so they cannot enforce; MCP
   ceremony inside the security-critical shim buys nothing for a private 1:1 channel.
3. **One-shot subprocess per check** (bash-guard `external-check` style) — stateless, but interpreter
   startup per command, no rule compilation, no per-session state.
4. **Persistent engine child process, NDJSON JSON-RPC 2.0 over stdio** — lazy spawn, exact-version
   handshake, request multiplexing, deadline and restart supervision.

## Decision Outcome

Option 4. The plugin registers one `permission.evaluate` hook and forwards invocations; the engine
answers `allow / ask / deny` per check. Consequences:

- (+) Engine is language-free and harness-free (implemented from `docs` schemas alone).
- (+) Shim stays small: transport, supervision, tighten-only mapping.
- (+) Verification possible without OpenCode: contract tests against a mock engine.
- (−) Daemon lifecycle must be engineered: restarts with backoff, unhealthy cooldown, dispose.
- (−) Protocol is a versioned contract now (`wire.v1.schema.json`); mismatches fail closed.
