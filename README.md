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

> **NEXT SESSION — START HERE:** implementation plan for the checker lives in
> [`spec/shell-warden/HANDOFF-checker.md`](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/HANDOFF-checker.md)
> (schema-first config v2 per ADR-0017: config loader → parser → splitter → matcher → pipeline →
> letter/verdict IO → golden + measurement). For verdict v2, read
> [`HANDOFF-verdict-v2.md`](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/HANDOFF-verdict-v2.md) after it.

| Product | Spec | Schemas |
|---|---|---|
| `shell-warden` (decision binary) + `opencode-shell-warden-hook` (OpenCode V2 thin hook) | [`spec/shell-warden/`](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/README.md) | [`schemas/shell-warden.letter.v1.schema.json`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.letter.v1.schema.json), historical [`schemas/shell-warden.verdict.v1.schema.json`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v1.schema.json), active [`schemas/shell-warden.verdict.v2.schema.json`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.verdict.v2.schema.json), [`schemas/shell-warden.config.v2.schema.json`](https://github.com/agent-guardrails/docs/blob/main/schemas/shell-warden.config.v2.schema.json) |
| `pr-review` (auditable pull request review workflow) | [`spec/pr-review/`](spec/pr-review/README.md) | [`schemas/pr-review-bundle.v1.schema.json`](schemas/pr-review-bundle.v1.schema.json), [`schemas/pr-review-findings.v1.schema.json`](schemas/pr-review-findings.v1.schema.json) |
| `shell-legible` (readability gate, standalone binary) + `opencode-shell-legible-hook` (planned) | — | — |
| `agent-skills` (public portable Agent Skills pack) | [`spec/agent-skills/`](spec/agent-skills/README.md) | — |

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
| [0014](adr/0014-payload-shape-untrusted.md) | Payload shape is untrusted; adapter normalization (referenced on the engine side in v1) | Accepted |
| [0015](adr/0015-engine-language-rust.md) | Decision component and reference tools in Rust | Accepted |
| [0016](adr/0016-two-tier-enforcement.md) | Two-tier enforcement: thin hook → one-shot shell-warden decision binary (supersedes 0002/0005/0007/0008) | Accepted |
| [0017](adr/0017-schema-first-shell-warden-config-contract.md) | Schema-first Shell Warden v2 configuration contract | Accepted |
| [0018](adr/0018-script-based-auditable-pr-review-workflow.md) | Shared fixed script contracts for auditable PR review, with MCP deferred as an optional transport | Accepted |
| [0019](adr/0019-fixed-evidence-bundle-inspection.md) | Fixed evidence bundle inspection | Accepted |
| [0020](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md) | Versioned Shell Warden verdict envelope | Superseded historical provenance, see 0023 |
| [0021](adr/0021-public-agent-skills-repository.md) | Public repository-managed portable Agent Skills | Accepted |
| [0022](https://github.com/agent-guardrails/docs/blob/main/adr/0022-post-schema-shell-warden-verdict-validation.md) | Post-schema Shell Warden verdict validation | Superseded historical provenance, see 0023 |
| [0023](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md) | Shell Warden verdict v2 only | Accepted, current decision |

## Conventions

- Normative keywords per RFC 2119.
- Engines are named `shell-*`; OpenCode hook plugins are `opencode-<engine>-hook`.
- Documentation changes ship in the same change that alters the described behavior.
- No references to resources outside this organization.
