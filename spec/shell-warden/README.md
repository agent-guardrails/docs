# shell-warden — Specification Set

Spec v1.1 · Status: shim M0/M1 implemented (`agent-guardrails/opencode-shell-warden-hook`);
engine config re-specified as **tool-first stages** (06/07/08 — v1.1; ADR-0008)

A two-component permission system for OpenCode V2: a **thin plugin shim** and an **orchestrator engine**
(`shell-warden`) communicating over NDJSON JSON-RPC 2.0 on stdio. All decision logic lives in
**stage tools**; the core walks stages and aggregates verdicts.

## Documents by domain

| Doc | Domain | Answers |
|---|---|---|
| `01-overview.md` | system | goals, non-goals, architecture, decision log |
| `02-protocol.md` | wire | **request/response format between hook and RPC backend** |
| `03-shim.md` | plugin | hook registrations, verdict application, supervision |
| `04-shim-config.md` | plugin config | `opencode.jsonc` plugin options schema |
| `05-engine-runtime.md` | backend runtime | process contract, stdio discipline, reload, termination |
| `06-engine-config.md` | backend config | **v1.1 tool-first: stage = external tool invocation; no rule grammar in core** |
| `07-command-parsing.md` | parsing guidance | **recommendations for stage-tool authors: classification, normalization, patterns, opaque handling** |
| `08-request-processing.md` | backend logic | **stage walk: invocation, aggregation, message composition, budgets** |
| `09-security.md` | security | invariants, threat model, fail-closed matrix |
| `10-testing.md` | quality | contract, golden, integration suites |
| `11-roadmap.md` | delivery | milestones, open questions |
| `../../design/shell-legible-gate.md` | design | readability gate reference tool (L1–L3, budget) |
| `../../schemas/*.json` | machine | JSON Schema drafts: wire v1, engine config v1.1 |

## Reading order

1. `01-overview.md` — what and why
2. `02-protocol.md` — the contract between the two parts
3. Backend side, in dependency order: `06-engine-config.md` → `07-command-parsing.md` → `08-request-processing.md` → `05-engine-runtime.md`
4. Shim side: `03-shim.md` → `04-shim-config.md`
5. Cross-cutting: `09-security.md`, `10-testing.md`, `11-roadmap.md`

## Conventions

- Normative keywords MUST / SHOULD / MAY per RFC 2119.
- **Shim** = OpenCode V2 plugin part (`@opencode/plugin`, in-process). **Engine** = `shell-warden` orchestrator process. **Stage tool** = external program invoked by the engine for one stage.
- All durations are integer milliseconds. All budget clamps are enforced with warn+clamp, never silently.
- Spec changes: bump the doc version and the relevant `protocolVersion` / config `version`.
- Revision status: 02, 04, 06, 07, 08 = v1.1 (tool-first). 03, 05, 09, 10, 11 — minor revision pending (v1.0 wording).
