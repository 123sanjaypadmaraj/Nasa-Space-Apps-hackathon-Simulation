import json
import unittest

import helpers  # noqa: F401  puts the project root on sys.path

from pyra import builder
from test_research import dummy_corpus

DUMMY_RULES = [
    {"id": "DUMMY-1", "text": "DUMMY rule for every fan.", "source": "DUMMY standard", "page": "1",
     "applies_to": ["fan"]},
    {"id": "DUMMY-2", "text": "DUMMY rule for everything.", "source": "DUMMY standard", "page": "2"},
]

LAYOUT = {
    "compartments": [{"id": "A", "kind": "galley"}, {"id": "B", "kind": "lab"},
                     {"id": "C", "kind": "airlock"}, {"id": "D", "kind": "store"}],
    "edges": [{"from": "A", "to": "B", "type": "hatch"}, {"from": "A", "to": "B", "type": "duct"},
              {"from": "B", "to": "C", "type": "hatch"}],
}
EQUIPMENT = [{"name": "DUMMY fan 1", "type": "fan"}, {"name": "DUMMY heater", "type": "heater"}]
MATERIALS = [{"name": "DUMMY cotton"}, {"name": "DUMMY unobtainium"}]
MAINTENANCE = [{"task": "filter change"}]


class TestBuilder(helpers.TempFiles, unittest.TestCase):

    def test_shipped_rules_file_is_empty(self):
        self.assertEqual(builder.load_rules(), [])

    def test_rule_without_citation_is_refused(self):
        path = self.write("rules.json", json.dumps({"rules": [{"id": "DUMMY-X", "text": "DUMMY"}]}))
        with self.assertRaisesRegex(ValueError, "DUMMY-X.*source, page"):
            builder.load_rules(path)

    def test_checklist_cites_rules_or_says_no_guidance(self):
        items = {i["subject"]: i["guidance"] for i in
                 builder.checklist(LAYOUT, EQUIPMENT, MATERIALS, MAINTENANCE, DUMMY_RULES)}
        self.assertEqual([g["id"] for g in items["equipment DUMMY fan 1"]], ["DUMMY-1", "DUMMY-2"])
        self.assertEqual([g["id"] for g in items["equipment DUMMY heater"]], ["DUMMY-2"])
        empty = builder.checklist(LAYOUT, EQUIPMENT, MATERIALS, MAINTENANCE, [])
        self.assertTrue(all(i["guidance"] == "no sourced guidance" for i in empty))

    def test_compartment_summary(self):
        summary = builder.compartment_summary(LAYOUT)
        self.assertEqual(summary["label"], "ILLUSTRATIVE HEURISTIC")
        rooms = {c["id"]: c for c in summary["compartments"]}
        self.assertEqual(rooms["B"]["degree"], 3)
        self.assertEqual(rooms["B"]["neighbours"], ["A", "C"])
        self.assertEqual((rooms["A"]["hatches"], rooms["A"]["ducts"]), (1, 1))
        self.assertEqual(summary["unconnected"], ["D"])

    def test_unknown_compartment_in_edge(self):
        with self.assertRaisesRegex(ValueError, "unknown compartment Z"):
            builder.compartment_summary({"compartments": [{"id": "A"}],
                                         "edges": [{"from": "A", "to": "Z", "type": "hatch"}]})

    def test_materials_match_never_says_safe(self):
        environment = {"o2_percent": 21, "pressure": 101.3, "gravity_g": 0, "fuel_phase": "solid"}
        table = builder.materials_match(MATERIALS, environment, dummy_corpus())
        self.assertEqual([row["material"] for row in table], ["DUMMY cotton", "DUMMY unobtainium"])
        for row in table:
            self.assertIn("gap_class", row)
            self.assertIn("evidence_class", row)
        self.assertNotIn("safe", json.dumps(table).lower())

    def test_assess_runs_end_to_end(self):
        mission = {"name": "DUMMY mission", "environment": {"o2_percent": 34, "pressure": 56.5}}
        out = builder.assess(mission, LAYOUT, EQUIPMENT, MATERIALS, MAINTENANCE, dummy_corpus(), DUMMY_RULES)
        self.assertEqual(set(out), {"mission", "materials", "checklist", "compartments"})


if __name__ == "__main__":
    unittest.main()
