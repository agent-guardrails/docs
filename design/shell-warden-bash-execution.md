# Bash startup evidence and explicit script operands

Status: implementation design.
Engine tracking: https://github.com/agent-guardrails/shell-warden/issues/74
Contract tracking: https://github.com/agent-guardrails/docs/issues/52

## Goal

Close the checker-only `BASH_ENV=/tmp/inject.sh bash -c 'approved command'`
bypass before enabling a new Bash script invocation form. The current extractor
collapses Bash and drops its environment; `env` also drops assignment operands.
An allowed child then incorrectly stands in for the complete execution.

The existing most-restrictive reducer cannot reject evidence that extraction
has erased. The fix belongs in extraction, with regression coverage through the
real letter/checker interface.

## Selected bounded behavior

- Model `bash -c STRING` and `sh -c STRING` only when `-c` immediately follows
  the executable. Other interpreter options remain opaque. Trailing words
  establish unmodeled `$0`/positional bindings: retain an opaque parent and
  still extract the command string, without appending those words to child argv.
- Model `bash /absolute/script [ARG...]` and
  `bash -- /absolute/script [ARG...]`. The script operand is a literal normalized
  absolute path. Arguments after it are script arguments, even `-c`.
- Emit a script child whose head is exactly that path, with original argument
  tokens. Existing exact executable selection and coverage determine permission.
  Do not recursively interpret the script filename as an interpreter, read its
  contents, resolve symlinks, search PATH, or infer trust from its basename.
- Every visible environment assignment reaching Bash or sh makes that
  interpreter opaque. This deliberately conservative boundary covers startup
  hooks such as `BASH_ENV` without pretending to enumerate all loader hooks,
  imported functions, option variables, or vendor-specific environment behavior.
  A rule covering the assignment as a string cannot prove absence of extra code.
- Retain opaque interpreter parents as participating parts. Independently
  extracted command/script children still contribute restrictive decisions.
- Preserve all leading assignments and `env` assignment operands, in order,
  through supported wrappers. Preserve wrapper redirects through child evidence.
  For a command-string wrapper, inherited evidence is included on each child
  rather than disappearing when the parent collapses.
- Keep assignment-only segments participating with default ask rather than
  dropping possible shell-state changes. Preserve quoted empty argument tokens
  so a script's exact argument coverage cannot silently omit them. Quoted or
  escaped digits adjacent to a redirect remain arguments, not IO-number tokens.
- Keep existing depth/evidence bounds, diagnostic reason vocabulary, and verdict
  format. The conservative startup case uses `opaque-expansion`.

This is a bounded extension of existing transparent extraction. The separate
uniform-wrapper participation implementation remains tracked by
https://github.com/agent-guardrails/shell-warden/issues/73 and will retain every
wrapper parent independently of these startup checks.

## Trust boundary

Script trust is the configured exact path plus argument/option/environment/
redirect coverage. It is not content auditing or a binary identity guarantee.
Bare or relative script operands, stdin mode, dynamic paths, interpreter options,
and non-normalized absolute script spellings stay opaque.

The letter has no inherited execution-environment snapshot. This change accounts
for assignments observable in the parsed command and its supported wrapper
ancestry; it does not certify an unknown ambient environment. A general environment
model or environment sanitization requires a separate end-to-end contract.
Shell state-changing commands and unsupported syntax continue to require their
own decisions; no shell-state simulation is introduced.

## Verification

1. Failing-first checker-only regression for the reported prefix and `env` form.
2. Multiple assignments, nested command-string/transparent wrappers, startup
   options and startup variables including empty values; explicit environment
   allow coverage cannot override interpreter opacity.
3. Exact script path with allowed arguments; changed path, extra arguments,
   `-c` as a script argument, dynamic/relative/stdin forms, and unsupported flags.
4. Environment and redirect coverage survives wrapper extraction.
5. Denied children still dominate opaque parents; recursion and evidence caps
   remain fail-closed; command aggregation includes each command.
6. Real checker CLI letters exercise the same cases without executing scripts.
7. Rust tests, formatting, Clippy, schema fixtures, and grammar drift checks.

The operator's live command limit remains 1 throughout this work.
