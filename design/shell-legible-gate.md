# Design: shell-legible — readability gate (reference stage tool)

v0.1 · 2026-10-31 · Status: design frozen, ready for implementation
Implementation: stage tool for the shell-warden engine (ADR-0008). Not a hook plugin (ADR-0007).

## 1. Positioning

`warden-legible` — a **format gate, not a threat detector.** It guarantees that
commands reach human review — and execution — in conventionally readable form.
It does not judge danger: "is this encoded string dangerous or normal" is not
its question (warden rules and the human answer that).

Key decisions (from the 2026-10 design discussion):

| Decision | Consequence |
|---|---|
| Gate, not display-rewrite | Unreadable → deny + recommendations to the agent. No "readable version" in the prompt — the human sees exactly what will execute (eliminates masking) |
| Structural rules only | Rules are syntactic constructs with ~zero false positives. No "looks like a payload" heuristics, no semantics |
| Review-path only (`voteOn: "ask"`) | Warden-allow ⇒ legible stays silent: policies automated the trust — the format gate does not re-litigate it. Enforcement only on the path to review |
| Bounded rejection (ADR-0010) | Rejection budget → suspension to ask: a token loop is impossible |

## 2. What legible does NOT do

- Does not decode base64/hex and does not judge whether an encoded string is
  dangerous.
- Does not resolve `$VAR` values — commands with substitutions are classified.
- Is not protection against deliberate evasion: structurally clean obfuscation
  (`openssl enc`, obfuscation inside a visible pipe) passes — the safety of
  such commands remains with warden rules, the native scanner, and the human.
- Does not block after a human approval.

## 3. Readability rules (the ladder)

| Level | Rule | FP risk | Default |
|---|---|---|---|
| **L1** | Script-in-script: `eval`, `bash -c`, `sh -c`, `zsh -c`, heredoc → interpreter | Low (construct, not content) | **on** |
| **L2** | Chains longer than N segments (`&&`/`;`/`\|\|`), N default 4 | ~zero at N=4 | opt-in |
| **L3** | Substitutions `$(...)`, backticks | High (idiomatic) | **off** |

Parser failure / unrecognized construct → **ask** (never deny, never allow):
our error must not punish the agent with a denial, but must not silently pass
either.

## 4. Rejection budget → suspension to ask (ADR-0010)

```
1..maxRejections: DENY + prescriptive recommendation ("call it directly, without bash -c")
budget exhausted:  the stage is bypassed for the session → commands go to the human (ask)
successful pass:   counter reset, the gate is active again
```

Never auto-allow. The suspension notice is added to the first message after
the bypass.

## 5. Contract (as a stage tool)

```jsonc
{ "id": "legible", "type": "tool",
  "tool": { "command": ["/usr/local/bin/warden-legible"], "lifecycle": "persistent",
            "timeoutMs": 1000, "onError": "ask" },
  "voteOn": "ask",               // ← does not re-litigate policy trust (§1)
  "messageMode": "append",       // reasons append; the first deny stops the walk
  "budget": { "maxRejections": 3, "windowMs": 1800000 } }
```

Response: `{ "verdict": "deny", "message": "L1: call commands directly, without bash -c",
"cacheTtlMs": 0 }`.

## 6. Honesty boundaries

- Structurally clean obfuscation (`base64 -d` in a visible pipe) passes — and
  must: the human sees the flat command and decides.
- "Danger" assessment — warden + the native scanner + the human; legible is
  responsible only for form.
