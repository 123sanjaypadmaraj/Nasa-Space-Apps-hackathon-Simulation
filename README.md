# PYRA: Predictive Hazard & Reliability Atlas

NASA Space Apps 2026, spacecraft fire safety challenge.

PYRA shows what NASA's microgravity combustion data actually tells you about fire in a
habitat, how close the nearest evidence is, and where there is no evidence at all.
It does not predict fires and it does not label materials safe or unsafe.

## Phase 0: setup and source verification

The goal of Phase 0 is to agree on the rules and check our sources before anyone writes app code.
Nothing goes into the database until a person has checked it.

| File | What it is | What you do with it |
| --- | --- | --- |
| `docs/RULES.md` | The 10 rules in plain words | Read it once, keep it open |
| `docs/TEAM.md` | Roles and the scope freeze | Put your name next to your role |
| `sources/sources.csv` | Every source we need to check (23 rows) | Take some rows, open each source, fill in the empty columns |
| `config/decisions.json` | Tech and number choices (database, weights, tolerances...) | Discuss as a team, change values if needed, add your name to `confirmed_by` |
| `tools/check_phase0.py` | Tells you what's still missing (the checks are in `tools/phase0/`) | Run it until it says "Phase 0 done" |

## How to check a source (sources.csv)

For each row you take:

1. Put your name in `assigned_to`.
2. Open the source (search the NTRS number on the NASA Technical Reports Server, or find the PSI page).
3. Fill in `url` (the link you actually opened), `access_date` (YYYY-MM-DD),
   `contents` (one line), and `fields_taken` (what we'll use, e.g. "O2 range; pressure; fuel").
4. If the link is dead or the content doesn't match the master doc, write that in `contents`.
   Don't quietly fix it.
5. Put your name in `verified_by` only once you've read it yourself.

Tip: avoid commas inside a cell, or the CSV gets messy. Use `;` instead.

## Run the checker

You only need Python 3. Nothing to install.

```
python tools/check_phase0.py
python -m unittest discover tests
```

The checker lists every source that's missing a url, date or verifier, and every decision nobody has confirmed yet.
It also checks that the ranking weights add up to 1.

## Phase 1: data foundation (`pyra/`)

Turn the verified sources into one SQLite database. Still plain Python 3, nothing to install.

### How a paper gets into the database

1. Run **Prompt 1** on the paper's text. Save the JSON in `data/factsheets/drafts/`
   (start from `data/factsheets/TEMPLATE.json`). Add a line to `prompts/LOG.md`.
2. Run **Prompt 12** on it. Fix whatever it flags.
3. A second person checks every number against the paper, then fills in `_review`
   (`checked_by`, `prompt12_passed: true`).
4. `python -m pyra validate data/factsheets/drafts/<file>.json` must say `ready`.
5. Move the file to `data/factsheets/verified/` and rebuild.

Several papers about the same investigation means several sheets with the same `acronym`.
They share one investigation in the database. Add `test_runs` only for the one or two
investigations the demo needs.

### Commands

```
python -m pyra build                  # rebuild data/pyra.db from data/factsheets/verified
python -m pyra check                  # data-quality checks (impossible values, duplicates, missing sources)
python -m pyra spotcheck              # 10 random numbers to check by hand against the paper
python -m pyra validate FILE...       # check sheets without loading them
python -m pyra build --dummy          # same as build, but uses the DUMMY samples (also: check/spotcheck --dummy)
```

The database is rebuilt from the sheets every time, so never edit it by hand (it's git-ignored).

### The code, one job per file

| File | Job |
| --- | --- |
| `pyra/units.py` | Unit conversion: psi/kPa/Pa/atm, cm/s/m/s/mm/s, C/K, mm/cm/m, ms/s |
| `pyra/factsheet.py` | Checks one sheet: errors reject it, warnings get it loaded but flagged |
| `pyra/schema.sql` | The tables, with comments |
| `pyra/db.py` | Opens or creates the SQLite file |
| `pyra/loader.py` | Puts checked sheets into the tables, one transaction per sheet |
| `pyra/quality.py` | Data-quality checks. Each check is one SQL query, so adding one is one entry |
| `pyra/cli.py` | The commands above |
| `data/samples/` | 3 sheets marked `DUMMY - NOT REAL DATA`, for trying things out and for tests |

What the loader guarantees:
- No source (url or NTRS id) and no second checker means the sheet is rejected.
- Every number keeps `original_value` and `original_unit`. The converted value goes in
  `normalized_value`/`normalized_unit` with `conversion_method`.
- Missing values are `NULL` with `is_missing = 1`, never 0. Text like "microgravity" is kept
  as text and is never turned into a number.

The tables are a slimmed-down version of the plan's list. A material is a column in `fuels`,
`experiment` is a column in `test_runs`, and every fact points at its publication and page,
so there's no separate citations table. `research_gaps` comes in Phase 2, which computes it.

### Phase 1 is done when

- `data/factsheets/verified/` has 15 to 20 investigations with O₂, pressure, flow, gravity, fuel,
  hardware, sensors and source filled in where the papers give them
- `python -m pyra build` rejects nothing, and `python -m pyra check` reports 0 problems
- someone has run `spotcheck` and confirmed the rows against the papers
- `python -m unittest discover tests` passes

## 3D simulation demo

`demo/pyra-3d.html` is a standalone three-act demo (Habitat, 2D Evidence Atlas, Data Pipeline).
On Windows, start it with:

```
.\run-simulation.ps1                  # serves demo/ on http://127.0.0.1:8080 and opens the browser
.\run-simulation.ps1 -Port 9000 -Test # different port; run the flame model tests first
```

It uses Python's `http.server` if Python is installed, otherwise a built-in PowerShell server.
If scripts are blocked, run `powershell -ExecutionPolicy Bypass -File .\run-simulation.ps1`.

## Phase 2: engines and web app

Still plain Python 3, nothing to install.

```
python -m pyra build --dummy          # build the DUMMY database first
python -m pyra serve --dummy          # then open http://127.0.0.1:8000
python tools/eval_retrieval.py        # recall of the search over the DUMMY eval set
```

Without `--dummy`, `serve` reads `data/pyra.db` and stops with a message if it hasn't been built.

Three tabs: **Explore** (scenario, Coverage Map, coverage by axis, ranked investigations;
a Research gaps sub-view; Compare opens as a side panel from the ranked list), **Ops**
(Crew / Controller over one SIMULATED stream) and **Builder** (early-design evidence check).
Export is a menu button and "Ask the evidence" is a side panel. Old view names such as
`#astronaut` redirect to their new place. Live values are SIMULATED and alert limits and
co-occurrence thresholds PLACEHOLDER (`config/alerts.json`).

| File | Job |
| --- | --- |
| `pyra/evidence.py` | Reads the database into one corpus the engines share |
| `pyra/ranking.py` | Ranks investigations by how close they are to a scenario |
| `pyra/gaps.py` | Evidence gap classes, from DIRECTLY_TESTED to NO_INDEXED_DATA |
| `pyra/compare.py` | Side-by-side comparison |
| `pyra/export.py` | CSV, JSON and XLSX export |
| `pyra/report.py` | Scenario report (markdown and HTML, print the HTML to PDF) |
| `pyra/retrieval.py` | In-memory search over papers and findings |
| `pyra/assistant.py` | Grounded assistant prompt and answer checks |
| `pyra/telemetry.py` | SIMULATED habitat telemetry |
| `pyra/concern.py` | Concern engine against the PLACEHOLDER limits |
| `pyra/ops.py` | Ops tab: crew tiles and banner priority, controller combined view (evidence envelope + ILLUSTRATIVE co-occurrence rules), no aggregate score |
| `pyra/research.py` | Weakness analysis and backtest |
| `pyra/builder.py` | Builder early-design evidence check: environment presets (`config/environment_presets.json`, sources not yet verified), validation, materials × axis table, cited design notes (`config/design_rules.json`) |
| `pyra/mlaudit.py` | Says whether there is enough data to train a model |
| `pyra/server.py`, `pyra/web/` | Standard-library web server, JSON API and the page |

## Agents tab: the evidence agent team (`pyra/agents/`)

A supervised team of eight agents, ported from the EMBER prototype (`ember/`, LangGraph + FastAPI) to the
standard library and bound to the rules in `docs/RULES.md`. It uses the same corpus, ranking, gap, builder and
research engines as the other tabs. Nothing to install; no model needed.

```
supervisor -> librarian -> mission_profiler -> physicist -> evidence_ranker <-> skeptic (max 3 passes)
           -> incident_analyst -> gap_hunter -> safety_officer (a person approves) -> reporter
```

| Agent | What it does |
| --- | --- |
| Librarian | Summarises the corpus and flags DUMMY data |
| Mission Profiler | Preset (`config/environment_presets.json`) + typed values -> one HYPOTHETICAL scenario, with the source of every value |
| Physicist | Buoyant vs ventilation flow, order-of-magnitude scaling with ILLUSTRATIVE constants (never a fire prediction) |
| Evidence Ranker | Ranks investigations and drafts one labelled, cited claim per material |
| Skeptic | Blocks MEASURED claims whose whole combination was not tested, missing citations, unstated partial gravity and banned wording; sends the draft back |
| Incident Analyst | Apollo 1, Apollo 13, Mir as fire chains (`config/incidents.json`, not yet verified), matched to the scenario as INTERPRETATION |
| Gap Hunter | Per-axis gap classes, data opportunities, and the PROPOSAL experiment that closes the biggest gap |
| Safety Officer | Evidence actions (what to test, what to verify, what not to present as measured); pauses for human approval |

Run it from the **Agents** tab (`python -m pyra serve --dummy`, then `#/agents`). API: `GET /api/agents`,
`POST /api/agents/run {goal, mode: full|evidence|gaps|lessons|custom, agents?, scenario: {preset, o2_percent,
pressure, pressure_unit, flow_speed, gravity_g, materials, pillar, pilot_mode: approve|shadow}}`,
`GET /api/agents/stream/<id>` (Server-Sent Events), `POST /api/agents/resume/<id> {decision, ids}`,
`POST /api/agents/stop/<id>`, `GET /api/agents/state/<id>`, `POST /api/agents/ask {agent, question, run_id}`.

**Model (optional).** Offline and scripted by default. Put `GROQ_API_KEY=...` in a `.env` at the project root (see
`.env.example`; any OpenAI-compatible endpoint works through `PYRA_LLM_BASE_URL` / `PYRA_LLM_MODEL`) and the model
words the summaries and may add agents to the route. Every sentence it writes goes through `llm.rule_problems()`:
a number not in the tool data, "safe"/"unsafe", "applies to the Moon/Mars" or a fire prediction means the scripted
sentence is used instead. Numbers always come from code. `PYRA_AGENTS_OFFLINE=1` forces offline.
