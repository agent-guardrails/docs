#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

# How to run: uv run scripts/check-shell-warden-config-v2-drift.py --help

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Final

if __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.shell_warden_config_v2_drift import (
    GrammarError,
    drift_diagnostic,
    normalize_grammar,
    parse_snapshot,
)
from scripts.shell_warden_config_v2_remote import remote_main

DEFAULT_SNAPSHOT: Final = Path(__file__).resolve().parents[1] / "schemas/shell-warden.config.v2.grammar.snapshot"


class CliOptions(argparse.Namespace):
    grammar_file: Path | None
    remote_main: bool
    snapshot: Path

    def __init__(self) -> None:
        super().__init__()
        self.grammar_file = None
        self.remote_main = False
        self.snapshot = DEFAULT_SNAPSHOT


def _read_source(options: CliOptions) -> tuple[str, str]:
    if options.remote_main:
        grammar, sha = remote_main()
        print(f"resolved shell-warden@main to {sha}", file=sys.stderr)
        return grammar, f"shell-warden@{sha}"
    grammar_file = options.grammar_file
    if grammar_file is None:
        raise GrammarError("--grammar-file is required without --remote-main")
    return grammar_file.read_text(encoding="utf-8"), str(grammar_file)


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare shell-warden config v2 Rust grammar with its docs snapshot.")
    source = parser.add_mutually_exclusive_group(required=True)
    _ = source.add_argument("--grammar-file", type=Path)
    _ = source.add_argument("--remote-main", action="store_true")
    _ = parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    options = CliOptions()
    _ = parser.parse_args(arguments, namespace=options)

    try:
        grammar, source_name = _read_source(options)
        expected = options.snapshot.read_text(encoding="utf-8")
        _ = parse_snapshot(expected)
        actual = normalize_grammar(grammar)
    except (GrammarError, OSError, UnicodeError) as error:
        print(f"shell-warden config v2 grammar check failed: {error}", file=sys.stderr)
        return 2

    if actual != expected:
        print(drift_diagnostic(expected, actual, source_name), file=sys.stderr)
        return 1
    print(f"grammar snapshot matches: {source_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
