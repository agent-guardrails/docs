# 05 — Engine Runtime (Retired)

Version 2.0 · 2026-11-01 · **Retired by [ADR-0016](../../adr/0016-two-tier-enforcement.md)**
(persistent engine process). Supersedes ADR-0002's persistent tier; the one-shot
spawn contract lives in 02.

This document formerly specified the persistent engine process: process contract,
supervision surface, config lifecycle, per-session state, health & telemetry.
With two-tier enforcement (thin hook + one-shot decision binary) that process
does not exist. Where its content moved:

| Former concern (v1.x) | Now |
|---|---|
| Spawn / stdio discipline / exit codes | one-shot invocation, 02 §2.1, §2.4 |
| Config load/reload (last-good, fatal) | checker re-reads config per spawn; invalid ⇒ exit 2, 06 §6.1, 02 §2.5 |
| Deadlines, in-flight caps, supervision, restart ladder | hook-side invoker + budgets only, 03 §3.3; no restarts of a persistent process |
| Per-session state (caches, staleness) | hook-owned state, 03 §3.4–3.5 |
| Health & telemetry (`initialize`, `ping`, `checkMs`) | no handshake; spawn latency measured by the hook (debug log, 03 §3.5; 10 §10.6) |
| State directory / audit rollups | hook debug log (03 §3.5); no checker-local state |

File numbering is kept stable for cross-references; nothing in this directory
refers to a persistent engine anymore. The retired M0 engine implementation in
the `shell-warden` repository (built against the ADR-0002/0005/0008 contracts)
stays there as reference only — it is not part of the v2 system.
