from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, override

BEGIN_MARKER: Final = "// shell-warden-config-v2-grammar: begin"
END_MARKER: Final = "// shell-warden-config-v2-grammar: end"
SNAPSHOT_HEADER: Final = "# shell-warden config v2 structural grammar snapshot"
DECLARATION_RE: Final = re.compile(r"\bpub\s+(?:struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)")
TOKEN_RE: Final = re.compile(r'"(?:\\.|[^"\\])*"|::|=>|->|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[^\s]')


@dataclass(frozen=True, slots=True)
class GrammarError(Exception):
    detail: str

    @override
    def __str__(self) -> str:
        return self.detail


def _marked_region(source: str) -> str:
    begin_count = source.count(BEGIN_MARKER)
    end_count = source.count(END_MARKER)
    if begin_count == 0:
        raise GrammarError("missing begin marker")
    if end_count == 0:
        raise GrammarError("missing end marker")
    if begin_count != 1 or end_count != 1:
        raise GrammarError("grammar source must contain exactly one marker pair")
    begin = source.index(BEGIN_MARKER) + len(BEGIN_MARKER)
    end = source.index(END_MARKER)
    if end <= begin:
        raise GrammarError("end marker precedes begin marker")
    return source[begin:end]


def _strip_comments(source: str) -> str:
    output: list[str] = []
    index = 0
    block_depth = 0
    in_string = False
    while index < len(source):
        pair = source[index : index + 2]
        char = source[index]
        if block_depth:
            if pair == "/*":
                block_depth += 1
                index += 2
            elif pair == "*/":
                block_depth -= 1
                index += 2
            else:
                if char == "\n":
                    output.append(char)
                index += 1
        elif in_string:
            output.append(char)
            if char == "\\" and index + 1 < len(source):
                index += 1
                output.append(source[index])
            elif char == '"':
                in_string = False
            index += 1
        elif pair == "//":
            newline = source.find("\n", index + 2)
            if newline < 0:
                break
            output.append("\n")
            index = newline + 1
        elif pair == "/*":
            block_depth = 1
            index += 2
        else:
            if char == '"':
                in_string = True
            output.append(char)
            index += 1
    if block_depth:
        raise GrammarError("unbalanced block comment in grammar markers")
    if in_string:
        raise GrammarError("unterminated string literal in grammar markers")
    return "".join(output)


def _retain_serde_attributes(source: str) -> str:
    output: list[str] = []
    index = 0
    while index < len(source):
        if source.startswith("#[", index):
            end = source.find("]", index + 2)
            if end < 0:
                raise GrammarError("unbalanced Rust attribute in grammar markers")
            attribute = source[index : end + 1]
            if re.match(r"#\[\s*serde\b", attribute):
                output.append(attribute)
            index = end + 1
        else:
            output.append(source[index])
            index += 1
    return "".join(output)


def _attribute_start(source: str, declaration_start: int) -> int:
    start = declaration_start
    while True:
        cursor = start - 1
        while cursor >= 0 and source[cursor].isspace():
            cursor -= 1
        if cursor < 0 or source[cursor] != "]":
            return start
        bracket = source.rfind("#[", 0, cursor + 1)
        if bracket < 0 or source[bracket : cursor + 1].count("[") != 1:
            return start
        start = bracket


def _declaration_end(source: str, name: str, declaration_start: int) -> int:
    brace = source.find("{", declaration_start)
    semicolon = source.find(";", declaration_start)
    if brace < 0 or 0 <= semicolon < brace:
        raise GrammarError(f"malformed declaration `{name}`: expected a braced body")
    depth = 0
    in_string = False
    index = brace
    while index < len(source):
        char = source[index]
        if in_string:
            if char == "\\" and index + 1 < len(source):
                index += 2
                continue
            if char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    raise GrammarError(f"unbalanced declaration `{name}`")


def normalize_grammar(source: str) -> str:
    region = _retain_serde_attributes(_strip_comments(_marked_region(source)))
    declarations: dict[str, str] = {}
    cursor = 0
    while match := DECLARATION_RE.search(region, cursor):
        name = match.group(1)
        if name in declarations:
            raise GrammarError(f"duplicate public declaration `{name}` between markers")
        end = _declaration_end(region, name, match.start())
        start = _attribute_start(region, match.start())
        tokens = TOKEN_RE.findall(region[start:end])
        declarations[name] = re.sub(r"# \[ (.*?) \]", r"#[\1]", " ".join(tokens))
        cursor = end
    if not declarations:
        raise GrammarError("no public struct or enum declarations between markers")
    return "\n".join((SNAPSHOT_HEADER, *(declarations[name] for name in sorted(declarations)), ""))


def parse_snapshot(snapshot: str) -> dict[str, str]:
    lines = snapshot.splitlines()
    if not lines or lines[0] != SNAPSHOT_HEADER:
        raise GrammarError("snapshot has an invalid header")
    if len(lines) == 1:
        raise GrammarError("snapshot contains no declarations")
    declarations: dict[str, str] = {}
    for line in lines[1:]:
        match = DECLARATION_RE.search(line)
        if match is None:
            raise GrammarError("snapshot contains a malformed declaration")
        name = match.group(1)
        if name in declarations:
            raise GrammarError(f"snapshot contains duplicate declaration `{name}`")
        declarations[name] = line
    if list(declarations) != sorted(declarations):
        raise GrammarError("snapshot declarations are not name-sorted")
    return declarations


def drift_diagnostic(expected: str, actual: str, source_name: str) -> str:
    expected_declarations = parse_snapshot(expected)
    actual_declarations = parse_snapshot(actual)
    messages = [f"shell-warden config v2 grammar drift: {source_name}"]
    for name in sorted(expected_declarations.keys() - actual_declarations.keys()):
        messages.append(f"missing declaration: {name}")
    for name in sorted(actual_declarations.keys() - expected_declarations.keys()):
        messages.append(f"extra declaration: {name}")
    for name in sorted(expected_declarations.keys() & actual_declarations.keys()):
        if expected_declarations[name] != actual_declarations[name]:
            messages.extend(
                (
                    f"changed declaration: {name}",
                    f"- {expected_declarations[name]}",
                    f"+ {actual_declarations[name]}",
                ),
            )
    return "\n".join(messages)
