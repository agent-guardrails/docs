# 03 — Shim (OpenCode V2 Plugin Domain)

Version 0.1 · 2026-10-30

## 3.1 Registrations

Registered in `setup(ctx)`, in this order (registration order = execution order within a plugin):

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-shell-warden-hook",
  async setup(ctx) {
    const opts = validateOptions(ctx.options)   // 04-shim-config.md; invalid engine.command ⇒ disable (I2)
    const supervisor = createSupervisor(opts.engine, opts.budgets)
    const cache = createCache(opts.cache)

    await ctx.permission.hook("evaluate", (ev) => applyVerdict(ev, { supervisor, cache, opts }))
    await ctx.shell.hook("create.before", (ev) => observeShell(ev, opts))  // audit-only no-op unless observeShell
    await ctx.tool.hook("execute.after", (ev) => cache.evictInvocation(ev))

    return () => supervisor.dispose()           // kill engine; in-flight → onEngineError
  },
})
```

Why these hooks:
- `permission.hook("evaluate")` — the only authority. Runs after configured rules for `allow`/`ask`; a configured
  `deny` never reaches hooks (native layer outranks the engine, by design).
- `shell.hook("create.before")` — receives final `command`, `cwd`, `timeout`, `shell`, `env`; used only for
  `policy/observe` audit when enabled. v1: never a decision point.
- `tool.hook("execute.after")` — cache eviction per `invocation.id`.

## 3.2 `applyVerdict` algorithm (normative)

```
1. if opts.actions does not include ev.action      → return            (hook is a no-op)
2. if ev.effect === "deny"                         → return            (final; never touch)
3. key = hash(ev.action + ev.resources.join("\u0000") + cwd + ev.agent)
4. cached = cache.get(key); if cached              → tighten(ev, cached); return
5. r = supervisor.check(buildCheckRequest(ev))     → VERDICT | ERROR
6. ERROR → tighten(ev, opts.onEngineError)         // no engine error text into prompts
7. tighten(ev, r.verdict, r.message)
8. if r.verdict === "allow" && r.cacheTtlMs > 0    → cache.put(key, r, ttl)
```

`tighten` is rank-guarded: `{allow:0, ask:1, deny:2}`; a write only applies if its rank is **higher** than the
current `effect` (never loosens — invariant I5). `onEngineError: "ask"` (default) leaves the native prompt to decide;
`"deny"` for hard-fail environments.

`cwd` for step 3/5 comes from the evaluate event's session (`ctx.session.get`) — resolved fresh per invocation,
never cached across sessions.

## 3.3 Supervisor (engine lifecycle, shim side)

States: `cold → spawning → handshaking → ready ⇄ busy → restarting → (ready | unhealthy)`, `disposed`.

| Transition | Trigger | Action |
|---|---|---|
| cold → spawning | first check needs engine (lazy) | spawn child, empty env, absolute argv |
| spawning → handshaking | stdin/stdout alive | send `initialize`, start handshake deadline |
| handshaking → ready | valid `initialize` result, exact `protocolVersion` | flush queued checks |
| any → restarting | deadline breach / protocol violation / crash / fatal error | SIGTERM, grace `killGraceMs`, SIGKILL; backoff 250 ms × 2ⁿ ≤ `maxBackoffMs` |
| restarting ×N within `windowMs` | `maxViolations` | **unhealthy**: all checks degrade (I3) until window elapses |
| ready | stable `resetAfterMs` | violation counter reset |
| any → disposed | plugin unload (`setup` cleanup) | in-flight → degrade; kill; cache cleared |

- In-flight checks are deadline-guarded individually; a restart aborts them all (each → `onEngineError`).
- Concurrency: one engine for all sessions; `maxInFlight` bounds pipelined JSON-RPC ids on the single stdio pair.
- Stderr ring buffer (8 KiB) attached to degrade log lines for debugging.

## 3.4 Cache

- In-memory LRU, `maxEntries` (default 1024). Key: hash(action ‖ commands ‖ cwd ‖ agent). No disk persistence.
- Entries: engine-issued `cacheTtlMs` on `allow` verdicts only (I9/D6). Denies are never cached.
- Eviction: TTL expiry, LRU overflow, engine restart, plugin unload, `cache/invalidate`.
- Per-invocation eviction hook: `tool.execute.after` with matching `invocation.id` (frees hot keys early).

## 3.5 What the shim deliberately does NOT do

- No command parsing (engine's job, `07-command-parsing.md`).
- No prompt answering (`ctx.permission.reply` unused — `evaluate` makes it unnecessary).
- No reading of engine config content (only the handshake echo, for logging).
- No per-stage hooks: `result.commands[].stage` is diagnostics only.
- No secrets in requests: command text, ids, cwd, agent only.

## 3.6 Compatibility & distribution

- Published as an npm package; depends on a `@opencode/plugin` version compatible with the targeted OpenCode release.
- V1/OpenCode-1 support is out of scope; do not ship a dual `server()`/`setup()` export.
- Options object in `opencode.jsonc` (`04-shim-config.md`); local dev via `.opencode/plugins/` directory.
