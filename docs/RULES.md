# PYRA rules (read before you write anything)

Our ground rules, short version.

1. **Don't make up NASA facts.** No invented numbers, paper titles, links or quotes.
   If we don't have it, we write "not provided" or "unknown".
2. **Label every statement** as one of:
   - MEASURED: comes from a source we cite
   - DERIVED: our code calculated it
   - HYPOTHETICAL: a value the user typed into a scenario
   - INTERPRETATION: reasoning, ours or the assistant's
3. **Every scientific claim needs a citation** (investigation, paper, page or table).
   No source means we write "no data found".
4. **Keep the original value and unit.** Converted values go in a separate column.
   Missing stays missing. It is never 0.
5. **Microgravity is not the Moon or Mars.** Say "bounded by" or "not directly measured".
6. **Never call a material "safe" or "unsafe".**
7. **Don't compare numbers across investigations** without checking hardware, scale,
   fuel phase and how the thing was measured. Warn when they can't be compared.
8. **Code does the maths, never the assistant.** Scores, distances, gap classes and unit
   conversions are all plain code.
9. **We don't predict fires.** No CFD claims. PYRA shows the evidence and where it stops.
10. **Keep it simple.** Use the smallest thing that works end to end.

Also: live values are SIMULATED, alert limits are PLACEHOLDER until sourced, and
checklists/heuristics are ILLUSTRATIVE. Out of scope: rocket engines and propellants.
