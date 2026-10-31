# agent-guardrails/docs

Knowledge base for the organization's projects: **decisions**, **specifications** and
**schemas**. Genres are separated deliberately — do not mix them.

## Layout

| Path | Genre | Rules |
|---|---|---|
| [`adr/`](adr/) | Architecture Decision Records | One decision per file. MADR structure (Status / Context / Decision Drivers / Considered Options / Decision / Consequences). Numbered, immutable — a changed decision is a new ADR with "Supersedes". |
| [`spec/`](spec/) | Specifications | Normative contracts (RFC 2119 MUST/SHOULD). One directory per product family. |
| [`schemas/`](schemas/) | Machine-readable contract | JSON Schema drafts referenced by implementations. |
| `design/` | Design drafts | Added only when the work enters the roadmap; promoted to `spec/` when accepted. |

## Products

| Product | Spec | Schemas |
|---|---|---|
| `shell-warden` (engine) + `opencode-shell-warden-hook` (OpenCode V2 hook plugin) | [`spec/shell-warden/`](spec/shell-warden/README.md) | [`schemas/wire.v1.schema.json`](schemas/wire.v1.schema.json), [`schemas/shell-warden.config.v1.schema.json`](schemas/shell-warden.config.v1.schema.json) |
| `shell-legible` (engine) + `opencode-shell-legible-hook` (planned) | — | — |

## Decisions index

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-fail-closed-degradation.md) | Fail-closed degradation (`onEngineError ∈ {ask, deny}`, never allow) | Accepted |
| [0002](adr/0002-stdio-ndjson-rpc-over-mcp.md) | Persistent engine over NDJSON JSON-RPC stdio (not MCP, not one-shot) | Accepted |
| [0003](adr/0003-user-global-policy-trust.md) | Policy code trusted from user-global scope only | Accepted |
| [0004](adr/0004-naming-shell-warden-family.md) | Naming family: `shell-*` engines, `opencode-*-hook` plugins | Accepted |
| [0005](adr/0005-single-evaluate-hook-stages-in-engine.md) | Single evaluate hook; stage routing lives in the engine | Accepted |
| [0006](adr/0006-adopt-docs-repo.md) | This repository is the canonical knowledge base | Accepted |
| [0007](adr/0007-one-evaluation-component.md) | One evaluation component: legibility and routing merge into the warden engine | Accepted |
| [0008](adr/0008-orchestrator-core-logic-in-tools.md) | Orchestrator core, decisions in stage tools | Accepted |
| [0009](adr/0009-message-resolution-on-existing-deny.md) | Stage message resolution | Superseded by 0012 |
| [0010](adr/0010-bounded-rejection-suspension-to-ask.md) | Bounded rejection: budget → suspension to ask | Accepted |
| [0011](adr/0011-quality-gates-vote-on-review-path.md) | Quality gates vote only on the review path | Accepted |
| [0012](adr/0012-stage-message-composition.md) | Stage message composition: `messageMode`, first-deny-stops | Accepted |
| [0013](adr/0013-substrate-fail-closed-reply-automation.md) | Substrate is the fail-closed boundary; the hook answers published permission requests | Accepted |

## Conventions

- Normative keywords per RFC 2119.
- Engines are named `shell-*`; OpenCode hook plugins are `opencode-<engine>-hook`.
- Documentation changes ship in the same change that alters the described behavior.
- No references to resources outside this organization.
