"""
check_phase0.py - tells us if Phase 0 is finished.

Phase 0 is done when:
  1. every source in sources/sources.csv has a url, an access date and a verifier
  2. every decision in config/decisions.json has someone's name in confirmed_by
  3. the ranking weights add up to 1

Run it from the project folder:
    python tools/check_phase0.py
"""

import csv
import json
import sys
from pathlib import Path

# The project folder is one level above this file (tools/..)
PROJECT = Path(__file__).resolve().parent.parent

# These columns must be filled in before a source counts as verified
REQUIRED_SOURCE_FIELDS = ["url", "access_date", "verified_by"]


def check_sources(csv_path):
    """Return a list of problems with the source checklist."""
    problems = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            missing = [col for col in REQUIRED_SOURCE_FIELDS if not row.get(col, "").strip()]
            if missing:
                problems.append(f"{row['id']} ({row['investigation']}): missing {', '.join(missing)}")
    return problems


def check_decisions(json_path):
    """Return a list of problems with the team decisions."""
    problems = []
    with open(json_path, encoding="utf-8") as f:
        decisions = json.load(f)

    for name, decision in decisions.items():
        if name.startswith("_"):  # skip notes like "_note"
            continue
        if not decision.get("confirmed_by", "").strip():
            problems.append(f"{name}: nobody has confirmed it yet")

    # The weights should add up to 1. We round because 0.1 + 0.2 is not exactly 0.3 in Python.
    weights = decisions.get("ranking_weights", {}).get("value", {})
    total = round(sum(weights.values()), 6)
    if total != 1:
        problems.append(f"ranking_weights add up to {total}, should be 1")

    return problems


def main():
    source_problems = check_sources(PROJECT / "sources" / "sources.csv")
    decision_problems = check_decisions(PROJECT / "config" / "decisions.json")

    print("== Sources ==")
    for p in source_problems:
        print("  -", p)
    if not source_problems:
        print("  all sources verified")

    print("== Decisions ==")
    for p in decision_problems:
        print("  -", p)
    if not decision_problems:
        print("  all decisions confirmed")

    if source_problems or decision_problems:
        print(f"\nPhase 0 NOT done: {len(source_problems)} source(s) and "
              f"{len(decision_problems)} decision(s) still open.")
        return 1

    print("\nPhase 0 done. You can start Phase 1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
