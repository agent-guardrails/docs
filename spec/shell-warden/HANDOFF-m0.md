# HANDOFF — Engine M0 (next session kickoff)

Spec source of truth: [`spec/shell-warden/06`](06-engine-config.md), [`08`](08-request-processing.md),
[`02`](02-protocol.md), schemas `schemas/`. The shim is DONE and live-tested
(`opencode-shell-warden-hook`, reply automation per ADR-0013). What's missing is THIS repo's content.

## Repo

`agent-guardrails/shell-warden` — created (empty). TypeScript, type-stripping (no enums/param
properties), deps: none at runtime; tests `node --test` (see the shim repo's tooling as the reference setup).

## M0 scope (spec-implied, in build order)

| Step | Files | Acceptance |
|---|---|---|
| 1. Wire handler | `src/wire.ts` | `initialize` + `policy/check` per 02-protocol; contract tests against the shim's client expectations (shim repo `test/helpers/mock-engine.mjs` shows the exact shapes) |
| 2. Config loader | `src/config.ts` | strict validation per 06 §6.2 (version, defaults.action: ask, limits incl. stages ≤ 64); invalid → last-good / fatal (never fail-open) |
| 3. Stage supervisor | `src/stagetools.ts` | persistent pool per stage (`tool.lifecycle`), lazy spawn, idle kill, restart ladder (reuse the SHIM's `supervisor.ts` pattern — at `opencode-shell-warden-hook/src/supervisor.ts`) |
| 4. Walk | `src/walk.ts` | 08 pseudocode verbatim: enabled → invoke → onError policy → most-restrictive → messageMode compose → first-deny-stops → exclusive claim |
| 5. First reference tool | separate binary `warden-match` | rule-file contract per 07 §7.4 (argv-prefix + raw glob; allow requires static classification) |
| 6. Integration | smoke per 10-testing §10.5 | end-to-end with the real shim; plus the open question 10.5.1 (ask-escalation on native-allow) |

## Config contract reminder (06 §6.3 final stage fields)

`id` · `tool{ command[], cwd?, env{}, lifecycle, idleTimeoutMs?, timeoutMs, killGraceMs, maxOutputBytes, input{session,mcp}, onError, sha256? }` ·
`onExistingDeny: append|replace` · `applyWhen: always|ask-only` · `exclusive: bool` ·
`passive: bool` · `budget{maxRejections, windowMs}?` · `enabled: bool`

Note: `voteOn`/`applyWhen`-as-vote and the `skip` verb are REMOVED in the final model
(reply automation per ADR-0013); specs 06/08 are already consistent.

## Smoke assets (reusable)

- Probe plugin + mock engines: `/private/var/folders/mk/17k6nth16r7gzxbxs3b7jlrw0000gn/T/opencode/smoke/` (temp — recreate if gone; templates in `opencode-shell-warden-hook/test/helpers/mock-engine.mjs`).
- Flow: shim (project config) → this engine → stage tools. Substrate stays `shell → ask` (ADR-0013).
