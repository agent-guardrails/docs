#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

# How to run: uv run scripts/check-shell-warden-config-v2-drift.py --help

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass
from http import HTTPStatus
from http.client import HTTPException, HTTPSConnection
from pathlib import Path
from typing import Final, override

BEGIN_MARKER: Final = "// shell-warden-config-v2-grammar: begin"
END_MARKER: Final = "// shell-warden-config-v2-grammar: end"
SNAPSHOT_HEADER: Final = "# shell-warden config v2 structural grammar snapshot"
DEFAULT_SNAPSHOT: Final = Path(__file__).resolve().parents[1] / "schemas/shell-warden.config.v2.grammar.snapshot"
API_HOST: Final = "api.github.com"
COMMIT_PATH: Final = "/repos/agent-guardrails/shell-warden/commits/main"
RAW_HOST: Final = "raw.githubusercontent.com"
GRAMMAR_PATH: Final = "/agent-guardrails/shell-warden/{sha}/src/checker/grammar.rs"
NETWORK_TIMEOUT_SECONDS: Final = 10.0
DECLARATION_RE: Final = re.compile(r"\bpub\s+(?:struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)")
TOKEN_RE: Final = re.compile(r'"(?:\\.|[^"\\])*"|::|=>|->|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[^\s]')


@dataclass(frozen=True, slots=True)
class GrammarError(Exception):
    detail: str

    @override
    def __str__(self) -> str:
        return self.detail


class CliOptions(argparse.Namespace):
    grammar_file: Path | None
    remote_main: bool
    snapshot: Path

    def __init__(self) -> None:
        super().__init__()
        self.grammar_file = None
        self.remote_main = False
        self.snapshot = DEFAULT_SNAPSHOT


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
    quote = ""
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
        elif quote:
            output.append(char)
            if char == "\\" and index + 1 < len(source):
                index += 1
                output.append(source[index])
            elif char == quote:
                quote = ""
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
            if char in {'"', "'"}:
                quote = char
            output.append(char)
            index += 1
    if block_depth:
        raise GrammarError("unbalanced block comment in grammar markers")
    if quote:
        raise GrammarError("unterminated string or character literal in grammar markers")
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
    quote = ""
    index = brace
    while index < len(source):
        char = source[index]
        if quote:
            if char == "\\" and index + 1 < len(source):
                index += 2
                continue
            if char == quote:
                quote = ""
        elif char in {'"', "'"}:
            quote = char
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
    declarations: list[tuple[str, str]] = []
    cursor = 0
    while match := DECLARATION_RE.search(region, cursor):
        name = match.group(1)
        end = _declaration_end(region, name, match.start())
        start = _attribute_start(region, match.start())
        tokens = TOKEN_RE.findall(region[start:end])
        normalized = re.sub(r"# \[ (.*?) \]", r"#[\1]", " ".join(tokens))
        declarations.append((name, normalized))
        cursor = end
    if not declarations:
        raise GrammarError("no public struct or enum declarations between markers")
    names = [name for name, _ in declarations]
    if len(names) != len(set(names)):
        raise GrammarError("duplicate public declaration name between markers")
    lines = [SNAPSHOT_HEADER, *(text for _, text in declarations)]
    return "\n".join(lines) + "\n"


def _fetch_text(host: str, path: str) -> str:
    try:
        with closing(HTTPSConnection(host, timeout=NETWORK_TIMEOUT_SECONDS)) as connection:
            connection.request(
                "GET",
                path,
                headers={"User-Agent": "agent-guardrails-docs-drift-guard"},
            )
            response = connection.getresponse()
            if response.status != HTTPStatus.OK:
                raise GrammarError(f"GET https://{host}{path} returned {response.status}")
            return response.read().decode("utf-8")
    except (HTTPException, OSError, UnicodeDecodeError) as error:
        raise GrammarError(f"failed to fetch https://{host}{path}: {error}") from error


def _remote_main() -> tuple[str, str]:
    metadata = _fetch_text(API_HOST, COMMIT_PATH)
    match = re.search(r'"sha"\s*:\s*"([0-9a-f]{40})"', metadata)
    if match is None:
        raise GrammarError("GitHub main response did not contain a commit SHA")
    sha = match.group(1)
    return _fetch_text(RAW_HOST, GRAMMAR_PATH.format(sha=sha)), sha


def _declarations(snapshot: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in snapshot.splitlines()[1:]:
        match = DECLARATION_RE.search(line)
        if match is None:
            raise GrammarError("snapshot contains a malformed declaration")
        result[match.group(1)] = line
    return result


def _drift_diagnostic(expected: str, actual: str, source_name: str) -> str:
    expected_declarations = _declarations(expected)
    actual_declarations = _declarations(actual)
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
                )
            )
    return "\n".join(messages)


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare shell-warden config v2 Rust grammar with its docs snapshot.")
    source = parser.add_mutually_exclusive_group(required=True)
    _ = source.add_argument("--grammar-file", type=Path)
    _ = source.add_argument("--remote-main", action="store_true")
    _ = parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    options = CliOptions()
    _ = parser.parse_args(arguments, namespace=options)

    try:
        if options.remote_main:
            grammar, sha = _remote_main()
            source_name = f"shell-warden@{sha}"
            print(f"resolved shell-warden@main to {sha}", file=sys.stderr)
        else:
            grammar_file = options.grammar_file
            if grammar_file is None:
                raise GrammarError("--grammar-file is required without --remote-main")
            grammar = grammar_file.read_text(encoding="utf-8")
            source_name = str(grammar_file)
        expected = options.snapshot.read_text(encoding="utf-8")
        actual = normalize_grammar(grammar)
    except (GrammarError, OSError, UnicodeError) as error:
        print(f"shell-warden config v2 grammar check failed: {error}", file=sys.stderr)
        return 2

    if actual != expected:
        print(_drift_diagnostic(expected, actual, source_name), file=sys.stderr)
        return 1
    print(f"grammar snapshot matches: {source_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
