from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Final

ROOT: Final = Path(__file__).resolve().parents[2]
SCRIPT: Final = ROOT / "scripts/check-shell-warden-config-v2-drift.py"
FIXTURE: Final = ROOT / "scripts/tests/fixtures/grammar-target.rs"
SNAPSHOT: Final = ROOT / "schemas/shell-warden.config.v2.grammar.snapshot"
BEGIN_MARKER: Final = "// shell-warden-config-v2-grammar: begin"
END_MARKER: Final = "// shell-warden-config-v2-grammar: end"


class DriftGuardTests(unittest.TestCase):
    def run_guard(self, grammar: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--grammar-file",
                str(grammar),
                "--snapshot",
                str(SNAPSHOT),
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def run_mutation(self, old: str, new: str) -> subprocess.CompletedProcess[str]:
        source = FIXTURE.read_text(encoding="utf-8")
        self.assertIn(old, source)
        snapshot_before = SNAPSHOT.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            grammar = Path(directory) / "grammar.rs"
            _ = grammar.write_text(source.replace(old, new, 1), encoding="utf-8")
            result = self.run_guard(grammar)
        self.assertEqual(snapshot_before, SNAPSHOT.read_bytes())
        return result

    def test_equal_grammar_matches_snapshot(self) -> None:
        result = self.run_guard(FIXTURE)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("grammar snapshot matches", result.stdout)

    def test_missing_begin_marker_is_rejected(self) -> None:
        result = self.run_mutation(BEGIN_MARKER, "// marker removed")

        self.assertNotEqual(0, result.returncode)
        self.assertIn("missing begin marker", result.stderr)

    def test_missing_end_marker_is_rejected(self) -> None:
        result = self.run_mutation(END_MARKER, "// marker removed")

        self.assertNotEqual(0, result.returncode)
        self.assertIn("missing end marker", result.stderr)

    def test_malformed_declaration_is_rejected(self) -> None:
        result = self.run_mutation(
            "pub enum TokenSelector {",
            "pub enum TokenSelector;",
        )

        self.assertNotEqual(0, result.returncode)
        self.assertIn("malformed declaration `TokenSelector`", result.stderr)

    def test_unbalanced_declaration_is_rejected(self) -> None:
        result = self.run_mutation(
            "    Within(String),\n}",
            "    Within(String),",
        )

        self.assertNotEqual(0, result.returncode)
        self.assertIn("unbalanced declaration `TokenSelector`", result.stderr)

    def test_changed_serde_attribute_reports_drift(self) -> None:
        result = self.run_mutation(
            '#[serde(deny_unknown_fields, rename_all = "camelCase")]\npub struct ArgumentsMatcher',
            '#[serde(deny_unknown_fields, rename_all = "snake_case")]\npub struct ArgumentsMatcher',
        )

        self.assertNotEqual(0, result.returncode)
        self.assertIn("ArgumentsMatcher", result.stderr)
        self.assertIn("snake_case", result.stderr)

    def test_changed_field_reports_drift(self) -> None:
        result = self.run_mutation("pub contains_any:", "pub excludes_all:")

        self.assertNotEqual(0, result.returncode)
        self.assertIn("contains_any", result.stderr)
        self.assertIn("excludes_all", result.stderr)

    def test_changed_variant_reports_drift(self) -> None:
        result = self.run_mutation("Within(String)", "Outside(String)")

        self.assertNotEqual(0, result.returncode)
        self.assertIn("Within", result.stderr)
        self.assertIn("Outside", result.stderr)

    def test_extra_declaration_reports_drift(self) -> None:
        extra = "#[serde(deny_unknown_fields)]\npub struct ExtraGrammar {\n    pub field: bool,\n}\n\n"
        result = self.run_mutation(END_MARKER, extra + END_MARKER)

        self.assertNotEqual(0, result.returncode)
        self.assertIn("ExtraGrammar", result.stderr)

    def test_missing_declaration_reports_drift(self) -> None:
        source = FIXTURE.read_text(encoding="utf-8")
        start = source.index("#[derive", source.index("pub enum TokenSelector") - 200)
        end = source.index("\n\n", source.index("pub enum TokenSelector")) + 2
        snapshot_before = SNAPSHOT.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            grammar = Path(directory) / "grammar.rs"
            _ = grammar.write_text(source[:start] + source[end:], encoding="utf-8")
            result = self.run_guard(grammar)
        self.assertEqual(snapshot_before, SNAPSHOT.read_bytes())

        self.assertNotEqual(0, result.returncode)
        self.assertIn("TokenSelector", result.stderr)


if __name__ == "__main__":
    _ = unittest.main()
