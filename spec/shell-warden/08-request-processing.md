# 08 — Decision Pipeline (checker) & Hook Application

Version 2.1 · 2026-11-04 · Revised for checker configuration v2 (command profiles) per
[docs#15](https://github.com/agent-guardrails/docs/issues/15): rules vote inside the binary
and reduce by the fixed lattice; there is no refinement phase, no first-match semantics and no
configuration-order meaning; the hook applies tighten-only and owns per-session state.

## 8.1 Checker pipeline (per letter)

```
read letter                 → validate per 02 §2.2; violation ⇒ exit 1 (never stdout)
load + validate config      → strict per 06 §6.1/§6.9; invalid ⇒ exit 2 (no stdout)
for each command:
    split (07 §7.2)         → recursive executable-part extraction; scanner-split is NEVER trusted
    select profile per part → lexical, unique by config validation (§8.2)
    parse options per part  → per-profile grammar (06 §6.3); failures ⇒ invalid evidence
    run analyzer per part   → closed fact catalog; xargs-v1 may emit analyzerCommand parts (§8.4)
    produce path coordinates from the profile's pathSources (§8.5)
    resolve effective redirect policy for every allow rule (§8.4 reduction step 1)
    match rules and collect votes (§8.3); allow additionally needs the coverage proof (§8.3)
    reduce part votes by the fixed lattice (§8.3)
aggregate across parts      → per-command verdict (§8.6) + diagnostics facts (bounded post-decision)
aggregate across commands   → most-restrictive verdict + message (§8.6)
write verdict JSON          → exit 0
```

All parts are evaluated regardless of earlier verdicts (complete per-part diagnostics in one
pass); rule evaluation itself never short-circuits: every matching rule is evaluated and
emits its vote.

## 8.2 Profile selection and option parsing

1. **Selection is lexical**: the profile owning the part's head token (06 §6.3). The head
   MUST be a resolvable literal token; an unresolvable head selects no profile. The head is
   evidence of selection and is NOT part of the positional arguments.
2. **Option parsing (06 §6.3)** runs on the argv AFTER the head: inline `--alias=value` for
   eligible arity-1 options, exact alias matches consuming `arity` following tokens, safe
   short clusters (every cluster character a declared alias; earlier characters arity-0; only
   the last may take values), the `--` boundary ending recognition, and everything after it
   positional. Unknown options, missing values, and invalid inline forms turn the part
   `invalid` (07 §7.3); the FIRST observed reason annotates the part.
3. **No selected profile** ⇒ no rule of that part may run; the part reduces to the bare
   default ask, and its evidence state still contributes to the command's classification
   (§8.6).
4. **Collapsed wrapper parts** (07 §7.2) participate only through their children.
5. **Analyzers**: when the selected profile declares an analyzer, the analyzer inspects the
   head token and the post-option-parsing positionals and emits facts from its closed
   catalog. Only `xargs-v1` may additionally relabel an emitted child as an
   `analyzerCommand` part (07 §7.2). Analyzers never load config code, never issue a verdict,
   and never grant a command.

## 8.3 Rules, votes, and reduction

1. **Ask/deny**: every rule whose ordinary predicates hold (06 §6.6) emits one vote.
2. **Allow**: an allow rule passes two phases — its `match` selectors hold for the evidence,
   AND the coverage proof (06 §6.7) holds: every observed security-relevant item (positional
   arguments INCLUDING resolvability, every option occurrence and consumed value, every
   environment assignment, every redirect occurrence and its target coordinates, every
   non-redirect path coordinate, every emitted fact, every nested executable part with its
   required reduced verdict) is universally covered by the applicable selector or by the
   resolved effective redirect policy. A partial match, a first-or-last-only match, or an
   unselected repeated occurrence does not qualify. A rejected allow emits NO vote and
   records its stable coverage reason codes (07 §7.3).
3. **Per-part reduction** by the fixed lattice `allow < ask < deny`; no emitted vote ⇒
   ask. There is no numeric priority, no first-match or last-match behavior, no refinement
   phase, and no configuration-order meaning.
4. **Part message**: when a vote wins, the per-part deciding rule is the rule with the
   lexicographically smallest id among that action's emitted votes; its `message` (if any)
   travels with the part outcome. When NO rule emits a vote (bare default ask), the selected
   profile's `fallbackHints` are considered: hints with no `match` or a satisfied ordinary
   `match` qualify, and the lexicographically smallest qualifying hint id supplies the part
   message. Fallback hints never vote and never fire when a rule vote exists.

## 8.4 Nested parts and analyzer-command findings

Children reduce before parents (ids are ordered); a parent's `nestedParts` selectors see the
child's relation, relation occurrence, selected profile, evidence state, reduced verdict, and
— for `analyzerCommand` parts — the originating analyzer. An allow requiring
`nestedParts` coverage over a nested part MUST therefore be covered with the child's already
reduced verdict (e.g. `verdict: "allow"` only when the child itself passed its coverage
proof).

## 8.5 Path coordinates

Before voting, the profile's `pathSources` declarations (06 §6.3) produce the actual
per-occurrence non-redirect path coordinates (`argument(index)`,
`optionValue(canonicalOptionId, optionOccurrence, valueOrdinal)`,
`environment(assignmentOccurrence)`, `analyzerFact(analyzerId, factName, factOccurrence)`);
a path selector with no observable coordinate produces none. Redirect target coordinates are
parser-produced (07 §7.5) and covered only by the effective redirect policy — never by
`match.paths`. Rules cannot cause new evidence to be produced: a profile with no matching
declaration gains no path evidence even when an argument resembles a path, which keeps allow
coverage obligations independent of which rules happen to match.

## 8.6 Command and letter aggregate, messages, classification

1. **Per-part**: the reduced vote lattice outcome (§8.3).
2. **Per-command aggregate**: most-restrictive across every participating part —
   `deny > ask > allow`; no participating part ⇒ ask.
3. **Evidence state (per command)**: `invalid` when any participating part is `invalid` or
   the evidence-items cap overflowed; else `opaque` when any participating part is `opaque`;
   else `complete`. The wire classification (`02 §2.3`) maps `complete` → `static`, and both
   `opaque` AND `invalid` → `opaque`, with the true state and stable reasons carried in
   bounded `facts`. `match` is `argv` when the command evidence is `complete`, `raw`
   otherwise.
4. **Per-command message**: the lexico-smallest deciding rule id of the winning action among
   the command's deciding parts (§8.3).
5. **Letter aggregate**: most-restrictive across commands. The aggregate message is, for the
   commanding verdict: the first per-command explicit message among commands with that
   verdict; else `defaults.message`; else — deny only — the constant
   `denied by shell-warden policy`. `allow` aggregates carry no message.
6. **Monotonicity invariants (normative)**:
   - REORDERING profiles, rules, options, fallback hints, redirect policies, or entries of
     the maps/lists MUST NOT change a verdict, a message, or the resolved canonical
     redirect-policy set. Messages and rule ids use lexicographic selection exactly so that
     this holds.
   - ADDING a matching allow rule MUST NOT lower any result: it only adds an allow vote, and
     an existing ask or deny remains dominant.
   - NO priority, refinement, order-dependence, or rule-count-dependence semantics exist;
     verdicts are independent of the notation used to write them.

## 8.7 Diagnostics facts (bounded only after the decision)

Diagnostics are computed in full before bounds are applied. Per command, the serialized
`facts` object (02 §2.3, ≤ `limits.diagnosticsBytes`) records:

| Key | Contents |
|---|---|
| `evidence` | the command's evidence state: `complete` \| `opaque` \| `invalid` |
| `reasons` | stable reason codes seen in the graph, sorted and deduplicated |
| `selectedProfiles` | profile ids selected by non-collapsed, non-dead parts, in part order |
| `matched` | ids of every rule whose selectors held (sorted, deduplicated) |
| `qualified` | ids of allow rules whose coverage proof passed |
| `rejected` | objects `{ "ruleId": id, "reasons": [stable coverage codes] }` for rejected allow rules |
| `votes` | emitted vote strings `"{action}:{ruleId}"` in evaluation order |

When the serialized facts exceed `diagnosticsBytes`, the bounded fallback keeps `evidence`,
the first 8 reasons, and a `diagnostics` marker value `truncated-after-decision`; truncation
only ever happens AFTER the decision was computed and never affects it.

## 8.8 Hook application duties (normative summary)

The hook applies the verdict per ADR-0013 reply automation (03 §3.2):

1. `allow` → `permission.reply("once")`; cache the verdict (03 §3.4) if `cache.ttlMs > 0`.
2. `deny` → `permission.reply("reject", message)` — message truncated to 512 chars, never
   widened.
3. `ask` → no reply — escalation by silence; the native prompt stands.
4. Checker anomaly (spawn failure, timeout, non-zero exit, garbage stdout, schema violation)
   → `onCheckerError ∈ {ask, deny}` (09 §9.4); the reply API NEVER synthesizes `allow` from
   an error.
5. Per-session deny budget (ADR-0010, hook-owned): after `rejectBudget.maxRejections` denies
   of the same rule for the session within `rejectBudget.windowMs`, the hook stops replying
   for that rule (commands fall to the human).
6. Tighten-only (I5): an allow reply applies only to a request whose checker verdict was
   allow; an existing native deny is unreachable here and is never loosened.
