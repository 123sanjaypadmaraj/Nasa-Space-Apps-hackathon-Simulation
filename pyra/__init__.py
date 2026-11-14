"""PYRA: the data foundation (Phase 1) and the engines and web app on top of it.

The modules, in the order data flows through them:

    units.py      unit conversion (psi -> kPa, m/s -> cm/s, C -> K, ...)
    factsheet.py  checks one fact sheet (Prompt 1 JSON) before it is loaded
    schema.sql    the database tables
    db.py         opens / creates the SQLite file
    loader.py     puts checked fact sheets into the database
    quality.py    data-quality checks on the finished database
    evidence.py   reads the database into one corpus the engines share
    ranking.py    ranks investigations by how close they are to a scenario
    gaps.py       evidence gap engine (DIRECTLY_TESTED ... NO_INDEXED_DATA)
    compare.py    side-by-side comparison of investigations
    export.py     CSV, JSON and XLSX export
    report.py     markdown / HTML scenario report
    retrieval.py  in-memory search over papers and findings
    assistant.py  grounded assistant prompt and answer checks
    telemetry.py  SIMULATED habitat telemetry
    concern.py    concern engine with PLACEHOLDER alert limits
    research.py   weakness analysis and backtest for researchers
    builder.py    builder assistant (design rules vs evidence)
    mlaudit.py    checks whether there is enough data to train a model
    server.py     standard-library web server and JSON API (web/ holds the page)
    cli.py        the commands you run: build, check, validate, spotcheck, serve
"""
