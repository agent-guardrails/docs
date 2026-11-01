# 0014 — Payload shape is untrusted: input normalization belongs to the engine side

* **Status:** Accepted (2026-11-01)
* **Deciders:** preved911
* **Related:** [07 §7.1–7.3](../spec/shell-warden/07-command-parsing.md) (defensive re-parse), ADR-0008

## Context and Problem Statement

The design briefly assumed the harness delivers pre-split, syntax-safe
commands ("the OpenCode scanner splits compounds before the engine"). This was
built on documentation fragments and is wrong twice:

1. **Unverified assumptions become traps**: the previous assumption chain ended
   in dead ends twice already (allow-downgrade, session.get deadlock).
   Verified live on OpenCode v2.2.5: compound `echo a && echo b` DOES arrive as
   two resources — but this is an observed behavior of one harness at one
   version, not a contract feature.
2. **Reusability (the core goal)**: shell-warden targets multiple agents.
   Harnesses deliver different payloads — OpenCode v1 passed whole compound
   strings; other agents pass argv arrays, multiline scripts, or single-call
   commands. Upstream guarantees and approval-payload shapes will differ
   per agent and per version.

## Decision Drivers

- The engine and its stage tools must be harness-agnostic.
- Stage tools judge **per command text**, not per harness promise.
- A wrong assumption about payload guarantees = a silent bypass across the
  whole product.

## Considered Options

1. **Trust the harness's shape** (assume pre-split/safe when docs say so) —
   rejected: unverified, harness-specific, reintroduced by version drift.
2. **Every stage tool re-parses the raw payload independently** — consistent
   with tool-first, but N× duplication and no unified notion of "the command
   instance" for aggregation.
3. **Engine-side input normalization as a shallow, explicit layer**: the core
   decodes the incoming payload into a unified primitive list (command texts +
   cwd + context), using the light rules of 07 §7.3 (split residual compound
   operators into statements; dynamic constructs ⇒ opaque); never assigns
   danger semantics itself.

## Decision

Option 3. Normative for all harness adapters and for the reference engine:

- **The payload shape is untrusted.** The engine normalizes defensively
  (07 §7.3): whatever arrives — compound string, argv, multiline script — is
  split/classified before stage evaluation; opaque pieces degrade to ask/deny
  and are never allowed.
- Harness-specific pre-splitting MAY be exploited as an optimization only
  after live verification per version (recorded in the testing notes), and the
  normalizer must still re-parse defensively.
- Stage tools always receive the unified form: `command: {raw, cwd}` per
  statement — their own matching logic stays simple (07 §7.4).
- A per-agent payload difference is handled by config: the adapter describes
  the source shape; agents with exotic payloads get their own shim/adapter —
  the engine stays the same.

## Consequences

- (+) Reusable across agents: guarantees are OWNED by shell-warden, not
  borrowed from any harness.
- (+) The verification trap is institutionalized: any harness-behavior
  assumption used in the implementation MUST have a live repro test in
  10-testing (OpenCode scanner-split is the first recorded one).
- (−) The core gains a shallow normalization layer (~tens of lines), scoped to
  split/classify — explicitly NOT a full shell parser (no semantics judgment).
