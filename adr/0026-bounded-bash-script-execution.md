# 26. Model Bash script operands with exact-path trust and opaque startup context

Date: 2026-11-17
Status: Accepted

## Context

https://github.com/agent-guardrails/shell-warden/issues/74 reports an allow for
`BASH_ENV=/tmp/inject.sh bash -c 'approved command'`. Collapsing the interpreter
discarded environment evidence. Supporting `bash /path/script.sh` additionally
requires distinguishing a script operand from interpreter options and command
strings.

## Decision drivers

- Preserve every observed execution effect before reducing policy decisions.
- Reuse explicit path trust and existing profile argument/option grammar.
- Keep startup behavior fail-closed without auditing script contents.

## Decision

Recognize a bounded Bash file form with a literal normalized absolute script
path. Evaluate the script as a child using existing exact executable profiles
and argument coverage, without reading or auditing the script.

Treat any observable environment assignments reaching Bash/sh as opaque startup
context and retain the interpreter's restrictive contribution. Preserve wrapper
environment and redirects. Only explicitly modeled interpreter syntax can
produce complete evidence.

Implementation design:
https://github.com/agent-guardrails/docs/issues/52#issuecomment-6935083706

## Considered options

- Add configuration-only guards: rejected because omitted extraction evidence
  cannot be recovered by rule reduction.
- Audit script contents: rejected because trust belongs to an explicit path and
  static auditing does not model runtime inputs.
- Enumerate dangerous environment names: rejected as an incomplete proof of
  startup behavior across shells, loaders, and versions.
- Conservatively keep observable interpreter environment opaque: selected; it
  supports the requested file form while preserving the fail-closed boundary.

## Consequences

Environment-prefixed Bash/sh invocations can become stricter, including benign
assignments and empty startup-variable values. Ambient environment remains
outside the current letter contract. Uniform wrapper-parent participation is
still delivered separately under
https://github.com/agent-guardrails/shell-warden/issues/73.
