import { RULE_VERSION, below, calculateBufferComponent, calculateSingle, calculateSIS, volumeUL } from "./calculations.mjs";
import {
  uid,
  blankBuffer,
  blankSIS,
  blankCocktail,
  componentFromRow,
  demoSIS,
  evaluate,
  makeRecord,
  readRecords,
  saveRecord,
  removeRecord,
  decodeRecord,
  copyRecord,
} from "./models.mjs";
import { readInventoryFile, tableFromRows, suggestMapping, matchingRows } from "./inventory.mjs";

const app = document.querySelector("#app");
const editors = { buffer: { inputs: blankBuffer(), status: "Draft", dirty: false }, sis: { inputs: blankSIS(), status: "Draft", dirty: false } };
let route = location.hash.slice(1) || "home",
  records = [],
  inventory = null,
  workbook = [],
  sheetIndex = 0,
  headerRow = 1,
  query = "",
  inventoryLoading = false,
  storageError = "",
  notice = "";
try {
  records = readRecords();
  inventory = JSON.parse(localStorage.getItem("lab.inventory.v1") || "null");
} catch (e) {
  storageError = `Browser storage could not be read: ${e.message}`;
}
const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v === 0
      ? "0"
      : Math.abs(v) < 0.0001 || Math.abs(v) >= 1e8
        ? v.toExponential(5)
        : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 9 }).format(v);
const units = {
  mass: ["mg", "g", "µg"],
  volume: ["µL", "mL", "L"],
  concentration: ["mmol/L", "mol/L", "µmol/L", "g/L", "mg/mL"],
  molar: ["mmol/L", "mol/L", "µmol/L"],
};
const editor = () => editors[route];
function get(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}
function set(obj, path, value) {
  const keys = path.split(".");
  if (keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k))) throw new Error("Invalid field.");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}
function input(path, label, placeholder = "", type = "text") {
  const value = get(editor().inputs, path);
  return `<label class="field">${escape(label)}<input data-path="${path}" id="f-${path}" type="${type}" ${type === "text" && /(mass|mw|target|volume|density|concentration|available|minimum|threshold|amount|actual|prepVolume|sampleVolume)/i.test(path) ? 'inputmode="decimal"' : ""} value="${escape(value)}" placeholder="${escape(placeholder)}" autocomplete="off"></label>`;
}
function select(path, label, options) {
  const value = get(editor().inputs, path);
  return `<label class="field">${escape(label)}<select data-path="${path}" id="f-${path}">${options
    .map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${escape(v)}" ${value === v ? "selected" : ""}>${escape(l)}</option>`;
    })
    .join("")}</select></label>`;
}
function quantity(path, label, unitPath, options, placeholder = "") {
  return `<label class="field">${escape(label)}<span class="unit-field"><input id="f-${path}" data-path="${path}" inputmode="decimal" value="${escape(get(editor().inputs, path))}" placeholder="${escape(placeholder)}" autocomplete="off"><select id="f-${unitPath}" data-path="${unitPath}" aria-label="${escape(label)} unit">${options.map((u) => `<option ${get(editor().inputs, unitPath) === u ? "selected" : ""}>${escape(u)}</option>`).join("")}</select></span></label>`;
}
const checkbox = (path, label, disabled = false) =>
  `<label class="check"><input type="checkbox" data-path="${path}" id="f-${path}" ${get(editor().inputs, path) ? "checked" : ""} ${disabled ? "disabled" : ""}>${escape(label)}</label>`;
const button = (action, label, cls = "", extra = "") => `<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
const formula = (items) =>
  items?.length
    ? `<details><summary>View formulas &amp; substituted values</summary><div class="formulas">${items.map((i) => `<p>${escape(i)}</p>`).join("")}</div></details>`
    : "";
const messages = (items, type = "error") =>
  items?.length
    ? `<div class="notice ${type}" role="${type === "error" ? "status" : "note"}"><strong>${type === "error" ? "Needs attention" : "Preparation note"}</strong><ul>${[...new Set(items)].map((i) => `<li>${escape(i)}</li>`).join("")}</ul></div>`
    : "";
const badge = (text, cls = "") => `<span class="badge ${cls}">${escape(text)}</span>`;
function results() {
  const e = editor();
  return e.snapshot && !e.dirty ? e.snapshot.results : evaluate(route, e.inputs);
}
function invalidate() {
  const e = editor();
  e.status = "Draft";
  e.dirty = true;
  e.snapshot = null;
  if (route === "sis") e.inputs.confirmed = false;
  else e.inputs.components.forEach((c) => (c.reviewed = false));
}
function normalizePreparationMethods() {
  if (route !== "buffer") return;
  const b = editor().inputs;
  for (const c of b.components) {
    const r = calculateBufferComponent(c, b.volume, b.volumeUnit);
    if (r.method) c.method = r.method;
  }
}
function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 6000);
}
function header() {
  return `<header class="header"><a href="#home" class="brand"><span class="logo"><svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2h8M10 2v8L4 21a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V2M7 17h10"/><circle cx="11" cy="20" r=".8"/></svg></span><span>Lab Preparation Workbench<small>PRECISION IN EVERY PREPARATION</small></span></a><nav class="nav" aria-label="Main navigation">${[
    ["home", "Overview"],
    ["buffer", "Buffer Making"],
    ["sis", "S/IS Making"],
    ["records", "Records"],
  ]
    .map(([r, l]) => `<a href="#${r}" class="${route === r ? "active" : ""}" ${route === r ? 'aria-current="page"' : ""}>${l}</a>`)
    .join("")}</nav><span class="local"><span class="dot"></span>Browser local workspace</span></header>`;
}
function home() {
  return `<div class="home-hero"><div class="eyebrow">YOUR LAB, ORGANIZED</div><h1>Prepare with confidence.<br>Keep every calculation clear.</h1><p>A practical workspace for buffer recipes, single standards, and S/IS cocktails. From your first input to a reviewed preparation record.</p></div><div class="module-grid"><a class="module" href="#buffer"><div class="module-icon">Bf</div><h2>Buffer Making</h2><p>Build a complete buffer recipe from your chemical inventory. Calculate quantities and record actual preparation.</p><span class="module-link">Start a buffer preparation &nbsp; →</span></a><a class="module" href="#sis"><div class="module-icon">S/IS</div><h2>S/IS Making</h2><p>Prepare single standards, coordinate cocktail volumes, and review every stock transfer.</p><span class="module-link">Open the S/IS workbench &nbsp; →</span></a><div class="module"><div class="module-icon">···</div><h2>Other Preparation</h2><p>More preparation workflows will be available here.</p><span>${badge("Coming soon")}</span></div></div><div class="notice">Saved records and imported inventory stay in this browser on this device. No company system or backend is connected. Export JSON records for backup; browser data can be cleared.</div><div class="stats"><div><h3>01 &nbsp; Define your preparation</h3><p>Use explicit units, inventory snapshots, and stock details.</p></div><div><h3>02 &nbsp; Check the calculation</h3><p>Inspect formulas, volume plans, and validation before review.</p></div><div><h3>03 &nbsp; Keep a useful record</h3><p>Save locally, reopen, export JSON, or print an operation sheet.</p></div></div>`;
}
function title() {
  const e = editor();
  return `<div class="title-row"><div><div class="eyebrow">PREPARATION WORKSPACE</div><h1>${route === "buffer" ? "Buffer Making" : "S/IS Making"}</h1><p class="subtitle">${route === "buffer" ? "One recipe. One final volume. Every component accounted for." : "Single standards and coordinated cocktails, with a traceable calculation for every transfer."}</p></div><div class="actions">${badge(e.status, e.status === "Reviewed" ? "teal" : "amber")}${e.dirty ? badge("Unsaved changes") : ""}${button("new", "New preparation")}${button("save", "Save Preparation Record", "primary")}</div></div>${e.inputs.demo ? '<div class="notice warning"><strong>Demo data</strong> — Example values for testing only. This preparation remains marked as demo in saved records, JSON, and printouts.</div>' : ""}${e.snapshot ? `<div class="notice saved-banner"><strong>Saved record reopened.</strong> Saved results and rule version ${escape(e.snapshot.ruleVersion)} are preserved. Editing an input recalculates results and requires a new review.${e.snapshot.imported ? " Imported records require local review." : ""}<details><summary>View saved snapshot</summary><pre>${escape(JSON.stringify(e.snapshot, null, 2))}</pre></details></div>` : ""}`;
}
function inventoryPanel() {
  if (inventoryLoading)
    return '<section class="panel"><div class="panel-heading"><h2>Chemical inventory</h2></div><div class="panel-body" role="status">Reading inventory… Please wait before selecting a worksheet or component.</div></section>';
  const mapping = inventory?.mapping || {};
  const options = [["", "Not mapped"], ...(inventory?.headers || []).map((h) => [h, h])];
  const matches = inventory ? matchingRows(inventory.rows, mapping, query) : [];
  const map = (key, label) =>
    `<label class="field">${label}<select data-map="${key}" id="map-${key}">${options.map(([v, l]) => `<option value="${escape(v)}" ${mapping[key] === v ? "selected" : ""}>${escape(l)}</option>`).join("")}</select></label>`;
  return `<section class="panel"><div class="panel-heading"><h2><span class="number">01</span>Chemical inventory</h2>${inventory ? badge(`${inventory.rows.length} entries`) : badge("CSV / XLSX")}</div><div class="panel-body"><div class="grid three"><label class="field">Import chemical inventory<input class="file-input" type="file" id="inventory-file" accept=".csv,.tsv,.xlsx"></label>${workbook.length ? `<label class="field">Worksheet<select id="sheet-index">${workbook.map((s, i) => `<option value="${i}" ${sheetIndex === i ? "selected" : ""}>${escape(s.name)}</option>`).join("")}</select></label><label class="field">Header row (1-based)<input id="header-row" type="number" min="1" value="${headerRow}"></label>` : '<div><p class="help">Select a file, choose the worksheet and header row, then map its columns. Original fields are retained; formulas are never executed.</p></div><div>' + button("demo-inventory", "Load demo inventory") + "</div>"}</div>${
    inventory
      ? `<p class="help">Source: ${escape(inventory.source)}. All ${inventory.headers.length} original columns retained. Stored only in this browser.</p><div class="grid">${map("name", "Chemical name column")}${map("cas", "CAS column")}${map("barcode", "Barcode column")}${map("mw", "MW column (g/mol)")}${map("density", "Density column (g/mL)")}</div><div class="divider"></div><label class="field">Find a chemical by name, CAS, or barcode<input id="inventory-query" value="${escape(query)}" placeholder="Search mapped inventory fields…" autocomplete="off"></label>${
          query
            ? `<p class="help">${matches.length} matching entries${matches.length > 30 ? " · Showing the first 30; refine your search." : ""}</p>${
                matches.length
                  ? `<div class="table-wrap"><table class="inventory-table"><thead><tr><th>Selection</th>${inventory.headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${matches
                      .slice(0, 30)
                      .map(
                        (row) =>
                          `<tr><td>${button("add-component", "Add component", "small", `data-index="${inventory.rows.indexOf(row)}" ${!mapping.name ? "disabled" : ""}`)}</td>${inventory.headers.map((h) => `<td>${escape(row[h])}</td>`).join("")}</tr>`
                      )
                      .join("")}</tbody></table></div>`
                  : '<div class="empty">No matching inventory entries. Check column mapping or refine your search.</div>'
              }`
            : ""
        }`
      : ""
  }</div></section>`;
}
function bufferComponent(c, i, result) {
  const p = `components.${i}`,
    r = result || calculateBufferComponent(c, editor().inputs.volume, editor().inputs.volumeUnit);
  const method = r.method || c.method,
    force = r.forcedStock;
  return `<section class="panel"><div class="panel-heading"><h2>${escape(c.name)} ${badge(`Component ${i + 1}`)}</h2>${button("remove-component", "Remove component", "small danger", `data-index="${i}"`)}</div><div class="snapshot" aria-label="Selected inventory row">${Object.entries(
    c.inventory
  )
    .map(([k, v]) => `<span><b>${escape(k)}</b>${escape(v) || "—"}</span>`)
    .join(
      ""
    )}<span><b>Inventory source</b>${escape(c.inventorySource)}</span></div><div class="panel-body"><div class="grid">${input(`${p}.mw`, "Molecular Weight (g/mol)")}${select(
    `${p}.form`,
    "Physical Form",
    [
      ["", "Select physical form"],
      ["solid", "Solid"],
      ["pure-liquid", "Pure liquid"],
      ["solution", "Solution of known concentration"],
    ]
  )}${c.form === "pure-liquid" ? input(`${p}.density`, "Density (g/mL)") : ""}${quantity(`${p}.target`, "Target Concentration", `${p}.targetUnit`, units.concentration)}</div><p class="help">Verify the exact salt and hydrate form from the selected inventory entry. Molecular weight, physical form, and density are never guessed from a name.</p><div class="result-strip"><div><small>Calculated Required Mass</small><strong>${fmt(r.requiredMg)} <small style="display:inline">mg</small></strong></div>${r.requiredLiquidUL != null ? `<div><small>Pure-liquid volume at target</small><strong>${fmt(r.requiredLiquidUL)} µL</strong></div>` : ""}<div><small>Actual final concentration</small><strong>${fmt(r.actualMM)} mM</strong></div></div>${force ? '<div class="notice warning"><strong>Stock required.</strong> Required mass is below 100 mg. Direct weighing is disabled; use a new stock or a confirmed existing stock.</div>' : ""}<div class="grid three">${select(
    `${p}.method`,
    "Preparation Method",
    c.form === "solution"
      ? [["existing", "Use confirmed existing solution"]]
      : force
        ? [
            ["new", "Prepare new stock"],
            ["existing", "Use confirmed existing stock"],
          ]
        : [
            ["direct", "Direct preparation"],
            ["new", "Prepare new stock"],
            ["existing", "Use confirmed existing stock"],
          ]
  )}</div><h3 class="subhead">Actual Preparation Inputs</h3><div class="grid">${method === "direct" ? (c.form === "pure-liquid" ? quantity(`${p}.actualLiquid`, "Actual pure liquid volume", `${p}.liquidUnit`, units.volume) : quantity(`${p}.actualMass`, "Actual weighed mass", `${p}.massUnit`, units.mass)) : method === "new" ? quantity(`${p}.actualMass`, "Actual weighed mass for stock", `${p}.massUnit`, units.mass) + quantity(`${p}.stockVolume`, "Stock final solution volume", `${p}.stockVolumeUnit`, units.volume) : quantity(`${p}.knownConcentration`, "Known stock concentration", `${p}.knownUnit`, units.concentration) + quantity(`${p}.available`, "Available stock volume", `${p}.availableUnit`, units.volume)}${method !== "direct" ? quantity(`${p}.actualTransfer`, "Actual stock volume transferred", `${p}.transferUnit`, units.volume) : ""}</div>${method === "existing" ? `<p>${checkbox(`${p}.confirmed`, "I confirm the existing stock concentration and units.")}</p>` : ""}${method !== "direct" ? `<div class="result-strip"><div><small>Stock concentration</small><strong>${fmt(r.stockMM)} mM</strong></div><div><small>Calculated stock transfer volume</small><strong>${fmt(r.transferML)} mL</strong></div></div>` : ""}${messages(r.errors)}${formula(r.formulas)}</div><div class="review-bar"><div>${checkbox(`${p}.reviewed`, "Calculation Review: inputs, units, and formula checked", !!r.errors.length)}</div>${badge(c.reviewed ? "Checked" : "Needs recheck", c.reviewed ? "teal" : "amber")}</div></section>`;
}
function buffer() {
  const b = editor().inputs,
    r = results();
  return (
    title() +
    `<section class="panel"><div class="panel-heading"><h2>Preparation details</h2>${badge("Final volume basis", "teal")}</div><div class="panel-body"><div class="grid three">${input("name", "Preparation Name", "e.g. Enzyme assay buffer")}${quantity("volume", "Final Buffer Volume", "volumeUnit", units.volume)}</div><div class="notice">Final buffer volume includes all stocks and other liquid additions. After adding every component, bring the buffer to ${escape(b.volume || "the specified")} ${escape(b.volumeUnit)}. Stock volumes are never added on top of this final volume.</div></div></section>` +
    inventoryPanel() +
    (b.components.length
      ? b.components.map((c, i) => bufferComponent(c, i, r.rows?.[i])).join("")
      : '<div class="empty">No components yet. Import an inventory, search for an entry, and select Add component.</div>') +
    review(r)
  );
}
function stockCard(c, i, role) {
  const s = c.stocks[role],
    p = `cocktails.${i}.stocks.${role}`,
    r = calculateSingle(s);
  return `<div class="stock-card"><h3>${role === "S" ? "S · Substrate standard" : "IS · Internal standard"}${badge("Independent stock")}</h3><div class="grid two">${input(`${p}.name`, "Compound", "Exact compound name")}${input(`${p}.mw`, "Molecular Weight (g/mol)", "Optional for qNMR")}${input(`${p}.lot`, "Lot")}${input(`${p}.date`, "Preparation date", "", "date")}${input(`${p}.solvent`, "Solvent")}${select(
    `${p}.source`,
    "Stock data source",
    [
      ["weight", "Weight / MW"],
      ["qnmr-amount", "qNMR — amount (µmol / nmol)"],
      ["qnmr-concentration", "qNMR — concentration + sample volume"],
    ]
  )}${s.source === "weight" ? quantity(`${p}.mass`, "Actual compound mass", `${p}.massUnit`, units.mass) : s.source === "qnmr-amount" ? quantity(`${p}.amount`, "qNMR amount (not concentration)", `${p}.amountUnit`, ["µmol", "nmol"]) : quantity(`${p}.qConcentration`, "qNMR concentration", `${p}.qUnit`, units.molar) + quantity(`${p}.sampleVolume`, "qNMR corresponding sample volume", `${p}.sampleUnit`, units.volume)}${select(
    `${p}.volumeMode`,
    "Preparation calculation",
    [
      ["manual", "Enter volume → calculate concentration"],
      ["target", "Enter target concentration → calculate volume"],
    ]
  )}${s.volumeMode === "manual" ? quantity(`${p}.prepVolume`, s.volumeBasis === "solvent" ? "Solvent Added (approximation)" : "Final Solution Volume", `${p}.prepUnit`, units.volume) : quantity(`${p}.desiredConcentration`, "Target single-standard concentration", `${p}.desiredUnit`, units.molar)}${select(
    `${p}.volumeBasis`,
    "Volume basis",
    [
      ["final", "Final Solution Volume"],
      ["solvent", "Solvent Added (volume approximation)"],
    ]
  )}${quantity(`${p}.available`, "Available stock volume (optional)", `${p}.availableUnit`, units.volume, "Defaults to prepared volume")}${quantity(`${p}.target`, "Target Concentration in Cocktail", `${p}.targetUnit`, units.molar)}</div><p class="help">Use the volume on the vial when available. Preparation volume must be &lt;3000 µL. Target refers to the final cocktail, before any further assay dilution. No purity correction is applied.</p><div class="result-strip"><div><small>Stock Concentration (mM)</small><strong>${fmt(r.stockMM)}</strong></div><div><small>Preparation volume (µL)</small><strong>${fmt(r.prepUL)}</strong></div></div>${messages(r.errors)}${messages(r.warnings, "warning")}${formula(r.formulas)}</div>`;
}
function cocktailTable(c, r) {
  return `<div class="table-wrap"><table class="results-table"><thead><tr><th>Compound</th><th>Stock Concentration<br>(mM)</th><th>Target Concentration in Cocktail<br>(µM)</th><th>Compound Mass per Assay<br>(µg)</th><th>Stock Volume per Assay<br>(µL)</th><th>Stock Volume to Transfer<br>(µL)</th></tr></thead><tbody>${[
    "S",
    "IS",
  ]
    .map((role) => {
      const row = r.rows?.find((row) => row.role === role);
      return `<tr><td><strong>${escape(c.stocks[role].name) || role}</strong><br>${badge(role)}</td><td>${fmt(row?.stock?.stockMM)}</td><td>${fmt(row?.targetUM)}</td><td>${row?.massUG == null ? (c.stocks[role].mw ? "—" : "Missing MW") : fmt(row.massUG)}</td><td>${fmt(row?.perAssayUL)}</td><td><strong>${fmt(row?.transferUL)}</strong></td></tr>`;
    })
    .join(
      ""
    )}</tbody></table></div><div class="solvent"><div><strong style="font-size:13px">Solvent Volume to Add (µL)</strong><br><span class="help">Bring to the final cocktail volume after adding all stocks.</span></div><strong>${fmt(r.solventUL)}</strong></div>`;
}
function volumePlan(r) {
  const s = editor().inputs,
    matching = s.match;
  return `<section class="panel"><div class="panel-heading"><h2><span class="number">02</span>Batch volume coordination</h2>${s.confirmed ? badge("Plan confirmed", "teal") : badge("Confirmation required", "amber")}</div><div class="panel-body"><div class="grid three">${input("minimum", "Minimum IS Aliquot (µL)", "20")}${input("threshold", "IS Scale-Up Threshold (µL)", "100")}<div><p class="help">The scale-up threshold controls whether a batch follows the common volume. It is not a hard limit on IS usage.</p></div></div><div class="actions" style="margin:18px 0">${button("match", "Match Batch Volumes", matching ? "primary" : "")}${matching ? button("reset-match", "Use automatic plan") : ""}</div><p class="help">A preview is recalculated from original volumes. Different original volumes are retained unless Match Batch Volumes is selected. Every S, IS, and solvent calculation uses the selected final volume for its cocktail.</p>${messages(r.warnings, "warning")}<div class="table-wrap"><table class="plan-table"><thead><tr><th>Cocktail</th><th>Original Volume<br>(µL)</th><th>Proposed Volume<br>(µL)</th><th>Selected Final Volume<br>(µL)</th><th>Original IS Aliquot<br>(µL)</th><th>Final IS Aliquot<br>(µL)</th><th>Adjustment reason</th></tr></thead><tbody>${s.cocktails
    .map((c) => {
      const p = r.plan?.find((p) => p.id === c.id);
      return `<tr class="${p && p.selectedVolume !== p.originalVolume ? "adjusted" : ""}"><td><strong>${escape(c.name) || "Unnamed cocktail"}</strong></td><td>${fmt(p?.originalVolume)}</td><td>${fmt(p?.proposedVolume)}</td><td class="final">${fmt(p?.selectedVolume)}</td><td>${fmt(p?.originalIS)}</td><td>${fmt(p?.finalIS)}</td><td>${escape(p?.reason || "Complete valid IS concentration and original volume inputs to calculate a plan.")}</td></tr>`;
    })
    .join(
      ""
    )}</tbody></table></div><div class="plan-confirm"><span class="help">Changing any preparation input invalidates this confirmation and the record review.</span>${button("confirm-plan", s.confirmed ? "Volume plan confirmed" : "Confirm volume plan", s.confirmed ? "" : "primary", r.plan?.length !== s.cocktails.length ? "disabled" : "")}</div></div></section>`;
}
function sis() {
  const s = editor().inputs,
    r = results();
  return (
    title() +
    `<section class="panel"><div class="panel-heading"><h2>Preparation details</h2>${button("demo-sis", "Load A / B / C demo")}</div><div class="panel-body"><div class="grid two">${input("name", "Preparation Name", "e.g. Multiplex S/IS preparation")}<div class="notice" style="margin:0">No inventory confirmation is required for S/IS. Each cocktail has separate S and IS stocks, targets, and final volume.</div></div></div></section>` +
    s.cocktails
      .map(
        (c, i) =>
          `<section class="panel"><div class="panel-heading"><h2><span class="number">${String(i + 1).padStart(2, "0")}</span>${escape(c.name) || `Cocktail ${i + 1}`}</h2>${button("remove-cocktail", "Remove cocktail", "small danger", `data-index="${i}"`)}</div><div class="panel-body"><div class="grid three">${input(`cocktails.${i}.name`, "Cocktail Name")}${quantity(`cocktails.${i}.volume`, "Original Planned Cocktail Volume", `cocktails.${i}.volumeUnit`, units.volume)}${quantity(`cocktails.${i}.assayVolume`, "Cocktail Volume per Assay", `cocktails.${i}.assayUnit`, units.volume)}</div><div class="divider"></div><div class="stock-grid">${stockCard(c, i, "S")}${stockCard(c, i, "IS")}</div></div></section>`
      )
      .join("") +
    `<div class="actions" style="margin-bottom:24px">${button("add-cocktail", "+ Add independent cocktail")}</div>` +
    volumePlan(r) +
    s.cocktails
      .map((c) => {
        const cr = r.cocktails?.find((x) => x.id === c.id) || {};
        return `<section class="panel"><div class="panel-heading"><h2>${escape(c.name) || "Cocktail"} · Transfer worksheet</h2>${badge(s.confirmed ? "Confirmed plan" : "Plan preview", s.confirmed ? "teal" : "amber")}</div><div class="panel-body"><div class="result-strip"><div><small>Final Cocktail Volume (µL)</small><strong>${fmt(cr.finalUL)}</strong></div><div><small>Cocktail Volume per Assay (µL)</small><strong>${fmt(cr.assayUL)}</strong></div></div></div>${cocktailTable(c, cr)}<div class="panel-body">${messages(cr.errors)}${formula([...(cr.formulas || []), ...(cr.rows || []).flatMap((row) => row.formulas || [])])}</div></section>`;
      })
      .join("") +
    review(r)
  );
}
function review(r) {
  const e = editor(),
    ready = !r.errors.length && (route !== "buffer" || e.inputs.components.every((c) => c.reviewed));
  return `<section class="panel"><div class="panel-heading"><h2>Calculation review &amp; record</h2>${badge(e.status, e.status === "Reviewed" ? "teal" : "amber")}</div><div class="panel-body">${messages(r.errors)}${route === "buffer" && e.inputs.components.some((c) => !c.reviewed) ? '<p class="help">Check Calculation Review for each component after verifying the inputs.</p>' : ""}<p class="help">Drafts may contain incomplete inputs. Reviewed records require valid calculations${route === "sis" ? ", sufficient stocks, and a confirmed volume plan" : ", actual preparation inputs, and checked components"}. Saving and imports use only this browser. Rules ${RULE_VERSION}.</p><div class="actions">${button("review", "Mark Reviewed", "", !ready ? "disabled" : "")}${button("save", "Save Preparation Record", "primary")}${button("export-current", "Export JSON")}${button("print", route === "sis" ? "Print operation sheet" : "Print preparation sheet", "", route === "sis" && !e.inputs.confirmed ? "disabled" : "")}</div></div></section>`;
}
function recordsPage() {
  return `<div class="title-row"><div><div class="eyebrow">YOUR LOCAL NOTEBOOK</div><h1>Preparation Records</h1><p class="subtitle">Reopen, edit, or duplicate a preparation. Export JSON to back up your records.</p></div><label class="button primary">Import JSON<input type="file" accept=".json,application/json" id="record-file" hidden></label></div><div class="notice">Records and imported data are saved only in this browser. No backend or company system is connected. Imported records open as Draft and retain their original result snapshot.</div><section class="panel"><div class="panel-heading"><h2>Saved preparations</h2>${badge(`${records.length} records`)}</div>${records.length ? `<div class="table-wrap"><table class="inventory-table"><thead><tr><th>Preparation</th><th>Module</th><th>Status</th><th>Last saved</th><th>Actions</th></tr></thead><tbody>${records.map((r) => `<tr><td><strong>${escape(r.name)}</strong><br>${r.demo ? badge("Demo data", "amber") : ""}</td><td>${r.kind === "buffer" ? "Buffer Making" : "S/IS Making"}</td><td>${badge(r.status, r.status === "Reviewed" ? "teal" : "amber")}</td><td>${escape(r.updatedAt?.replace("T", " ").slice(0, 16))} UTC<br><span class="help">Rules ${escape(r.ruleVersion)}</span></td><td><div class="actions">${button("open-record", "Open", "small", `data-id="${escape(r.id)}"`)}${button("copy-record", "Copy as new", "small", `data-id="${escape(r.id)}"`)}${button("export-record", "JSON", "small", `data-id="${escape(r.id)}"`)}${button("delete-record", "Delete", "small danger", `data-id="${escape(r.id)}"`)}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="panel-body"><div class="empty">No saved records yet. Start a preparation and select Save Preparation Record.</div></div>'}</section>`;
}
function printSheet() {
  if (!["buffer", "sis"].includes(route)) return "";
  const e = editor(),
    r = results(),
    b = e.inputs;
  return `<article class="operation"><h1>Lab Preparation Workbench</h1><h2>${escape(b.name) || "Untitled preparation"}</h2><p>${route === "buffer" ? "Buffer Making" : "S/IS Making"} · ${escape(e.status)}${b.demo ? " · Demo data" : ""} · Rules ${escape(e.snapshot?.ruleVersion || RULE_VERSION)}</p><p>Browser local record · Printed ${new Date().toISOString()}</p>${messages(r.errors)}${messages(r.warnings, "warning")}${
    route === "buffer"
      ? `<h2>Final Buffer Volume: ${escape(b.volume)} ${escape(b.volumeUnit)}</h2><p><strong>Bring to the final buffer volume after adding all stocks and other liquids.</strong></p>${b.components
          .map((c, i) => {
            const cr = r.rows?.[i] || {};
            return `<section class="print-block"><h3>${i + 1}. ${escape(c.name)} · ${escape(c.form)}</h3><p>Inventory snapshot: ${escape(JSON.stringify(c.inventory))}</p><p>MW: ${escape(c.mw)} g/mol · Target: ${escape(c.target)} ${escape(c.targetUnit)} · Required mass: ${fmt(cr.requiredMg)} mg · Method: ${escape(cr.method)}${c.form === "pure-liquid" ? ` · Density: ${escape(c.density)} g/mL` : ""}</p><p>Actual mass: ${escape(c.actualMass) || "—"} ${escape(c.massUnit)} · Actual liquid: ${escape(c.actualLiquid) || "—"} ${escape(c.liquidUnit)} · Stock final volume: ${escape(c.stockVolume) || "—"} ${escape(c.stockVolumeUnit)}</p><p>Stock concentration: ${fmt(cr.stockMM)} mM · Stock transfer required: ${fmt(cr.transferML)} mL · Actual stock transfer: ${escape(c.actualTransfer) || "—"} ${escape(c.transferUnit)} · Actual final concentration: ${fmt(cr.actualMM)} mM</p></section>`;
          })
          .join("")}`
      : `${
          r.cocktails
            ?.map((cr) => {
              const c = b.cocktails.find((c) => c.id === cr.id);
              if (!c) return "";
              return `<section><h2>${escape(c.name)} · Final Cocktail Volume: ${fmt(cr.finalUL)} µL</h2><p>Cocktail Volume per Assay: ${fmt(cr.assayUL)} µL · Original Volume: ${fmt(cr.plan?.originalVolume)} µL · Proposed Volume: ${fmt(cr.plan?.proposedVolume)} µL · Original IS Aliquot: ${fmt(cr.plan?.originalIS)} µL · Final IS Aliquot: ${fmt(cr.plan?.finalIS)} µL</p><p><strong>${escape(cr.plan?.reason)}</strong></p>${[
                "S",
                "IS",
              ]
                .map((role) => {
                  const st = c.stocks[role],
                    sr = calculateSingle(st);
                  return `<p>${role}: ${escape(st.name)} · MW ${escape(st.mw) || "missing"} g/mol · Lot ${escape(st.lot)} · Prepared ${escape(st.date)} · Solvent ${escape(st.solvent)} · Source ${escape(st.source)} · Mass ${escape(st.mass) || "—"} ${escape(st.massUnit)} · qNMR amount ${escape(st.amount) || "—"} ${escape(st.amountUnit)} · qNMR concentration ${escape(st.qConcentration) || "—"} ${escape(st.qUnit)} at sample volume ${escape(st.sampleVolume) || "—"} ${escape(st.sampleUnit)} · ${st.volumeBasis === "solvent" ? "Solvent Added (volume approximation)" : "Final Solution Volume"} ${fmt(sr.prepUL)} µL</p>`;
                })
                .join("")}${cocktailTable(c, cr)}${messages(cr.errors)}</section>`;
            })
            .join("") || ""
        }`
  }<p>Reviewed by: ____________________ &nbsp; Date: ____________________</p><p>Rules: Minimum IS ${escape(r.rules?.minimumISuL)} µL; IS Scale-Up Threshold ${escape(r.rules?.thresholdISuL)} µL; stock required below 100 mg; final volume includes all liquid additions.</p></article>`;
}
function render() {
  const active = document.activeElement,
    focus = active?.id,
    start = active?.selectionStart,
    end = active?.selectionEnd;
  const opened = editor()?.snapshot,
    stale = opened && opened.ruleVersion !== RULE_VERSION;
  app.innerHTML =
    header() +
    `<main class="shell" id="main"><div class="breadcrumb"><a href="#home">Workbench</a> &nbsp;/&nbsp; ${escape({ home: "Overview", buffer: "Buffer Making", sis: "S/IS Making", records: "Records" }[route] || "Overview")}</div><div class="workspace">${storageError ? messages([storageError]) : ""}${notice ? `<div class="notice">${escape(notice)}</div>` : ""}${stale ? `<h1>${escape(opened.name)}</h1><div class="notice warning">This record uses rules ${escape(opened.ruleVersion)}. Saved results are preserved as a read-only snapshot. Recalculate explicitly to edit under current rules ${RULE_VERSION}.</div>${button("recalculate", "Recalculate with current rules", "primary")}<pre>${escape(JSON.stringify(opened, null, 2))}</pre>` : route === "home" ? home() : route === "buffer" ? buffer() : route === "sis" ? sis() : recordsPage()}</div>${stale ? "" : printSheet()}<footer class="footer"><span>Lab Preparation Workbench · Browser local storage · Export records for backup</span><span>Explicit units. Traceable calculations. &nbsp; Rules ${RULE_VERSION}</span></footer></main>`;
  if (focus) {
    const next = document.getElementById(focus);
    if (next) {
      next.focus({ preventScroll: true });
      if (start != null && next.setSelectionRange)
        try {
          next.setSelectionRange(start, end);
        } catch {
          /* Selects do not have a text selection. */
        }
    }
  }
}
function navigate(r) {
  location.hash = r;
  if (route === r) render();
}
function openRecord(r) {
  editors[r.kind] = {
    inputs: structuredClone(r.inputs),
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    dirty: false,
    snapshot: structuredClone(r),
  };
  navigate(r.kind);
}
function download(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${r.demo ? "demo-" : ""}${r.kind}-${r.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function persistInventory() {
  try {
    localStorage.setItem("lab.inventory.v1", JSON.stringify(inventory));
  } catch {
    toast("Inventory is available for this session, but browser storage is full. Selected row snapshots are still included when saving a record.");
  }
}
function useSheet() {
  const table = tableFromRows(workbook[sheetIndex].rows, headerRow);
  inventory = { ...table, mapping: suggestMapping(table.headers), source: `${useSheet.filename} / ${workbook[sheetIndex].name}`, demo: false };
  persistInventory();
  query = "";
  render();
}
app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "inventory-query") {
    query = target.value;
    render();
    return;
  }
  if (!target.dataset.path || target.tagName === "SELECT" || target.type === "checkbox") return;
  try {
    invalidate();
    set(editor().inputs, target.dataset.path, target.value);
    normalizePreparationMethods();
    render();
  } catch (e) {
    toast(e.message);
  }
});
app.addEventListener("change", async (event) => {
  const t = event.target;
  try {
    if (t.id === "inventory-file") {
      if (!t.files[0]) return;
      inventoryLoading = true;
      render();
      try {
        const sheets = await readInventoryFile(t.files[0]);
        if (!sheets.length) throw new Error("No worksheets found.");
        useSheet.filename = t.files[0].name;
        workbook = sheets;
        sheetIndex = 0;
        headerRow = 1;
        useSheet();
        toast("Inventory imported into this browser. Map the search fields before selecting a component.");
      } finally {
        inventoryLoading = false;
        render();
      }
    } else if (t.id === "sheet-index") {
      sheetIndex = Number(t.value);
      headerRow = 1;
      useSheet();
    } else if (t.id === "header-row") {
      headerRow = Number(t.value);
      useSheet();
    } else if (t.dataset.map) {
      inventory.mapping[t.dataset.map] = t.value;
      persistInventory();
      render();
    } else if (t.id === "record-file") {
      if (!t.files[0]) return;
      const r = decodeRecord(await t.files[0].text());
      r.id = uid();
      r.status = "Draft";
      r.imported = true;
      saveRecord(r);
      records = readRecords();
      render();
      toast("Record imported as Draft. Saved results preserved; review before use.");
    } else if (t.dataset.path && (t.tagName === "SELECT" || t.type === "checkbox")) {
      if (t.dataset.path.endsWith(".reviewed")) {
        set(editor().inputs, t.dataset.path, t.checked);
        editor().dirty = true;
        editor().snapshot = null;
        editor().status = "Draft";
      } else {
        invalidate();
        set(editor().inputs, t.dataset.path, t.type === "checkbox" ? t.checked : t.value);
        normalizePreparationMethods();
      }
      render();
    }
  } catch (e) {
    toast(e.message);
  }
});
app.addEventListener("click", (event) => {
  const b = event.target.closest("[data-action]");
  if (!b) return;
  const action = b.dataset.action,
    e = editor();
  try {
    if (action === "new") {
      if (e.dirty && !confirm("Discard unsaved changes and start a new preparation?")) return;
      editors[route] = { inputs: route === "buffer" ? blankBuffer() : blankSIS(), status: "Draft", dirty: false };
    } else if (action === "demo-inventory") {
      inventory = {
        headers: ["Chemical", "CAS", "Barcode", "MW", "Supplier", "Lot"],
        rows: [
          { Chemical: "Sodium chloride", CAS: "7647-14-5", Barcode: "DEMO-001", MW: "58.44", Supplier: "Demo supplier", Lot: "DEMO-ONLY" },
          { Chemical: "Glycine", CAS: "56-40-6", Barcode: "DEMO-002", MW: "75.07", Supplier: "Demo supplier", Lot: "DEMO-ONLY" },
        ],
        mapping: { name: "Chemical", cas: "CAS", barcode: "Barcode", mw: "MW", density: "" },
        source: "Demo data / Example inventory",
        demo: true,
      };
      workbook = [];
      query = "";
      persistInventory();
    } else if (action === "add-component") {
      if (!inventory.mapping.name) throw new Error("Map a chemical name column first.");
      invalidate();
      e.inputs.components.push(componentFromRow(inventory.rows[Number(b.dataset.index)], inventory.mapping, inventory.source));
      if (inventory.demo) e.inputs.demo = true;
    } else if (action === "remove-component") {
      invalidate();
      e.inputs.components.splice(Number(b.dataset.index), 1);
    } else if (action === "add-cocktail") {
      invalidate();
      e.inputs.cocktails.push(blankCocktail());
    } else if (action === "remove-cocktail") {
      invalidate();
      e.inputs.cocktails.splice(Number(b.dataset.index), 1);
    } else if (action === "demo-sis") {
      if (e.dirty && !confirm("Replace unsaved S/IS inputs with clearly marked Demo data?")) return;
      editors.sis = { inputs: demoSIS(), status: "Draft", dirty: true };
    } else if (action === "match" || action === "reset-match") {
      invalidate();
      e.inputs.match = action === "match";
    } else if (action === "confirm-plan") {
      const r = calculateSIS(e.inputs);
      if (r.plan.length !== e.inputs.cocktails.length || !r.plan.length || r.plan.some((p) => below(p.finalIS, Number(e.inputs.minimum))))
        throw new Error("The volume plan does not satisfy the minimum IS aliquot. Review the inputs or use Match Batch Volumes.");
      e.inputs.confirmed = true;
      e.dirty = true;
      e.snapshot = null;
      e.status = "Draft";
      toast("Volume plan confirmed. Review stock availability and calculations before marking Reviewed.");
    } else if (action === "review") {
      makeRecord(route, e.inputs, "Reviewed");
      e.status = "Reviewed";
      e.dirty = true;
      toast("Calculation marked Reviewed. Save Preparation Record to keep this status.");
    } else if (action === "save") {
      if (e.snapshot && e.snapshot.ruleVersion !== RULE_VERSION) throw new Error("Recalculate explicitly before saving under current rules.");
      const record = makeRecord(route, e.inputs, e.status, e.id, e.createdAt);
      saveRecord(record);
      records = readRecords();
      e.id = record.id;
      e.createdAt = record.createdAt;
      e.dirty = false;
      e.snapshot = record;
      toast(`${record.status} preparation saved in this browser${record.demo ? " · Demo data" : ""}.`);
    } else if (action === "export-current") {
      download(e.snapshot && !e.dirty ? e.snapshot : makeRecord(route, e.inputs, e.status, e.id, e.createdAt));
    } else if (action === "print") {
      if (route === "sis" && !e.inputs.confirmed) throw new Error("Confirm the volume plan before printing an operation sheet.");
      window.print();
      return;
    } else if (action === "recalculate") {
      invalidate();
      toast("Recalculated with current rules. Review is required.");
    } else if (["open-record", "copy-record", "export-record", "delete-record"].includes(action)) {
      const r = records.find((r) => r.id === b.dataset.id);
      if (!r) throw new Error("Record no longer exists.");
      if (action === "open-record") {
        if (editors[r.kind].dirty && !confirm("Replace unsaved editor inputs with this saved record?")) return;
        openRecord(r);
        return;
      }
      if (action === "copy-record") {
        if (editors[r.kind].dirty && !confirm("Replace unsaved editor inputs with a new copy?")) return;
        const copy = copyRecord(r);
        editors[r.kind] = { inputs: copy.inputs, status: "Draft", dirty: true };
        navigate(r.kind);
        return;
      }
      if (action === "export-record") {
        download(r);
        return;
      }
      if (action === "delete-record" && confirm(`Delete "${r.name}" from this browser? Export a backup first if needed.`)) {
        removeRecord(r.id);
        records = readRecords();
      }
    }
    render();
  } catch (error) {
    toast(`Unable to complete action: ${error.message}`);
  }
});
window.addEventListener("hashchange", () => {
  route = ["home", "buffer", "sis", "records"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  notice = "";
  render();
  window.scrollTo(0, 0);
});
window.addEventListener("beforeunload", (event) => {
  if (Object.values(editors).some((e) => e.dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
render();
