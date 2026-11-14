"""
Small tests for tools/check_phase0.py.
Run from the project folder:  python -m unittest discover tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

# let the test import the script from the tools folder
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import check_phase0


class TestCheckPhase0(unittest.TestCase):

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())

    def write(self, name, text):
        path = self.folder / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_source_without_verifier_is_flagged(self):
        csv_file = self.write("s.csv",
            "id,investigation,url,access_date,verified_by\n"
            "S01,BASS-II,https://example.org,2026-11-14,\n")
        problems = check_phase0.check_sources(csv_file)
        self.assertEqual(len(problems), 1)
        self.assertIn("verified_by", problems[0])

    def test_fully_filled_source_passes(self):
        csv_file = self.write("s.csv",
            "id,investigation,url,access_date,verified_by\n"
            "S01,BASS-II,https://example.org,2026-11-14,Asha\n")
        self.assertEqual(check_phase0.check_sources(csv_file), [])

    def test_weights_must_add_to_one(self):
        decisions = {"ranking_weights": {"value": {"a": 0.5, "b": 0.4}, "confirmed_by": "Asha"}}
        json_file = self.write("d.json", json.dumps(decisions))
        problems = check_phase0.check_decisions(json_file)
        self.assertTrue(any("add up to" in p for p in problems))

    def test_unconfirmed_decision_is_flagged_and_notes_are_skipped(self):
        decisions = {"_note": "ignore me", "database": {"value": "sqlite", "confirmed_by": ""}}
        json_file = self.write("d.json", json.dumps(decisions))
        problems = check_phase0.check_decisions(json_file)
        self.assertEqual(problems, ["database: nobody has confirmed it yet",
                                    "ranking_weights add up to 0, should be 1"])


if __name__ == "__main__":
    unittest.main()
