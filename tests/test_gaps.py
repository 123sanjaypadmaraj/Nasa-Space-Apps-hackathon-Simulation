import unittest

import helpers  # noqa: F401  puts the project root on sys.path

from pyra import evidence, gaps


def dummy_run(run_id, gravity, words=(), scale="bench", **values):
    """DUMMY - NOT REAL DATA. One test run with the given values."""
    numbers = {"o2_percent": 21.0, "pressure": 101.0, "flow_speed": 10.0, "temperature": None}
    numbers.update(values, gravity=gravity)
    return {"run_id": run_id, "investigation_id": 1, "acronym": "DUMMY-X", "scale": scale,
            "pillar": "prevention", "materials": ["PMMA"], "values": numbers,
            "from_words": list(words), "source": {"title": "DUMMY - NOT REAL DATA"}}


def corpus(*runs):
    return {"investigations": [{"id": 1}], "runs": list(runs)}


def scenario(**raw):
    base = {"o2_percent": 21, "pressure": 101, "flow_speed": 10, "material": "PMMA", "pillar": "prevention"}
    return evidence.scenario(dict(base, **raw))


class TestClassifyAxis(unittest.TestCase):

    def test_moon_between_zero_and_one_g_is_bounded(self):
        gap, distance = gaps.classify_axis([0.0, 0.0, 1.0, 1.0], 0.16, 0.05, 3)
        self.assertEqual(gap, "BOUNDED")
        self.assertAlmostEqual(distance, 3.2)

    def test_classes(self):
        self.assertEqual(gaps.classify_axis([20, 21, 22], 21, 2, 3), ("DIRECTLY_TESTED", 0.0))
        self.assertEqual(gaps.classify_axis([21, 30], 21, 2, 3), ("INSUFFICIENT", 0.0))
        self.assertEqual(gaps.classify_axis([15, 17], 30, 2, 3), ("ONE_SIDED", 6.5))
        self.assertEqual(gaps.classify_axis([None], 30, 2, 3), ("NO_INDEXED_DATA", None))


class TestAnalyze(unittest.TestCase):

    def test_moon_with_only_zero_and_one_g_data(self):
        runs = [dummy_run(f"R{n}", g) for n, g in enumerate([0.0, 0.0, 0.0, 1.0, 1.0, 1.0])]
        found = gaps.analyze(corpus(*runs), scenario(gravity_g=0.16))
        self.assertEqual(found["axes"]["gravity"]["class"], "BOUNDED")
        self.assertNotEqual(found["combination"]["class"], "DIRECTLY_TESTED")
        self.assertEqual(found["combination"]["runs_matching"], [])
        text = " ".join(found["report"])
        self.assertIn("bounded by", text)
        self.assertIn("not directly measured", text)
        self.assertNotIn("safe", text.lower())

    def test_combination_needs_one_run_matching_every_axis(self):
        runs = [dummy_run(f"R{n}", 0.16) for n in range(3)]
        found = gaps.analyze(corpus(*runs), scenario(gravity_g=0.16))
        self.assertEqual(found["combination"]["class"], "DIRECTLY_TESTED")
        self.assertEqual(found["combination"]["runs_matching"], ["R0", "R1", "R2"])

    def test_axes_covered_separately_are_not_a_combination(self):
        runs = [dummy_run(f"G{n}", 0.16, o2_percent=40.0) for n in range(3)]
        runs += [dummy_run(f"O{n}", 1.0) for n in range(3)]
        found = gaps.analyze(corpus(*runs), scenario(gravity_g=0.16))
        self.assertEqual(found["axes"]["gravity"]["class"], "DIRECTLY_TESTED")
        self.assertEqual(found["axes"]["o2_percent"]["class"], "DIRECTLY_TESTED")
        self.assertEqual(found["combination"]["class"], "INSUFFICIENT")

    def test_word_gravity_is_not_comparable(self):
        runs = [dummy_run(f"R{n}", 0.0, words=["gravity"]) for n in range(3)]
        found = gaps.analyze(corpus(*runs), scenario(gravity_g=0.0))
        self.assertEqual(found["axes"]["gravity"]["class"], "NOT_COMPARABLE")

    def test_other_scale_is_not_comparable(self):
        runs = [dummy_run(f"R{n}", 0.0) for n in range(3)]
        found = gaps.analyze(corpus(*runs), scenario(gravity_g=0.0, scale="spacecraft-scale"))
        self.assertEqual(found["axes"]["o2_percent"]["class"], "NOT_COMPARABLE")

    def test_nearest_runs_carry_source(self):
        runs = [dummy_run(f"R{n}", 0.0, o2_percent=21.0 + n) for n in range(5)]
        nearest = gaps.analyze(corpus(*runs), scenario(gravity_g=0.0))["nearest_runs"]
        self.assertEqual([r["run_id"] for r in nearest], ["R0", "R1", "R2"])
        self.assertEqual(nearest[0]["source"]["title"], "DUMMY - NOT REAL DATA")

    def test_dummy_database(self):
        found = gaps.analyze(evidence.load(evidence.dummy_conn()), scenario(gravity_g=0.16))
        self.assertEqual(found["label"], "DERIVED")
        self.assertEqual(set(found["axes"]), {"o2_percent", "pressure", "flow_speed", "gravity",
                                              "material_class", "pillar"})


if __name__ == "__main__":
    unittest.main()
