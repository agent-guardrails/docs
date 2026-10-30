# 0004 — Naming family: `shell-*` engines, `opencode-*-hook` plugins

* **Status:** Accepted (2026-10-31)
* **Deciders:** preved911
* **Related:** ADR-0005 (architecture), spec/shell-warden/11-roadmap.md (Q4, closed)

## Context and Problem Statement

The organization ships hook plugins and engines. Names must show what is made for OpenCode, what the
artifact is (plugin vs engine), and stay scalable beyond the first pair of projects. Earlier
candidates rejected along the way: `policyd` (promises more than bash-command scope),
`opencode-bash-hook` / `opencode-shell-hook` (too literal, no engine tie-in).

## Decision Drivers

- Plugin names must carry the `opencode-` prefix (made for OpenCode) and describe the mechanism.
- Engine and plugin must be recognizably one family.
- Room for a second hook on stage one: human readability of agent-run scripts.

## Considered Options

1. `opencode-policyd` / `policyd` — engine name doubles as brand; too broad for bash-only scope.
2. `opencode-bash-hook`, `opencode-shell-hook` — scope without a product identity.
3. **`shell-warden` engine + `opencode-shell-warden-hook` plugin; family rule: engines `shell-*`,
   hooks `opencode-<engine>-hook`.**

## Decision Outcome

Option 3. First-stage artifacts:

| Artifact | Name |
|---|---|
| Guard engine | `shell-warden` |
| Guard hook plugin (npm, plugin id) | `opencode-shell-warden-hook` |
| Readability engine | `shell-legible` (final name pending vs `shell-unfold`) |
| Readability hook plugin | `opencode-shell-legible-hook` |

## Consequences

- (+) `opencode-` prefix answers "for OpenCode", `-hook` suffix answers "it is a hook plugin",
  middle word names the engine family member.
- (+) `shell-*` keeps engines grouped in listings and registries.
- (−) Long plugin names (~25 chars); accepted for explicitness.
