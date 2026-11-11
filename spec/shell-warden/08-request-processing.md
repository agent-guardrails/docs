# 08 — Decision Pipeline (checker) & Hook Application

Version 2.3 · 2026-11-11 · Revised for verdict v2 per
[ADR-0022](https://github.com/agent-guardrails/docs/blob/main/adr/0022-post-schema-shell-warden-verdict-validation.md) and
[docs issue 31](https://github.com/agent-guardrails/docs/issues/31): rules vote inside the
binary and reduce by the fixed lattice; there is no refinement phase, first-match semantics,
configuration-order meaning, or compatibility grammar.

## 8.1 Checker pipeline (per letter)

```
read letter                 → validate per 02 §2.2; violation ⇒ exit 1 (never stdout)
load + validate config      → strict per 06 §6.1/§6.9; invalid ⇒ exit 2 (no stdout)
for each command:
    split (07 §7.2)         → recursive executable-part extraction; scanner-split is NEVER trusted
    select profile per part → lexical, unique by config validation (§8.2)
    parse options per part  → per-profile grammar (06 §6.3); failures ⇒ invalid evidence
    run analyzer per part   → closed fact catalog; xargs-v1 may emit analyzer-command parts (§8.4)
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
2. **Option parsing (06 §6.3)** runs on the argv AFTER the head: inline `--alias=value` only
   for arity-one options that explicitly declare `inline: true`, exact alias matches consuming
   their fixed `arity` of zero through four following tokens, the `--` boundary ending
   recognition, and everything after it positional. The parser does not infer aliases or option
   boundaries from token spelling. Unknown options, missing values, and invalid inline forms turn the part
   `invalid` (07 §7.3); the FIRST observed reason annotates the part.
3. **No selected profile** ⇒ no rule of that part may run; the part reduces to the bare
   default ask, and its evidence state still contributes to the command's classification
   (§8.6).
4. **Collapsed wrapper parts** (07 §7.2) participate only through their children.
5. **Analyzers**: when the selected profile declares an analyzer, the analyzer inspects the
   head token and the post-option-parsing positionals and emits facts from its closed
   catalog. Only `xargs-v1` may additionally relabel an emitted child as an
   `analyzer-command` part (07 §7.2). Analyzers never load config code, never issue a verdict,
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
   lexicographically smallest UTF-8 byte sequence among that action's emitted votes; its `message` (if any)
   travels with the part outcome. When NO rule emits a vote (bare default ask), the selected
   profile's `fallbackHints` are considered: hints with no `match` or a satisfied ordinary
   `match` qualify, and the lexicographically smallest UTF-8 byte sequence among qualifying hint IDs supplies the part
   message. Fallback hints never vote and never fire when a rule vote exists.

## 8.4 Nested parts and analyzer-command findings

Children reduce before parents (ids are ordered); a parent's `nestedParts` selectors see the
child's relation, relation occurrence, selected profile, evidence state, reduced verdict, and
— for `analyzer-command` parts — the originating analyzer. An allow requiring
`nestedParts` coverage over a nested part MUST therefore be covered with the child's already
reduced verdict (e.g. `verdict: "allow"` only when the child itself passed its coverage
proof).

## 8.5 Path coordinates

Before voting, the profile's `pathSources` declarations (06 §6.3) produce the actual
per-occurrence non-redirect path coordinates (`argument(index)`,
`optionValue(canonicalOptionId, optionOccurrence, valueOrdinal)`,
`environment(assignmentOccurrence)`,
`analyzerFact(analyzerId, version, factName, factOccurrence)`);
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
   else `complete`. Legacy verdict v1 maps `complete` → `static` and both `opaque` and
   `invalid` → `opaque` exactly as released. Verdict v2 maps `complete` → `static`,
   `opaque` → `opaque`, and `invalid` → `invalid`. `match` is `argv` only for
   complete/static evidence and `raw` otherwise.
4. **Invalid-evidence ask floor**: an invalid command MUST be at least ask and
   MUST NEVER allow. When no ordinary rule emits a vote, it is a bare ask and
   MUST omit `ruleId`. Retained typed evidence or raw text MAY match ordinary ask
   or deny rules. An emitted ask vote yields ask; deny remains dominant.
5. **Per-command message and rule ID**: when present, `ruleId` is the
   UTF-8-byte-order smallest emitted vote whose action matches the command verdict.
   A default ask with no emitted ask vote MUST omit `ruleId`.
6. **Letter aggregate**: most-restrictive across commands. The aggregate message is, for the
   commanding verdict: the first per-command explicit message among commands with that
    verdict; else `defaults.message`; else — deny only — the constant
    `denied by shell-warden policy`. Aggregate `allow` and `ask` messages are
    optional; aggregate `deny` requires a message.
7. **Monotonicity invariants (normative)**:
   - REORDERING profiles, rules, options, fallback hints, redirect policies, or entries of
      the maps/lists MUST NOT change a verdict, an optional aggregate message, or the resolved canonical
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
| `reasons` | stable reason codes seen in the graph, sorted and deduplicated by UTF-8 bytes before any bounded selection |
| `selectedProfiles` | profile ids selected by non-collapsed, non-dead parts, in part order |
| `matched` | ids of every rule whose selectors held (sorted by UTF-8 bytes, deduplicated) |
| `qualified` | ids of allow rules whose coverage proof passed |
| `rejected` | one canonical object `{ "ruleId": id, "reasons": [stable coverage codes] }` per rejected allow rule ID; each object carries all its coverage codes sorted and deduplicated by UTF-8 bytes |
| `votes` | emitted vote strings `"{action}:{ruleId}"` in evaluation order. Default asks are not votes. |

For full diagnostics, `votes` records only emitted votes. Each part without an emitted vote
defaults to ask, so a command may be ask even when all recorded votes are allow. A command
verdict is never less restrictive than any emitted vote. A full static/argv/allow command
MUST contain at least one emitted allow vote. When present, `ruleId` MUST be the
UTF-8-byte-order smallest emitted vote whose action matches the command verdict; a default
ask with no emitted ask vote MUST omit it.

Before serialization, `reasons` MUST be deduplicated and sorted by UTF-8 bytes.
`rejected` MUST be constructed by grouping every rejected allow finding by `ruleId`,
then emitting one entry per rule ID with that rule's complete coverage reasons
deduplicated and sorted by UTF-8 bytes. Duplicate `ruleId` entries are invalid even
if their JSON object properties appear in a different order.

When the serialized facts exceed `diagnosticsBytes`, the bounded fallback keeps
`evidence`, a deterministic `reasons` subset, and a `diagnostics` marker value
`truncated-after-decision`; truncation only ever happens AFTER the decision was
computed and never affects it. If the full reason set has at most eight entries,
the bounded reasons are the full sorted set. Otherwise, retain exactly one evidence
anchor: `complete` for complete evidence, `opaque-expansion` for opaque evidence,
or the UTF-8-byte-order lowest invalid-cause reason for invalid evidence. Fill the
remaining seven slots with the UTF-8-byte-order lowest other reasons, then sort the
selected unique entries by UTF-8 bytes. The bounded reasons array MUST contain no
more than eight entries.

## 8.8 Hook application duties (normative summary)

The hook applies the verdict per ADR-0013 reply automation (03 §3.2):

1. `allow` → `permission.reply("once")`; cache the verdict (03 §3.4) if `cache.ttlMs > 0`.
2. `deny` → `permission.reply("reject", message)` — message truncated to 512 chars, never
   widened.
3. `ask` → no reply — escalation by silence; the native prompt stands. Its optional aggregate message is not a reply.
4. Checker anomaly (spawn failure, timeout, non-zero exit, garbage stdout, schema violation)
   → `onCheckerError ∈ {ask, deny}` (09 §9.4); the reply API NEVER synthesizes `allow` from
   an error.
5. Per-session deny budget (ADR-0010, hook-owned): after `rejectBudget.maxRejections` denies
   of the same rule for the session within `rejectBudget.windowMs`, the hook stops replying
   for that rule (commands fall to the human).
6. Tighten-only (I5): an allow reply applies only to a request whose checker verdict was
   allow; an existing native deny is unreachable here and is never loosened.

## 8.9 Verdict v2 serialization and aggregate consistency

The new checker MUST serialize only the closed v2 envelope in 02 §2.7. It MUST
emit static/argv with allow, ask, or deny; opaque/raw with ask or deny; and
invalid/raw with ask or deny. Every other combination is invalid. Invalid evidence
establishes an ask floor and MUST NEVER allow. When no ordinary rule emits a vote,
it produces a bare ask without `ruleId`. Retained typed evidence or raw text MAY
match ordinary ask or deny rules. An emitted ask vote yields ask with the
deterministic `ruleId` selection of §8.6; deny remains dominant. Opaque evidence
MUST NOT allow.

Before serialization the checker MUST validate v2 output against the expected
letter invocation ID and positional indexes. Validation includes indexes equal to
their array positions in both letter and verdict; recognized full or truncated
diagnostic key sets with well-formed members; stable 07 §7.3 reason codes;
facts/classification agreement; full-diagnostics emitted-vote semantics; the 16
KiB facts and depth-8 caps; and the 64 KiB verdict cap. Consumers MUST additionally
verify those coverage and semantic invariants after schema validation, including
that the aggregate equals the most-restrictive command verdict. Any
serialization or aggregate failure is a checker anomaly and takes `onCheckerError`
through the hook; malformed v2 MUST NOT be retried as v1.

For exact-valid v1 results, a `facts` object containing at least one reserved
diagnostic key, one of
`evidence`, `reasons`, `diagnostics`, `selectedProfiles`, `matched`,
`qualified`, `rejected`, or `votes` MUST be an exact valid full or truncated
diagnostic shape or fail closed. V1 facts disjoint from those reserved keys
remain legacy-opaque.
