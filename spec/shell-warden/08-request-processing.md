# 08 — Decision Pipeline (checker) & Hook Application

Version 2.0 · 2026-11-01 · Revised per [ADR-0016](../../adr/0016-two-tier-enforcement.md):
rules vote inside the binary; the first deny is final; the hook applies
tighten-only and owns per-session state.

## 8.1 Checker pipeline (per letter)

```
read letter                 → validate per 02 §2.2; violation ⇒ exit 1 (never stdout)
load + validate config      → strict per 06 §6.1; invalid ⇒ exit 2 (no stdout)
for each command part:
    normalize (07 §7.4)     → any unresolvable step ⇒ part is opaque
    split (07 §7.2)         → recursive chain split; scanner-split is NEVER trusted (0014)
    classify (07 §7.3)      → static | opaque per part
    for each enabled stage with matched scope (§8.2):
        for each matching rule (§6.4/§6.5):
            vote
    refine (§8.3)           → discard strictly-refined matched rules
    reduce (§8.4)           → first deny is final; else most-restrictive
aggregate per-command → aggregate verdict (§8.4) + message (§8.5)
write verdict JSON          → exit 0
```

All chain parts are evaluated regardless of earlier verdicts (complete
per-part diagnostics in one pass); only rule matching inside a part may stop
early once a deny is known.

## 8.2 Stage entry and rule vote

1. **Scope entry**: a stage matches a part when ANY `scope.anyOf` condition
   holds (argv token sequence or raw glob, 06 §6.3). All stages are consulted —
   stages do not claim or exclude each other (the old `exclusive` is retired
   with the tool walk).
2. **Vote**: a rule votes when ALL its conditions hold for the part (conditions
   AND). `allow`-rules vote only when the part is `static` (I10); on `opaque`
   parts they are treated as non-matching and evaluation continues.
3. **Short-circuit**: once a `deny` vote exists for a part, further rule
   matching inside that part may stop — a deny cannot be out-ranked (§8.4).

## 8.3 Refinement (precise over broad)

Among the matched (voting) rules of a part, a rule is **strictly refined** by
another if the refiner's matched condition set implies the refined's on the
same part:

- `argv` token sequence S refines S′ iff S∪S′ tokens align and every token of
  S equals S′'s or S is longer along the same prefix (level-prefix of tokens),
  including `{anyOf}` membership;
- flag predicates: the refiner's `flag`/`flagValue` requirements contain the
  refined's (strictly more constrained refinement code basis: bash-guard).

Refined rules are discarded before reduction, so a narrow `allow` survives the
broad `allow` it refines and the most-restrictive reduction applies to genuinely
competing rules only. Refinement never applies across different parts or
stages.

## 8.4 Reduction

| Combination (per part) | Part verdict |
|---|---|
| any `deny` vote | `deny` — first deny is final; its `ruleId`, `match` kind and `message` returned |
| else any non-discarded `ask` vote | `ask` — most-obvious ask rule wins: the first surviving matched ask rule in config order |
| else any surviving `allow` vote (part fully parsed, `static`) | `allow` |
| else | part inherits `defaults.action` (`ask`) |

Per-command verdict = that part's reduced verdict. Aggregate verdict =
most-restrictive across parts (`deny > ask > allow`); the aggregate `message`
is the message of the most-restrictive deciding part; every part that did not
equal the aggregate keeps its own verdict in `commands[]` diagnostics.

## 8.5 Message composition

- **Deny**: the deciding deny rule's `message` (no composition — the first
  deny wins; there is never a contested "two deny reasons" case).
- **Ask**: the surviving ask rule's `message`; if no rule message, the top-level
  `defaults.message` (06 §6.2); if neither, the hook's degrade message
  (`defaults` level).
- **Allow**: no message surface (the hook ignoring it is normal).
- Messages are rule templates + allowlisted context interpolation only (I11);
  checker/infra error text never enters `message`.

## 8.6 Hook application duties (normative summary)

The hook applies the verdict per ADR-0013 reply automation (03 §3.2):

1. `allow` → `permission.reply("once")`; cache the verdict (03 §3.4) if
   `cache.ttlMs > 0`.
2. `deny` → `permission.reply("reject", message)` — message truncated to 512
   chars, never widened.
3. `ask` → no reply — escalation by silence; the native prompt stands.
4. Checker anomaly (spawn failure, timeout, non-zero exit, garbage stdout,
   schema violation) → `onCheckerError ∈ {ask, deny}` (09 §9.4); the reply API
   NEVER synthesizes `allow` from an error.
5. Per-session deny budget (ADR-0010, hook-owned): after `rejectBudget.maxRejections`
   denies of the same rule for the session within `rejectBudget.windowMs`,
   the hook stops replying for that rule (commands fall to the human). Budget
   bookkeeping, like all session state, lives in the hook.
6. Tighten-only (I5): an allow reply applies only to a request whose checker
   verdict was allow; an existing native deny is unreachable here (hooks do
   not see denied requests) and is never loosened.
