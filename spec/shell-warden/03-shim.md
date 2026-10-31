# 03 — Shim (OpenCode V2 Plugin Domain)

Version 1.1 · 2026-10-31 · Mechanism revised per ADR-0013 (reply automation)

## 3.1 Registrations

Registered in `setup(ctx)`:

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-shell-warden-hook",
  async setup(ctx) {
    const opts = validateOptions(ctx.options)   // 04-shim-config.md; invalid engine.command ⇒ disable (I2)
    const supervisor = createSupervisor(opts.engine, opts.budgets)
    const cache = createCache(opts.cache)

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
          if (ev.type !== "permission.asked") continue
          const d = (ev as any).data ?? {}
          if ((ev as any).location?.directory !== ctx.location.directory) continue  // foreign project
          void handleAsk(d, ev)
        }
      } catch (e) { /* subscription errors: log; requests then reach the human (fail-closed) */ }
    })()

    if (opts.asConfig?.observeShell) {
      await ctx.shell.hook("create.before", (ev) => observeShell(ev, opts))  // audit-only
    }
    await ctx.tool.hook("execute.after", (ev) => cache.evictInvocation(ev))

    return () => { controller.abort(); supervisor.dispose() }
  },
})
```

**Mechanism (ADR-0013).** The shim does NOT use a permission evaluate hook:
live smoke showed a hook-allow does not suppress a configured ask on
v2.2.x, and `ctx.session.get` inside the evaluate hook deadlocks. Instead the
substrate itself is the fail-closed boundary (`shell → ask` is configured
natively), and the shim **answers published requests**:

```
agent requests shell command
   → OpenCode evaluates rules → ask → publishes request (permission.asked)
   → shim: fresh or cached engine verdict
       allow → ctx.permission.reply(decision: "once")   → command runs
       deny  → ctx.permission.reply(decision: "reject", message: reason)
       ask   → NO reply → dialog goes to the human (escalation by silence)
```

Live-proven (OpenCode v2.2.x): the reply wins the race against the client
auto-reject (28 ms vs ~40 ms), and the stage reason reaches the agent in the
rejection error.

## 3.2 `handleAsk` algorithm (normative)

```
1. if opts.actions does not include data.action    → return (foreign ask; let it ride)
2. invocationId = data.source.messageID + ":" + data.source.id
   (data.source: { type: "tool", messageID, id }; absent on non-tool asks → synthetic)
3. key = hash(data.action + data.resources.join("\u0000") + cwd + agent)
4. cached = cache.get(key); if cached              → reply(cached); return
5. r = supervisor.check(buildCheckRequest(data))   → VERDICT | ERROR
   ERROR → verdict = opts.onEngineError            // no engine error text into prompts
6. reply via ctx.permission.reply:
      allow → decision "once"
      deny  → decision "reject", message = r.message (≤512)
      ask   → no reply (escalation by silence)
7. if allow && r.cacheTtlMs > 0                    → cache.put(key, r, ttl)
```

Fail-safety:

- Every shim reply error is logged; an unanswered request resolution falls back
  to the native path (human in TUI, auto-reject in headless) — fail-closed (I3):
  the reply API never widens access (an allow reply applies only to a request
  whose engine verdict was allow).
- `cwd` is fixed to `""` in v0.1: no OpenCode HTTP calls from the ask handler
  (the evaluate-hook deadlock finding applies to any re-entrant call during
  permission processing). M1: session-event cache for cwd outside the hot path.

## 3.3 Supervisor (engine lifecycle, shim side)

Unchanged from v1.0: states
`cold → spawning → handshaking → ready ⇄ busy → restarting → (ready | unhealthy)`,
lazy spawn on the first ask, restart ladder with backoff, unhealthy cooldown,
dispose on unload. See 03 v1.0 tables (live-proven: persistent pool, first call
~215 ms, repeats ~3 ms).

## 3.4 Cache

Allow-only TTL LRU (`maxEntries`, default 1024), keyed
`hash(action ‖ resources ‖ cwd ‖ agent)`; TTL from the engine's `cacheTtlMs`
(denies never cached, I9). Eviction: TTL, LRU overflow, engine restart,
`enabled` profile changes.

## 3.5 What the shim deliberately does NOT do

- No command parsing (engine's job).
- No prompt answering beyond the reply automation above.
- No evaluate hook / no event-effect mutation (removed with ADR-0013 — the
  v2.2.x allow-downgrade limitation makes it unusable anyway).
- No engine-side logic in TS: the LOC budget stays ~400.

## 3.6 Compatibility & distribution

- npm package; depends on a `@opencode/plugin` version compatible with the
  targeted OpenCode release. Verified live on v2.2.2–v2.2.5 (probe).
- Options object in `opencode.jsonc`; the substrate is part of the SAME config:
  `permissions: [ { action: "shell", resource: "*", effect: "ask" } ]` —
  this polarity IS the fail-closed boundary (ADR-0013).
