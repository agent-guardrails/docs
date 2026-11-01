# 0015 — Engine and reference tools are implemented in Rust

* **Status:** Accepted (2026-11-01)
* **Deciders:** preved911
* **Related:** ADR-0008 (orchestrator core / stage tools), ADR-0002 (wire contract v1)

## Context and Problem Statement

The operator's explicit requirement for `shell-warden`: **compiled code with
strict typing, executing as fast as possible**. Language must be decided once
and not revisited: TS/JS for the engine (or reference tools) is excluded — the
only TS in the system is the hook shim itself, forced by the OpenCode plugin
platform (in-process plugin requirement).

## Decision Drivers

- Compiled, strictly typed, minimal runtime dependency for delivery.
- Evaluation axes: time-to-first-working-version AND maintenance cost of a
  young, evolving contract (revisions already frequent during design).
- Stage tools (warden-match, warden-legible) are in scope of the same rule —
  the whole decision logic is compiled (ADR-0008 separates them from the
  orchestrator, but language policy is system-wide).

## Considered Options

1. **TypeScript engine** — excluded by the operator; also adds a runtime
   dependency (node/bun) to the target machine and weakens delivery (no single
   static binary).
2. **Go** — simpler dev loop, `go install` ergonomics, prebuilt via goreleaser;
   typing guarantees weaker (nil-handling, no algebraic types).
3. **Rust** — strictest typing; no GC; single static binary (musl) = one-file
   delivery; dev loop heavier. Our design keeps the classic Rust pain zones out:
   owned data end-to-end, no shared mutable state, no async (std threads +
   `recv_timeout` for stage deadlines), flat modules (config/wire/walk/tool).

## Decision

Option 3. The engine core and all reference tools are implemented in **Rust**:

- Delivery: `cargo install --git https://github.com/agent-guardrails/shell-warden`
  (operator with a toolchain) or prebuilt binaries + install script
  (cargo-dist / Release assets) for machines without a toolchain.
- Toolchain missing today on the dev machine — top item of the implementation
  session (rustup install).
- Wire contract (ADR-0002, schemas) is the language boundary: the hook stays
  TS (platform necessity), the engine is Rust, the contract does not change.

## Consequences

- (+) Matches the operator's hard requirement: compiled, strictly typed,
  fastest execution; single-binary delivery.
- (+) Strict typing catches contract drift (frequent so far) at compile time.
- (−) Heavier per-revision maintenance while the contract churns (accepted;
  mitigated by serde-typed schema水肿 mirroring).
- (−) Dev loop slower than Go/TS; mitigated by pain-zone-avoiding design and
  `cargo check` speed.
- (−) Toolchain setup required (session step 0: rustup).
