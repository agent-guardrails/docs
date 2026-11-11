# 03 — Hook (OpenCode V2 Plugin Domain)

Version 2.1 · 2026-11-11 · Mechanism per ADR-0013 (reply automation);
invoker/state per ADR-0016 and verdict v2 per [ADR-0021](https://github.com/agent-guardrails/docs/blob/main/adr/0021-post-schema-shell-warden-verdict-validation.md)
and [docs issue 31](https://github.com/agent-guardrails/docs/issues/31)

## 3.1 Registrations

Registered in `setup(ctx)`:

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-shell-warden-hook",
  async setup(ctx) {
    const opts = validateOptions(ctx.options)   // 04-shim-config.md; invalid checker.command ⇒ disable (I2)
    const invoker = createInvoker(opts.checker, opts.budgets)
    const cache = createCache(opts.cache)
    const state = createSessionState(opts.rejectBudget)   // deny budgets per session (ADR-0010)

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
    await ctx.tool.hook("execute.after", (ev) => cache.evictForEvent(ev))   // same-key eviction on execution

    return () => { controller.abort(); void invoker.dispose() }
  },
})
```

**Mechanism (ADR-0013, unchanged).** The hook does NOT use a permission
evaluate hook: live smoke showed a hook-allow does not suppress a configured
ask on v2.2.x, and `ctx.session.get` inside the evaluate hook deadlocks
(10 §10.5). The substrate itself is the fail-closed boundary (`shell → ask` is
configured natively), and the hook **answers published requests**:

```
agent requests shell command
   → OpenCode evaluates rules → ask → publishes request (permission.asked)
   → hook: fresh or cached checker verdict
       allow → ctx.permission.reply(decision: "once")   → command runs
       deny  → ctx.permission.reply(decision: "reject", message: reason)
       ask   → NO reply → dialog goes to the human (escalation by silence)
```

Live-proven (OpenCode v2.2.x): the reply wins the race against the client
auto-reject (28 ms vs ~40 ms), and the rule reason reaches the agent in the
rejection error.

## 3.2 `handleAsk` algorithm (normative)

```
1. if opts.actions does not include data.action    → return (foreign ask; let it ride)
2. invocationId = data.source.messageID + ":" + data.source.id
   (data.source: { type: "tool", messageID, id }; absent on non-tool asks → synthetic)
3. key = hash(data.action + data.resources.join("\u0000") + cwd + agent)
4. cached = cache.get(key); if cached              → reply(cached); return
5. verdict = invoker.check(buildLetter(data))      → VERDICT | ERROR
   ERROR → verdict = opts.onCheckerError           // no checker error text into prompts
6. reply via ctx.permission.reply:
      allow → decision "once"
      deny  → decision "reject", message = r.message (≤512)
      ask   → no reply (escalation by silence)
7. if allow && opts.cache.ttlMs > 0                → cache.put(key, verdict, ttl)
```

Fail-safety:

- Every hook reply error is logged; an unanswered request resolution falls
  back to the native path (human in TUI, auto-reject in headless) — fail-closed
  (I3): the reply API never widens access (an allow reply applies only to a
  request whose checker verdict was allow).
- Released letter building stamps the project cwd into every `commands[].cwd`.
  The ask handler makes no OpenCode HTTP call to derive it, because re-entrant
  calls during permission processing can deadlock.

## 3.3 Invoker (one-shot spawn, shim-side lifecycle)

Per check (02 §2.1):

1. Build the letter (02 §2.2); the configured `maxRequestCommands` is warned and
   clamped at 128, and a request exceeding the effective limit or 64 KiB letter
   cap ⇒ **local degrade without spawn**.
2. Spawn `checker.command` (absolute argv[0], no shell, **empty child
   environment** — I1), write the letter, close stdin.
3. Read stdout to EOF; verdict deadline `budgets.checkTimeoutMs`; on breach
   SIGTERM → `killGraceMs` → SIGKILL ⇒ degrade (I3).
4. Read and enforce the 64 KiB verdict cap before parsing. Parse exactly one JSON
   value only after that cap passes. When `protocol` is absent, exact-validate only
   `shell-warden.verdict.v1`; when it exactly equals `shell-warden.verdict.v2`,
   exact-validate only the v2 envelope and nested `result` (02 §2.8). Unknown,
   non-string, malformed protocol or failed v2 validation MUST NOT fall back to
   v1 and ⇒ degrade. After either exact schema validation, apply the semantic
   invariants in 02 §2.8 using the expected letter invocation ID and positional
   indexes: positional contiguous indexes equal to the array position in both
   letter and verdict, legal classification/match/verdict tuples, required
   deny message, both recognized diagnostics shapes, and aggregate consistency.
   This includes rejecting exact-valid v1
   impossible tuples such as opaque/argv/allow. The selected result's
   `invocationId` MUST echo the letter's `invocation.id`. Anything else (empty,
   garbage, multiple values, oversize, foreign echo, invalid coverage or
   aggregate) ⇒ degrade.
5. Non-zero exit ⇒ ignore stdout, degrade. Exit 2 (config invalid) ⇒ log the
   stderr line; every re-check will fail the same way until the user fixes the
   file (no retry ladder needed — stateless one-shot).
6. Concurrency cap `budgets.maxConcurrentSpawns` (default 8): newer requests
   beyond the cap degrade locally (fail-closed), never queue unbounded.

There is no persistent process, no handshake, no restart ladder, no unhealthy
window: each check is independent; a crash affects only its own invocation
plus the debug-log violation note. Logs go to the hook log, never to stdout of
OpenCode and never into prompts.

## 3.4 Cache

Allow-only TTL LRU (`maxEntries`, default 1024), keyed
`hash(action ‖ resources ‖ cwd ‖ agent)`; TTL = hook option `cache.ttlMs`
(default 0 = never cache; the checker issues no TTL — v2 change, 02 §2.5).
Denies never cached (I9). Eviction: TTL, LRU overflow, `enabled` profile
changes. Config changes need no cache invalidation machinery beyond TTL:
uncached verdicts re-read the current rules file on every spawn (06 §6.1);
a cached allow may survive rule changes for at most one TTL — keep TTL small.
(The shim's engine-issued `cacheTtlMs` of v1.x is retired with the handshake.)

## 3.5 Per-session state (ADR-0010, ADR-0016)

The hook owns, keyed by `invocation.sessionID`, bounded (LRU, hook-chosen cap):

- **Deny budget**: counts denies per rule id per session within
  `rejectBudget.windowMs`; on exhausting `rejectBudget.maxRejections` the hook
  stops answering for that rule (07-style suspension is hook-side silence —
  first bypass logs a debug notice: the command then reaches the human via the
  native ask, never auto-allowed). Reset: window expiry.
- **Debug log** (opt-in `debug.enabled`): per check one NDJSON line — letter,
  verdict, matched rule ids, spawn/total timing, degradation reason if any;
  ≤ 16 KiB / depth ≤ 8; default dir `~/.local/state/shell-warden/hook/`
  (`debug.dir` override). MUST NOT write inside the project, the repo, or
  `~/.config`.

## 3.6 What the hook deliberately does NOT do

- No command parsing, classification or rule matching (checker's job, I5 posture of 0014 inside the binary).
- No prompt answering beyond the reply automation above.
- No evaluate hook / no event-effect mutation (removed with ADR-0013).
- No policy logic in TS: the ~400 LOC budget stands (no imports beyond
  `@opencode/plugin` + node built-ins).

## 3.7 Compatibility & distribution

- npm package; depends on a `@opencode/plugin` version compatible with the
  targeted OpenCode release. Verified live on v2.2.2–v2.2.5 (probe).
- Options object in `opencode.jsonc`; the substrate is part of the SAME config:
  `permissions: [ { action: "shell", resource: "*", effect: "ask" } ]` —
  this polarity IS the fail-closed boundary (ADR-0013).
- The checker binary ships separately (`shell-warden` releases, board P3);
  the hook cannot supply policy — the checker path, like the rules file, is
  user-global posture (ADR-0003), enforced by option validation (04 §4.3).

## 3.8 Verdict v2 compatibility and rollout

The dual-read hook MUST accept exact v1 when protocol is absent and exact v2 when
the protocol is exact. A flat object carrying `protocol` is not v1 because the v1
root is closed. The hook MUST return the validated nested v2 `result` to the
existing tighten-only path and MUST NEVER synthesize allow.

Publish compatible hook and checker releases together as one coordinated pair for
[hook issue 13](https://github.com/agent-guardrails/opencode-shell-warden-hook/issues/13).
Deploy the dual-read hook first, then the v2-only checker. Roll back the checker
first. The four-state matrix and completion requirements are normative in 02 §2.9.
