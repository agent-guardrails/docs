# 0006 — Adopt `agent-guardrails/docs` as the canonical knowledge base

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** ADR-0004 (naming), spec/shell-warden/09-security.md

## Context and Problem Statement

The hook and engine implementations must share one contract: wire protocol, configuration schema,
security invariants. The first version of these documents lived in a private repository outside the
organization, which made them invisible to org collaborators and to automation, and mixing them with
project planning was awkward.

## Decision Drivers

- Schemas and specs are the contract for at least two implementations (hook plugin, engine) — a
  single, org-visible home is required.
- Repositories in the org must not reference resources outside the organization.
- Two document genres must not be confused: ADRs (one decision per record, immutable) versus
  specifications (normative contracts) versus design drafts.

## Considered Options

1. **`agent-guardrails/docs`** — umbrella: `adr/`, `spec/`, `schemas/`; design drafts are added only
   when the corresponding work enters the roadmap.
2. `agent-guardrails/adrs` — ADR-branded name; misleading once specs and schemas move in.
3. Specs inside each implementation repository — the shared protocol is duplicated across repos.
4. No repo — knowledge stays in issues and private storage; invisible to collaborators and automation.

## Decision Outcome

Option 1. `agent-guardrails/docs` is the canonical home for decisions, specifications and schemas.
The personal spec repository remains a frozen seed: content may be used, but the org repository
carries no references to it. The repo structure:

```
adr/        one decision per file, MADR structure, supersede instead of edit
spec/       normative contracts (RFC 2119); shell-warden first
schemas/    machine-readable contract (wire v1, engine config v1)
```

## Consequences

- (+) Implementations and collaborators (including agents) see the same contract.
- (+) Genres stay separated; the spec set does not pretend to be an ADR log.
- (−) One more repository to keep coherent; mitigated by "docs changes ship with the change they
  describe".
- (−) The private seed repository stays as an unforked archive.
