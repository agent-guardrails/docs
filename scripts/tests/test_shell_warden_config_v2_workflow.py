from __future__ import annotations

import unittest
from pathlib import Path
from typing import ClassVar, Final, override

ROOT: Final = Path(__file__).resolve().parents[2]
WORKFLOW: Final = ROOT / ".github/workflows/shell-warden-config-drift.yml"


class WorkflowContractTests(unittest.TestCase):
    workflow: ClassVar[str]

    @classmethod
    @override
    def setUpClass(cls) -> None:
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_job_has_timeout(self) -> None:
        self.assertIn("timeout-minutes: 10", self.workflow)

    def test_fixture_changes_trigger_workflow(self) -> None:
        self.assertIn('"schemas/fixtures/shell-warden.config.v2/**"', self.workflow)

    def test_pinned_ajv_runs_fixture_validator(self) -> None:
        self.assertIn("ajv@8.17.1", self.workflow)
        self.assertIn("node scripts/validate-shell-warden-config-v2-fixtures.mjs", self.workflow)

    def test_v3_gate_replaces_live_comparison_to_historical_v2(self) -> None:
        self.assertNotIn("--remote-main", self.workflow)
        active = (ROOT / ".github/workflows/shell-warden-v3.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn('"schemas/**"', active)
        self.assertIn("ajv@8.17.1", active)
        self.assertIn("node scripts/generate-shell-warden-v3.mjs --check", active)
        self.assertIn("node scripts/validate-shell-warden-v3.mjs", active)
        self.assertNotIn("continue-on-error", active)


if __name__ == "__main__":
    _ = unittest.main()
