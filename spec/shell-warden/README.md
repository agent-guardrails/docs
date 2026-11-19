# shell-warden — Specification Set

Specification set · Status: retired M0 engine exists as reference (`agent-guardrails/shell-warden`);
v2 target architecture per ADR-0016: **thin hook + one-shot decision binary**
(`agent-guardrails/opencode-shell-warden-hook` + `shell-warden`)

The active configuration/verdict v3 contract is governed by
[ADR-0026](../../adr/0026-contextual-parameter-evidence.md) and
[12 — Contextual parameters](12-contextual-parameters.md). V1/v2 schemas remain
historical provenance; no alternate runtime reader or fallback is supported.
The earlier v2-only transition was governed by
[ADR-0023](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md),
for [docs issue 33](https://github.com/agent-guardrails/docs/issues/33). [ADR-0020](https://github.com/agent-guardrails/docs/blob/main/adr/0020-versioned-shell-warden-verdict-envelope.md)
and [ADR-0022](https://github.com/agent-guardrails/docs/blob/main/adr/0022-post-schema-shell-warden-verdict-validation.md)
are historical provenance. The coordinated v3 implementation does not by itself
claim a release or production rollout.

A two-tier permission system for OpenCode V2: a **thin hook** (in-process plugin) and a
**one-shot decision binary** (`shell-warden`, Rust). All decision logic lives in the
binary: parsing, classification, rules and verdict composition. The hook owns per-session
state (deny budgets, allow cache, debug log) and applies verdicts tighten-only.

## Documents by domain

| Doc | Domain | Answers |
|---|---|---|
| [01-overview.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/01-overview.md) | system | goals, non-goals, architecture, decision log |
| [02-letter-verdict.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md) | one-shot contract | **letter/verdict shapes, spawn contract, exit codes** |
| [03-shim.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/03-shim.md) | plugin | reply automation, invoker, per-session state |
| [04-shim-config.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/04-shim-config.md) | plugin config | `opencode.jsonc` plugin options schema |
| [05-engine-runtime.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/05-engine-runtime.md) | retired | persistent engine pointers only |
| [06-engine-config.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/06-engine-config.md) | rules grammar | **command profiles and typed-evidence rules (config v3)** |
| [07-command-parsing.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/07-command-parsing.md) | parsing | **normative**: recursive parts and evidence states, quote classes, redirects, matching vocabulary |
| [08-request-processing.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/08-request-processing.md) | decision pipeline | **action-sensitive matching, fixed-lattice reduction, monotonicity; hook duties** |
| [09-security.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/09-security.md) | security | invariants, threat model, fail-closed matrix |
| [10-testing.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/10-testing.md) | quality | unit/scenario/property suites, golden (checker CLI), contract (hook), integration; live-smoke history |
| [11-roadmap.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/11-roadmap.md) | delivery | milestones, open questions |
| [12-contextual-parameters.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/12-contextual-parameters.md) | active v3 contract | **context grants, unknown predicates, coverage, diagnostics, and coordinated migration** |
| [HANDOFF-verdict-v2.md](https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/HANDOFF-verdict-v2.md) | implementation | separate Rust checker and TypeScript hook verdict-v2 work |
| [shell-legible-gate design](https://github.com/agent-guardrails/docs/blob/main/design/shell-legible-gate.md) | design | readability gate, standalone binary (ADR-0007 superseded 0007: separate project) |
| [shell-warden-verdict-v2 design](https://github.com/agent-guardrails/docs/blob/main/design/shell-warden-verdict-v2.md) | design | accepted verdict-v2 direction and migration |
| [schemas](https://github.com/agent-guardrails/docs/tree/main/schemas) | machine | active letter v1, config v3, verdict v3; earlier versions are historical |

## Reading order

1. `01-overview.md` — what and why
2. `02-letter-verdict.md` — the contract between the two tiers
3. Checker side, in dependency order: `06-engine-config.md` → `07-command-parsing.md` → `08-request-processing.md`
4. Hook side: `03-shim.md` → `04-shim-config.md`
5. Cross-cutting: `09-security.md`, `10-testing.md`, `11-roadmap.md`
6. Current implementers: [12-contextual-parameters.md](12-contextual-parameters.md).
   [HANDOFF-verdict-v2.md](HANDOFF-verdict-v2.md) is historical provenance.

## Conventions

- Normative keywords MUST / SHOULD / MAY per RFC 2119.
- **Hook** = OpenCode V2 plugin part (`opencode-shell-warden-hook`, in-process; the v1.x docs
  called it *shim*). **Checker** = `shell-warden`, the one-shot decision binary from the
  `shell-warden` repository. **Letter / verdict** = the request/response JSON of 02.
- All durations are integer milliseconds. All budget clamps are enforced with warn+clamp, never silently.
- Spec changes: bump the doc version and the relevant `version` field of the matching schema.
- Revision status: 02, 06–09, and 12 define the coordinated v3 change.
  Other documents retain their unchanged subsystem contracts; historical
  v2-only handoffs do not select an alternate response runtime.
