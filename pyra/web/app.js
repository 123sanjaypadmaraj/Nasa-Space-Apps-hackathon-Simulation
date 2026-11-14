// PYRA front end. Plain JavaScript, no libraries: every chart is hand-drawn SVG.
// All numbers come from the API; this file only lays them out.
"use strict";

const QUANTITIES = {
  o2_percent: "O2 (%)", pressure: "pressure (kPa)", flow_speed: "flow (cm/s)",
  gravity: "gravity (g)", temperature: "temperature (K)",
};
// Okabe-Ito, readable with the common forms of colour blindness.
const PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#BBBBBB"];
const SHAPES = { bench: "circle", "spacecraft-scale": "square", unknown: "triangle" };
const META_KEYS = ["source", "compartment", "t", "scenario", "label"];
const SVG = "http://www.w3.org/2000/svg";

const state = { investigations: [], runs: [], coverage: null, telemetry: [], step: 0, timer: null,
  selected: new Set() };
const MAX_COMPARE = 3;
const $ = (sel) => document.querySelector(sel);

async function api(path, body) {
  const options = body === undefined ? {} :
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `${path} answered ${response.status}`);
  return payload;
}

function showError(err) {
  const box = $("#error");
  box.textContent = err ? err.message : "";
  box.hidden = !err;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function show(value) {
  if (value === null || value === undefined) return "not provided";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toPrecision(4);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A table for any list of flat-ish objects, so the view keeps up with the engines.
function table(rows) {
  if (!rows || !rows.length) return el("p", { class: "note" }, "No data found.");
  const keys = Object.keys(rows[0]);
  const wrap = el("div", { class: "table-wrap" });
  const tbl = el("table");
  const head = el("tr");
  keys.forEach((k) => head.appendChild(el("th", { scope: "col" }, k)));
  tbl.appendChild(head);
  rows.forEach((row) => {
    const tr = el("tr");
    keys.forEach((k) => tr.appendChild(el("td", {}, show(row[k]))));
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl);
  return wrap;
}

/* ---------- views ---------- */

// Routes are "#/<tab>/<sub>". Three tabs: explore, ops, builder.
const TABS = { explore: ["coverage", "research", "report"], ops: ["crew", "controller"], builder: [] };
// Old one-word views (from the six-tab layout) redirect to where they live now.
const LEGACY = {
  explorer: "explore", researchers: "explore/research", compare: "explore", report: "explore/report",
  astronaut: "ops/crew", mission: "ops/controller", builders: "builder",
};

function parseRoute(hash) {
  let path = (hash || "").replace(/^#\/?/, "");
  if (LEGACY[path]) path = LEGACY[path];
  let [tab, sub] = path.split("/");
  if (!TABS[tab]) tab = "explore";
  if (!TABS[tab].includes(sub)) sub = TABS[tab][0];
  return { tab, sub, canonical: sub ? `#/${tab}/${sub}` : `#/${tab}` };
}

function route() {
  const { tab, sub, canonical } = parseRoute(location.hash);
  const wanted = location.hash.replace(/^#\/?/, "");
  if (LEGACY[wanted]) history.replaceState(null, "", canonical);
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${tab}`; });
  document.querySelectorAll(".tab").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
  const view = $(`#view-${tab}`);
  view.querySelectorAll(".sub").forEach((s) => { s.hidden = s.id !== `sub-${sub}`; });
  view.querySelectorAll(".subtab").forEach((a) => a.setAttribute("aria-current", a.dataset.sub === sub ? "page" : "false"));
  if (tab === "ops") startTelemetry(); else stopTelemetry();
  if (tab === "explore" && sub === "coverage") drawMap();
  if (tab === "explore" && sub === "research") loadWeakness();
}

function toggleDrawer(id, open) {
  const drawer = document.getElementById(id);
  drawer.hidden = open === undefined ? !drawer.hidden : !open;
  const toggle = document.querySelector(`[aria-controls=${id}]`);
  if (toggle) toggle.setAttribute("aria-expanded", String(!drawer.hidden));
  if (!drawer.hidden) { const first = drawer.querySelector("input, button:not(.drawer-close)"); if (first) first.focus(); }
}

/* ---------- Explorer ---------- */

function colorOf(acronym) {
  const index = state.investigations.findIndex((inv) => inv.acronym === acronym);
  return PALETTE[(index < 0 ? PALETTE.length - 1 : index) % PALETTE.length];
}

function marker(shape, x, y, r, fill) {
  if (shape === "square") return svgEl("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, fill });
  if (shape === "triangle") return svgEl("polygon", { points: `${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`, fill });
  return svgEl("circle", { cx: x, cy: y, r, fill });
}

function extent(values) {
  const nums = values.filter((v) => typeof v === "number");
  if (!nums.length) return [0, 1];
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

function ticks([lo, hi], count = 5) {
  return Array.from({ length: count + 1 }, (_, i) => lo + ((hi - lo) * i) / count);
}

function scenarioValues() {
  return state.coverage ? state.coverage.scenario : null;
}

function drawMap() {
  const svg = $("#map");
  const width = svg.clientWidth || 700, height = svg.clientHeight || 440;
  const m = { left: 56, right: 16, top: 14, bottom: 40 };
  const xKey = $("#x-axis").value, yKey = $("#y-axis").value;
  const runs = state.coverage ? state.coverage.runs : state.runs;
  const scen = scenarioValues();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const xs = runs.map((r) => r.values[xKey]).concat(scen ? [scen[xKey]] : []);
  const ys = runs.map((r) => r.values[yKey]).concat(scen ? [scen[yKey]] : []);
  const xDom = extent(xs), yDom = extent(ys);
  const sx = (v) => m.left + ((v - xDom[0]) / (xDom[1] - xDom[0])) * (width - m.left - m.right);
  const sy = (v) => height - m.bottom - ((v - yDom[0]) / (yDom[1] - yDom[0])) * (height - m.top - m.bottom);

  ticks(xDom).forEach((v) => {
    svg.appendChild(svgEl("line", { class: "grid", x1: sx(v), x2: sx(v), y1: m.top, y2: height - m.bottom }));
    const label = svgEl("text", { x: sx(v), y: height - m.bottom + 14, "text-anchor": "middle" });
    label.textContent = show(v);
    svg.appendChild(label);
  });
  ticks(yDom).forEach((v) => {
    svg.appendChild(svgEl("line", { class: "grid", x1: m.left, x2: width - m.right, y1: sy(v), y2: sy(v) }));
    const label = svgEl("text", { x: m.left - 6, y: sy(v) + 4, "text-anchor": "end" });
    label.textContent = show(v);
    svg.appendChild(label);
  });
  const xTitle = svgEl("text", { x: width / 2, y: height - 6, "text-anchor": "middle" });
  xTitle.textContent = QUANTITIES[xKey];
  const yTitle = svgEl("text", { x: 14, y: height / 2, transform: `rotate(-90 14 ${height / 2})`, "text-anchor": "middle" });
  yTitle.textContent = QUANTITIES[yKey];
  svg.append(xTitle, yTitle);

  const placed = runs.filter((r) => typeof r.values[xKey] === "number" && typeof r.values[yKey] === "number");
  const hasScenario = scen && typeof scen[xKey] === "number" && typeof scen[yKey] === "number";
  if (hasScenario && state.coverage.gaps) {
    (state.coverage.gaps.nearest_runs || []).forEach((near) => {
      const run = placed.find((r) => r.run_id === near.run_id && r.acronym === near.acronym);
      if (run) svg.appendChild(svgEl("line", { class: "near", x1: sx(scen[xKey]), y1: sy(scen[yKey]), x2: sx(run.values[xKey]), y2: sy(run.values[yKey]) }));
    });
  }

  placed.forEach((run) => {
    const dot = marker(SHAPES[run.scale] || "triangle", sx(run.values[xKey]), sy(run.values[yKey]), 6, colorOf(run.acronym));
    dot.setAttribute("class", "run");
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("aria-label", `${run.acronym} run ${run.run_id}`);
    const open = () => hoverCard(run, dot);
    dot.addEventListener("mouseenter", open);
    dot.addEventListener("focus", open);
    dot.addEventListener("mouseleave", () => { $("#hover").hidden = true; });
    dot.addEventListener("blur", () => { $("#hover").hidden = true; });
    svg.appendChild(dot);
  });

  if (hasScenario) {
    const x = sx(scen[xKey]), y = sy(scen[yKey]);
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 11, fill: "none", stroke: "#ffb000", "stroke-width": 2 }));
    svg.appendChild(svgEl("path", { d: `M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}`, stroke: "#ffb000", "stroke-width": 2 }));
    const tag = svgEl("text", { x: x + 14, y: y - 10 });
    tag.textContent = "HYPOTHETICAL";
    tag.setAttribute("style", "fill:#ffb000");
    svg.appendChild(tag);
  }

  const hidden = runs.length - placed.length;
  const note = svgEl("text", { x: width - m.right, y: m.top + 10, "text-anchor": "end" });
  note.textContent = hidden ? `${hidden} run(s) not shown: missing ${QUANTITIES[xKey]} or ${QUANTITIES[yKey]}` : "";
  svg.appendChild(note);
  drawLegend();
}

function hoverCard(run, dot) {
  const card = $("#hover");
  const missing = Object.keys(QUANTITIES).filter((q) => run.values[q] === null || run.values[q] === undefined);
  const lines = Object.keys(QUANTITIES).filter((q) => run.original[q]).map((q) => {
    const o = run.original[q];
    const kind = run.from_words.includes(q) ? "DERIVED from words" : "MEASURED";
    return `${QUANTITIES[q]}: ${show(run.values[q])} (reported ${show(o.value)} ${o.unit || ""}, ${o.page || "page not provided"}) ${kind}`;
  });
  card.replaceChildren(
    el("strong", {}, `${run.acronym} / ${run.run_id}`),
    el("div", { class: "note" }, `${run.hardware || "hardware not provided"}, ${run.scale}`),
    el("div", {}, `Source: ${run.source.title || "not provided"}${run.page_or_table ? ", " + run.page_or_table : ""}`),
    ...lines.map((line) => el("div", { class: "mono" }, line)),
    el("div", { class: "note" }, missing.length ? `Missing (not zero): ${missing.join(", ")}` : "No missing quantities."),
  );
  const box = dot.getBoundingClientRect(), frame = $("#map").getBoundingClientRect();
  card.style.left = `${Math.min(box.left - frame.left + 12, frame.width - 290)}px`;
  card.style.top = `${box.top - frame.top + 12}px`;
  card.hidden = false;
}

function drawLegend() {
  const legend = $("#legend");
  legend.replaceChildren();
  const swatch = (shape, color, label) => {
    const item = el("span");
    const icon = svgEl("svg", { width: 14, height: 14, "aria-hidden": "true" });
    icon.appendChild(marker(shape, 7, 7, 5, color));
    item.append(icon, ` ${label}`);
    legend.appendChild(item);
  };
  state.investigations.forEach((inv) => swatch("circle", colorOf(inv.acronym), inv.acronym));
  Object.entries(SHAPES).forEach(([scale, shape]) => swatch(shape, "#9fb0cc", `scale: ${scale}`));
  legend.appendChild(el("span", {}, "Points are MEASURED values; gravity placed from words like \"microgravity\" is DERIVED."));
}

function scenarioBody() {
  const form = new FormData($("#scenario"));
  const body = Object.fromEntries([...form.entries()].filter(([, v]) => v !== ""));
  // Gravity is a slider, so it always has a value; "set" decides whether it is sent.
  if (!body.gravity_set) delete body.gravity_g;
  delete body.gravity_set;
  return body;
}

async function runCoverage() {
  try {
    state.coverage = await api("/api/coverage", scenarioBody());
    showError(null);
  } catch (err) {
    state.coverage = null;
    showError(err);
  }
  drawMap();
  drawGaps();
  drawRanked();
}

// Which scenario input sets each gap axis, so an unset axis line can open it.
const AXIS_INPUT = {
  o2_percent: "o2_percent", pressure: "pressure", flow_speed: "flow_speed",
  gravity: "gravity_g", material_class: "material", pillar: "pillar",
};
const AXIS_LABEL = {
  o2_percent: "O2", pressure: "Pressure", flow_speed: "Flow", gravity: "Gravity",
  material_class: "Material", pillar: "Pillar",
};

function openAxisInput(axis) {
  if (axis === "gravity") $("#scenario [name=gravity_set]").checked = true;
  const input = $(`#scenario [name=${AXIS_INPUT[axis]}]`);
  if (!input) return;
  input.disabled = false;
  input.focus();
  if (input.select && input.type !== "range") input.select();
}

// The gap panel only lays out the lines the engine wrote (gaps.panel_line); it never
// shows a raw null, so the words "not provided" cannot appear here.
function drawGaps() {
  const box = $("#gaps");
  box.replaceChildren();
  const gaps = state.coverage && state.coverage.gaps;
  if (!gaps) return box.appendChild(el("p", { class: "note" }, "Run a scenario to see coverage per axis."));
  Object.entries(gaps.axes || {}).forEach(([axis, g]) => {
    if (g.state === "NOT_EVALUATED") {
      const line = el("button", { type: "button", class: "gap-unset", "data-axis": axis }, g.summary);
      line.addEventListener("click", () => openAxisInput(axis));
      box.appendChild(line);
      return;
    }
    const row = el("div", { class: "gap-axis" });
    row.append(el("span", {}, AXIS_LABEL[axis] || axis), el("span", { class: `gap-class ${g.class}` }, g.class));
    row.append(el("span", {}), el("span", { class: "gap-line" }, g.summary));
    box.appendChild(row);
  });
  if (gaps.combination) box.appendChild(el("p", { class: "gap-combo" }, gaps.combination.summary));
}

function pickBox(acronym) {
  const box = el("input", { type: "checkbox", value: acronym, class: "pick", "aria-label": `Select ${acronym} to compare` });
  box.checked = state.selected.has(acronym);
  box.addEventListener("change", () => {
    if (box.checked) state.selected.add(acronym); else state.selected.delete(acronym);
    syncPicks();
  });
  return box;
}

// Keep every checkbox for the same investigation in step, and cap the selection at MAX_COMPARE.
function syncPicks() {
  const full = state.selected.size >= MAX_COMPARE;
  document.querySelectorAll("input.pick").forEach((box) => {
    box.checked = state.selected.has(box.value);
    box.disabled = full && !box.checked;
  });
  const n = state.selected.size;
  const button = $("#compare-btn");
  button.textContent = `Compare (${n})`;
  button.disabled = n < 2 || n > MAX_COMPARE;
  $("#compare-hint").textContent = n < 2 ? "Tick 2 or 3 investigations to compare."
    : `${[...state.selected].join(", ")}`;
}

function drawRanked() {
  const list = $("#ranked");
  list.replaceChildren();
  const ranked = (state.coverage && state.coverage.ranked) || [];
  ranked.forEach((inv) => {
    const li = el("li");
    const head = el("label", { class: "ranked-head" });
    head.append(pickBox(inv.acronym), el("strong", {}, ` ${inv.acronym} `), el("span", { class: "total" }, show(inv.total)),
      el("span", { class: "note" }, ` ${inv.evidence_class || ""}`));
    li.appendChild(head);
    const bars = el("div", { class: "bars" });
    Object.entries(inv.scores || {}).forEach(([name, score]) => {
      const bar = el("div", { class: "bar" });
      bar.style.width = `${Math.max(0, Math.min(1, score || 0)) * 100}%`;
      const track = el("div");
      track.appendChild(bar);
      bars.append(el("span", {}, name), track, el("span", { class: "mono" }, show(score)));
    });
    li.append(bars, el("div", { class: "note" }, inv.explanation || ""));
    if (inv.unmatched && inv.unmatched.length) li.appendChild(el("div", { class: "note" }, `Not matched: ${inv.unmatched.join(", ")}`));
    list.appendChild(li);
  });
  drawPicks(new Set(ranked.map((inv) => inv.acronym)));
}

async function openReport() {
  try {
    const built = await api("/api/report", { scenario: scenarioBody() });
    $("#report-out").innerHTML = built.html;
    location.hash = "#/explore/report";
    showError(null);
  } catch (err) { showError(err); }
}

/* ---------- Compare (side panel) ---------- */

// Investigations that are not in the ranked list can still be picked from "Other investigations".
function drawPicks(shown = new Set()) {
  const box = $("#compare-picks");
  box.replaceChildren();
  state.investigations.filter((inv) => !shown.has(inv.acronym)).forEach((inv) => {
    const label = el("label");
    label.append(pickBox(inv.acronym), ` ${inv.acronym}`);
    box.appendChild(label);
  });
  if (!box.children.length) box.appendChild(el("p", { class: "note" }, "All investigations are in the ranked list."));
  syncPicks();
}

// What each verdict reason is about. The wording comes from pyra/compare.py; we only label it.
const REASON_TOPICS = [
  [/hardware/i, "Hardware"], [/scale/i, "Scale"], [/fuel|phase/i, "Fuel phase"],
  [/sensor|measure/i, "Measurement definition"],
];

function reasonItem(reason) {
  const text = reason.replace(/^NOT DIRECTLY COMPARABLE:\s*/, "");
  const topic = (REASON_TOPICS.find(([pattern]) => pattern.test(text)) || [null, "Other"])[1];
  const li = el("li");
  li.append(el("strong", {}, `${topic}: `), text);
  return li;
}

function verdictBlock(verdict) {
  const block = el("div", { class: verdict.comparable ? "verdict ok" : "verdict no" });
  if (verdict.comparable) {
    block.appendChild(el("p", { class: "verdict-title" }, "COMPARABLE WITH CARE"));
    block.appendChild(el("p", { class: "note" }, "Hardware, scale, fuel phase and sensors match. [DERIVED]"));
    return block;
  }
  block.appendChild(el("p", { class: "verdict-title" }, "NOT DIRECTLY COMPARABLE"));
  const reasons = el("ul");
  (verdict.reasons || []).forEach((r) => reasons.appendChild(reasonItem(r)));
  block.appendChild(reasons);
  return block;
}

async function runCompare() {
  const acronyms = [...state.selected];
  const out = $("#compare-out");
  out.replaceChildren(el("p", { class: "note" }, `Comparing ${acronyms.join(", ")}...`));
  toggleDrawer("compare-panel", true);
  try {
    const found = await api("/api/compare", { acronyms });
    showError(null);
    out.replaceChildren(verdictBlock(found.verdict || {}));
    const names = found.investigations || acronyms;
    const tbl = el("table");
    const head = el("tr");
    head.appendChild(el("th", {}, "field"));
    names.forEach((a) => head.appendChild(el("th", {}, a)));
    tbl.appendChild(head);
    (found.rows || []).forEach((row) => {
      const tr = el("tr", { class: row.same ? "" : "differs" });
      tr.appendChild(el("td", {}, row.field));
      const values = Array.isArray(row.values) ? row.values : names.map((a) => row.values[a]);
      values.forEach((v) => tr.appendChild(el("td", {}, show(v))));
      tbl.appendChild(tr);
    });
    const wrap = el("div", { class: "table-wrap" });
    wrap.appendChild(tbl);
    out.appendChild(wrap);
    [["Can conclude", found.can_conclude], ["Cannot conclude", found.cannot_conclude]].forEach(([title, items]) => {
      out.appendChild(el("h3", {}, `${title} [DERIVED]`));
      const ul = el("ul");
      [].concat(items || []).forEach((t) => ul.appendChild(el("li", {}, show(t))));
      out.appendChild(ul);
    });
  } catch (err) {
    out.replaceChildren(el("p", { class: "error" }, err.message));
  }
}

/* ---------- Astronaut and Mission control (SIMULATED) ---------- */

function channels(sample) {
  return Object.keys(sample).filter((k) => !META_KEYS.includes(k) && typeof sample[k] === "number");
}

function latestByCompartment() {
  const latest = {};
  state.telemetry.slice(0, state.step + 1).forEach((s) => { latest[s.compartment] = s; });
  return latest;
}

function stopTelemetry() {
  clearInterval(state.timer);
  state.timer = null;
}

async function startTelemetry() {
  if (state.timer) return;
  const picker = $("#tele-scenario");
  const name = picker.value;
  try {
    const sim = await api(`/api/telemetry?scenario=${encodeURIComponent(name || "")}&seed=1&steps=60`);
    if (!picker.options.length) sim.scenarios.forEach((s) => picker.appendChild(el("option", {}, s)));
    picker.value = name || sim.scenarios[0];
    state.telemetry = sim.samples;
    state.step = 0;
    showError(null);
    tick();
    state.timer = setInterval(tick, 1000);
  } catch (err) { showError(err); }
}

async function tick() {
  if (!state.telemetry.length) return;
  state.step = Math.min(state.step + 1, state.telemetry.length - 1);
  const latest = latestByCompartment();
  const verdicts = {};
  await Promise.all(Object.entries(latest).map(async ([compartment, sample]) => {
    const history = state.telemetry.slice(0, state.step).filter((s) => s.compartment === compartment);
    try {
      verdicts[compartment] = await api("/api/concern", { sample, history, material_class: $("#material-class").value || "solid" });
    } catch (err) { showError(err); }
  }));
  drawAstronaut(latest, verdicts);
  drawMission(latest, verdicts);
  if (state.step >= state.telemetry.length - 1) stopTelemetry();
}

function drawAstronaut(latest, verdicts) {
  const compartment = Object.keys(latest)[0];
  if (!compartment) return;
  const sample = latest[compartment];
  const alerts = (verdicts[compartment] && verdicts[compartment].alerts) || [];
  const flagged = new Set(alerts.map((a) => a.channel));
  const tiles = $("#tiles");
  tiles.replaceChildren();
  channels(sample).forEach((name) => {
    const tile = el("div", { class: flagged.has(name) ? "tile alert" : "tile" });
    tile.append(el("span", {}, `${name} (${compartment})`), el("b", {}, show(sample[name])));
    tiles.appendChild(tile);
  });
  const banner = $("#banner");
  banner.className = alerts.length ? "banner alert" : "banner";
  banner.textContent = alerts.length
    ? `${alerts[0].message} [${alerts[0].label || "PLACEHOLDER"}]`
    : `No alert in ${compartment}. Values are SIMULATED, limits PLACEHOLDER.`;
}

function drawMission(latest, verdicts) {
  const rows = Object.entries(latest).map(([compartment, sample]) => {
    const row = { compartment, t: sample.t };
    channels(sample).forEach((c) => { row[c] = sample[c]; });
    row.alerts = ((verdicts[compartment] && verdicts[compartment].alerts) || []).length;
    return row;
  });
  $("#compartments").replaceChildren(table(rows));
  const list = $("#alerts");
  list.replaceChildren();
  Object.entries(verdicts).forEach(([compartment, verdict]) => {
    (verdict.alerts || []).forEach((alert) => {
      const details = el("details");
      details.appendChild(el("summary", {}, `${compartment}: ${alert.type} on ${alert.channel}. ${alert.message} [${alert.label || "PLACEHOLDER"}]`));
      details.appendChild(el("pre", {}, JSON.stringify({ envelope: verdict.envelope, reasoning: verdict.reasoning }, null, 2)));
      list.appendChild(details);
    });
  });
  if (!list.children.length) list.appendChild(el("p", { class: "note" }, "No alerts at this step."));
}

/* ---------- Builders and Researchers ---------- */

const listOf = (text) => (text || "").split(",").map((s) => s.trim()).filter(Boolean);

// "habitat-lab hatch; lab-node duct" -> [{from, to, type}]
function edgesOf(text) {
  return (text || "").split(";").map((s) => s.trim()).filter(Boolean).map((part) => {
    const [pair, type] = part.split(/\s+/);
    const [from, to] = pair.split("-");
    return { from, to, type: type || "hatch" };
  });
}

async function runBuilder(event) {
  event.preventDefault();
  const form = new FormData($("#builder"));
  const body = {
    mission: { name: form.get("mission"), environment: scenarioBody() },
    layout: { compartments: listOf(form.get("compartments")).map((id) => ({ id })), edges: edgesOf(form.get("edges")) },
    equipment: listOf(form.get("equipment")).map((name) => ({ name })),
    materials: listOf(form.get("materials")).map((name) => ({ name })),
    maintenance: listOf(form.get("maintenance")).map((task) => ({ task })),
  };
  const out = $("#builder-out");
  try {
    const found = await api("/api/builder/match", body);
    showError(null);
    const checklist = found.checklist.map((item) => ({
      subject: item.subject,
      guidance: Array.isArray(item.guidance) ? item.guidance.map((g) => `${g.text} (${g.source}, ${g.page})`).join(" | ") : item.guidance,
      label: item.label,
    }));
    out.replaceChildren(
      el("h3", {}, "Materials match (environment from the Scenario Lab, HYPOTHETICAL)"), table(found.materials),
      el("h3", {}, "Design checklist (ILLUSTRATIVE)"), table(checklist),
      el("h3", {}, `Compartments (${found.compartments.label})`), table(found.compartments.compartments),
    );
  } catch (err) { showError(err); }
}

async function loadWeakness() {
  try {
    const found = await api("/api/research/weakness");
    $("#weakness").replaceChildren(table(Array.isArray(found) ? found : found.rows || [found]));
    showError(null);
  } catch (err) { showError(err); }
}

async function runOpportunities() {
  try {
    const found = await api("/api/research/opportunities", { scenario: scenarioBody() });
    $("#opportunities").replaceChildren(found.length ? table(found)
      : el("p", { class: "note" }, "Every set axis is DIRECTLY_TESTED, or no axis is set, so there is nothing to rank."));
    showError(null);
  } catch (err) { showError(err); }
}

// "ACRONYM=2012" lines -> {ACRONYM: "2012"}
function yearsOf(text) {
  const years = {};
  (text || "").split(/\n|,/).map((s) => s.trim()).filter(Boolean).forEach((line) => {
    const [key, year] = line.split("=").map((s) => s.trim());
    if (key && year) years[key] = year;
  });
  return years;
}

async function runBacktest(event) {
  event.preventDefault();
  const form = new FormData($("#backtest"));
  const body = {
    cutoff_year: form.get("cutoff_year"), years: yearsOf(form.get("years")),
    checks: [{ name: "current scenario", scenario: scenarioBody(), should_flag: form.get("should_flag") === "on" }],
  };
  try {
    const found = await api("/api/research/backtest", body);
    $("#backtest-out").replaceChildren(
      el("p", {}, `Kept before ${found.cutoff_year}: ${found.investigations_kept.join(", ") || "none"}. `
        + `Dropped for having no year: ${found.undated_dropped.join(", ") || "none"}. Hits ${found.hits}, misses ${found.misses}. [DERIVED]`),
      table(found.checks));
    showError(null);
  } catch (err) { showError(err); }
}

async function runAsk(event) {
  event.preventDefault();
  const question = new FormData($("#ask")).get("question");
  try {
    const found = await api("/api/ask", { question });
    const text = found.text || "No model is connected, so PYRA shows the retrieved passages only.";
    $("#ask-out").replaceChildren(el("p", {}, `${text} [${found.label}]`), table(found.context));
    showError(null);
  } catch (err) { showError(err); }
}

/* ---------- start ---------- */

async function start() {
  ["#x-axis", "#y-axis"].forEach((sel, i) => {
    Object.entries(QUANTITIES).forEach(([key, label]) => $(sel).appendChild(el("option", { value: key }, label)));
    $(sel).value = i === 0 ? "o2_percent" : "flow_speed";
    $(sel).addEventListener("change", drawMap);
  });
  $("#scenario").addEventListener("submit", (e) => { e.preventDefault(); runCoverage(); });
  $("#scenario [name=gravity_g]").addEventListener("input", (e) => {
    $("#g-out").value = e.target.value;
    $("#scenario [name=gravity_set]").checked = true;
  });
  $("#report-btn").addEventListener("click", openReport);
  $("#report-menu").addEventListener("click", (e) => { e.target.closest("details").open = false; openReport(); });
  $("#compare-btn").addEventListener("click", runCompare);
  $("#builder").addEventListener("submit", runBuilder);
  $("#ask").addEventListener("submit", runAsk);
  $("#ask-toggle").addEventListener("click", () => toggleDrawer("ask-panel"));
  document.querySelectorAll(".drawer-close").forEach((b) => b.addEventListener("click", () => toggleDrawer(b.dataset.close, false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".drawer:not([hidden])").forEach((d) => toggleDrawer(d.id, false));
  });
  $("#opportunities-btn").addEventListener("click", runOpportunities);
  $("#backtest").addEventListener("submit", runBacktest);
  $("#tele-scenario").addEventListener("change", () => { stopTelemetry(); startTelemetry(); });
  $("#large-text").addEventListener("click", (e) => {
    const on = document.body.classList.toggle("large");
    e.target.setAttribute("aria-pressed", on);
  });
  window.addEventListener("resize", drawMap);
  window.addEventListener("hashchange", route);

  try {
    [state.investigations, state.runs] = await Promise.all([api("/api/investigations"), api("/api/runs")]);
  } catch (err) { return showError(err); }
  drawPicks();
  route();
  runCoverage();
}

start();
