"""Help a habitat builder see what the evidence and the cited rules say about a design.

The design comes in as plain dicts (mission, layout, equipment, materials,
maintenance plan). Three outputs:

    materials_match    each material against the mission environment: evidence class
                       from ranking and gap class from gaps, never safe/unsafe (rule 6)
    checklist          each design element with the cited rules that apply to it,
                       or exactly 'no sourced guidance' when none do
    compartment_summary  connections per compartment, an ILLUSTRATIVE HEURISTIC only

Rules come only from config/design_rules.json. Each one must carry id, text,
source and page. A rule may list "applies_to" tags; a rule without them
applies to every element.
"""

import json

from . import evidence, gaps, paths, ranking

DESIGN_RULES = paths.ROOT / "config" / "design_rules.json"
RULE_FIELDS = ("id", "text", "source", "page")
NO_GUIDANCE = "no sourced guidance"
HEURISTIC = "ILLUSTRATIVE HEURISTIC"


def load_rules(path=DESIGN_RULES):
    """The rules list from design_rules.json, refusing any rule without a full citation."""
    rules = json.loads(path.read_text(encoding="utf-8"))["rules"]
    for number, rule in enumerate(rules):
        missing = [field for field in RULE_FIELDS if not rule.get(field)]
        if missing:
            raise ValueError(f"design rule #{number} ({rule.get('id', 'no id')}) is missing {', '.join(missing)}")
    return rules


def materials_match(materials, environment, corpus):
    """One row per material: closest evidence and the gap class for the mission environment."""
    table = []
    for material in materials:
        scen = evidence.scenario(dict(environment, material=material["name"]))
        ranked = ranking.rank(corpus, scen)
        best = ranked[0] if ranked else None
        table.append({
            "material": material["name"],
            "nearest_investigation": best["acronym"] if best else None,
            "match_score": best["total"] if best else None,
            "evidence_class": best["evidence_class"] if best else "no data found",
            "gap_class": gaps.analyze(corpus, scen)["combination"]["class"],
            "label": "DERIVED",
        })
    return table


def _elements(layout, equipment, materials, maintenance):
    """(subject, tags) for every part of the design a rule could apply to."""
    for room in layout["compartments"]:
        yield f"compartment {room['id']}", {"compartment", room.get("kind")}
    for part in equipment:
        yield f"equipment {part['name']}", {"equipment", part.get("type")}
    for material in materials:
        yield f"material {material['name']}", {"material", material["name"]}
    for task in maintenance:
        yield f"maintenance {task['task']}", {"maintenance", task["task"]}


def checklist(layout, equipment, materials, maintenance, rules):
    """Each design element with the cited rules whose tags it matches."""
    checklist_rows = []
    for subject, tags in _elements(layout, equipment, materials, maintenance):
        applying = [rule for rule in rules
                    if "applies_to" not in rule or tags & set(rule["applies_to"])]
        guidance = [{field: rule[field] for field in RULE_FIELDS} for rule in applying]
        checklist_rows.append({"subject": subject, "guidance": guidance or NO_GUIDANCE, "label": "ILLUSTRATIVE"})
    return checklist_rows


def compartment_summary(layout):
    """Degree, neighbours and hatch/duct counts per compartment."""
    rooms = {room["id"]: {"neighbours": set(), "hatch": 0, "duct": 0} for room in layout["compartments"]}
    for edge in layout["edges"]:
        for end in (edge["from"], edge["to"]):
            if end not in rooms:
                raise ValueError(f"edge {edge['from']}-{edge['to']} names unknown compartment {end}")
        for here, there in ((edge["from"], edge["to"]), (edge["to"], edge["from"])):
            rooms[here]["neighbours"].add(there)
            rooms[here][edge["type"]] += 1
    return {
        "label": HEURISTIC,
        "compartments": [{
            "id": room_id,
            "degree": counts["hatch"] + counts["duct"],
            "neighbours": sorted(counts["neighbours"]),
            "hatches": counts["hatch"],
            "ducts": counts["duct"],
            "closures_to_isolate": counts["hatch"] + counts["duct"],
        } for room_id, counts in rooms.items()],
        "unconnected": sorted(room_id for room_id, counts in rooms.items() if not counts["neighbours"]),
    }


def assess(mission, layout, equipment, materials, maintenance, corpus, rules=None):
    """All three outputs for one design. mission["environment"] is a raw scenario."""
    if rules is None:
        rules = load_rules()
    return {
        "mission": mission["name"],
        "materials": materials_match(materials, mission["environment"], corpus),
        "checklist": checklist(layout, equipment, materials, maintenance, rules),
        "compartments": compartment_summary(layout),
    }
