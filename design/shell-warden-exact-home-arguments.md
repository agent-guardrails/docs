# Design draft: policy-scoped parameter expansion

Status: proposed direction; no accepted contract or runtime changes
Refinement: https://github.com/agent-guardrails/docs/issues/45
Initial design: https://github.com/agent-guardrails/docs/issues/43
Feature request: https://github.com/agent-guardrails/shell-warden/issues/69
Design PR: https://github.com/agent-guardrails/docs/pull/44
Current policy contract: https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/06-engine-config.md
Current verdict contract: https://github.com/agent-guardrails/docs/blob/main/spec/shell-warden/02-letter-verdict.md

## 1. Direction and permission being granted

Provide a rule-local escape hatch for explicitly allowlisted variable references,
not a HOME-specific raw-source matcher. Keep ordinary argument matching and total
coverage; introduce a typed symbolic-word selector rather than another tuple mode.
This replaces the earlier `arguments.sourceExact` proposal.

There are two independent checks:

1. **Capability:** this allow rule permits references to these variable names.
2. **Coverage:** this rule covers the complete symbolic word at this argument and,
   when applicable, its path coordinate.

Neither check alone permits a command. All other coverage checks still apply.
No configuration field asserts a variable's runtime value or exported status.
The permission authorizes an expression for **any value of its named variables**,
not a confined expanded path. Trusted runtime expansion remains separate work.

Although HOME motivates the feature, the mechanism works with explicit scalar
names such as `HOME`, `XDG_CONFIG_HOME`, or `PROJECT_DIR`; no HOME-specific parser
branch or built-in list of supposedly safe variables is proposed.

## 2. Findings from the current implementation

The design is grounded in these implementation boundaries:

| Boundary | Observation and consequence |
|---|---|
| [Scanner](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/parse.rs#L219-L270) | Active double-quoted expansions currently become an unresolved replacement marker. Preserve typed literal/reference segments before this information is lost; do not reconstruct references from that marker. |
| [Option parsing](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/options.rs#L36-L70) | The parser distinguishes hyphen-prefixed options and a `--` terminator. An unknown value can change that distinction, even inside double quotes. |
| [Allow coverage](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/matcher.rs#L948-L1002) | Allow currently requires complete evidence. A variable-name allowlist cannot simply clear opacity and reuse literal equality. |
| [Path coverage](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/matcher.rs#L1076-L1098) | `paths.none` rejects observed coordinates, and ordinary path entries require resolved values. An unresolved path needs explicit symbolic coverage, not removal from the coordinate set. |
| [Wrapper extraction](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/split.rs#L342-L374) | Most wrappers unwrap only complete parts. Exclusions need to inspect literal wrapper heads, not rely on a child having been extracted from an already-opaque part. |
| [Repeated config assembly](https://github.com/agent-guardrails/shell-warden/blob/5100394b44fde1a241fdce2eb3fef9ffdf0e2ade/src/checker/config.rs#L144-L239) | Files validate independently and profiles remain whole objects. Keep the escape hatch inside its rule; never accumulate variable permissions across files or rules. |
| [Hook verdict validation](https://github.com/agent-guardrails/opencode-shell-warden-hook/blob/4dec4eecb00f32df5b0b316108d70e85e090261a/src/verdict-v2.ts#L231-L264) | Released v2 rejects both unknown classifications and opaque allow. Symbolic permission needs an honest coordinated evidence contract. |

Nine harmless `sh` probes confirmed the relevant shell behavior: quoted expansion
preserves one field even with whitespace or glob characters; variable contents are
not recursively executed by that expansion; empty HOME changes the example target
to `/.config/example`; a leading expansion can become an option; literal `--`
prevents that reinterpretation; prefix assignments and `env` do not change outer
shell argument expansion, but can change a nested shell's value; unbraced names
consume the whole identifier. These probes exercised fixed scripts, not arbitrary
commands or an implementation of the proposed matcher.

## 3. Proposed configuration

The following is a **proposed allow-rule fragment**, not released configuration.
The selected profile declares positional argument 0 as a path source and models
the normal `--` option terminator; its effective redirect policy forbids redirects.

```json
{
  "id": "ls-user-config",
  "action": "allow",
  "expansions": {
    "variables": ["HOME"]
  },
  "match": {
    "classification": "symbolic",
    "arguments": {
      "exact": [
        { "template": "${HOME}/.config/example" }
      ]
    },
    "options": { "none": true },
    "environment": { "none": true },
    "paths": {
      "all": [
        {
          "coordinate": { "argument": { "index": 0 } },
          "template": "${HOME}/.config/example"
        }
      ]
    },
    "facts": { "none": true },
    "nestedParts": { "none": true }
  }
}
```

This can cover `ls -- "$HOME/.config/example"` and
`ls -- "${HOME}/.config/example"` with identical symbolic meaning. The ordinary
option parser consumes the literal `--`; it is not an extra positional argument
and does not require a declared option.

The gate belongs to the allow rule, alongside its `match`, not to
`match.environment`: the latter covers assignment occurrences, not variable reads.
No global or profile-wide switch widens every allow rule.

Proposed validation:

- Omitted `expansions`, or an empty `variables` array, grants no variable capability.
- A nonempty allowlist contains at most 64 unique, case-sensitive names matching
  `[A-Za-z_][A-Za-z0-9_]*`; wildcards, operators, values, and duplicate names are
  invalid.
- A rule using a template has a nonempty allowlist, `classification: "symbolic"`,
  and explicit template coverage for its symbolic arguments. Every template
  reference belongs to that same rule's allowlist.
- Ordinary allow rules retain `classification: "complete"`. Their existing
  strings and selectors keep their current meanings.
- The expansion gate and new template selectors are allow-only in the first
  implementation. Ask/deny rules and hints retain their existing vocabulary.
- A nonempty gate without argument templates is a configuration error, not a
  latent permission that can affect ordinary string selectors.

Unused names in a nonempty list confer no additional argument coverage. A later
rule cannot borrow a gate or a covered coordinate from an earlier rule.

## 4. Typed symbolic words, not rendered strings

Extend an entry of `arguments.exact` from a literal string to the closed choice
`literal string | {"template": string}`. The tuple still has exact count and
position semantics; no new `sourceExact` tuple mode is needed. Prefix/remainder
templates and option-value templates are deferred.

A template describes the decoded word in a small data language, not shell code:
literal chunks interleaved with `${NAME}` placeholders. Config placeholders use
the braced spelling only; unknown `$` forms, operators, backticks, backslashes,
quotes, line breaks, and unterminated placeholders are invalid. At least one
placeholder is present. Proposed fixed bounds are 4096 UTF-8 bytes and 64
references per template, also subject to existing config and evidence limits.
Templates are not globs or regexes: a `*` in a literal chunk is a literal asterisk.

The scanner constructs the same typed representation for eligible command words:

```text
command:  "$HOME/.config/example"
command:  "${HOME}/.config/example"
template: ${HOME}/.config/example
word:     [Variable(HOME), Literal("/.config/example")]
```

Only adjacent literal chunks are coalesced. Equality compares segment types,
variable names, and literal bytes; it never compares a lossy rendered string.
For example, the literal argument `'${HOME}/.config/example'` is not the word above.
`"$HOMEtail"` refers to `HOMEtail`, not to HOME followed by `tail`.

Multiple references, including repeated references to the same name, use this
same model. A template `${XDG_CONFIG_HOME}/${APP}/config` needs both names in its
rule's allowlist. No interpolation of config against checker environment occurs.
The existing `{env:NAME}` helper for locating config files is unrelated and is
not reused for command analysis.

Ordinary exact strings, `str.any`, `str.oneOf`, regexes, and lexical path
selectors still require literal values. They do not match placeholder renderings,
and enabling the gate does not reinterpret a string such as `$HOME/foo`.

## 5. Supported source syntax and argument roles

Initially, an eligible symbolic operand is a single balanced, wholly
double-quoted word containing literal chunks and simple `$NAME`/`${NAME}` reads.
There is no concatenation of separately quoted or unquoted fragments and no
escape processing inside a symbolic word in this first step.

Unquoted expansion, tilde, positional/special parameters such as `$1` or `$@`,
parameter operators, indirect/array references, arithmetic, substitutions,
backticks, process substitution, and malformed quoting do not acquire symbolic
permission. Recognition of a supported reference never hides another unsupported
expansion or its recursively extracted commands.

Double quotes establish **one field**, including when its expanded value is
empty. They do not establish that the field is a positional operand:

- After a preceding, fully literal `--`, the existing profile grammar fixes the
  operand role.
- Without that boundary, a nonempty leading literal chunk whose first character
  is not `-` can establish a non-option word under the same grammar; for example,
  `"./${PROJECT_DIR}/file"`.
- A word beginning with an unknown variable has no such guarantee. Even if its
  template ends in `/file`, its value could start with an option spelling or be
  `--`. It cannot qualify without the boundary.

Thus `ls "$HOME/.config/example"` still asks in this mode, while the explicit
`ls -- "$HOME/.config/example"` can qualify. No assumption that HOME is absolute,
nonempty, or starts with `/` substitutes for role proof.

Never manufacture an option terminator from a symbolic token whose displayed
text resembles `--`. Options, their fixed-arity values, and executable selection
remain entirely literal in the initial implementation. Profile correctness about
an executable's grammar remains the existing policy-author responsibility; the
checker still does not resolve binaries or prove that arbitrary programs honor
`--`.

## 6. Paths and other coverage dimensions

The proposed `template` arm on a non-redirect path coverage entry means:
**authorize this exact symbolic word at this exact argument coordinate**.
It does not mean `within(HOME)` and does not normalize an unknown path.

This is why the example covers the argument twice: its tuple position and its
declared path coordinate are separate coverage obligations. Keep the coordinate
even though its runtime value is unknown:

- Existing `exact`, `within`, and `outside` path policies remain literal-only.
- A path entry chooses exactly one of those policies or the new `template` arm.
  Template coverage is restricted to eligible, individually indexed argument
  coordinates in this step. Overlapping symbolic and ordinary path entries for
  the same argument are rejected: `within` alongside a template is not an
  additional confinement check.
- If a profile produces a symbolic path coordinate but the rule supplies only
  `within`, or supplies `paths.none`, the allow fails. No coordinate is dropped.
- A profile without such path sources can still use `paths.none`; that already
  expresses argument authorization without a path guarantee.
- There is no `.`/`..` simplification across references, symlink check, absolute
  path assertion, or implicit trust in a familiar variable name.

All observed options and literal values still need normal coverage. Redirects,
assignments, facts, nested parts, and limits are not waived by the gate.

For the first implementation, symbolic permission is limited to ordinary root
command parts with no assignments, redirects, nested executable content, or
value-dependent analyzer. Known wrapper/interpreter heads and wrapper children
are excluded even if the current opaque splitter did not unwrap them. Profiles
using code-bearing arguments or richer analyzer semantics need a separate
contract before opting into symbolic permission; the allowlist does not certify
that a program treats its arguments as inert data.

Literal siblings in a chain or pipeline retain their own coverage obligations.
Unsupported content in another part is not rescued by a symbolic allow.

## 7. Rule evaluation and evidence

Keep baseline parser evidence (`complete`, `opaque`, `invalid`) separate from an
allow rule's authorization proof. In particular, do not globally relabel an opaque
word as complete when a name appears on any allowlist.

Proposed evaluation order:

1. Parse all syntax and nested content normally. Preserve literals, typed
   references, quote/field shape, and unsupported causes; retain ordinary opacity.
2. Select the profile and establish argument/option roles without substituting
   variable values. Invalid structure or limits cannot qualify.
3. Evaluate existing ask/deny predicates against their unchanged baseline view.
   An `opaque` predicate still sees an unresolved variable reference.
4. Each symbolic allow rule independently proves supported syntax, its own
   variable capability, template equality, stable roles, and complete coverage of
   every dimension. One rule covers everything; partial proofs do not combine.
5. Only a successful proof emits that rule's allow vote and records symbolic
   authorization. A rejected candidate emits no allow vote.
6. Reduce votes and parts with the existing `deny > ask > allow` lattice and
   deterministic rule-ID selection. A source authorization cannot suppress an
   emitted ask/deny vote or an uncovered sibling's default ask.

For output evidence, a baseline-opaque part has symbolic authorization only when
it actually has a qualified symbolic allow proof. This can coexist with an ask
or deny vote that wins reduction. A merely parseable but uncovered reference is
still opaque, not authorized.

The proposed aggregate evidence order is
`invalid > opaque > symbolic > static`: invalid content dominates; any unresolved
part without a qualified proof remains opaque; otherwise at least one qualified
symbolic part gives symbolic evidence. All-literal commands stay static.
The baseline predicate view is not rewritten by this output classification.

## 8. Values, assignments, and environment changes

The gate permits **named variable references**, not verified environment reads.
A shell-local variable may supply the value even when no such name is exported.
No value is read from checker environment, sent in the letter, or checked against
a configured claim.

Unset and empty values are deliberately covered by this permission. Under
`nounset` the shell may fail instead; the checker does not simulate execution.
Whitespace, glob characters, or text resembling `$(...)` inside a variable's
value do not cause field splitting, globbing, or recursive evaluation by the
supported double-quoted expansion. A downstream interpreter is a separate
execution boundary, not made safe by this fact.

Assignments and environment-changing wrappers remain excluded in the initial
scope; this is an implementation boundary, not proof that HOME cannot change.
For example, `HOME=/other command "$HOME"` expands the argument in the outer
shell before applying the command's assignment. A nested shell can see another
value. Neither case is analyzed by assuming a convenient configured HOME.

A separately covered earlier command may have changed a variable. There is no
cross-command value or taint analysis: the symbolic permission intentionally
accepts every value at the authorized reference. Other commands still need their
own permission.

## 9. Honest wire representation and rollout

Released v2 remains `static/argv`, `opaque/raw`, or `invalid/raw`; its opaque
commands cannot allow. Do not widen that contract in place or present symbolic
permission as static argv.

The proposed direction is a separately versioned verdict contract, provisionally
`shell-warden.verdict.v3`, adding `symbolic/template` with `allow | ask | deny`.
Symbolic evidence means qualified template authorization, not resolved values.
Full diagnostics identify emitted qualified rules and use a distinct symbolic
reason anchor; they do not log variable values. Truncated diagnostics also
identify symbolic rather than complete evidence.

The corresponding contract change needs closed schemas, full/truncated diagnostic
semantics, tuple and aggregation validation, and shared positive/negative fixtures.
Tests include fabricated symbolic allow without a qualifying vote in full
diagnostics, wrong match kind, and inconsistent aggregate evidence.

Proposed rollout is explicit protocol selection on both sides: existing
configurations keep v2 and no expansion capability; enabling the new gate requires
the new checker contract and a matching hook configuration. There is no retry,
automatic downgrade, mixed-version interpretation, or fallback to static evidence.
Old or mismatched consumers reject and degrade. Exact config-version disposition
and protocol-selection field names belong to that contract change and its ADR,
not to an undocumented optional widening of v2.
Adopting this rollout also requires a new ADR superseding the current
[v2-only decision](https://github.com/agent-guardrails/docs/blob/main/adr/0023-shell-warden-verdict-v2-only.md);
this draft does not change that Accepted ADR.

## 10. Alternatives and trade-offs

| Approach | Assessment |
|---|---|
| Global variable allowlist that clears opacity | Too broad: widens unrelated allow rules and can mask unknown options, paths, or interpreter arguments. |
| Earlier HOME-specific `sourceExact` | Quote-sensitive boilerplate, special-cases one variable, and does not express a reusable capability. Replaced by this proposal. |
| Treat existing literal strings as templates whenever a switch is on | Ambiguous literal/reference identity and silent selector reinterpretation. Keep typed template entries instead. |
| Rule-local variable capability plus typed template coverage | Proposed baseline: explicit authority, generic names, structural equality, and no cross-rule permission borrowing. |
| Resolve configured or inherited values | Useful only with a separate trustworthy execution-context binding; does not implement this value-independent escape hatch. |

The cost of the proposed baseline is a typed selector extension and explicit path
coverage when a profile tracks that coordinate. This is intentional: the escape
hatch records exactly which proof is replaced rather than skipping coverage.
These are proposals for review, not accepted architectural decisions; acceptance
requires a new ADR without editing existing Accepted ADRs.

## 11. Regression requirements

| Case | Expected result |
|---|---|
| Existing config or ordinary exact string containing `$HOME` | Unchanged literal semantics; active expansion still opaque |
| Matching template, same-rule allowlist, literal `--`, all coverage | Eligible symbolic allow under the future contract |
| `$HOME` vs `${HOME}` source spelling | Same reference; canonical template equality |
| Single-quoted or escaped-dollar source | Literal, not the corresponding symbolic template |
| `$HOMEtail` with only HOME permitted | No symbolic allow; different variable |
| Several or repeated references | Every reference and whole word covered by the same rule |
| Name not permitted by that rule, even if allowed elsewhere | No symbolic allow |
| Template references name missing from its config allowlist | Config error |
| Duplicate/invalid/wildcard names or gate without templates | Config error |
| Gate present with ordinary `str.any`, regex, or literal exact | No widening to unknown values |
| Leading unknown reference without literal `--` | No symbolic allow; option role unproven |
| Literal `--` or invariant non-hyphen literal prefix | Operand role can be proven under the profile grammar |
| Variable value resembling an option or `--` | Never changes the analyzed grammar; boundary required when needed |
| Unset/empty value, whitespace/glob/code-like value | Same explicit value-independent permission; exactly one quoted field |
| Different suffix, reference order, or argument count | Template/tuple mismatch |
| Path source covered only by `within` or `paths.none` | No symbolic allow; unresolved coordinate retained |
| Matching coordinate template vs literal path policy | Symbolic authorization only; no confinement claim |
| Template and ordinary path coverage overlap on one argument | Config error; no apparent combination with confinement |
| `..` around a reference | No normalization through unknown value or implicit template equality |
| Assignment, redirect, wrapper/interpreter, or dependent analyzer | No symbolic allow in initial scope |
| Unsupported expansion anywhere in the part | Remains opaque/invalid; nested execution still examined |
| Unknown option, missing value, uncovered sibling, limit overflow | Existing fail-closed behavior |
| Existing opaque ask/deny rule also matches | Its vote remains; most restrictive wins |
| Grants split across rules or config files | No combined authorization |
| Old consumer or mismatched protocol | Reject and degrade; never static reinterpretation |

## 12. Acceptance and implementation gates

1. Review the rule-local capability, typed template syntax, any-value semantics,
   argument-role requirements, and initial scope in this design PR.
2. Record accepted capability/evidence and versioning decisions in new ADRs.
3. Define config validation, grammar snapshot, versioned verdict schema, diagnostic
   anchors, aggregate semantics, protocol pinning, and shared fixtures together.
4. Implement scanner evidence preservation, symbolic tuple/coordinate matching,
   independent rule proofs, and coordinated hook validation. Do not replace the
   baseline evidence path.
5. Run checker/hook tests, schema and grammar drift gates, shell-semantic probes,
   and a real permission round trip, including disabled and mismatched versions.

This PR changes design text only. It neither enables the escape hatch nor accepts
a runtime/config/protocol contract.
