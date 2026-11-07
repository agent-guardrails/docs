from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Final

ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPTS: Final = ROOT / "scripts"

from scripts.shell_warden_config_v2_drift import (
    BEGIN_MARKER,
    END_MARKER,
    GrammarError,
    drift_diagnostic,
    normalize_grammar,
    parse_snapshot,
)

CHECKER: Final = SCRIPTS / "check-shell-warden-config-v2-drift.py"
FIXTURE: Final = SCRIPTS / "tests/fixtures/grammar-target.rs"
SNAPSHOT: Final = ROOT / "schemas/shell-warden.config.v2.grammar.snapshot"
SUBPROCESS_TIMEOUT_SECONDS: Final = 5.0


def grammar(*declarations: str) -> str:
    return "\n".join((BEGIN_MARKER, *declarations, END_MARKER))


class NormalizationHardeningTests(unittest.TestCase):
    def test_declaration_reordering_is_invariant(self) -> None:
        first = "pub struct Alpha { pub value: bool, }"
        second = "pub enum Zebra { One, Two, }"

        self.assertEqual(
            normalize_grammar(grammar(first, second)),
            normalize_grammar(grammar(second, first)),
        )

    def test_formatting_and_comments_are_ignored(self) -> None:
        compact = grammar("#[serde(default)] pub struct Item { pub value: bool, }")
        formatted = grammar(
            "/* before */ #[serde( default )]\npub struct Item { // field\n pub value : bool , /* after */ }",
        )

        self.assertEqual(normalize_grammar(compact), normalize_grammar(formatted))

    def test_rust_lifetime_is_supported(self) -> None:
        source = grammar("pub struct Borrowed<'a> { pub value: &'a str, }")

        normalized = normalize_grammar(source)

        self.assertIn("Borrowed < ' a >", normalized)
        self.assertIn("& ' a str", normalized)

    def test_duplicate_marker_is_rejected(self) -> None:
        source = grammar("pub struct Item { pub value: bool, }") + f"\n{END_MARKER}"

        with self.assertRaisesRegex(GrammarError, "exactly one marker pair"):
            _ = normalize_grammar(source)

    def test_reversed_markers_are_rejected(self) -> None:
        source = f"{END_MARKER}\npub struct Item {{ pub value: bool, }}\n{BEGIN_MARKER}"

        with self.assertRaisesRegex(GrammarError, "precedes"):
            _ = normalize_grammar(source)


class SnapshotHardeningTests(unittest.TestCase):
    def run_with_snapshot(self, snapshot: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            snapshot_path = Path(directory) / "snapshot.txt"
            _ = snapshot_path.write_text(snapshot, encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--grammar-file",
                    str(FIXTURE),
                    "--snapshot",
                    str(snapshot_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=SUBPROCESS_TIMEOUT_SECONDS,
            )

    def assert_controlled_snapshot_error(self, snapshot: str, message: str) -> None:
        result = self.run_with_snapshot(snapshot)

        self.assertEqual(2, result.returncode)
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_malformed_snapshot_line_is_controlled(self) -> None:
        self.assert_controlled_snapshot_error(
            "# shell-warden config v2 structural grammar snapshot\nnot a declaration\n",
            "malformed declaration",
        )

    def test_header_only_snapshot_is_controlled(self) -> None:
        self.assert_controlled_snapshot_error(
            "# shell-warden config v2 structural grammar snapshot\n",
            "contains no declarations",
        )

    def test_wrong_snapshot_header_is_controlled(self) -> None:
        self.assert_controlled_snapshot_error(
            "# wrong header\npub struct Item { pub value : bool , }\n",
            "invalid header",
        )

    def test_duplicate_snapshot_name_is_controlled(self) -> None:
        declaration = "pub struct Item { pub value : bool , }"
        self.assert_controlled_snapshot_error(
            f"# shell-warden config v2 structural grammar snapshot\n{declaration}\n{declaration}\n",
            "duplicate declaration `Item`",
        )

    def test_reorder_diagnostic_identifies_changed_declaration(self) -> None:
        expected = normalize_grammar(grammar("pub struct Item { pub before: bool, }"))
        actual = normalize_grammar(grammar("pub struct Item { pub after: bool, }"))

        diagnostic = drift_diagnostic(expected, actual, "fixture")

        self.assertIn("changed declaration: Item", diagnostic)
        self.assertIn("before", diagnostic)
        self.assertIn("after", diagnostic)

    def test_committed_snapshot_is_valid(self) -> None:
        declarations = parse_snapshot(SNAPSHOT.read_text(encoding="utf-8"))

        self.assertIn("ArgumentsMatcher", declarations)


if __name__ == "__main__":
    _ = unittest.main()
