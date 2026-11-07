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

    def test_remote_main_gate_remains_mandatory(self) -> None:
        remote_step = self.workflow.split("- name: Compare shell-warden main", maxsplit=1)[1]

        self.assertIn("--remote-main", remote_step)
        self.assertNotIn("continue-on-error", remote_step)


if __name__ == "__main__":
    _ = unittest.main()
